--[[
	Big Bebeh — save your map edits.

	Run this in Studio (edit mode) after moving, restyling or deleting things in
	the map. It writes what you changed into a MapEdits ModuleScript, and from
	then on every rebuild puts those changes back.

	That is the difference from HandEdited: the map still regenerates, so changes
	to WorldBuilder and GameConfig keep working, and your edits are replayed on
	top of the new map instead of freezing the old one.

	How it works: it builds a clean copy of the map, compares your version
	against it part by part, and records only the differences. Anything you BUILT
	yourself belongs in BigBebehWorld/Custom, which is never regenerated and
	needs no recording.

	Run it again whenever you change more. It rewrites the file from scratch, so
	the file always describes your map as it stands right now.
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

local WORLD_NAME = "BigBebehWorld"
local live = workspace:FindFirstChild(WORLD_NAME)
if not live then
	return "FAILED  No BigBebehWorld in Workspace. Press Play once, or run 4_EditableMap, then edit the map."
end

if live:GetAttribute("HandEdited") then
	live:SetAttribute("HandEdited", nil)
	say("CLEARED HandEdited — the map regenerates again, with your edits replayed on top.")
end

local MapKeep = require(folder:FindFirstChild("MapKeep"))
local WorldBuilder = require(folder:FindFirstChild("WorldBuilder"))

-- A pristine reference to compare against. The live world is renamed out of the
-- way first so the builder does not find and destroy it, and any existing
-- MapEdits is parked so the reference is genuinely unedited.
live.Name = WORLD_NAME .. "__editing"

local edits = folder:FindFirstChild("MapEdits")
if edits then
	edits.Name = "MapEdits__parked"
end

local built, reference = pcall(function()
	WorldBuilder.build()
	return workspace:FindFirstChild(WORLD_NAME)
end)

local function putBack()
	live.Name = WORLD_NAME
	if edits then
		edits.Name = "MapEdits"
	end
end

if not built or not reference then
	putBack()
	return `FAILED  Could not build a reference map: {tostring(reference)}`
end

-- Compare ---------------------------------------------------------------------

local function nearly(a, b)
	return math.abs(a - b) < 0.001
end

local function sameCFrame(a, b)
	local ax, ay, az = a.X, a.Y, a.Z
	local bx, by, bz = b.X, b.Y, b.Z
	if not (nearly(ax, bx) and nearly(ay, by) and nearly(az, bz)) then
		return false
	end
	local ac = { a:GetComponents() }
	local bc = { b:GetComponents() }
	for i = 4, 12 do
		if not nearly(ac[i], bc[i]) then
			return false
		end
	end
	return true
end

local liveById = MapKeep.index(live)
local refById = MapKeep.index(reference)

local props: { [string]: { [string]: any } } = {}
local removed: { string } = {}
local changedCount, removedCount = 0, 0

for id, refNode in refById do
	local mine = liveById[id]
	if not mine then
		table.insert(removed, id)
		removedCount += 1
		continue
	end
	if not refNode:IsA("BasePart") or not mine:IsA("BasePart") then
		continue
	end

	local diff = {}
	if not sameCFrame(mine.CFrame, refNode.CFrame) then
		diff.CFrame = { mine.CFrame:GetComponents() }
	end
	if (mine.Size - refNode.Size).Magnitude > 0.001 then
		diff.Size = { mine.Size.X, mine.Size.Y, mine.Size.Z }
	end
	if mine.Color ~= refNode.Color then
		diff.Color = {
			math.round(mine.Color.R * 255),
			math.round(mine.Color.G * 255),
			math.round(mine.Color.B * 255),
		}
	end
	if mine.Material ~= refNode.Material then
		diff.Material = mine.Material.Name
	end
	if not nearly(mine.Transparency, refNode.Transparency) then
		diff.Transparency = mine.Transparency
	end
	if mine.CanCollide ~= refNode.CanCollide then
		diff.CanCollide = mine.CanCollide
	end
	if mine.Anchored ~= refNode.Anchored then
		diff.Anchored = mine.Anchored
	end

	if next(diff) then
		props[id] = diff
		changedCount += 1
	end
end

-- Keep whatever you built yourself: move it onto the fresh map, then drop the
-- old one. What is left is exactly what a Play would now produce.
local custom = live:FindFirstChild("Custom")
local customCount = 0
if custom then
	customCount = #custom:GetChildren()
	local existingCustom = reference:FindFirstChild("Custom")
	if existingCustom then
		existingCustom:Destroy()
	end
	custom.Parent = reference
end

-- Write ------------------------------------------------------------------------

local function num(n)
	if n == math.floor(n) then
		return string.format("%d", n)
	end
	return string.format("%.4f", n)
end

local function listOf(values)
	local out = {}
	for _, v in values do
		table.insert(out, num(v))
	end
	return table.concat(out, ", ")
end

local lines = {
	"--[[",
	"\tMapEdits",
	"\tYour hand edits to the map, replayed after every rebuild.",
	"",
	"\tWritten by tools/5_SaveMapEdits.lua -- run that again after editing rather",
	"\tthan changing this by hand. Keys are BuildIds: a part's path plus its",
	"\tposition among same-named siblings.",
	"]]",
	"",
	"return {",
	"\tversion = 1,",
	"\tprops = {",
}

for id, diff in props do
	table.insert(lines, `\t\t["{id}"] = \{`)
	if diff.CFrame then
		table.insert(lines, `\t\t\tCFrame = \{ {listOf(diff.CFrame)} },`)
	end
	if diff.Size then
		table.insert(lines, `\t\t\tSize = \{ {listOf(diff.Size)} },`)
	end
	if diff.Color then
		table.insert(lines, `\t\t\tColor = \{ {listOf(diff.Color)} },`)
	end
	if diff.Material then
		table.insert(lines, `\t\t\tMaterial = "{diff.Material}",`)
	end
	if diff.Transparency then
		table.insert(lines, `\t\t\tTransparency = {num(diff.Transparency)},`)
	end
	if diff.CanCollide ~= nil then
		table.insert(lines, `\t\t\tCanCollide = {tostring(diff.CanCollide)},`)
	end
	if diff.Anchored ~= nil then
		table.insert(lines, `\t\t\tAnchored = {tostring(diff.Anchored)},`)
	end
	table.insert(lines, "\t\t},")
end

table.insert(lines, "\t},")
table.insert(lines, "\tremoved = {")
for _, id in removed do
	table.insert(lines, `\t\t["{id}"] = true,`)
end
table.insert(lines, "\t},")
table.insert(lines, "}")

local source = table.concat(lines, "\n") .. "\n"

if edits then
	edits.Name = "MapEdits"
	edits.Source = source
else
	local module = Instance.new("ModuleScript")
	module.Name = "MapEdits"
	module.Source = source
	module.Parent = folder
end

-- The reference, with your edits and your builds on it, becomes the live map.
live:Destroy()

local applied, orphans = MapKeep.apply(reference, {
	props = props,
	removed = (function()
		local set = {}
		for _, id in removed do
			set[id] = true
		end
		return set
	end)(),
})

say(`SAVED   {changedCount} changed part(s), {removedCount} deleted, {customCount} thing(s) in Custom kept.`)
say(`APPLIED {applied} edit(s) back onto the fresh map.`)
if #orphans > 0 then
	say(`NOTE    {#orphans} edit(s) had nowhere to land and were skipped.`)
end
say("NEXT    Save the place. Change the map code freely — your edits are replayed after every rebuild.")
say("HINT    Build your own stuff inside BigBebehWorld/Custom; that folder is never regenerated.")

print("=== Big Bebeh — save map edits ===")
for _, line in report do
	print("  " .. line)
end
print("=== end ===")

return table.concat(report, "\n")
