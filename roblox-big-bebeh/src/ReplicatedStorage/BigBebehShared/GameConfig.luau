--[[
	GameConfig
	Every tunable number for the "Feed Big Bebeh" cookie game lives here.
	Tweak these values and the whole world rebuilds itself on the next run.
]]

local GameConfig = {}

-- Saving -------------------------------------------------------------------
GameConfig.SaveEnabled = true
GameConfig.DataStoreName = "BigBebehCookies_v2"
GameConfig.AutosaveInterval = 120

-- Big Bebeh's look ---------------------------------------------------------
-- Leave this empty to use the part-built Bebeh. To use your own artwork,
-- upload the picture to Roblox (Create → Decals), then paste its id here as
-- "rbxassetid://0000000000" and every Bebeh becomes a cutout of your image.
-- A Model named "BigBebeh" in ServerStorage beats both of these.
GameConfig.BebehImageId = ""
GameConfig.BebehImageAspect = 1152 / 1320 -- width / height of the artwork

-- Gameplay tuning ----------------------------------------------------------
GameConfig.FeedRadius = 16 -- studs; walk this close to Big Bebeh to auto-feed
GameConfig.FeedInterval = 0.3 -- seconds between auto-feed checks
GameConfig.CookieRespawnTime = 5 -- seconds before a picked-up cookie comes back
GameConfig.CollectRange = 14 -- server-side sanity check on pickups
GameConfig.VoidY = -60 -- fall below this and you get placed back on your area
GameConfig.MagnetInterval = 0.15 -- seconds between magnet sweeps

-- World layout -------------------------------------------------------------
-- Default platform footprint. An area can override it with its own
-- `PlatformSize`, which is how zone 1 stays a compact starter arena.
GameConfig.PlatformSize = Vector3.new(220, 6, 220)
GameConfig.AreaSpacing = 300 -- centre-to-centre distance along +X
GameConfig.BridgeWidth = 26

-- Areas --------------------------------------------------------------------
-- Feed the Bebeh in area N its HungerGoal to unlock area N + 1.
-- CarryCapacity is the base hand size once that area is unlocked; the
-- Bigger Hands upgrade multiplies it.
GameConfig.Areas = {
	{
		Name = "Cookie Nursery",
		PlatformSize = Vector3.new(190, 6, 190),
		-- Cookies spawn only inside this pit, so the rest of the map is walkable
		-- space for the board, the altar and the Bebeh.
		CookiePit = { Center = Vector3.new(0, 0, 18), Size = Vector3.new(76, 76) },
		-- Beside the pit, turned to face it. Standing it in front of the Bebeh
		-- blocked the view of him.
		BoardOffset = Vector3.new(-52, 0, 18),
		BoardYaw = -90,
		BebehOffset = Vector3.new(0, 0, -74),
		AltarOffset = Vector3.new(-62, 0, 62),
		ShopOffset = Vector3.new(62, 0, 62),
		-- Mirrors the upgrade board on the far side of the pit, turned to face it.
		LeaderboardOffset = Vector3.new(58, 0, 4),
		LeaderboardYaw = 90,
		FloorColor = Color3.fromRGB(126, 196, 122),
		AccentColor = Color3.fromRGB(255, 232, 120),
		CookieColor = Color3.fromRGB(214, 168, 106),
		CookieValue = 1,
		CookieCount = 26,
		CarryCapacity = 30,
		HungerGoal = 60,
		BebehName = "Baby Bebeh",
		BebehScale = 1,
	},
	{
		Name = "Sugar Sandbox",
		FloorColor = Color3.fromRGB(238, 205, 152),
		AccentColor = Color3.fromRGB(255, 170, 200),
		CookieColor = Color3.fromRGB(240, 214, 168),
		CookieValue = 4,
		CookieCount = 40,
		CarryCapacity = 120,
		HungerGoal = 400,
		BebehName = "Bigger Bebeh",
		BebehScale = 1.35,
	},
	{
		Name = "Frosting Fields",
		FloorColor = Color3.fromRGB(160, 214, 236),
		AccentColor = Color3.fromRGB(255, 255, 255),
		CookieColor = Color3.fromRGB(255, 236, 244),
		CookieValue = 15,
		CookieCount = 40,
		CarryCapacity = 450,
		HungerGoal = 1800,
		BebehName = "Chonky Bebeh",
		BebehScale = 1.75,
	},
	{
		Name = "Choco Chip Canyon",
		FloorColor = Color3.fromRGB(120, 84, 60),
		AccentColor = Color3.fromRGB(196, 132, 88),
		CookieColor = Color3.fromRGB(96, 62, 40),
		CookieValue = 60,
		CookieCount = 40,
		CarryCapacity = 1800,
		HungerGoal = 9000,
		BebehName = "Mega Bebeh",
		BebehScale = 2.2,
	},
	{
		Name = "Golden Crumb Summit",
		FloorColor = Color3.fromRGB(226, 186, 84),
		AccentColor = Color3.fromRGB(255, 246, 190),
		CookieColor = Color3.fromRGB(255, 214, 88),
		CookieValue = 250,
		CookieCount = 40,
		CarryCapacity = 7500,
		HungerGoal = 45000,
		BebehName = "BIG BEBEH",
		BebehScale = 2.8,
	},
}

