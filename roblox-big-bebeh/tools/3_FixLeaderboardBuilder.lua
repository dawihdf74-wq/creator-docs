--[[
	Big Bebeh — add the missing leaderboard builder.

	Fixes "WorldBuilder: attempt to call a nil value" after patching: the call to
	buildLeaderboards was added but the function itself was not, so at the call
	site the name is nil.

	This only ADDS what is missing. It does not replace your WorldBuilder, so any
	custom areas, portals or boards you have written stay exactly as they are.

	The function is inserted directly above `local function buildArea`, because a
	`local function` in Lua is only visible below its own declaration -- putting
	it there guarantees every caller can see it, whatever else you have changed.
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

local module = folder:FindFirstChild("WorldBuilder")
if not module then
	return "FAILED  WorldBuilder not found under BigBebehGame."
end

local BUILDER = [=[
--[[
	A row of global leaderboards.

	Unlike the upgrade board, these are drawn by the SERVER. Every player sees
	the same ten names, so rendering them once and letting them replicate beats
	rebuilding the same list in every client.

	Each face is tagged so the game script can find it again to fill in rows;
	the builder only puts up the empty board.
]]
local function buildLeaderboards(areaIndex: number, cfg: any, parent: Instance)
	local folder = Instance.new("Folder")
	folder.Name = "Leaderboards"
	folder.Parent = parent

	local anchor = GameConfig.getLandmark(areaIndex, "LeaderboardOffset")
	local yaw = CFrame.Angles(0, math.rad(GameConfig.Areas[areaIndex].LeaderboardYaw or 0), 0)
	local base = CFrame.new(anchor) * yaw

	local boardWidth, boardHeight, spacing = 20, 26, 23
	local count = #GameConfig.Leaderboards
	-- Lay the row out around its centre, so the anchor means the middle of the
	-- row rather than the first board.
	local startX = -(count - 1) * spacing / 2

	for index, board in GameConfig.Leaderboards do
		local at = base * CFrame.new(startX + (index - 1) * spacing, 0, 0)

		makeAnchoredPart(
			"LeaderboardLeg",
			Vector3.new(1.4, 10, 1.4),
			at * CFrame.new(0, 5, 0),
			Color3.fromRGB(96, 74, 58),
			folder
		)
		makeAnchoredPart(
			"LeaderboardFrame",
			Vector3.new(boardWidth + 2, boardHeight + 2, 1.4),
			at * CFrame.new(0, 10 + boardHeight / 2, 0),
			Color3.fromRGB(64, 52, 74),
			folder
		)

		local face = makeAnchoredPart(
			"LeaderboardFace",
			Vector3.new(boardWidth, boardHeight, 1),
			at * CFrame.new(0, 10 + boardHeight / 2, -0.6),
			Color3.fromRGB(26, 24, 36),
			folder
		)
		face.Material = Enum.Material.SmoothPlastic
		-- Which board this is, so the filler does not have to rely on order.
		face:SetAttribute("BoardId", board.Id)
		CollectionService:AddTag(face, "Leaderboard")
	end

	local header = makeAnchoredPart(
		"LeaderboardHeader",
		Vector3.new(1, 1, 1),
		base * CFrame.new(0, 10 + boardHeight + 5, 0),
		cfg.AccentColor,
		folder
	)
	header.Transparency = 1
	header.CanCollide = false
	makeSign("🏆 HALL OF CRUMBS", UDim2.fromScale(26, 4), header, 0)

	return folder
end]=]

local DEF = "local function buildLeaderboards"
local CALL = "buildLeaderboards(areaIndex, cfg, folder)"
local AREA = "local function buildArea"
local BOARD_CALL = "buildUpgradeBoard(areaIndex, cfg, folder)"

local source = module.Source
local changed = false

local function lineOf(text, needle)
	local at = string.find(text, needle, 1, true)
	if not at then
		return nil
	end
	local _, newlines = string.gsub(string.sub(text, 1, at), "\n", "")
	return newlines + 1
end

say(`FOUND   definition at line {tostring(lineOf(source, DEF))}, call at line {tostring(lineOf(source, CALL))}.`)

-- 1. The definition, above buildArea so every caller can see it.
if string.find(source, DEF, 1, true) then
	say("SKIP    The builder is already defined.")
else
	local at = string.find(source, AREA, 1, true)
	if not at then
		say(`FAILED  Could not find "{AREA}" to insert above. Nothing changed.`)
	else
		source = string.sub(source, 1, at - 1) .. BUILDER .. "\n\n" .. string.sub(source, at)
		changed = true
		say(`ADDED   The leaderboard builder ({#BUILDER} chars), above buildArea.`)
	end
end

-- 2. The call, if the patch never managed to add it.
if string.find(source, CALL, 1, true) then
	say("SKIP    The call is already there.")
elseif string.find(source, BOARD_CALL, 1, true) then
	source = string.gsub(
		source,
		"(\n(\t*)" .. string.gsub(BOARD_CALL, "[%(%)%.%%%+%-%*%?%[%]%^%$]", "%%%1") .. ")",
		"%1\n%2" .. CALL,
		1
	)
	changed = true
	say("ADDED   The call, next to buildUpgradeBoard.")
else
	say("NOTE    No buildUpgradeBoard call to sit beside; add buildLeaderboards yourself where you want the boards.")
end

-- 3. Tidy the indentation the original patch got wrong. Cosmetic only -- Lua
--    does not care -- but a stray outdent in someone else's file is rude.
local tidied, fixes = string.gsub(source, "\n\t" .. string.gsub(CALL, "[%(%)%.%%%+%-%*%?%[%]%^%$]", "%%%1") .. "\n\tend", "\n\t\t" .. CALL .. "\n\tend")
if fixes > 0 then
	source = tidied
	changed = true
	say("TIDIED  Indentation of the call.")
end

if changed then
	module.Source = source
	say(`DONE    definition now at line {tostring(lineOf(source, DEF))}, call at line {tostring(lineOf(source, CALL))}.`)
	local defAt = string.find(source, DEF, 1, true)
	local callAt = string.find(source, CALL, 1, true)
	if defAt and callAt and defAt < callAt then
		say("OK      The definition comes before the call, so it will resolve.")
	else
		say("WARNING The definition is still not above the call — tell Claude.")
	end
else
	say("OK      Nothing needed changing.")
end

print("=== Big Bebeh — fix leaderboard builder ===")
for _, line in report do
	print("  " .. line)
end
print("=== end ===")

return table.concat(report, "\n")
