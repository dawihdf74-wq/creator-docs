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

return SessionLock
