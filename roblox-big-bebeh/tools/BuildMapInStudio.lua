--[[
	Big Bebeh — put the map in Workspace so you can see and edit it.

	The world is generated when the server starts, so in edit mode Workspace is
	empty and there is nothing to look at. Pressing Play does not help: that map
	exists only inside the play session and goes away when you stop. This builds
	it into the place, in edit mode, where it stays.

	This is the surface you edit. The loop is:

	    run this  ->  move/restyle/delete things  ->  run 5_SaveMapEdits  ->  save

	5_SaveMapEdits records what you changed into a MapEdits module, and MapKeep
	replays it after every rebuild. So the map still regenerates -- your changes
	to WorldBuilder and GameConfig keep working -- and your hand edits ride on
	top instead of being wiped.

	Anything you BUILD yourself goes in BigBebehWorld/Custom. That folder is
	never regenerated and needs no recording.

	This does NOT freeze the map. That is 4_EditableMap, which is the other
	approach: it stops the map generating at all, so map code changes stop
	having any effect. You do not want both.

	Safe to re-run: it refuses if there are edits in the world you have not
	recorded yet, rather than rebuilding over them.
]]

local ServerScriptService = game:GetService("ServerScriptService")

local report = {}
local function say(line)
	table.insert(report, line)
end

local gameFolder = ServerScriptService:FindFirstChild("BigBebehGame")
if not gameFolder then
	return "FAILED  ServerScriptService.BigBebehGame not found — is the place set up?"
end

local worldBuilder = gameFolder:FindFirstChild("WorldBuilder")
if not worldBuilder then
	return "FAILED  BigBebehGame.WorldBuilder not found."
end

local WORLD_NAME = "BigBebehWorld"
local existing = workspace:FindFirstChild(WORLD_NAME)

--[[
	Rebuilding is destructive to anything not yet recorded, so the question worth
	asking is not "is there a world here" but "would rebuilding lose work".

	A map with real content in it and no MapEdits recording anything might be
	carrying hand edits nobody has captured, and a rebuild would take them with
	it. Refuse and say so. Whether it is stamped makes no difference -- an
	unstamped map is a pre-MapKeep one, which is MORE likely to hold edits, not
	less. Only a map that is empty enough to be a shell is rebuilt without asking.
]]
if existing then
	local descendants = #existing:GetDescendants()

	local edits = gameFolder:FindFirstChild("MapEdits")
	local hasRecord = false
	if edits and edits:IsA("ModuleScript") then
		local ok, loaded = pcall(require, edits)
		if ok and type(loaded) == "table" then
			for _ in loaded.props or {} do
				hasRecord = true
				break
			end
			for _ in loaded.removed or {} do
				hasRecord = true
				break
			end
		end
	end

	if descendants >= 50 and not hasRecord then
		return table.concat({
			`STOP    {WORLD_NAME} is already here with {descendants} thing(s) in it, and no MapEdits`,
			"        is recording any changes to it.",
			"",
			"        If you have edited this map, run 5_SaveMapEdits FIRST — rebuilding now",
			"        would throw those edits away.",
			"",
			"        If you have not edited it, delete BigBebehWorld and run this again.",
		}, string.char(10))
	end

	existing:Destroy()
	say(`REPLACED The {WORLD_NAME} that was here ({descendants} thing(s)).`)
end

local ok, err = pcall(function()
	require(worldBuilder).build()
end)

if not ok then
	return `FAILED  Could not build the map: {tostring(err)}`
end

local world = workspace:FindFirstChild(WORLD_NAME)
if not world then
	return "FAILED  The builder ran but produced no BigBebehWorld."
end

if world:GetAttribute("HandEdited") then
	say("NOTE    This map is marked HandEdited, so the server will use it as-is and stop")
	say("        generating. Clear that attribute if you want map code to keep working.")
end

local parts, stamped = 0, 0
for _, node in world:GetDescendants() do
	if node:IsA("BasePart") then
		parts += 1
	end
	if type(node:GetAttribute("BuildId")) == "string" then
		stamped += 1
	end
end

say(`BUILT   {parts} part(s) in Workspace.{WORLD_NAME}, {stamped} stamped with a BuildId.`)

if stamped == 0 then
	say("WARNING Nothing was stamped — MapKeep is not wired into WorldBuilder.")
	say("        Run 1_InstallModules and 2_PatchHooks, then run this again.")
end

say("NEXT    Edit the map. Build your own stuff inside BigBebehWorld/Custom.")
say("THEN    Run 5_SaveMapEdits to record it, and save the place.")

print("=== Big Bebeh — build the map here ===")
for _, line in report do
	print("  " .. line)
end
print("=== end ===")

return table.concat(report, string.char(10))