-- Upgrades -----------------------------------------------------------------
-- Bought with Sprinkles, which you earn by feeding Big Bebeh.
GameConfig.SprinklesPerCookieFed = 1

GameConfig.BaseWalkSpeed = 16
GameConfig.CapacityPerLevel = 0.2 -- +20% of the area's base capacity per level
GameConfig.SpeedPerLevel = 2 -- +2 walk speed per level
GameConfig.MagnetBaseRadius = 9 -- radius at level 1
GameConfig.MagnetPerLevel = 2.5 -- extra radius for each level after the first
GameConfig.LuckPerLevel = 0.05 -- +5% chance of a double-value cookie per level
GameConfig.SpawnSpeedPerLevel = 0.06 -- -6% cookie respawn time per level
GameConfig.MinRespawnTime = 0.8 -- never faster than this, however many levels

GameConfig.Upgrades = {
	{
		Id = "Capacity",
		Name = "Bigger Hands",
		Icon = "🧤",
		Blurb = "Carry more cookies each trip",
		MaxLevel = 20,
		BaseCost = 40,
		CostMultiplier = 1.42,
	},
	{
		Id = "Speed",
		Name = "Sugar Rush",
		Icon = "👟",
		Blurb = "Run faster between cookies",
		MaxLevel = 15,
		BaseCost = 60,
		CostMultiplier = 1.5,
	},
	{
		Id = "Magnet",
		Name = "Cookie Magnet",
		Icon = "🧲",
		Blurb = "Suck up cookies without touching them",
		MaxLevel = 12,
		BaseCost = 120,
		CostMultiplier = 1.55,
	},
	{
		Id = "Spawn",
		Name = "Fresh Batch",
		Icon = "⏱️",
		Blurb = "Cookies respawn faster in the pit",
		MaxLevel = 12,
		BaseCost = 90,
		CostMultiplier = 1.5,
	},
	{
		Id = "Luck",
		Name = "Double Chip",
		Icon = "🍀",
		Blurb = "Chance for a cookie to count twice",
		MaxLevel = 10,
		BaseCost = 200,
		CostMultiplier = 1.6,
	},
}

-- Runes --------------------------------------------------------------------
-- Stand on the rune altar and it opens runes for you. Each open rolls down the
-- ladder from rarest to commonest, so adding a new tier is one entry here.
--
-- `Odds = 7` means a 1 in 7 roll. Keep the list sorted commonest-first.
--
-- The two boost numbers are read exactly as written: holding ONE gives
-- `FirstBoost`, and holding `MaxStack` of them gives `MaxBoost`. The curve
-- between is solved from those two points (see getRuneBoost), so you can state
-- a rune's power in the terms players actually see.
GameConfig.RuneOpenInterval = 1.1 -- seconds per open while standing on the altar
GameConfig.RuneAltarRadius = 15

GameConfig.RuneEffectNames = {
	CookieBoost = "Cookie Boost",
	RuneLuck = "Rune Luck",
	RuneBulk = "Rune Bulk",
	RuneClone = "Rune Clone",
}

-- Rune families. The menu shows one family at a time and lets you pick between
-- them, so a second family is one entry here plus runes tagged with its Id.
GameConfig.RuneTypes = {
	{
		Id = "Cookie",
		Name = "Cookie Rune",
		Icon = "🍪",
		Color = Color3.fromRGB(255, 190, 84),
		Blurb = "Opened at the Cookie Altar in the Nursery.",
	},
}

