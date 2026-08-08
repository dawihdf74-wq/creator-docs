--[[
	PlayerState
	Per-player progress, with optional DataStore persistence.

	state = {
		maxArea  = 1,          -- highest area unlocked
		carried  = 0,          -- cookies currently in hand
		fed      = { 12, 0 },  -- cookies fed to each area's Bebeh
		totalFed = 12,
	}
]]

local DataStoreService = game:GetService("DataStoreService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local GameConfig = require(ReplicatedStorage.BigBebehShared.GameConfig)

local PlayerState = {}

local states: { [Player]: any } = {}

local store: DataStore? = nil
if GameConfig.SaveEnabled then
	local ok, result = pcall(function()
		return DataStoreService:GetDataStore(GameConfig.DataStoreName)
	end)
	if ok then
		store = result
	else
		warn(`[BigBebeh] DataStore unavailable, running without saves: {result}`)
	end
end

local function defaultState()
	local fed = table.create(#GameConfig.Areas, 0)
	return {
		maxArea = 1,
		carried = 0,
		fed = fed,
		totalFed = 0,
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
	if type(raw.carried) == "number" and raw.carried >= 0 then
		state.carried = math.min(math.floor(raw.carried), GameConfig.getCapacity(state.maxArea))
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

function PlayerState.load(player: Player)
	local raw = nil
	if store then
		local ok, result = pcall(function()
			return store:GetAsync(key(player))
		end)
		if ok then
			raw = result
		else
			warn(`[BigBebeh] Load failed for {player.Name}: {result}`)
		end
	end

	local state = sanitize(raw)
	states[player] = state
	return state
end

function PlayerState.get(player: Player)
	return states[player]
end

function PlayerState.save(player: Player)
	local state = states[player]
	if not state or not store then
		return
	end
	local ok, err = pcall(function()
		store:SetAsync(key(player), state)
	end)
	if not ok then
		warn(`[BigBebeh] Save failed for {player.Name}: {err}`)
	end
end

function PlayerState.release(player: Player)
	PlayerState.save(player)
	states[player] = nil
end

function PlayerState.all()
	return states
end

return PlayerState
