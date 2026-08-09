--[[
	Big Bebeh — STEP 2 of 2: wire the modules into your scripts.

	Run 1_InstallModules first (it creates the modules); this connects them.

	Touches GameConfig, WorldBuilder, PlayerState and the BigBebehGame script.

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

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local folder = ServerScriptService:FindFirstChild("BigBebehGame")
if not folder then
	return "FAILED  ServerScriptService.BigBebehGame not found — nothing was changed."
end

-- Most targets are children of BigBebehGame. A "shared:" prefix means the module
-- lives in ReplicatedStorage.BigBebehShared instead.
local function resolve(target)
	if not target then
		return folder, "BigBebehGame"
	end
	local prefix, name = string.match(target, "^(%w+):(.+)$")
	if prefix == "shared" then
		local sharedFolder = ReplicatedStorage:FindFirstChild("BigBebehShared")
		return sharedFolder and sharedFolder:FindFirstChild(name), name
	end
	return folder:FindFirstChild(target), target
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
table.insert(PATCHES, {
	target = "shared:GameConfig",
	label = [[
leaderboard config]],
	marker = [[
GameConfig.Leaderboards]],
	finds = {
		[[
-- Rebirth ------------------------------------------------------------------]],
	},
	replace = [=[
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

-- Rebirth ------------------------------------------------------------------]=],
})
table.insert(PATCHES, {
	target = "shared:GameConfig",
	label = [[
zone 1 leaderboard placement]],
	marker = [[
LeaderboardYaw]],
	finds = {
		[[
		ShopOffset = Vector3.new(62, 0, 62),
]],
	},
	replace = [[
		ShopOffset = Vector3.new(62, 0, 62),
		-- Mirrors the upgrade board on the far side of the pit, turned to face it.
		LeaderboardOffset = Vector3.new(58, 0, 4),
		LeaderboardYaw = 90,
]],
})
table.insert(PATCHES, {
	target = "shared:GameConfig",
	label = [[
leaderboard placement for the other zones]],
	marker = [[
LeaderboardOffset = Vector3.new(size.X / 2 - 10]],
	finds = {
		[[
		BoardOffset = Vector3.new(0, 0, -(size.Z / 2 - 6)),
]],
	},
	replace = [[
		BoardOffset = Vector3.new(0, 0, -(size.Z / 2 - 6)),
		LeaderboardOffset = Vector3.new(size.X / 2 - 10, 0, 0),
]],
})
table.insert(PATCHES, {
	target = "WorldBuilder",
	label = [[
the leaderboard builder]],
	marker = [[
local function buildLeaderboards]],
	finds = {
		[[
--[[
	The rune altar.]],
	},
	replace = [=[
--[[
	A row of global leaderboards.

	Unlike the upgrade board, these are drawn by the SERVER. Every player sees
	the same ten names, so rendering them once and letting them replicate beats
	rebuilding the same list in every client.

	Each face is tagged so the game script can find it again to fill in rows;
	the builder only puts up the empty board.
]]
local function buildLeaderboards(areaIndex: number, cfg: any, parent: Instance)
	local folder = Instance.new("Folder")
	folder.Name = "Leaderboards"
	folder.Parent = parent

	local anchor = GameConfig.getLandmark(areaIndex, "LeaderboardOffset")
	local yaw = CFrame.Angles(0, math.rad(GameConfig.Areas[areaIndex].LeaderboardYaw or 0), 0)
	local base = CFrame.new(anchor) * yaw

	local boardWidth, boardHeight, spacing = 20, 26, 23
	local count = #GameConfig.Leaderboards
	-- Lay the row out around its centre, so the anchor means the middle of the
	-- row rather than the first board.
	local startX = -(count - 1) * spacing / 2

	for index, board in GameConfig.Leaderboards do
		local at = base * CFrame.new(startX + (index - 1) * spacing, 0, 0)

		makeAnchoredPart(
			"LeaderboardLeg",
			Vector3.new(1.4, 10, 1.4),
			at * CFrame.new(0, 5, 0),
			Color3.fromRGB(96, 74, 58),
			folder
		)
		makeAnchoredPart(
			"LeaderboardFrame",
			Vector3.new(boardWidth + 2, boardHeight + 2, 1.4),
			at * CFrame.new(0, 10 + boardHeight / 2, 0),
			Color3.fromRGB(64, 52, 74),
			folder
		)

		local face = makeAnchoredPart(
			"LeaderboardFace",
			Vector3.new(boardWidth, boardHeight, 1),
			at * CFrame.new(0, 10 + boardHeight / 2, -0.6),
			Color3.fromRGB(26, 24, 36),
			folder
		)
		face.Material = Enum.Material.SmoothPlastic
		-- Which board this is, so the filler does not have to rely on order.
		face:SetAttribute("BoardId", board.Id)
		CollectionService:AddTag(face, "Leaderboard")
	end

	local header = makeAnchoredPart(
		"LeaderboardHeader",
		Vector3.new(1, 1, 1),
		base * CFrame.new(0, 10 + boardHeight + 5, 0),
		cfg.AccentColor,
		folder
	)
	header.Transparency = 1
	header.CanCollide = false
	makeSign("🏆 HALL OF CRUMBS", UDim2.fromScale(26, 4), header, 0)

	return folder
end

--[[
	The rune altar.]=],
})
table.insert(PATCHES, {
	target = "WorldBuilder",
	label = [[
building leaderboards per area]],
	marker = [[
buildLeaderboards(areaIndex, cfg, folder)]],
	finds = {
		[[
	buildUpgradeBoard(areaIndex, cfg, folder)
]],
	},
	replace = [[
	buildUpgradeBoard(areaIndex, cfg, folder)
	buildLeaderboards(areaIndex, cfg, folder)
]],
})
table.insert(PATCHES, {
	target = "WorldBuilder",
	label = [[
keeping scenery out of the leaderboards]],
	marker = [[
"LeaderboardOffset"), radius = 56]],
	finds = {
		[[
		{ pos = GameConfig.getLandmark(areaIndex, "BoardOffset"), radius = 32 },
]],
	},
	replace = [[
		{ pos = GameConfig.getLandmark(areaIndex, "BoardOffset"), radius = 32 },
		{ pos = GameConfig.getLandmark(areaIndex, "LeaderboardOffset"), radius = 56 },
]],
})
table.insert(PATCHES, {
	target = "PlayerState",
	label = [[
lifetime stats in the default state]],
	marker = [[
totalCookies = 0]],
	finds = {
		[[
		runes = runes,
		runesOpened = 0,
]],
	},
	replace = [[
		runes = runes,
		runesOpened = 0,
		-- Leaderboard stats. Lifetime totals: rebirth resets areas, not records.
		totalCookies = 0,
		playtime = 0,
]],
})
table.insert(PATCHES, {
	target = "PlayerState",
	label = [[
lifetime stats survive a load]],
	marker = [[
raw.totalCookies]],
	finds = {
		[[
	if type(raw.runesOpened) == "number" and raw.runesOpened >= 0 then
		state.runesOpened = math.floor(raw.runesOpened)
	end]],
	},
	replace = [[
	if type(raw.runesOpened) == "number" and raw.runesOpened >= 0 then
		state.runesOpened = math.floor(raw.runesOpened)
	end
	if type(raw.totalCookies) == "number" and raw.totalCookies >= 0 then
		state.totalCookies = math.floor(raw.totalCookies)
	end
	if type(raw.playtime) == "number" and raw.playtime >= 0 then
		state.playtime = math.floor(raw.playtime)
	end]],
})
table.insert(PATCHES, {
	target = "PlayerState",
	label = [[
document the lifetime stats]],
	marker = [[
lifetime, never reset by rebirth]],
	finds = {
		[[
		runesOpened = 420,
]],
	},
	replace = [[
		runesOpened = 420,
		totalCookies = 9120,     -- lifetime, never reset by rebirth
		playtime  = 4830,        -- seconds played, all sessions
]],
})
table.insert(PATCHES, {
	target = nil,
	label = [[
require Leaderboard and the design system]],
	marker = [[
require(script.Leaderboard)]],
	finds = {
		[[
local Remotes = require(ReplicatedStorage.BigBebehShared.Remotes)
local AntiCheat = require(script.AntiCheat)
local BebehBuilder = require(script.BebehBuilder)
]],
	},
	replace = [[
local Remotes = require(ReplicatedStorage.BigBebehShared.Remotes)
local Theme = require(ReplicatedStorage.BigBebehShared.UI.Theme)
local UI = require(ReplicatedStorage.BigBebehShared.UI.Components)
local AntiCheat = require(script.AntiCheat)
local BebehBuilder = require(script.BebehBuilder)
local Leaderboard = require(script.Leaderboard)
]],
})
table.insert(PATCHES, {
	target = nil,
	label = [[
collecting counts lifetime cookies]],
	marker = [[
state.totalCookies += gained]],
	finds = {
		[[
	local gained = math.min(math.floor(value), capacity - state.carried)
	state.carried += gained
]],
	},
	replace = [[
	local gained = math.min(math.floor(value), capacity - state.carried)
	state.carried += gained
	-- Lifetime total for the leaderboard. Counts what reached your hands, so a
	-- pickup that overflowed your capacity does not inflate the record.
	state.totalCookies += gained
]],
})
table.insert(PATCHES, {
	target = nil,
	label = [[
playtime ticking and the leaderboard boards]],
	marker = [[
PLAYTIME_TICK]],
	finds = {
		[[
AntiCheat.start(function(player)
	return PlayerState.get(player)
end)]],
	},
	replace = [=[
AntiCheat.start(function(player)
	return PlayerState.get(player)
end)

-- Leaderboards -------------------------------------------------------------

--[[
	Playtime is counted here rather than from a join timestamp, so a server that
	crashes loses at most one tick instead of the whole session.
]]
local PLAYTIME_TICK = 15

task.spawn(function()
	while true do
		task.wait(PLAYTIME_TICK)
		for _, state in PlayerState.all() do
			state.playtime += PLAYTIME_TICK
		end
	end
end)

--[[
	Fills a leaderboard face. The whole list is redrawn on each update rather
	than diffed: ten rows is nothing, and a redraw cannot drift out of step with
	the data the way an incremental update can.
]]
local function drawLeaderboard(face: BasePart, rows: { any })
	local boardId = face:GetAttribute("BoardId") :: string
	local board = nil
	for _, entry in GameConfig.Leaderboards do
		if entry.Id == boardId then
			board = entry
		end
	end
	if not board then
		return
	end

	local gui = face:FindFirstChild("Board") :: SurfaceGui?
	if not gui then
		gui = Instance.new("SurfaceGui")
		gui.Name = "Board"
		gui.Face = Enum.NormalId.Front
		gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
		gui.PixelsPerStud = 48
		gui.LightInfluence = 0
		gui.Parent = face

		local panel = UI.panel(gui, {
			Name = "Root",
			Size = UDim2.fromScale(1, 1),
		})
		UI.padding(panel, 3)
		UI.list(panel, 1)

		UI.label(panel, {
			Name = "Title",
			Size = UDim2.new(1, 0, 0, 40),
			LayoutOrder = 0,
			Font = Theme.font.display,
			Text = `{board.Icon} {string.upper(board.Name)}`,
			TextColor3 = Theme.color.text,
			TextSize = Theme.textSize.lg,
			TextXAlignment = Enum.TextXAlignment.Center,
		})

		local list = Instance.new("Frame")
		list.Name = "Rows"
		list.BackgroundTransparency = 1
		list.Size = UDim2.new(1, 0, 1, -46)
		list.LayoutOrder = 1
		list.Parent = panel
		UI.list(list, 1)
	end

	local panel = gui:FindFirstChild("Root") :: Frame
	local list = panel:FindFirstChild("Rows") :: Frame
	for _, child in list:GetChildren() do
		if child:IsA("GuiObject") then
			child:Destroy()
		end
	end

	if #rows == 0 then
		UI.label(list, {
			Size = UDim2.new(1, 0, 0, 30),
			Text = "no one yet — be first",
			TextColor3 = Theme.color.textFaint,
			TextSize = Theme.textSize.sm,
			TextXAlignment = Enum.TextXAlignment.Center,
		})
		return
	end

	for rank, row in rows do
		local line = UI.row(list, {
			Name = `Rank{rank}`,
			Size = UDim2.new(1, 0, 0, 32),
			LayoutOrder = rank,
		})
		-- The top three are the only rows anyone reads twice, so they keep full
		-- contrast and the rest step back.
		local rankColor = if rank == 1
			then Theme.color.cookie
			elseif rank <= 3 then Theme.color.text
			else Theme.color.textDim

		UI.label(line, {
			Name = "Rank",
			Size = UDim2.new(0, 34, 1, 0),
			LayoutOrder = 0,
			Text = `{rank}.`,
			TextColor3 = rankColor,
			TextSize = Theme.textSize.sm,
		})
		UI.label(line, {
			Name = "Name",
			Size = UDim2.new(1, -132, 1, 0),
			LayoutOrder = 1,
			Text = row.name,
			TextColor3 = rankColor,
			TextSize = Theme.textSize.sm,
			TextTruncate = Enum.TextTruncate.AtEnd,
		})
		UI.label(line, {
			Name = "Value",
			Size = UDim2.new(0, 90, 1, 0),
			LayoutOrder = 2,
			Text = GameConfig.formatStat(board, row.value),
			TextColor3 = Theme.color.cookie,
			TextSize = Theme.textSize.sm,
			TextXAlignment = Enum.TextXAlignment.Right,
		})
	end
end

local function redraw(boardId: string, rows: { any })
	for _, face in CollectionService:GetTagged("Leaderboard") do
		if face:GetAttribute("BoardId") == boardId then
			local ok, err = pcall(drawLeaderboard, face, rows)
			if not ok then
				warn(`[BigBebeh] Could not draw the {boardId} leaderboard: {err}`)
			end
		end
	end
end

Leaderboard.onUpdate(redraw)
Leaderboard.start(PlayerState.all)

-- Draw the empty state immediately, so a fresh server shows boards rather than
-- blank slabs while the first fetch is in flight.
for _, board in GameConfig.Leaderboards do
	redraw(board.Id, Leaderboard.top(board.Id))
end]=],
})

local applied, skipped, missed = 0, 0, 0

-- Each script is read once, patched in memory, and written once. Assigning
-- Source per patch would make a half-applied script the visible state if a
-- later patch failed.
local edits = {}

for _, patch in PATCHES do
	local target, name = resolve(patch.target)

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

print("=== Big Bebeh — patch hooks ===")
for _, line in report do
	print("  " .. line)
end
print("=== end ===")

return table.concat(report, "\n")
