--[[
	Leaderboard
	Global top-ten boards, backed by one OrderedDataStore per stat.

	Two loops, deliberately at different speeds:

	  * PUBLISH pushes the local players' numbers up. Writes cost DataStore
	    budget, so it only writes a value that actually changed, and it spaces
	    players out rather than firing every write on the same tick.
	  * REFRESH pulls the top ten back down and hands them to whoever draws the
	    boards. Reads are cheap but not free, and nobody notices a leaderboard
	    being thirty seconds stale.

	Ordered stores hold integers only, so every value is floored, and clamped to
	the range doubles can still count in one by one. A cookie total past 2^53
	would otherwise start rounding, and a leaderboard that disagrees with the
	player's own HUD is worse than one that saturates.
]]

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local GameConfig = require(ReplicatedStorage.BigBebehShared.GameConfig)

local Leaderboard = {}

local PUBLISH_INTERVAL = 60
local REFRESH_INTERVAL = 45
local MAX_VALUE = 2 ^ 53 - 1

type Row = { userId: number, name: string, value: number }

local stores: { [string]: OrderedDataStore } = {}
local cached: { [string]: { Row } } = {}
local published: { [Player]: { [string]: number } } = {}
local nameCache: { [number]: string } = {}
local listeners: { (string, { Row }) -> () } = {}

for _, board in GameConfig.Leaderboards do
	cached[board.Id] = {}
	local ok, store = pcall(function()
		return DataStoreService:GetOrderedDataStore(`BigBebehLB_{board.Id}_v{GameConfig.LeaderboardVersion}`)
	end)
	if ok then
		stores[board.Id] = store
	else
		warn(`[Leaderboard] {board.Name} unavailable: {store}`)
	end
end

-- Names ---------------------------------------------------------------------

--[[
	An ordered store only knows user ids, so every row needs a name looked up.
	That is a web call per player, and the top ten barely changes between
	refreshes, so results are cached for the life of the server. A lookup that
	fails falls back to the id rather than dropping the row -- a board with one
	odd-looking name beats a board with a hole in it.
]]
local function nameFor(userId: number): string
	local known = nameCache[userId]
	if known then
		return known
	end

	local ok, name = pcall(function()
		return Players:GetNameFromUserIdAsync(userId)
	end)
	if not ok or type(name) ~= "string" then
		name = `User {userId}`
	end
	nameCache[userId] = name
	return name
end

-- Publishing ----------------------------------------------------------------

local function valueFor(state: any, board: any): number
	local raw = state[board.Field]
	if type(raw) ~= "number" or raw ~= raw then -- nan never compares equal to itself
		return 0
	end
	return math.clamp(math.floor(raw), 0, MAX_VALUE)
end

--[[
	Writes one player's stats. `force` is for the way out the door: on leave the
	write happens even if the value looks unchanged, because that is the last
	chance to record the session.
]]
function Leaderboard.publish(player: Player, state: any, force: boolean?)
	if not state then
		return
	end
	local seen = published[player]
	if not seen then
		seen = {}
		published[player] = seen
	end

	for _, board in GameConfig.Leaderboards do
		local store = stores[board.Id]
		if not store then
			continue
		end

		local value = valueFor(state, board)
		-- Nothing to say. A leaderboard write that changes no ordering is pure
		-- budget spent for no reason.
		if value <= 0 or (not force and seen[board.Id] == value) then
			continue
		end

		local ok, err = pcall(function()
			store:SetAsync(tostring(player.UserId), value)
		end)
		if ok then
			seen[board.Id] = value
		else
			warn(`[Leaderboard] Could not publish {board.Name} for {player.Name}: {err}`)
		end
	end
end

function Leaderboard.forget(player: Player)
	published[player] = nil
end

-- Reading -------------------------------------------------------------------

function Leaderboard.top(boardId: string): { Row }
	return cached[boardId] or {}
end

-- Called with (boardId, rows) whenever a board changes, so the world can redraw
-- only what moved.
function Leaderboard.onUpdate(callback: (string, { Row }) -> ())
	table.insert(listeners, callback)
end

local function fetch(board: any)
	local store = stores[board.Id]
	if not store then
		return
	end

	local ok, pages = pcall(function()
		return store:GetSortedAsync(false, GameConfig.LeaderboardSize)
	end)
	if not ok then
		warn(`[Leaderboard] Could not read {board.Name}: {pages}`)
		return
	end

	local rows: { Row } = {}
	local okPage, page = pcall(function()
		return pages:GetCurrentPage()
	end)
	if not okPage then
		warn(`[Leaderboard] Could not page {board.Name}: {page}`)
		return
	end

	for _, entry in page do
		local userId = tonumber(entry.key)
		if userId then
			table.insert(rows, { userId = userId, name = nameFor(userId), value = entry.value })
		end
	end

	cached[board.Id] = rows
	for _, listener in listeners do
		local okCall, err = pcall(listener, board.Id, rows)
		if not okCall then
			warn(`[Leaderboard] Listener errored for {board.Name}: {err}`)
		end
	end
end

-- Lifecycle -----------------------------------------------------------------

function Leaderboard.start(getStates: () -> { [Player]: any })
	-- Read first, so the boards have something on them before anyone has played
	-- long enough to be published.
	task.spawn(function()
		while true do
			for _, board in GameConfig.Leaderboards do
				fetch(board)
				-- Spread the four reads out instead of firing them together; the
				-- boards do not need to change in the same frame.
				task.wait(1)
			end
			task.wait(REFRESH_INTERVAL)
		end
	end)

	task.spawn(function()
		while true do
			task.wait(PUBLISH_INTERVAL)
			for player, state in getStates() do
				Leaderboard.publish(player, state)
				task.wait(0.5)
			end
		end
	end)

	Players.PlayerRemoving:Connect(function(player)
		local state = getStates()[player]
		if state then
			Leaderboard.publish(player, state, true)
		end
		Leaderboard.forget(player)
	end)

	game:BindToClose(function()
		for player, state in getStates() do
			Leaderboard.publish(player, state, true)
		end
	end)
end

return Leaderboard
