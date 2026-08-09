--[[
	Big Bebeh — make the map editable by hand.

	Why editing the map does nothing right now: WorldBuilder wipes and rebuilds
	Workspace.BigBebehWorld on every server start. Your edits are real, they just
	get deleted a moment later.

	Run this ONCE in Studio (edit mode, not while playing). It:

	  1. builds the map into the place, if it is not already there,
	  2. marks it HandEdited, which tells the server to use it as-is.

	Then SAVE the place. From that point the map in the place is the map: move
	things, restyle them, delete the scenery, build your own zones -- it all
	sticks, because the server stops generating.

	WHAT MUST STAY: the server finds things by CollectionService tag, not by
	position or name. Keep these tags on whatever parts you want to play those
	roles, and you can move or rebuild them freely:

	    BigBebeh          the model to feed  (needs an AreaIndex attribute)
	    FeedPad           the pad you stand on to feed
	    AreaGate          the gate into an area  (needs an AreaIndex attribute)
	    RuneCrystal       the rune altar crystal
	    UpgradeBoard      the face the upgrade GUI is drawn on
	    Leaderboard       a leaderboard face  (needs a BoardId attribute)
	    DarkCookieBoard   } your World 2 boards, if you use them
	    DarkUpgradeBoard  }
	    WorldPortal       a portal ring  (needs a PortalArea attribute)
	    ShopPrompt        the shop's ProximityPrompt

	Cookies are still spawned by the server at runtime, into the Cookies folder,
	inside each area's cookie pit as set by GameConfig.

	TO GO BACK to a generated map: select BigBebehWorld and clear its HandEdited
	attribute (or just delete the folder), then press Play.
]]

local CollectionService = game:GetService("CollectionService")
local ServerScriptService = game:GetService("ServerScriptService")

local report = {}
local function say(line)
	table.insert(report, line)
end

local gameFolder = ServerScriptService:FindFirstChild("BigBebehGame")
if not gameFolder then
	return "FAILED  ServerScriptService.BigBebehGame not found."
end

local WORLD_NAME = "BigBebehWorld"
local existing = workspace:FindFirstChild(WORLD_NAME)

if existing and existing:GetAttribute("HandEdited") then
	say("SKIP    The map is already marked HandEdited — your edits are already being kept.")
else
	if not existing then
		local ok, err = pcall(function()
			local WorldBuilder = require(gameFolder:FindFirstChild("WorldBuilder"))
			WorldBuilder.build()
		end)
		if not ok then
			return `FAILED  Could not build the map: {err}`
		end
		existing = workspace:FindFirstChild(WORLD_NAME)
		say("BUILT   Generated the map into the place.")
	else
		say("FOUND   Using the map already in the place.")
	end

	if not existing then
		return "FAILED  The builder ran but produced no BigBebehWorld."
	end

	existing:SetAttribute("HandEdited", true)
	say("MARKED  HandEdited — the server will now use this map as-is.")
end

-- What the server will be able to find. Reported so a missing tag shows up here
-- rather than as a puzzle at runtime.
local counts = {
	BigBebeh = 0,
	FeedPad = 0,
	AreaGate = 0,
	RuneCrystal = 0,
	UpgradeBoard = 0,
	Leaderboard = 0,
	ShopPrompt = 0,
}
for tag in counts do
	counts[tag] = #CollectionService:GetTagged(tag)
end

say("TAGS    " .. `BigBebeh {counts.BigBebeh}, FeedPad {counts.FeedPad}, AreaGate {counts.AreaGate}, RuneCrystal {counts.RuneCrystal}`)
say("TAGS    " .. `UpgradeBoard {counts.UpgradeBoard}, Leaderboard {counts.Leaderboard}, ShopPrompt {counts.ShopPrompt}`)

if counts.BigBebeh == 0 then
	say("WARNING No BigBebeh tagged — nothing can be fed. Tag your Bebeh models and give each an AreaIndex.")
end

say("NEXT    Save the place. Edit the map freely; it will stay as you leave it.")

print("=== Big Bebeh — editable map ===")
for _, line in report do
	print("  " .. line)
end
print("=== end ===")

return table.concat(report, "\n")