GameConfig.Runes = {
	{
		Id = "BasicCookie",
		Type = "Cookie",
		Name = "Basic Cookie",
		Odds = 1,
		Effect = "CookieBoost",
		FirstBoost = 0.1,
		MaxStack = 1000,
		MaxBoost = 1.0,
		Color = Color3.fromRGB(206, 206, 206),
	},
	{
		Id = "RareCookie",
		Type = "Cookie",
		Name = "Rare Cookie",
		Odds = 7,
		Effect = "CookieBoost",
		FirstBoost = 0.2,
		MaxStack = 2500,
		MaxBoost = 2.0,
		Color = Color3.fromRGB(88, 198, 255),
	},
}

function GameConfig.getRuneType(id: string)
	for _, runeType in GameConfig.RuneTypes do
		if runeType.Id == id then
			return runeType
		end
	end
	return nil
end

-- Every rune in a family, still in commonest-first order.
function GameConfig.getRunesOfType(typeId: string)
	local list = {}
	for _, rune in GameConfig.Runes do
		if rune.Type == typeId then
			table.insert(list, rune)
		end
	end
	return list
end

function GameConfig.getRune(id: string)
	for _, rune in GameConfig.Runes do
		if rune.Id == id then
			return rune
		end
	end
	return nil
end

--[[
	Boost from holding `count` of a rune.

	Solves `boost = MaxBoost * (n / MaxStack) ^ p` for the p that makes
	boost(1) = FirstBoost and boost(MaxStack) = MaxBoost, so both of the numbers
	quoted in the config are hit exactly and everything between curves smoothly.
]]
function GameConfig.getRuneBoost(rune: any, count: number): number
	if count <= 0 then
		return 0
	end
	local capped = math.min(count, rune.MaxStack)
	local p = math.log(rune.FirstBoost / rune.MaxBoost) / math.log(1 / rune.MaxStack)
	return rune.MaxBoost * (capped / rune.MaxStack) ^ p
end

function GameConfig.getRuneCount(state: any, id: string): number
	return (state.runes and state.runes[id]) or 0
end

-- Total of every rune contributing a given effect.
function GameConfig.getRuneEffectTotal(state: any, effect: string): number
	local total = 0
	for _, rune in GameConfig.Runes do
		if rune.Effect == effect then
			total += GameConfig.getRuneBoost(rune, GameConfig.getRuneCount(state, rune.Id))
		end
	end
	return total
end

function GameConfig.getCookieMultiplier(state: any): number
	return 1 + GameConfig.getRuneEffectTotal(state, "CookieBoost")
end

function GameConfig.getRuneLuck(state: any): number
	return 1 + GameConfig.getRuneEffectTotal(state, "RuneLuck")
end

function GameConfig.getRuneBulk(state: any): number
	return math.max(1, math.floor(1 + GameConfig.getRuneEffectTotal(state, "RuneBulk")))
end

function GameConfig.getRuneCloneChance(state: any): number
	return math.min(0.95, GameConfig.getRuneEffectTotal(state, "RuneClone"))
end

--[[
	Rolls one rune. Walks the ladder rarest-first; the first tier that hits wins,
	and the commonest tier is the floor so a roll always produces something.
	`luck` divides the odds, so x2 luck turns 1/7 into 1/3.5.
]]
function GameConfig.rollRune(luck: number)
	for i = #GameConfig.Runes, 2, -1 do
		local rune = GameConfig.Runes[i]
		if math.random() < math.min(1, luck / rune.Odds) then
			return rune
		end
	end
	return GameConfig.Runes[1]
end

-- Game passes --------------------------------------------------------------
--[[
	Paid perks. To make one live:

	  1. Create the pass on Roblox: Creations -> your experience -> Passes.
	  2. Open it and copy the number out of its URL.
	  3. Paste it into `AssetId` below.

	Until an AssetId is set the button still shows, but says it is not
	configured rather than prompting a purchase that would fail.

	Ownership is checked on the SERVER against Roblox and is never read from a
	save file, so a tampered save cannot grant a pass.
]]
GameConfig.GamePasses = {
	{
		Id = "DoubleCookies",
		Name = "x2 Cookies",
		Blurb = "Every cookie is worth double, forever",
		Icon = "🍪",
		AssetId = 0, -- <- paste your pass id here
		Multiplier = 2,
	},
}

function GameConfig.getGamePass(id: string)
	for _, pass in GameConfig.GamePasses do
		if pass.Id == id then
			return pass
		end
	end
	return nil
