--[[
	Big Bebeh — which module is actually broken?

	Run this after "Requested module experienced an error while loading".

	That message names the module you asked for, not the one that broke. If
	GameConfig has an error, requiring WorldBuilder reports WorldBuilder — because
	WorldBuilder requires GameConfig and the failure travels outward. So this
	loads each module on its own, in dependency order, and the FIRST failure is
	the real one; everything after it is an echo.

	Two things worth knowing about Studio while you are here:

	  - A module that errors is cached as failed for the rest of the session. Every
	    later require gets the same generic message instead of the real error, so
	    the useful text is the FIRST occurrence in the Output window.
	  - If every module below reports the generic message, restart Studio and run
	    this again. That clears the cache and you get the real error with a line
	    number.

	Reads only. Requiring a module does run it, so a module with side effects at
	the top level will do them -- none of these have any.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")

local report = {}
local function say(line)
	table.insert(report, line)
end

local gameFolder = ServerScriptService:FindFirstChild("BigBebehGame")
if not gameFolder then
	return "FAILED  ServerScriptService.BigBebehGame not found."
end

local sharedFolder = ReplicatedStorage:FindFirstChild("BigBebehShared")
if not sharedFolder then
	say("MISSING ReplicatedStorage.BigBebehShared — nothing that needs GameConfig can load.")
end

local uiFolder = sharedFolder and sharedFolder:FindFirstChild("UI")

-- Dependency order: anything that fails here explains every failure below it.
local TARGETS = {
	{ parent = sharedFolder, name = "GameConfig" },
	{ parent = sharedFolder, name = "Remotes" },
	{ parent = uiFolder, name = "Theme" },
	{ parent = uiFolder, name = "Components" },
	{ parent = gameFolder, name = "MapKeep" },
	{ parent = gameFolder, name = "MapEdits", optional = true },
	{ parent = gameFolder, name = "SessionLock" },
	{ parent = gameFolder, name = "BebehBuilder" },
	{ parent = gameFolder, name = "PlayerState" },
	{ parent = gameFolder, name = "AntiCheat" },
	{ parent = gameFolder, name = "Leaderboard" },
	{ parent = gameFolder, name = "WorldBuilder" },
}

local GENERIC = "Requested module experienced an error while loading"

local failures, echoes, firstBroken = 0, 0, nil

for _, target in TARGETS do
	local module = target.parent and target.parent:FindFirstChild(target.name)

	if not module then
		if not target.optional then
			say(`MISSING {target.name}`)
			failures += 1
		end
		continue
	end

	if not module:IsA("ModuleScript") then
		say(`WRONG   {target.name} is a {module.ClassName}, not a ModuleScript.`)
		failures += 1
		continue
	end

	local lines = select(2, string.gsub(module.Source, string.char(10), "")) + 1
	local ok, result = pcall(require, module)

	if ok then
		say(`OK      {target.name} ({lines} lines, returns a {type(result)})`)
	elseif string.find(tostring(result), GENERIC, 1, true) then
		-- Not this module's own error: something it requires is broken.
		echoes += 1
		failures += 1
		say(`ECHO    {target.name} — fails only because something it requires does.`)
	else
		failures += 1
		firstBroken = firstBroken or target.name
		say(`BROKEN  {target.name} ({lines} lines)`)
		say(`        {tostring(result)}`)
	end
end

say("")

if failures == 0 then
	say("RESULT  Every module loads. The build error is not a module failing to load —")
	say("        check the Output window for the actual error and send it over.")
elseif firstBroken then
	say(`RESULT  {firstBroken} is the one to fix. The line number is in the message above.`)
	if echoes > 0 then
		say(`        The other {echoes} failure(s) are just echoes of it.`)
	end
else
	say("RESULT  Every failure is an echo, so the real error is cached from earlier.")
	say("        Restart Studio and run this again — you will get the real message then.")
	say("        Or scroll the Output window back to the FIRST occurrence.")
end

print("=== Big Bebeh — check modules ===")
for _, line in report do
	print("  " .. line)
end
print("=== end ===")

return table.concat(report, string.char(10))
