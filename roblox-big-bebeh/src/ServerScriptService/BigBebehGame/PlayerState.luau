--[[
	PlayerState
	Per-player progress, with optional DataStore persistence.

	state = {
		maxArea   = 1,          -- highest area unlocked
		carried   = 0,          -- cookies currently in hand
		fed       = { 12, 0 },  -- cookies fed to each area's Bebeh
		totalFed  = 12,
		sprinkles = 340,        -- upgrade currency, earned by feeding
		upgrades  = { Capacity = 3, Speed = 1 },
		rebirths  = 0,
		runes     = { BasicCookie = 412, RareCookie = 8 },
		runesOpened = 420,
		totalCookies = 9120,     -- lifetime, never reset by rebirth
		playtime  = 4830,        -- seconds played, all sessions
		passes    = { DoubleCookies = true }, -- runtime only, never saved
	}
]]

local DataStoreService = game:GetService("DataStoreService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local GameConfig = require(ReplicatedStorage.BigBebehShared.GameConfig)
local SessionLock = require(script.Parent.SessionLock)

local PlayerState = {}

local states: { [Player]: any } = {}

local store: DataStore? = nil
if GameConfig.SaveEnabled then
	local ok, result = pcall(function()
		return DataStoreService:GetDataStore(GameConfig.DataStoreName)
	end)
	if ok then
		store = result
		SessionLock.startHeartbeat(result)
	else
		warn(`[BigBebeh] DataStore unavailable, running without saves: {result}`)
	end
end

local function defaultState()
	local upgrades = {}
	for _, upgrade in GameConfig.Upgrades do
		upgrades[upgrade.Id] = 0
	end
	local runes = {}
	for _, rune in GameConfig.Runes do
		runes[rune.Id] = 0
	end
	return {
		maxArea = 1,
		carried = 0,
		fed = table.create(#GameConfig.Areas, 0),
		totalFed = 0,
		sprinkles = 0,
		upgrades = upgrades,
		rebirths = 0,
		runes = runes,
		runesOpened = 0,
		-- Leaderboard stats. Lifetime totals: rebirth resets areas, not records.
		totalCookies = 0,
		playtime = 0,
		-- Game pass ownership is filled in from Roblox after the state loads.
		passes = {},
	}
end

-- Anything loaded from a DataStore is untrusted: an older save may be missing
-- fields, or have more/fewer areas than the current config.
local function sanitize(raw: any)
	local state = defaultState()
	if type(raw) ~= "table" then
		return state
	end

	if type(raw.maxArea) == "number" then
		state.maxArea = math.clamp(math.floor(raw.maxArea), 1, #GameConfig.Areas)
	end
	if type(raw.rebirths) == "number" and raw.rebirths >= 0 then
		state.rebirths = math.floor(raw.rebirths)
	end
	if type(raw.sprinkles) == "number" and raw.sprinkles >= 0 then
		state.sprinkles = math.floor(raw.sprinkles)
	end

	-- Upgrades are read before `carried`, because carry capacity depends on them.
	if type(raw.upgrades) == "table" then
		for _, upgrade in GameConfig.Upgrades do
			local level = raw.upgrades[upgrade.Id]
			if type(level) == "number" and level >= 0 then
				state.upgrades[upgrade.Id] = math.min(math.floor(level), upgrade.MaxLevel)
			end
		end
	end

	-- Runes are read before capacity too: a rune could grant carry space later.
	if type(raw.runes) == "table" then
		for _, rune in GameConfig.Runes do
			local owned = raw.runes[rune.Id]
			if type(owned) == "number" and owned >= 0 then
				state.runes[rune.Id] = math.floor(owned)
			end
		end
	end
	if type(raw.runesOpened) == "number" and raw.runesOpened >= 0 then
		state.runesOpened = math.floor(raw.runesOpened)
	end
	if type(raw.totalCookies) == "number" and raw.totalCookies >= 0 then
		state.totalCookies = math.floor(raw.totalCookies)
	end
	if type(raw.playtime) == "number" and raw.playtime >= 0 then
		state.playtime = math.floor(raw.playtime)
	end

	-- `passes` is deliberately NOT read from the save. Ownership is answered by
	-- Roblox on the server every session, so an edited save cannot grant one.

	if type(raw.carried) == "number" and raw.carried >= 0 then
		state.carried = math.min(math.floor(raw.carried), GameConfig.getCapacity(state))
	end
	if type(raw.fed) == "table" then
		for i = 1, #GameConfig.Areas do
			local value = raw.fed[i]
			if type(value) == "number" and value >= 0 then
				state.fed[i] = math.min(math.floor(value), GameConfig.Areas[i].HungerGoal)
			end
		end
	end
	if type(raw.totalFed) == "number" and raw.totalFed >= 0 then
		state.totalFed = math.floor(raw.totalFed)
	end

	return state
end

local function key(player: Player): string
	return `player_{player.UserId}`
end

--[[
	Loads a player's progress, claiming their save first.

	Returns `state, nil` on success, or `nil, reason` when the save could not be
	claimed. A refusal is not an inconvenience to route around -- loading anyway
	would put two servers on the same data, which is precisely the duplication
	SessionLock exists to stop. The caller must kick the player with the reason.
]]
function PlayerState.load(player: Player): (any, string?)
	local raw = nil
	if store then
		local claim = SessionLock.claim(store, key(player))

		--[[
			A claim can fail two very different ways, and they deserve opposite
			answers.

			`taken` means another server holds the save. Refuse, always -- that is
			the duplication this exists to stop.

			Otherwise the DataStore simply could not be reached. In a live server
			that still has to refuse: letting somebody play from a default state
			and then saving it would overwrite the real progress they already had,
			which is worse than making them wait. But in Studio it is almost always
			API access being switched off, where nothing persists and there is no
			second server, so there is nothing to duplicate and nothing to lose.
			Locking a developer out of their own game over that is pure friction,
			so Studio drops to the no-saves mode the game has always had.
		]]
		if not claim.ok then
			if claim.taken or not RunService:IsStudio() then
				return nil, claim.reason or "Could not open your save."
			end

			warn(`[BigBebeh] {claim.reason}`)
			warn("[BigBebeh] Running WITHOUT saves. To test saving, turn on:")
			warn("[BigBebeh]   Game Settings -> Security -> Enable Studio Access to API Services")
			store = nil
		else
			raw = claim.data
		end
	end

	local state = sanitize(raw)
	states[player] = state
	return state, nil
end

function PlayerState.get(player: Player)
	return states[player]
end

function PlayerState.save(player: Player)
	local state = states[player]
	if not state or not store then
		return
	end
	-- Writes through SessionLock, which refuses if this server no longer owns the
	-- save. Overwriting a claim we lost would roll the other server back.
	SessionLock.save(store, key(player), state)
end

function PlayerState.release(player: Player)
	local state = states[player]
	if state and store then
		-- Save and drop the claim together, so the player can rejoin elsewhere
		-- straight away instead of waiting for the claim to time out.
		SessionLock.release(store, key(player), state)
	end
	states[player] = nil
end

function PlayerState.all()
	return states
end

return PlayerState