end

function GameConfig.ownsPass(state: any, id: string): boolean
	return (state.passes and state.passes[id]) == true
end

-- Cookie multiplier from every pass the player owns. Passes stack.
function GameConfig.getPassMultiplier(state: any): number
	local multiplier = 1
	for _, pass in GameConfig.GamePasses do
		if GameConfig.ownsPass(state, pass.Id) then
			multiplier *= pass.Multiplier
		end
	end
	return multiplier
end

-- Leaderboards -------------------------------------------------------------
--[[
	Global top-ten boards, one OrderedDataStore each.

	`Field` is the key in the player's state, so adding a board is a matter of
	naming a number the game already tracks. `Format` decides how the value is
	written on the board -- a playtime of 12,345 should read "3h 25m", not
	"12.3K".

	Bump `Version` to wipe a board and start it again; the old ordered store is
	simply abandoned rather than migrated, which is the cheap and honest way to
	reset a leaderboard.
]]
GameConfig.LeaderboardVersion = 1
GameConfig.LeaderboardSize = 10

GameConfig.Leaderboards = {
	{ Id = "Cookies", Name = "Most Cookies", Icon = "🍪", Field = "totalCookies", Format = "number" },
	{ Id = "Playtime", Name = "Most Playtime", Icon = "⏱️", Field = "playtime", Format = "time" },
	{ Id = "Rebirths", Name = "Most Rebirths", Icon = "⭐", Field = "rebirths", Format = "number" },
	{ Id = "Runes", Name = "Most Runes", Icon = "✦", Field = "runesOpened", Format = "number" },
}

-- Seconds -> "3h 25m". Anything under an hour reads in minutes, and a brand new
-- player reads "0m" rather than an empty string.
function GameConfig.formatDuration(seconds: number): string
	local total = math.max(0, math.floor(seconds))
	local hours = total // 3600
	local minutes = (total % 3600) // 60
	if hours >= 1 then
		return `{hours}h {minutes}m`
	end
	return `{minutes}m`
end

function GameConfig.formatStat(board: any, value: number): string
	if board.Format == "time" then
		return GameConfig.formatDuration(value)
	end
	return GameConfig.abbreviate(value)
end

-- Rebirth ------------------------------------------------------------------
-- Once BIG BEBEH is full you can start over. Areas reset, but you keep every
-- upgrade and sprinkle, plus a permanent multiplier on everything you collect.
GameConfig.RebirthMultiplierPerLevel = 0.5
GameConfig.RebirthSprinkleBonus = 2500

-- Helpers ------------------------------------------------------------------

--[[
	Where cookies are allowed to spawn in an area, as a centre and an XZ size.
	An area without a `CookiePit` falls back to most of its platform, which is
	what every zone past the first still does.
]]
function GameConfig.getCookiePit(areaIndex: number)
	local area = GameConfig.Areas[areaIndex]
	local center = GameConfig.getAreaCenter(areaIndex)
	if area.CookiePit then
		return center + area.CookiePit.Center, area.CookiePit.Size
	end
	local size = GameConfig.getPlatformSize(areaIndex)
	return center, Vector2.new(size.X - 40, size.Z - 40)
end

-- Fixed landmarks. Areas can place these themselves; otherwise they are
-- positioned relative to the platform's own size.
function GameConfig.getLandmark(areaIndex: number, key: string): Vector3
	local area = GameConfig.Areas[areaIndex]
	local center = GameConfig.getAreaCenter(areaIndex)
	if area[key] then
		return center + area[key]
	end
	local size = GameConfig.getPlatformSize(areaIndex)
	local defaults = {
		BebehOffset = Vector3.new(0, 0, -(size.Z / 2 - 25)),
		AltarOffset = Vector3.new(-(size.X / 2 - 26), 0, size.Z / 2 - 26),
		ShopOffset = Vector3.new(size.X / 2 - 26, 0, size.Z / 2 - 26),
		BoardOffset = Vector3.new(0, 0, -(size.Z / 2 - 6)),
		LeaderboardOffset = Vector3.new(size.X / 2 - 10, 0, 0),
	}
	return center + (defaults[key] or Vector3.new())
end

function GameConfig.getPlatformSize(areaIndex: number): Vector3
	return GameConfig.Areas[areaIndex].PlatformSize or GameConfig.PlatformSize
end

