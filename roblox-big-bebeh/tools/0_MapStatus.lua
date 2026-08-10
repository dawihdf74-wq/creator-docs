--[[
	Big Bebeh — what is actually in my map?

	Reads and reports. It changes nothing, so it is always safe to run, and it is
	the right first step whenever a map tool says something surprising.

	Tells you: which world folders exist in Workspace, how much is in them, how
	many parts carry a BuildId, whether the map is frozen, and what MapEdits
	currently says it will do on the next rebuild.
]]

local ServerScriptService = game:GetService("ServerScriptService")

local report = {}
local function say(line)
	table.insert(report, line)
end

local folder = ServerScriptService:FindFirstChild("BigBebehGame")
if not folder then
	return "FAILED  ServerScriptService.BigBebehGame not found."
end

-- Worlds ---------------------------------------------------------------------
-- Any leftover "__editing" copy matters too: it means a capture died halfway.

local worlds = {}
for _, child in workspace:GetChildren() do
	if string.find(child.Name, "BigBebehWorld", 1, true) then
		table.insert(worlds, child)
	end
end

if #worlds == 0 then
	say("WORLD   None. Nothing named BigBebehWorld is in Workspace.")
end

for _, world in worlds do
	local descendants = world:GetDescendants()
	local parts, stamped, customCount = 0, 0, 0

	for _, node in descendants do
		if node:IsA("BasePart") then
			parts += 1
		end
		if type(node:GetAttribute("BuildId")) == "string" then
			stamped += 1
		end
	end

	local custom = world:FindFirstChild("Custom")
	if custom then
		customCount = #custom:GetChildren()
	end

	say(`WORLD   {world.Name} ({world.ClassName})`)
	say(`        {#world:GetChildren()} direct child(ren), {#descendants} descendant(s), {parts} part(s).`)
	say(`        {stamped} carry a BuildId.`)
	say(`        Custom folder: {custom and `yes, {customCount} thing(s)` or "none"}`)
	say(`        HandEdited (frozen): {tostring(world:GetAttribute("HandEdited") ~= nil)}`)

	-- Names of the direct children, which is usually enough to tell a real map
	-- from an empty shell at a glance.
	local names = {}
	for index, child in world:GetChildren() do
		if index > 8 then
			table.insert(names, "...")
			break
		end
		table.insert(names, child.Name)
	end
	if #names > 0 then
		say(`        Children: {table.concat(names, ", ")}`)
	end
end

-- MapEdits -------------------------------------------------------------------

local edits = folder:FindFirstChild("MapEdits")
if not edits then
	say("EDITS   No MapEdits module. Nothing will be replayed on the next build.")
elseif not edits:IsA("ModuleScript") then
	say(`EDITS   MapEdits is a {edits.ClassName}, not a ModuleScript. Delete it.`)
else
	local ok, loaded = pcall(require, edits)
	if not ok or type(loaded) ~= "table" then
		say(`EDITS   MapEdits does not load: {tostring(loaded)}`)
	else
		local changed, deleted = 0, 0
		for _ in loaded.props or {} do
			changed += 1
		end
		for _ in loaded.removed or {} do
			deleted += 1
		end
		say(`EDITS   MapEdits will change {changed} part(s) and delete {deleted}.`)
		if deleted > 200 then
			say("        WARNING That many deletions would gut the map. Delete MapEdits before building.")
		end
	end
end

-- Modules --------------------------------------------------------------------

local mapKeep = folder:FindFirstChild("MapKeep")
if not mapKeep then
	say("MODULE  MapKeep is missing — run 1_InstallModules.")
else
	local fillOnly = string.find(mapKeep.Source, "local keep: { [Instance]: string } = {}", 1, true) ~= nil
	say(`MODULE  MapKeep present ({#mapKeep.Source} chars), fill-only stamping: {tostring(fillOnly)}`)
	if not fillOnly then
		say("        That is the old version. Run 1_InstallModules before capturing edits.")
	end
end

-- What to do next ------------------------------------------------------------

local main = worlds[1]
local stampedAny = false
if main then
	for _, node in main:GetDescendants() do
		if type(node:GetAttribute("BuildId")) == "string" then
			stampedAny = true
			break
		end
	end
end

-- Pressing Play is deliberately not the advice here. That map lives only inside
-- the play session and is gone when you stop, so it is no use for editing.
if not main then
	say("NEXT    Nothing to edit. Run BuildMapInStudio to put the map in Workspace.")
elseif #main:GetDescendants() < 50 then
	say("NEXT    This world is nearly empty. Delete it, then run BuildMapInStudio to rebuild.")
elseif not stampedAny then
	say("NEXT    Nothing is stamped yet. 5_SaveMapEdits will stamp it for you.")
else
	say("NEXT    Looks healthy. Edit the map, then run 5_SaveMapEdits.")
end

print("=== Big Bebeh — map status ===")
for _, line in report do
	print("  " .. line)
end
print("=== end ===")

return table.concat(report, string.char(10))
