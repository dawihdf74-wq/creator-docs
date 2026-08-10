--[[
	MapKeep
	Keeps hand edits when the map is regenerated.

	`HandEdited` freezes the whole map, which means changes to WorldBuilder never
	show up again. That is the wrong trade if you are still writing map code. This
	module does the other thing: the map regenerates every start as normal, and
	your edits are re-applied on top.

	Edits are kept in two different ways, because they are two different problems.

	  THINGS YOU ADDED live in Workspace.BigBebehWorld.Custom. That folder is
	  lifted out before the rebuild and put back afterwards, so it is never
	  touched. Anything you build goes there and simply survives.

	  THINGS YOU CHANGED -- a shop you dragged, a fence you recoloured, scenery
	  you deleted -- are recorded as overrides in a MapEdits ModuleScript and
	  replayed after each build.

	An override has to name the part it belongs to, and generated parts share
	names by the hundred ("Fence", "Bush"). So every generated instance is
	stamped with a BuildId: its path plus its position among same-named siblings,
	e.g. `Areas/Area1_Cookie Nursery/Shop/Post#2`. Generation is deterministic, so
	the same part gets the same id every run.

	The honest limit: change the code so a part is no longer generated, and its
	override has nowhere to land. Those are reported, not silently dropped, so
	you find out rather than wondering where an edit went.
]]

local MapKeep = {}

local CUSTOM_NAME = "Custom"

-- Only these are worth replaying. Anything else is either derived (Position is
-- part of CFrame) or not meaningfully editable by hand.
local TRACKED = {
	"CFrame",
	"Size",
	"Color",
	"Material",
	"Transparency",
	"CanCollide",
	"Anchored",
	"Reflectance",
}

--[[
	The folder your own builds live in. Created on demand, so it exists to drag
	things into the moment the map is first built.
]]
function MapKeep.customFolder(world: Instance): Folder
	local custom = world:FindFirstChild(CUSTOM_NAME)
	if not custom then
		custom = Instance.new("Folder")
		custom.Name = CUSTOM_NAME
		custom.Parent = world
	end
	return custom :: Folder
end

--[[
	Lifts the Custom folder out of the old world so it survives the Destroy that
	follows. Returns nil when there is nothing to keep.
]]
function MapKeep.detach(world: Instance?): Folder?
	if not world then
		return nil
	end
	local custom = world:FindFirstChild(CUSTOM_NAME)
	if not custom then
		return nil
	end
	custom.Parent = nil
	return custom :: Folder
end

function MapKeep.restore(world: Instance, custom: Folder?)
	if custom then
		custom.Parent = world
	else
		MapKeep.customFolder(world)
	end
end

--[[
	Gives every generated instance a stable id.

	The ordinal is per-name within a parent, so adding a new kind of part beside
	an existing one does not renumber it -- only adding another part of the SAME
	name in the SAME parent shifts the ones after it.
]]
function MapKeep.stamp(world: Instance)
	local function walk(node: Instance, prefix: string)
		local counts: { [string]: number } = {}
		for _, child in node:GetChildren() do
			-- Your own folder is not generated, so it is not stamped.
			if child.Name == CUSTOM_NAME and node == world then
				continue
			end
			local n = (counts[child.Name] or 0) + 1
			counts[child.Name] = n
			local id = `{prefix}{child.Name}#{n}`
			child:SetAttribute("BuildId", id)
			walk(child, id .. "/")
		end
	end
	walk(world, "")
end

local function index(world: Instance): { [string]: Instance }
	local byId: { [string]: Instance } = {}
	for _, node in world:GetDescendants() do
		local id = node:GetAttribute("BuildId")
		if type(id) == "string" then
			byId[id] = node
		end
	end
	return byId
end

MapKeep.index = index

--[[
	Replays the overrides in `edits` onto a freshly built world.

	Returns how many landed and a list of ids that no longer exist, which is the
	signal that the map code changed underneath an edit.
]]
function MapKeep.apply(world: Instance, edits: any): (number, { string })
	MapKeep.stamp(world)

	if type(edits) ~= "table" then
		return 0, {}
	end

	local byId = index(world)
	local applied = 0
	local orphans: { string } = {}

	-- Deletions first: no point restyling something that is about to go.
	for id in edits.removed or {} do
		local node = byId[id]
		if node then
			node:Destroy()
			byId[id] = nil
			applied += 1
		else
			table.insert(orphans, id)
		end
	end

	for id, props in edits.props or {} do
		local node = byId[id]
		if not node then
			table.insert(orphans, id)
			continue
		end
		for key, value in props do
			-- One bad property must not stop the rest of the map being restored.
			local ok, err = pcall(function()
				if key == "CFrame" then
					(node :: any).CFrame = CFrame.new(table.unpack(value))
				elseif key == "Size" then
					(node :: any).Size = Vector3.new(value[1], value[2], value[3])
				elseif key == "Color" then
					(node :: any).Color = Color3.fromRGB(value[1], value[2], value[3])
				elseif key == "Material" then
					(node :: any).Material = (Enum.Material :: any)[value]
				else
					(node :: any)[key] = value
				end
			end)
			if not ok then
				warn(`[MapKeep] Could not restore {key} on {id}: {err}`)
			end
		end
		applied += 1
	end

	return applied, orphans
end

--[[
	The whole job in one call, for WorldBuilder to use at the end of a build.
	Finds MapEdits next to itself if it exists; without one this just stamps ids,
	so the capture tool has something to compare against.
]]
function MapKeep.finish(world: Instance, custom: Folder?)
	MapKeep.restore(world, custom)

	local module = script.Parent:FindFirstChild("MapEdits")
	if not module or not module:IsA("ModuleScript") then
		MapKeep.stamp(world)
		return
	end

	local ok, edits = pcall(require, module)
	if not ok then
		warn(`[MapKeep] MapEdits could not be loaded, map left as generated: {edits}`)
		MapKeep.stamp(world)
		return
	end

	local applied, orphans = MapKeep.apply(world, edits)
	if applied > 0 then
		print(`[MapKeep] Restored {applied} hand edit(s).`)
	end
	if #orphans > 0 then
		warn(
			`[MapKeep] {#orphans} edit(s) had nowhere to land -- the map code no longer builds those parts. `
				.. `First: {orphans[1]}. Re-run the capture tool to drop them.`
		)
	end
end

MapKeep.TRACKED = TRACKED

return MapKeep
