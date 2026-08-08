--[[
	GameConfig
	Every tunable number for the "Feed Big Bebeh" cookie game lives here.
	Tweak these values and the whole world rebuilds itself on the next run.
]]

local GameConfig = {}

-- Saving -------------------------------------------------------------------
GameConfig.SaveEnabled = true
GameConfig.DataStoreName = "BigBebehCookies_v1"
GameConfig.AutosaveInterval = 120

-- Gameplay tuning ----------------------------------------------------------
GameConfig.FeedRadius = 16 -- studs; walk this close to Big Bebeh to auto-feed
GameConfig.FeedInterval = 0.3 -- seconds between auto-feed checks
GameConfig.CookieRespawnTime = 5 -- seconds before a picked-up cookie comes back
GameConfig.CollectRange = 14 -- server-side sanity check on pickups
GameConfig.VoidY = -60 -- fall below this and you get placed back on your area

-- World layout -------------------------------------------------------------
GameConfig.PlatformSize = Vector3.new(220, 6, 220)
GameConfig.AreaSpacing = 300 -- centre-to-centre distance along +X
GameConfig.BridgeWidth = 26

-- Areas --------------------------------------------------------------------
-- Feed the Bebeh in area N its HungerGoal to unlock area N + 1.
-- CarryCapacity is how many cookies you can hold once that area is unlocked.
GameConfig.Areas = {
	{
		Name = "Cookie Nursery",
		FloorColor = Color3.fromRGB(126, 196, 122),
		AccentColor = Color3.fromRGB(255, 232, 120),
		CookieColor = Color3.fromRGB(214, 168, 106),
		CookieValue = 1,
		CookieCount = 40,
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

-- Helpers ------------------------------------------------------------------

function GameConfig.getAreaCenter(areaIndex: number): Vector3
	return Vector3.new((areaIndex - 1) * GameConfig.AreaSpacing, 0, 0)
end

function GameConfig.getCapacity(maxArea: number): number
	local area = GameConfig.Areas[math.clamp(maxArea, 1, #GameConfig.Areas)]
	return area.CarryCapacity
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
