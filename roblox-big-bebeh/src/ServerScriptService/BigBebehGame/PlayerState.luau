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
		passes    = { DoubleCookies = true }, -- runtime only, never saved
	}
]]

local DataStoreService = game:GetService("DataStoreService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

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
		if not claim.ok then
			return nil, claim.reason or "Could not open your save."
		end
		raw = claim.data
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