-- Where an area's platform ends along X. Bridges are built between these edges
-- rather than assuming every platform is the same width.
function GameConfig.getAreaEdge(areaIndex: number, side: number): number
	return GameConfig.getAreaCenter(areaIndex).X + side * GameConfig.getPlatformSize(areaIndex).X / 2
end

function GameConfig.getAreaCenter(areaIndex: number): Vector3
	return Vector3.new((areaIndex - 1) * GameConfig.AreaSpacing, 0, 0)
end

function GameConfig.getUpgrade(id: string)
	for _, upgrade in GameConfig.Upgrades do
		if upgrade.Id == id then
			return upgrade
		end
	end
	return nil
end

function GameConfig.getUpgradeLevel(state: any, id: string): number
	return (state.upgrades and state.upgrades[id]) or 0
end

-- Cost of the NEXT level, given how many you already own.
function GameConfig.getUpgradeCost(upgrade: any, currentLevel: number): number
	return math.floor(upgrade.BaseCost * upgrade.CostMultiplier ^ currentLevel)
end

function GameConfig.getCapacity(state: any): number
	local area = GameConfig.Areas[math.clamp(state.maxArea or 1, 1, #GameConfig.Areas)]
	local level = GameConfig.getUpgradeLevel(state, "Capacity")
	return math.floor(area.CarryCapacity * (1 + GameConfig.CapacityPerLevel * level))
end

function GameConfig.getWalkSpeed(state: any): number
	return GameConfig.BaseWalkSpeed + GameConfig.SpeedPerLevel * GameConfig.getUpgradeLevel(state, "Speed")
end

-- Level 0 means no magnet at all.
function GameConfig.getMagnetRadius(state: any): number
	local level = GameConfig.getUpgradeLevel(state, "Magnet")
	if level <= 0 then
		return 0
	end
	return GameConfig.MagnetBaseRadius + GameConfig.MagnetPerLevel * (level - 1)
end

-- How long a collected cookie stays gone. Driven by the upgrade of whoever
-- picked it up, since the cookies themselves are shared.
function GameConfig.getRespawnTime(state: any): number
	local level = GameConfig.getUpgradeLevel(state, "Spawn")
	local scaled = GameConfig.CookieRespawnTime * (1 - GameConfig.SpawnSpeedPerLevel * level)
	return math.max(GameConfig.MinRespawnTime, scaled)
end

function GameConfig.getLuckChance(state: any): number
	return math.min(1, GameConfig.LuckPerLevel * GameConfig.getUpgradeLevel(state, "Luck"))
end

function GameConfig.getRebirthMultiplier(state: any): number
	return 1 + GameConfig.RebirthMultiplierPerLevel * (state.rebirths or 0)
end

function GameConfig.canRebirth(state: any): boolean
	local last = #GameConfig.Areas
	return (state.fed and state.fed[last] or 0) >= GameConfig.Areas[last].HungerGoal
end

-- Short "what does this level do" text for the shop.
function GameConfig.describeUpgrade(state: any, upgrade: any): string
	local level = GameConfig.getUpgradeLevel(state, upgrade.Id)
	if upgrade.Id == "Capacity" then
		return `Hands: {GameConfig.abbreviate(GameConfig.getCapacity(state))}`
	elseif upgrade.Id == "Speed" then
		return `Speed: {GameConfig.getWalkSpeed(state)}`
	elseif upgrade.Id == "Magnet" then
		local radius = GameConfig.getMagnetRadius(state)
		return radius > 0 and `Reach: {math.floor(radius)} studs` or "Not bought yet"
	elseif upgrade.Id == "Spawn" then
		return `Respawn: {string.format("%.1f", GameConfig.getRespawnTime(state))}s`
	elseif upgrade.Id == "Luck" then
		return `Double chance: {math.floor(GameConfig.getLuckChance(state) * 100)}%`
	end
	return `Level {level}`
end

-- Turns 45000 into "45K" so the HUD never overflows.
function GameConfig.abbreviate(n: number): string
	local suffixes = { "", "K", "M", "B", "T" }
	local tier = 0
	local value = n
	while value >= 1000 and tier < #suffixes - 1 do
		value /= 1000
		tier += 1
	end
	if tier == 0 then
		return string.format("%d", value)
	end
	-- "45.0K" reads worse than "45K", so drop a trailing zero decimal.
	local text = string.gsub(string.format("%.1f", value), "%.0$", "")
	return text .. suffixes[tier + 1]
end

return GameConfig
