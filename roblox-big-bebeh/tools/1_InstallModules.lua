--[[
	Big Bebeh — STEP 1 of 2: install the server modules.

	Paste into the Mango bridge (or the Studio Command Bar) and run.
	Then run 2_PatchHooks to wire them in.

	CREATES these ModuleScripts under ServerScriptService.BigBebehGame:

	  SessionLock   stops cross-server duplication
	  AntiCheat     throttling, movement checks, Discord reports
	  Leaderboard   the global top-ten boards

	It does NOT edit your existing scripts. Those carry your own changes, and
	overwriting them to save you a few edits is a bad trade. Instead it reads
	them, works out which hook-ins are already in place, and lists the rest --
	which is what step 2 applies.

	Re-running is safe. Existing modules are updated in place, so this is the same
	paste whether it is a first install or a version bump.
]]

local ServerScriptService = game:GetService("ServerScriptService")

local report = {}
local function say(line)
	table.insert(report, line)
end

local game_folder = ServerScriptService:FindFirstChild("BigBebehGame")
if not game_folder then
	warn("[Install] Could not find ServerScriptService.BigBebehGame — nothing was changed.")
	return "FAILED  ServerScriptService.BigBebehGame not found — nothing was changed."
end

local SOURCES = {}
SOURCES["SessionLock"] = [=[
--[[
	SessionLock
	Stops the only real dupe this game has: the cross-server rollback.

	The trick players use is to be in two servers at once. Server A loads your
	save, server B loads the same save, you spend in one and bank in the other,
	and whichever writes last wins -- so the currency you spent is still there.
	Nothing inside the game loop can prevent that, because both servers are
	behaving correctly on stale data.

	The fix is to make "who owns this save" a single value that only one server
	can hold. Every session claims the key before loading, refreshes the claim
	while it plays, and drops it on the way out. A second server that finds a
	live claim refuses to load rather than starting from stale data.

	UpdateAsync is what makes this safe: it reads and writes in one atomic
	operation, so two servers claiming at the same instant cannot both win.
]]

local DataStoreService = game:GetService("DataStoreService")
local RunService = game:GetService("RunService")

local SessionLock = {}

-- How long a claim stays valid without a refresh. A server that crashes cannot
-- release its claim, so the claim has to expire on its own -- otherwise a crash
-- would lock a player out of their own save forever. Long enough to survive a
-- slow autosave, short enough that a crash is a brief annoyance.
local LOCK_TTL = 90
local REFRESH_INTERVAL = 30

-- Studio has no reliable JobId, and running two Studio sessions against the same
-- key is normal while testing, so the lock identifies the server by JobId and
-- falls back to a random id.
local SERVER_ID = if RunService:IsStudio() or game.JobId == ""
	then `studio-{math.random(1, 1e9)}`
	else game.JobId

local held: { [string]: boolean } = {}

export type ClaimResult = {
	ok: boolean,
	reason: string?, -- set when ok is false, safe to show the player
	data: any, -- the saved value, only when ok is true
	-- True only when another server holds the claim. A failure with `taken =
	-- false` means the DataStore could not be reached at all, which is a very
	-- different problem and the caller may reasonably treat it differently.
	taken: boolean,
}

--[[
	Claims the key and hands back whatever was stored with it.

	`ok = false` means somebody else holds it. That is not an error to swallow --
	loading anyway is exactly the dupe this module exists to prevent, so the
	caller must refuse to let the player play.
]]
function SessionLock.claim(store: DataStore, key: string): ClaimResult
	local now = os.time()
	local rejected: string? = nil

	local ok, err = pcall(function()
		store:UpdateAsync(key, function(record)
			record = if type(record) == "table" then record else {}
			local lock = record.__lock

			-- A claim from another server that has not expired yet.
			if
				type(lock) == "table"
				and lock.server ~= SERVER_ID
				and type(lock.at) == "number"
				and now - lock.at < LOCK_TTL
			then
				rejected = `Your save is still open in another server. Try again in {LOCK_TTL - (now - lock.at)}s.`
				return nil -- returning nil aborts the write, leaving the claim alone
			end

			record.__lock = { server = SERVER_ID, at = now }
			return record
		end)
	end)

	if not ok then
		-- A DataStore outage must not become a dupe window, so this fails closed.
		return { ok = false, reason = `Could not reach the save servers: {err}`, data = nil, taken = false }
	end
	if rejected then
		return { ok = false, reason = rejected, data = nil, taken = true }
	end

	held[key] = true

	local read, record = pcall(function()
		return store:GetAsync(key)
	end)
	local data = if read and type(record) == "table" then record.data else nil
	return { ok = true, reason = nil, data = data, taken = false }
end

-- Writes the player's progress alongside the claim, refreshing it in the same
-- call so an active session never has its claim expire underneath it.
function SessionLock.save(store: DataStore, key: string, data: any): boolean
	if not held[key] then
		-- We do not own this key any more. Writing would clobber whichever server
		-- does own it, which is the dupe running in reverse.
		return false
	end

	local ok, err = pcall(function()
		store:UpdateAsync(key, function(record)
			record = if type(record) == "table" then record else {}
			local lock = record.__lock
			if type(lock) == "table" and lock.server ~= SERVER_ID and os.time() - lock.at < LOCK_TTL then
				return nil -- somebody took it while we were away; do not overwrite
			end
			record.data = data
			record.__lock = { server = SERVER_ID, at = os.time() }
			return record
		end)
	end)

	if not ok then
		warn(`[SessionLock] Save failed for {key}: {err}`)
	end
	return ok
end

-- Drops the claim so the player can rejoin somewhere else immediately, instead
-- of waiting out the TTL.
function SessionLock.release(store: DataStore, key: string, data: any?)
	if not held[key] then
		return
	end

	pcall(function()
		store:UpdateAsync(key, function(record)
			record = if type(record) == "table" then record else {}
			local lock = record.__lock
			if type(lock) == "table" and lock.server ~= SERVER_ID then
				return nil
			end
			if data ~= nil then
				record.data = data
			end
			record.__lock = nil
			return record
		end)
	end)

	held[key] = nil
end

function SessionLock.holds(key: string): boolean
	return held[key] == true
end

function SessionLock.serverId(): string
	return SERVER_ID
end

--[[
	Keeps every claim this server holds alive. Without this a session longer than
	LOCK_TTL would look abandoned, and another server could take the save out from
	under a player who is still playing.
]]
function SessionLock.startHeartbeat(store: DataStore)
	task.spawn(function()
		while true do
			task.wait(REFRESH_INTERVAL)
			for key in held do
				pcall(function()
					store:UpdateAsync(key, function(record)
						record = if type(record) == "table" then record else {}
						local lock = record.__lock
						if type(lock) == "table" and lock.server ~= SERVER_ID then
							-- Lost it. Stop pretending we hold it.
							held[key] = nil
							return nil
						end
						record.__lock = { server = SERVER_ID, at = os.time() }
						return record
					end)
				end)
			end
		end
	end)
end

return SessionLock]=]
SOURCES["AntiCheat"] = [=[
--[[
	AntiCheat
	Server-side detection, throttling and reporting.

	Read this first, because it decides how much the rest is worth:

	An exploiter runs arbitrary Lua on their own machine. Anything a LocalScript
	checks, they can delete. So there is no such thing as client-side anti-cheat --
	only server checks, and speed bumps that catch people who are not really
	trying. Everything in this file runs on the server.

	What actually protects the game is that the server owns the economy: the
	client asks for an upgrade by name and the server decides the price, cookies
	are added by the server after a distance check, and nothing the client sends
	is ever used as a number. That was already true before this file existed.

	What this file adds is the layer around it:

	  * throttling, so a remote cannot be spammed thousands of times a second
	  * movement checks, because Roblox hands the client authority over its own
	    character -- speed and flight are the one thing they really can fake
	  * a strike system, so one lag spike is not a ban but a pattern is
	  * a Discord report with the player's name, id and a profile link

	Roblox's own physics ownership means movement checks will occasionally fire on
	a laggy player. That is why the thresholds are generous and why a single
	detection does nothing on its own.
]]

local DataStoreService = game:GetService("DataStoreService")
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local GameConfig = require(ReplicatedStorage.BigBebehShared.GameConfig)

local AntiCheat = {}

-- Settings -----------------------------------------------------------------

--[[
	Discord will NOT accept a webhook posted straight from a Roblox server. It
	blocks Roblox's address range, and you get a 403 with nothing useful in it.
	You need a tiny proxy in between; the README has a Cloudflare Worker that does
	it in about ten lines, and it is free.

	Put the PROXY url here, not the raw discord.com one.
	Leave it empty and reports go to the Output window instead.
]]
AntiCheat.WebhookUrl = ""

AntiCheat.Settings = {
	-- Strikes needed before each consequence. Strikes decay, so somebody who
	-- trips one check once an hour never escalates; somebody flying does.
	KickAt = 6,
	BanAt = 0, -- 0 disables banning. Try KickAt-only first and watch the channel.
	StrikeDecay = 300, -- seconds for one strike to fall off

	-- Movement. Tolerances are deliberately loose: Roblox gives the client
	-- physics ownership of its own character, so a lag spike genuinely does look
	-- like a short teleport.
	SampleInterval = 0.5,
	SpeedTolerance = 1.6, -- multiple of the player's legitimate walk speed
	SpeedGraceStuds = 8, -- absorbed per sample, on top of the tolerance
	SpeedStrikesNeeded = 3, -- consecutive bad samples before it counts at all
	TeleportStuds = 150, -- a single sample longer than this is not lag
	FlightSeconds = 6, -- airborne this long without falling

	-- Remotes. Generous next to real play, tiny next to a spam loop.
	Limits = {
		BuyUpgrade = { perSecond = 8, burst = 16 },
		Rebirth = { perSecond = 1, burst = 3 },
		SyncState = { perSecond = 4, burst = 8 },
	},

	-- Reporting
	FlushInterval = 3, -- seconds between Discord posts
	MaxEmbedsPerPost = 10, -- Discord's own limit
	AggregateWindow = 30, -- repeats of the same rule collapse into one report
}

-- Severity decides the colour of the Discord embed and the strike weight.
local RULES = {
	Speed = { strikes = 1, color = 0xF1C40F, icon = "🏃" },
	Teleport = { strikes = 2, color = 0xE67E22, icon = "✈️" },
	Flight = { strikes = 2, color = 0xE67E22, icon = "🪂" },
	RemoteSpam = { strikes = 1, color = 0x3498DB, icon = "📡" },
	BadPayload = { strikes = 3, color = 0x9B59B6, icon = "📦" },
	Invariant = { strikes = 4, color = 0xE74C3C, icon = "🧮" },
	SessionLock = { strikes = 0, color = 0x95A5A6, icon = "🔒" },
}

-- State --------------------------------------------------------------------

type Tracker = {
	strikes: number,
	lastStrike: number,
	buckets: { [string]: { tokens: number, at: number } },
	lastPosition: Vector3?,
	lastSample: number,
	badSpeedRun: number,
	airborneSince: number?,
	pardonUntil: number,
	reported: { [string]: number },
}

local trackers: { [Player]: Tracker } = {}
local queue: { any } = {}
local banStore: DataStore? = nil

if AntiCheat.Settings.BanAt > 0 then
	local ok, result = pcall(function()
		return DataStoreService:GetDataStore("BigBebehBans_v1")
	end)
	if ok then
		banStore = result
	else
		warn(`[AntiCheat] Ban store unavailable, bans disabled: {result}`)
	end
end

local function tracker(player: Player): Tracker?
	return trackers[player]
end

-- Reporting ----------------------------------------------------------------

local function describeServer(): string
	if RunService:IsStudio() then
		return "Studio"
	end
	return `Place {game.PlaceId} · Server {string.sub(game.JobId, 1, 8)}`
end

--[[
	Queues one report. Nothing is posted here: a player who is flying trips the
	check every half second, and firing a webhook each time would get the webhook
	rate-limited by Discord and drown the channel. The flush loop batches, and
	repeats of the same rule inside AggregateWindow collapse into a count.
]]
local function report(player: Player, kind: string, detail: string, strikes: number)
	local rule = RULES[kind] or { color = 0x7F8C8D, icon = "❓" }
	local now = os.clock()
	local track = tracker(player)

	if track then
		local key = kind
		local last = track.reported[key]
		if last and now - last < AntiCheat.Settings.AggregateWindow then
			-- Already reported recently. Find the pending embed and bump its count
			-- rather than adding another one.
			for _, entry in queue do
				if entry.userId == player.UserId and entry.kind == kind then
					entry.count += 1
					entry.detail = detail
					entry.strikes = strikes
					return
				end
			end
		end
		track.reported[key] = now
	end

	table.insert(queue, {
		userId = player.UserId,
		name = player.Name,
		displayName = player.DisplayName,
		kind = kind,
		icon = rule.icon,
		color = rule.color,
		detail = detail,
		strikes = strikes,
		count = 1,
		at = DateTime.now():ToIsoDate(),
	})
end

local function buildEmbed(entry: any): any
	local title = `{entry.icon} {entry.kind}`
	if entry.count > 1 then
		title ..= ` (x{entry.count})`
	end

	return {
		title = title,
		color = entry.color,
		fields = {
			{
				name = "Player",
				value = `[{entry.displayName} (@{entry.name})](https://www.roblox.com/users/{entry.userId}/profile)`,
				inline = true,
			},
			{ name = "User ID", value = tostring(entry.userId), inline = true },
			{ name = "Strikes", value = `{entry.strikes} / {AntiCheat.Settings.KickAt}`, inline = true },
			-- Discord rejects a field longer than 1024 characters and drops the
			-- whole message, so this is cut short rather than risked.
			{ name = "Detail", value = string.sub(entry.detail, 1, 1000), inline = false },
		},
		footer = { text = describeServer() },
		timestamp = entry.at,
	}
end

local function flush()
	if #queue == 0 then
		return
	end

	local batch = {}
	for _ = 1, math.min(#queue, AntiCheat.Settings.MaxEmbedsPerPost) do
		table.insert(batch, buildEmbed(table.remove(queue, 1)))
	end

	if AntiCheat.WebhookUrl == "" then
		for _, embed in batch do
			warn(`[AntiCheat] {embed.title} — {embed.fields[1].value} — {embed.fields[4].value}`)
		end
		return
	end

	local body = HttpService:JSONEncode({
		username = "Big Bebeh Anti-Cheat",
		embeds = batch,
	})

	local ok, err = pcall(function()
		HttpService:PostAsync(AntiCheat.WebhookUrl, body, Enum.HttpContentType.ApplicationJson)
	end)

	if not ok then
		-- A broken webhook must never take the game down with it, so this only
		-- complains. The detection and the kick already happened.
		warn(`[AntiCheat] Webhook post failed: {err}`)
	end
end

-- Strikes ------------------------------------------------------------------

local function punish(player: Player, track: Tracker, kind: string)
	local settings = AntiCheat.Settings

	if settings.BanAt > 0 and track.strikes >= settings.BanAt and banStore then
		pcall(function()
			banStore:SetAsync(`ban_{player.UserId}`, {
				at = os.time(),
				reason = kind,
			})
		end)
		player:Kick("You have been banned for exploiting.")
		return
	end

	if track.strikes >= settings.KickAt then
		player:Kick("Kicked for exploiting. If you think this is wrong, rejoin and play normally.")
	end
end

--[[
	Records a detection. `detail` is the human-readable evidence -- the numbers
	that made this look wrong -- and ends up in the Discord embed, so make it
	specific enough to tell a real exploiter from a laggy player.
]]
function AntiCheat.flag(player: Player, kind: string, detail: string)
	local track = tracker(player)
	if not track then
		return
	end

	local rule = RULES[kind]
	local weight = if rule then rule.strikes else 1
	local now = os.clock()

	-- Decay before adding, so an old strike does not stack with a new one.
	local elapsed = now - track.lastStrike
	local decayed = math.floor(elapsed / AntiCheat.Settings.StrikeDecay)
	if decayed > 0 then
		track.strikes = math.max(0, track.strikes - decayed)
	end

	track.strikes += weight
	track.lastStrike = now

	report(player, kind, detail, track.strikes)
	punish(player, track, kind)
end

-- Throttling ---------------------------------------------------------------

--[[
	Token bucket. Returns false when the player is over their allowance for this
	key, which the caller should treat as "ignore this request" -- not as proof of
	cheating, because a double click is not an attack. Sustained abuse flags
	itself once the bucket has been empty for a while.

	Rate limiting is not optional decoration: without it, one client can call a
	remote in a tight loop and make the server do that work thousands of times a
	second, which costs you the server rather than the economy.
]]
function AntiCheat.allow(player: Player, key: string): boolean
	local track = tracker(player)
	if not track then
		return false
	end

	local limit = AntiCheat.Settings.Limits[key]
	if not limit then
		return true
	end

	local now = os.clock()
	local bucket = track.buckets[key]
	if not bucket then
		bucket = { tokens = limit.burst, at = now }
		track.buckets[key] = bucket
	end

	bucket.tokens = math.min(limit.burst, bucket.tokens + (now - bucket.at) * limit.perSecond)
	bucket.at = now

	if bucket.tokens < 1 then
		-- Far past empty means a loop, not a fast player.
		if bucket.tokens < -limit.burst then
			bucket.tokens = 0
			AntiCheat.flag(player, "RemoteSpam", `Flooded {key}: over {limit.perSecond}/s allowance`)
		else
			bucket.tokens -= 1
		end
		return false
	end

	bucket.tokens -= 1
	return true
end

-- Movement -----------------------------------------------------------------

--[[
	The game teleports players itself -- rebirth, the void catcher, respawns. Each
	of those looks exactly like a teleport exploit from the outside, so whoever
	does the teleporting has to say so.
]]
function AntiCheat.pardon(player: Player, seconds: number?)
	local track = tracker(player)
	if not track then
		return
	end
	track.pardonUntil = os.clock() + (seconds or 3)
	track.lastPosition = nil
	track.badSpeedRun = 0
	track.airborneSince = nil
end

local function sampleMovement(player: Player, track: Tracker, state: any)
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not root or not humanoid or humanoid.Health <= 0 then
		track.lastPosition = nil
		return
	end

	local now = os.clock()
	if now < track.pardonUntil then
		return
	end

	local position = root.Position
	local previous = track.lastPosition
	local dt = now - track.lastSample
	track.lastPosition = position
	track.lastSample = now

	if not previous or dt <= 0 then
		return
	end

	-- Horizontal only: falling is not running, and a long drop would otherwise
	-- read as a speed hack.
	local moved = (Vector3.new(position.X, 0, position.Z) - Vector3.new(previous.X, 0, previous.Z)).Magnitude

	if moved > AntiCheat.Settings.TeleportStuds then
		AntiCheat.flag(player, "Teleport", `Moved {math.floor(moved)} studs in {string.format("%.2f", dt)}s`)
		track.badSpeedRun = 0
		return
	end

	local allowed = GameConfig.getWalkSpeed(state) * AntiCheat.Settings.SpeedTolerance * dt
		+ AntiCheat.Settings.SpeedGraceStuds

	if moved > allowed then
		track.badSpeedRun += 1
		-- One bad sample is lag. Several in a row is not.
		if track.badSpeedRun >= AntiCheat.Settings.SpeedStrikesNeeded then
			AntiCheat.flag(
				player,
				"Speed",
				`{math.floor(moved / dt)} studs/s over {track.badSpeedRun} samples, allowed {math.floor(GameConfig.getWalkSpeed(state))}`
			)
			track.badSpeedRun = 0
		end
	else
		track.badSpeedRun = 0
	end

	-- Flight: off the ground, and not falling. A long jump or a fall off the map
	-- both end with the player losing height, so height that holds or climbs for
	-- several seconds is the tell.
	if humanoid.FloorMaterial == Enum.Material.Air then
		if not track.airborneSince then
			track.airborneSince = now
		elseif position.Y >= previous.Y - 0.5 and now - track.airborneSince > AntiCheat.Settings.FlightSeconds then
			AntiCheat.flag(
				player,
				"Flight",
				`Airborne {math.floor(now - track.airborneSince)}s at Y={math.floor(position.Y)} without falling`
			)
			track.airborneSince = now -- restart, so it reports at most once per window
		end
	else
		track.airborneSince = nil
	end
end

-- Lifecycle ----------------------------------------------------------------

function AntiCheat.isBanned(userId: number): boolean
	if not banStore then
		return false
	end
	local ok, record = pcall(function()
		return banStore:GetAsync(`ban_{userId}`)
	end)
	return ok and type(record) == "table"
end

function AntiCheat.watch(player: Player)
	trackers[player] = {
		strikes = 0,
		lastStrike = os.clock(),
		buckets = {},
		lastPosition = nil,
		lastSample = os.clock(),
		badSpeedRun = 0,
		airborneSince = nil,
		-- Joining, loading and spawning all move the character around, so the
		-- first few seconds are never evidence of anything.
		pardonUntil = os.clock() + 10,
		reported = {},
	}

	player.CharacterAdded:Connect(function()
		AntiCheat.pardon(player, 5)
	end)
end

function AntiCheat.forget(player: Player)
	trackers[player] = nil
end

--[[
	`getState` is passed in rather than required, because AntiCheat sits below
	PlayerState and requiring upwards would be a loop. It should return the
	player's state table, or nil if they have not finished loading.
]]
function AntiCheat.start(getState: (Player) -> any)
	task.spawn(function()
		while true do
			task.wait(AntiCheat.Settings.SampleInterval)
			for player, track in trackers do
				if player.Parent == nil then
					continue
				end
				local state = getState(player)
				if not state then
					continue
				end
				local ok, err = pcall(sampleMovement, player, track, state)
				if not ok then
					warn(`[AntiCheat] Movement check errored for {player.Name}: {err}`)
				end
			end
		end
	end)

	task.spawn(function()
		while true do
			task.wait(AntiCheat.Settings.FlushInterval)
			local ok, err = pcall(flush)
			if not ok then
				warn(`[AntiCheat] Report flush errored: {err}`)
			end
		end
	end)

	-- Anything still queued when the server closes would otherwise be lost.
	game:BindToClose(function()
		pcall(flush)
	end)
end

-- Lets the rest of the game report things AntiCheat cannot see for itself, such
-- as a save that failed its own sanity check.
function AntiCheat.note(player: Player, kind: string, detail: string)
	if not trackers[player] then
		AntiCheat.watch(player)
	end
	AntiCheat.flag(player, kind, detail)
end

return AntiCheat]=]
SOURCES["Leaderboard"] = [=[
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

return Leaderboard]=]
SOURCES["MapKeep"] = [=[
--[[
	MapKeep
	Keeps hand edits when the map is regenerated.

	`HandEdited` freezes the whole map, which means changes to WorldBuilder never
	show up again. That is the wrong trade if you are still writing map code. This
	module does the other thing: the map regenerates every start as normal, and
	your edits are re-applied on top.

	Edits are kept in two different ways, because they are two different problems.

	  THINGS YOU ADDED live in Workspace.BigBebehWorld.Custom. That folder is
	  lifted out before the rebuild and put back afterwards, so it is never
	  touched. Anything you build goes there and simply survives.

	  THINGS YOU CHANGED -- a shop you dragged, a fence you recoloured, scenery
	  you deleted -- are recorded as overrides in a MapEdits ModuleScript and
	  replayed after each build.

	An override has to name the part it belongs to, and generated parts share
	names by the hundred ("Fence", "Bush"). So every generated instance is
	stamped with a BuildId: its path plus its position among same-named siblings,
	e.g. `Areas/Area1_Cookie Nursery/Shop/Post#2`. Generation is deterministic, so
	the same part gets the same id every run.

	The honest limit: change the code so a part is no longer generated, and its
	override has nowhere to land. Those are reported, not silently dropped, so
	you find out rather than wondering where an edit went.
]]

local MapKeep = {}

local CUSTOM_NAME = "Custom"

-- Only these are worth replaying. Anything else is either derived (Position is
-- part of CFrame) or not meaningfully editable by hand.
local TRACKED = {
	"CFrame",
	"Size",
	"Color",
	"Material",
	"Transparency",
	"CanCollide",
	"Anchored",
	"Reflectance",
}

--[[
	The folder your own builds live in. Created on demand, so it exists to drag
	things into the moment the map is first built.
]]
function MapKeep.customFolder(world: Instance): Folder
	local custom = world:FindFirstChild(CUSTOM_NAME)
	if not custom then
		custom = Instance.new("Folder")
		custom.Name = CUSTOM_NAME
		custom.Parent = world
	end
	return custom :: Folder
end

--[[
	Lifts the Custom folder out of the old world so it survives the Destroy that
	follows. Returns nil when there is nothing to keep.
]]
function MapKeep.detach(world: Instance?): Folder?
	if not world then
		return nil
	end
	local custom = world:FindFirstChild(CUSTOM_NAME)
	if not custom then
		return nil
	end
	custom.Parent = nil
	return custom :: Folder
end

function MapKeep.restore(world: Instance, custom: Folder?)
	if custom then
		custom.Parent = world
	else
		MapKeep.customFolder(world)
	end
end

--[[
	Gives every generated instance a stable id.

	The ordinal is per-name within a parent, so adding a new kind of part beside
	an existing one does not renumber it -- only adding another part of the SAME
	name in the SAME parent shifts the ones after it.

	Stamping only ever FILLS IN a missing id; an id already on a part is kept.
	That matters because ordinals are positional: if this renumbered, deleting one
	part would shift every later sibling onto its neighbour's id, and the edits
	recorded for those parts would land on the wrong things. Keeping stored ids
	means a deletion costs exactly one id -- the deleted one.
]]
function MapKeep.stamp(world: Instance)
	local function walk(node: Instance, prefix: string)
		local children = node:GetChildren()

		-- Ids already present here, so a freshly stamped sibling cannot be handed
		-- one of them. A hand-duplicated part arrives carrying the original's id;
		-- the second one through is treated as unstamped and renamed.
		local taken: { [string]: boolean } = {}
		local keep: { [Instance]: string } = {}
		for _, child in children do
			local existing = child:GetAttribute("BuildId")
			if type(existing) == "string" and not taken[existing] then
				taken[existing] = true
				keep[child] = existing
			end
		end

		local counts: { [string]: number } = {}
		for _, child in children do
			-- Your own folder is not generated, so it is not stamped.
			if child.Name == CUSTOM_NAME and node == world then
				continue
			end

			local id = keep[child]
			if not id then
				local n = counts[child.Name] or 0
				repeat
					n += 1
					id = `{prefix}{child.Name}#{n}`
				until not taken[id]
				counts[child.Name] = n
				taken[id] = true
				child:SetAttribute("BuildId", id)
			end
			walk(child, id .. "/")
		end
	end
	walk(world, "")
end

local function index(world: Instance): { [string]: Instance }
	local byId: { [string]: Instance } = {}
	for _, node in world:GetDescendants() do
		local id = node:GetAttribute("BuildId")
		if type(id) == "string" then
			byId[id] = node
		end
	end
	return byId
end

MapKeep.index = index

--[[
	Replays the overrides in `edits` onto a freshly built world.

	Returns how many landed and a list of ids that no longer exist, which is the
	signal that the map code changed underneath an edit.
]]
function MapKeep.apply(world: Instance, edits: any): (number, { string })
	MapKeep.stamp(world)

	if type(edits) ~= "table" then
		return 0, {}
	end

	local byId = index(world)
	local applied = 0
	local orphans: { string } = {}

	-- Deletions first: no point restyling something that is about to go.
	for id in edits.removed or {} do
		local node = byId[id]
		if node then
			node:Destroy()
			byId[id] = nil
			applied += 1
		else
			table.insert(orphans, id)
		end
	end

	for id, props in edits.props or {} do
		local node = byId[id]
		if not node then
			table.insert(orphans, id)
			continue
		end
		for key, value in props do
			-- One bad property must not stop the rest of the map being restored.
			local ok, err = pcall(function()
				if key == "CFrame" then
					(node :: any).CFrame = CFrame.new(table.unpack(value))
				elseif key == "Size" then
					(node :: any).Size = Vector3.new(value[1], value[2], value[3])
				elseif key == "Color" then
					(node :: any).Color = Color3.fromRGB(value[1], value[2], value[3])
				elseif key == "Material" then
					(node :: any).Material = (Enum.Material :: any)[value]
				else
					(node :: any)[key] = value
				end
			end)
			if not ok then
				warn(`[MapKeep] Could not restore {key} on {id}: {err}`)
			end
		end
		applied += 1
	end

	return applied, orphans
end

--[[
	The whole job in one call, for WorldBuilder to use at the end of a build.
	Finds MapEdits next to itself if it exists; without one this just stamps ids,
	so the capture tool has something to compare against.
]]
function MapKeep.finish(world: Instance, custom: Folder?)
	MapKeep.restore(world, custom)

	local module = script.Parent:FindFirstChild("MapEdits")
	if not module or not module:IsA("ModuleScript") then
		MapKeep.stamp(world)
		return
	end

	local ok, edits = pcall(require, module)
	if not ok then
		warn(`[MapKeep] MapEdits could not be loaded, map left as generated: {edits}`)
		MapKeep.stamp(world)
		return
	end

	local applied, orphans = MapKeep.apply(world, edits)
	if applied > 0 then
		print(`[MapKeep] Restored {applied} hand edit(s).`)
	end
	if #orphans > 0 then
		warn(
			`[MapKeep] {#orphans} edit(s) had nowhere to land -- the map code no longer builds those parts. `
				.. `First: {orphans[1]}. Re-run the capture tool to drop them.`
		)
	end
end

MapKeep.TRACKED = TRACKED

return MapKeep]=]

local ORDER = { "SessionLock", "AntiCheat", "Leaderboard", "MapKeep" }

for _, name in ORDER do
	local existing = game_folder:FindFirstChild(name)
	if existing and not existing:IsA("ModuleScript") then
		say(`FAILED  {name} exists but is a {existing.ClassName}, not a ModuleScript — rename or delete it and re-run.`)
		continue
	end

	if existing then
		if existing.Source == SOURCES[name] then
			say(`SAME    {name} already matches, left alone.`)
		else
			existing.Source = SOURCES[name]
			say(`UPDATED {name} ({#SOURCES[name]} chars).`)
		end
	else
		local module = Instance.new("ModuleScript")
		module.Name = name
		module.Source = SOURCES[name]
		module.Parent = game_folder
		say(`CREATED {name} ({#SOURCES[name]} chars).`)
	end
end

-- Hook-ins ------------------------------------------------------------------
-- These live inside scripts you have edited yourself, so they are checked and
-- reported, never written.

local function check(container, childName, label, needle)
	local target = if childName then container:FindFirstChild(childName) else container
	if not target then
		say(`MISSING {label} — could not find {childName or "the script"}.`)
		return
	end
	if string.find(target.Source, needle, 1, true) then
		say(`OK      {label}`)
	else
		say(`TODO    {label}`)
	end
end

check(game_folder, "PlayerState", "PlayerState requires SessionLock", "require(script.Parent.SessionLock)")
check(game_folder, "PlayerState", "PlayerState starts the lock heartbeat", "SessionLock.startHeartbeat")
check(game_folder, "PlayerState", "PlayerState.load claims the save", "SessionLock.claim")
check(game_folder, "PlayerState", "PlayerState.save goes through the lock", "SessionLock.save")
check(game_folder, "PlayerState", "PlayerState.release drops the claim", "SessionLock.release")

check(game_folder, nil, "Server script requires AntiCheat", "require(script.AntiCheat)")
check(game_folder, nil, "teleportToArea pardons the move", "AntiCheat.pardon")
check(game_folder, nil, "BuyUpgrade is throttled", 'AntiCheat.allow(player, "BuyUpgrade")')
check(game_folder, nil, "Rebirth is throttled", 'AntiCheat.allow(player, "Rebirth")')
check(game_folder, nil, "SyncState is throttled", 'AntiCheat.allow(player, "SyncState")')
check(game_folder, nil, "Join refuses a locked save", "player:Kick(refused)")
check(game_folder, nil, "Leaving clears the tracker", "AntiCheat.forget")
check(game_folder, nil, "AntiCheat.start is called", "AntiCheat.start")

check(game_folder, "PlayerState", "PlayerState tracks lifetime cookies", "totalCookies = 0")
check(game_folder, "PlayerState", "PlayerState tracks playtime", "playtime = 0")
check(game_folder, nil, "Server script requires Leaderboard", "require(script.Leaderboard)")
check(game_folder, nil, "Collecting counts lifetime cookies", "state.totalCookies += gained")
check(game_folder, nil, "Playtime is ticked", "PLAYTIME_TICK")
check(game_folder, nil, "Leaderboard.start is called", "Leaderboard.start")
check(game_folder, "WorldBuilder", "The world builds leaderboards", "buildLeaderboards")

check(game_folder, "WorldBuilder", "WorldBuilder requires MapKeep", "require(script.Parent.MapKeep)")
check(game_folder, "WorldBuilder", "Your builds are lifted out before a rebuild", "MapKeep.detach(existing)")
check(game_folder, "WorldBuilder", "Edits are replayed after a build", "MapKeep.finish(world, kept)")

-- Settings the modules cannot check for themselves.
local anti = game_folder:FindFirstChild("AntiCheat")
if anti and string.find(anti.Source, 'AntiCheat.WebhookUrl = ""', 1, true) then
	say("NOTE    No webhook set yet — reports go to Output. Set AntiCheat.WebhookUrl to your proxy url.")
end

print("=== Big Bebeh — install modules ===")
for _, line in report do
	print("  " .. line)
end

local todo = 0
for _, line in report do
	if string.sub(line, 1, 4) == "TODO" or string.sub(line, 1, 7) == "MISSING" then
		todo += 1
	end
end
if todo > 0 then
	say("NEXT    Run 2_PatchHooks to apply those automatically.")
end

local summary = if todo == 0 then "ALL HOOKS PRESENT" else `{todo} hook-in(s) still to add`
print("  " .. summary)
print("=== end ===")

-- Returned as well as printed: a bridge plugin shows the return value in its own
-- report box, and print() only reaches the Output window.
--
-- One STRING, not a table. The bridge stringifies whatever it gets, so a table
-- comes back as "table: 0x...". A joined string survives that intact.
table.insert(report, summary)
return table.concat(report, "\n")
