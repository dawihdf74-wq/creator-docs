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

return AntiCheat
