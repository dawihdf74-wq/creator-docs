--[[
	Big Bebeh — apply the anti-cheat hook-ins.

	Run InstallAntiCheat first (it creates the modules); this wires them in.

	Every change here is an anchored find/replace. It matches an exact region of
	your script, and if that region is not there verbatim it reports the miss
	rather than guessing where the code should go -- a patcher that guesses is
	how you end up with a script that no longer compiles.

	Already-applied changes are skipped, so running this twice is safe.
]]

local ServerScriptService = game:GetService("ServerScriptService")

local report = {}
local function say(line)
	table.insert(report, line)
end

local folder = ServerScriptService:FindFirstChild("BigBebehGame")
if not folder then
	return "FAILED  ServerScriptService.BigBebehGame not found — nothing was changed."
end

local PATCHES = {}
table.insert(PATCHES, {
	target = "PlayerState",
	label = [[
require SessionLock]],
	marker = [[
script.Parent.SessionLock]],
	finds = {
		[[
local GameConfig = require(ReplicatedStorage.BigBebehShared.GameConfig)
]],
	},
	replace = [[
local GameConfig = require(ReplicatedStorage.BigBebehShared.GameConfig)
local SessionLock = require(script.Parent.SessionLock)
]],
})
table.insert(PATCHES, {
	target = "PlayerState",
	label = [[
start the lock heartbeat]],
	marker = [[
SessionLock.startHeartbeat]],
	finds = {
		[[
	if ok then
		store = result
	else
]],
	},
	replace = [[
	if ok then
		store = result
		SessionLock.startHeartbeat(result)
	else
]],
})
table.insert(PATCHES, {
	target = "PlayerState",
	label = [[
require RunService]],
	marker = [[
local RunService = game:GetService("RunService")]],
	finds = {
		[[
local ReplicatedStorage = game:GetService("ReplicatedStorage")
]],
	},
	replace = [[
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
]],
})
table.insert(PATCHES, {
	target = "PlayerState",
	label = [[
load claims the save, and degrades in Studio]],
	marker = [[
Running WITHOUT saves]],
	finds = {
		[[
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
end]],
		[=[
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
end]=],
	},
	replace = [=[
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
end]=],
})
table.insert(PATCHES, {
	target = "PlayerState",
	label = [[
save and release go through the lock]],
	marker = [[
SessionLock.save]],
	finds = {
		[[
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
end]],
	},
	replace = [[
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
end]],
})
table.insert(PATCHES, {
	target = nil,
	label = [[
require AntiCheat]],
	marker = [[
require(script.AntiCheat)]],
	finds = {
		[[
local BebehBuilder = require(script.BebehBuilder)
]],
	},
	replace = [[
local AntiCheat = require(script.AntiCheat)
local BebehBuilder = require(script.BebehBuilder)
]],
})
table.insert(PATCHES, {
	target = nil,
	label = [[
teleportToArea pardons the move]],
	marker = [[
AntiCheat.pardon]],
	finds = {
		[[
	character:PivotTo(CFrame.new(center + Vector3.new(0, 6, 70)))
]],
	},
	replace = [[
	-- Tell the watchdog before moving them, or the game's own teleport reads as a
	-- teleport exploit the instant it lands.
	AntiCheat.pardon(player, 3)
	character:PivotTo(CFrame.new(center + Vector3.new(0, 6, 70)))
]],
})
table.insert(PATCHES, {
	target = nil,
	label = [[
throttle BuyUpgrade]],
	marker = [[
AntiCheat.allow(player, "BuyUpgrade")]],
	finds = {
		[[
Remotes.BuyUpgrade.OnServerEvent:Connect(function(player, upgradeId)
	if type(upgradeId) ~= "string" then
		return
	end]],
	},
	replace = [[
Remotes.BuyUpgrade.OnServerEvent:Connect(function(player, upgradeId)
	if not AntiCheat.allow(player, "BuyUpgrade") then
		return
	end
	if type(upgradeId) ~= "string" then
		-- The real client only ever sends a string. Anything else was hand-built.
		AntiCheat.flag(player, "BadPayload", `BuyUpgrade sent a {typeof(upgradeId)}`)
		return
	end]],
})
table.insert(PATCHES, {
	target = nil,
	label = [[
throttle Rebirth]],
	marker = [[
AntiCheat.allow(player, "Rebirth")]],
	finds = {
		[[
Remotes.Rebirth.OnServerEvent:Connect(function(player)
	local state = PlayerState.get(player)]],
	},
	replace = [[
Remotes.Rebirth.OnServerEvent:Connect(function(player)
	if not AntiCheat.allow(player, "Rebirth") then
		return
	end
	local state = PlayerState.get(player)]],
})
table.insert(PATCHES, {
	target = nil,
	label = [[
throttle SyncState]],
	marker = [[
AntiCheat.allow(player, "SyncState")]],
	finds = {
		[[
Remotes.SyncState.OnServerEvent:Connect(function(player)
	sync(player)
end)]],
	},
	replace = [[
Remotes.SyncState.OnServerEvent:Connect(function(player)
	-- Cheap to serve but not free, and it is the easiest remote to sit in a loop.
	if not AntiCheat.allow(player, "SyncState") then
		return
	end
	sync(player)
end)]],
})
table.insert(PATCHES, {
	target = nil,
	label = [[
join refuses a locked save]],
	marker = [[
player:Kick(refused)]],
	finds = {
		[[
local function onPlayerAdded(player: Player)
	local state = PlayerState.load(player)
]],
	},
	replace = [[
local function onPlayerAdded(player: Player)
	AntiCheat.watch(player)

	if AntiCheat.isBanned(player.UserId) then
		player:Kick("You are banned from this experience.")
		return
	end

	local state, refused = PlayerState.load(player)
	if not state then
		-- Their save is open in another server. Letting them play from stale data
		-- is how currency gets duplicated, so they wait instead.
		player:Kick(refused)
		return
	end
]],
})
table.insert(PATCHES, {
	target = nil,
	label = [[
leaving clears the tracker, and AntiCheat starts]],
	marker = [[
AntiCheat.forget]],
	finds = {
		[[
Players.PlayerRemoving:Connect(function(player)
	lastToast[player] = nil
	PlayerState.release(player)
end)]],
	},
	replace = [[
Players.PlayerRemoving:Connect(function(player)
	lastToast[player] = nil
	AntiCheat.forget(player)
	PlayerState.release(player)
end)

-- Movement sampling and Discord reporting. AntiCheat cannot require PlayerState
-- itself without a require cycle, so it is handed a way to read state instead.
AntiCheat.start(function(player)
	return PlayerState.get(player)
end)]],
})

local applied, skipped, missed = 0, 0, 0

-- Each script is read once, patched in memory, and written once. Assigning
-- Source per patch would make a half-applied script the visible state if a
-- later patch failed.
local edits = {}

for _, patch in PATCHES do
	local target = if patch.target then folder:FindFirstChild(patch.target) else folder
	local name = patch.target or "BigBebehGame"

	if not target then
		say(`FAILED  {patch.label} — {name} not found.`)
		missed += 1
		continue
	end

	local source = edits[target] or target.Source

	if string.find(source, patch.marker, 1, true) then
		say(`SKIP    {patch.label} — already applied.`)
		skipped += 1
		continue
	end

	-- Several anchors may be listed, one per shape the code has had. Take the
	-- first that matches exactly once; a second match means the anchor is
	-- ambiguous, and picking one at random is worse than doing nothing.
	local from, to, ambiguous = nil, nil, false
	for _, anchor in patch.finds do
		local a, b = string.find(source, anchor, 1, true)
		if a then
			if string.find(source, anchor, b + 1, true) then
				ambiguous = true
			else
				from, to = a, b
				break
			end
		end
	end

	if not from then
		if ambiguous then
			say(`MISSED  {patch.label} — the anchor appears more than once in {name}, so it is ambiguous.`)
		else
			say(`MISSED  {patch.label} — could not find the anchor in {name}. Apply this one by hand.`)
		end
		missed += 1
		continue
	end

	edits[target] = string.sub(source, 1, from - 1) .. patch.replace .. string.sub(source, to + 1)
	say(`PATCHED {patch.label}`)
	applied += 1
end

for instance, source in edits do
	instance.Source = source
end

local summary = `{applied} applied, {skipped} already there, {missed} need doing by hand`
say(summary)

print("=== Big Bebeh hook-in patch ===")
for _, line in report do
	print("  " .. line)
end
print("=== end ===")

return table.concat(report, "\n")
