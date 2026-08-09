--[[
	Big Bebeh — Cookie Collector (server)

	The loop:
	  1. Cookies lie around each area. Walk over one to pick it up.
	  2. Your hands only hold so many; when they are full, go feed Big Bebeh.
	  3. Stand on his pad and he eats everything you are carrying, paying out
	     Sprinkles as he goes.
	  4. Fill his hunger bar and the gate to the next area opens for you.
	  5. Spend Sprinkles at the shop on hands, speed, magnet and luck.
	  6. Once BIG BEBEH is full, rebirth for a permanent multiplier.

	All tuning lives in ReplicatedStorage/BigBebehShared/GameConfig.
]]

local CollectionService = game:GetService("CollectionService")
local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local GameConfig = require(ReplicatedStorage.BigBebehShared.GameConfig)
local Remotes = require(ReplicatedStorage.BigBebehShared.Remotes)
local Theme = require(ReplicatedStorage.BigBebehShared.UI.Theme)
local UI = require(ReplicatedStorage.BigBebehShared.UI.Components)
local AntiCheat = require(script.AntiCheat)
local BebehBuilder = require(script.BebehBuilder)
local Leaderboard = require(script.Leaderboard)
local PlayerState = require(script.PlayerState)
local WorldBuilder = require(script.WorldBuilder)

local COOKIE_COLOR = Color3.fromRGB(255, 226, 140)
local LUCKY_COLOR = Color3.fromRGB(150, 255, 170)
local UNLOCK_COLOR = Color3.fromRGB(140, 255, 170)
local SPRINKLE_COLOR = Color3.fromRGB(255, 150, 220)
local DENY_COLOR = Color3.fromRGB(255, 150, 130)

local world = WorldBuilder.build()

local cookiePool = Instance.new("Folder")
cookiePool.Name = "CookiePool"
cookiePool.Parent = ServerStorage

-- Cookies grouped by area, so the magnet only ever scans one platform's worth.
local cookiesByArea: { [number]: { Model } } = {}

-- Cookie spawning ----------------------------------------------------------

-- Somewhere on the platform that is not on top of the Bebeh or his feed pad.
local function randomCookiePosition(areaIndex: number): Vector3
	-- Cookies belong in the pit and nowhere else, which is what keeps the rest of
	-- the map walkable instead of carpeted.
	local pitCenter, pitSize = GameConfig.getCookiePit(areaIndex)
	local halfX = math.max(6, pitSize.X / 2 - 6)
	local halfZ = math.max(6, pitSize.Y / 2 - 6)
	-- The pit floor sits 2.5 studs below the platform, so cookies ride just above it.
	local y = pitCenter.Y + 0.3

	return Vector3.new(
		pitCenter.X + math.random(-halfX, halfX),
		y,
		pitCenter.Z + math.random(-halfZ, halfZ)
	)
end

-- Import models/BigBebehCookie.fbx and name it "CookieModel" in ServerStorage
-- to swap the procedural cookie for the sculpted mesh.
local COOKIE_TEMPLATE = ServerStorage:FindFirstChild("CookieModel")
local COOKIE_TARGET_WIDTH = 3.2

local function createMeshCookie(areaIndex: number): Model
	local cfg = GameConfig.Areas[areaIndex]
	local model = (COOKIE_TEMPLATE :: Model):Clone()
	model.Name = "Cookie"

	-- Match the procedural cookie's footprint whatever scale it imported at.
	pcall(function()
		model:ScaleTo(1)
		local _, size = model:GetBoundingBox()
		if size.X > 0.001 then
			model:ScaleTo(COOKIE_TARGET_WIDTH / size.X)
		end
	end)

	-- The biggest part becomes the touch target; the chips stay inert.
	local biggest: BasePart? = nil
	for _, part in model:GetDescendants() do
		if part:IsA("BasePart") then
			part.Anchored = true
			part.CanCollide = false
			part.CanTouch = false
			part.CanQuery = false
			part.Material = Enum.Material.Sand
			local color = BebehBuilder.colorFor(part.Name)
			part.Color = color or cfg.CookieColor
			if not biggest or part.Size.Magnitude > biggest.Size.Magnitude then
				biggest = part
			end
		end
	end

	if biggest then
		biggest.Name = "Disc"
		biggest.CanTouch = true
		model.PrimaryPart = biggest
	end

	model:SetAttribute("AreaIndex", areaIndex)
	model:SetAttribute("Value", cfg.CookieValue)
	model:SetAttribute("IsMesh", true)
	return model
end

local function createCookie(areaIndex: number): Model
	if COOKIE_TEMPLATE and COOKIE_TEMPLATE:IsA("Model") then
		return createMeshCookie(areaIndex)
	end

	local cfg = GameConfig.Areas[areaIndex]

	local model = Instance.new("Model")
	model.Name = "Cookie"

	local disc = Instance.new("Part")
	disc.Name = "Disc"
	disc.Shape = Enum.PartType.Cylinder
	disc.Size = Vector3.new(0.6, 3.2, 3.2)
	disc.Color = cfg.CookieColor
	disc.Material = Enum.Material.Sand
	disc.Anchored = true
	disc.CanCollide = false
	disc.CanTouch = true
	disc.Parent = model
	model.PrimaryPart = disc

	-- Chocolate chips scattered on the top face.
	for i = 1, 4 do
		local angle = (i / 4) * math.pi * 2 + math.random() * 0.6
		local chip = Instance.new("Part")
		chip.Name = "Chip"
		chip.Shape = Enum.PartType.Ball
		chip.Size = Vector3.new(0.7, 0.7, 0.7)
		chip.Color = cfg.CookieColor:Lerp(Color3.fromRGB(40, 24, 14), 0.75)
		chip.Material = Enum.Material.SmoothPlastic
		chip.Anchored = true
		chip.CanCollide = false
		chip.CanTouch = false
		chip.CanQuery = false
		chip.Parent = model
		chip:SetAttribute("Offset", Vector3.new(math.cos(angle) * 0.9, 0.35, math.sin(angle) * 0.9))
	end

	model:SetAttribute("AreaIndex", areaIndex)
	model:SetAttribute("Value", cfg.CookieValue)

	return model
end

-- Places a cookie model at a fresh random spot in its area.
local function placeCookie(model: Model)
	local areaIndex = model:GetAttribute("AreaIndex") :: number
	local pos = randomCookiePosition(areaIndex)

	if model:GetAttribute("IsMesh") then
		-- The sculpted cookie is already flat, so move it whole and spin the
		-- yaw for variety.
		model:PivotTo(CFrame.new(pos) * CFrame.Angles(0, math.random() * math.pi * 2, 0))
	else
		local disc = model.PrimaryPart :: Part
		-- The cylinder's axis runs along its local X, so roll it 90° to lie flat.
		disc.CFrame = CFrame.new(pos) * CFrame.Angles(0, 0, math.rad(90))
		for _, chip in model:GetChildren() do
			if chip:IsA("BasePart") and chip.Name == "Chip" then
				chip.Position = pos + (chip:GetAttribute("Offset") :: Vector3)
			end
		end
	end

	model.Parent = world.cookiesFolder
end

-- Player helpers -----------------------------------------------------------

local lastToast: { [Player]: number } = {}

local function toast(player: Player, message: string, color: Color3?, throttleSeconds: number?)
	if throttleSeconds then
		local now = os.clock()
		if lastToast[player] and now - lastToast[player] < throttleSeconds then
			return
		end
		lastToast[player] = now
	end
	Remotes.Toast:FireClient(player, message, color or Color3.fromRGB(255, 255, 255))
end

local function applyWalkSpeed(player: Player, state: any)
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid.WalkSpeed = GameConfig.getWalkSpeed(state)
	end
end

local function sync(player: Player)
	local state = PlayerState.get(player)
	if not state then
		return
	end

	local stats = player:FindFirstChild("leaderstats")
	if stats then
		stats.Cookies.Value = state.carried
		stats.Sprinkles.Value = state.sprinkles
		stats.Area.Value = state.maxArea
		stats.Rebirths.Value = state.rebirths
	end

	Remotes.SyncState:FireClient(player, {
		maxArea = state.maxArea,
		carried = state.carried,
		capacity = GameConfig.getCapacity(state),
		fed = state.fed,
		totalFed = state.totalFed,
		sprinkles = state.sprinkles,
		upgrades = state.upgrades,
		rebirths = state.rebirths,
		runes = state.runes,
		runesOpened = state.runesOpened,
		passes = state.passes,
	})
end

local function areaAtPosition(position: Vector3): number
	local index = math.round(position.X / GameConfig.AreaSpacing) + 1
	return math.clamp(index, 1, #GameConfig.Areas)
end

local function teleportToArea(player: Player, areaIndex: number)
	local character = player.Character
	if not character then
		return
	end
	local center = GameConfig.getAreaCenter(areaIndex)
	-- Tell the watchdog before moving them, or the game's own teleport reads as a
	-- teleport exploit the instant it lands.
	AntiCheat.pardon(player, 3)
	character:PivotTo(CFrame.new(center + Vector3.new(0, 6, 70)))
end

-- Collecting ---------------------------------------------------------------

-- `allowedRange` lets the magnet reach further than a plain footstep pickup.
local function collect(player: Player, model: Model, allowedRange: number?)
	local state = PlayerState.get(player)
	if not state then
		return
	end

	local areaIndex = model:GetAttribute("AreaIndex") :: number
	if state.maxArea < areaIndex then
		toast(player, `Feed {GameConfig.Areas[areaIndex - 1].BebehName} first!`, nil, 3)
		return
	end

	local capacity = GameConfig.getCapacity(state)
	if state.carried >= capacity then
		toast(player, "Hands full! Go feed Big Bebeh 🍪", Color3.fromRGB(255, 180, 120), 3)
		return
	end

	-- Distance check so a mis-fired Touched can't grab a cookie across the map.
	local root = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
	if not root or not model.PrimaryPart then
		return
	end
	if (root.Position - model.PrimaryPart.Position).Magnitude > (allowedRange or GameConfig.CollectRange) then
		return
	end

	local value = (model:GetAttribute("Value") :: number)
		* GameConfig.getRebirthMultiplier(state)
		* GameConfig.getCookieMultiplier(state)
		* GameConfig.getPassMultiplier(state)
	local lucky = math.random() < GameConfig.getLuckChance(state)
	if lucky then
		value *= 2
	end

	local gained = math.min(math.floor(value), capacity - state.carried)
	state.carried += gained
	-- Lifetime total for the leaderboard. Counts what reached your hands, so a
	-- pickup that overflowed your capacity does not inflate the record.
	state.totalCookies += gained

	Remotes.CookiePop:FireClient(
		player,
		model.PrimaryPart.Position,
		lucky and `+{GameConfig.abbreviate(gained)} x2!` or `+{GameConfig.abbreviate(gained)}`,
		lucky and LUCKY_COLOR or COOKIE_COLOR
	)
	sync(player)

	-- Hide it, then bring it back somewhere else on the same platform.
	model.Parent = cookiePool
	-- Whoever picked it up decides how fast it comes back; the cookies are shared.
	task.delay(GameConfig.getRespawnTime(state), function()
		if model.Parent == cookiePool then
			placeCookie(model)
		end
	end)
end

local function armCookie(model: Model)
	local disc = model.PrimaryPart :: Part
	disc.Touched:Connect(function(hit)
		-- Ignore touches while the cookie is pooled or already being claimed.
		if model.Parent ~= world.cookiesFolder then
			return
		end
		local character = hit.Parent
		if not character or not character:FindFirstChildOfClass("Humanoid") then
			return
		end
		local player = Players:GetPlayerFromCharacter(character)
		if player then
			collect(player, model)
		end
	end)
end

for areaIndex = 1, #GameConfig.Areas do
	cookiesByArea[areaIndex] = {}
	for _ = 1, GameConfig.Areas[areaIndex].CookieCount do
		local cookie = createCookie(areaIndex)
		placeCookie(cookie)
		armCookie(cookie)
		table.insert(cookiesByArea[areaIndex], cookie)
	end
end

-- Magnet -------------------------------------------------------------------

task.spawn(function()
	while true do
		task.wait(GameConfig.MagnetInterval)
		for player, state in PlayerState.all() do
			local radius = GameConfig.getMagnetRadius(state)
			if radius <= 0 then
				continue
			end

			local character = player.Character
			local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
			if not root or state.carried >= GameConfig.getCapacity(state) then
				continue
			end

			local areaIndex = areaAtPosition(root.Position)
			if areaIndex > state.maxArea then
				continue
			end

			for _, cookie in cookiesByArea[areaIndex] do
				if cookie.Parent ~= world.cookiesFolder or not cookie.PrimaryPart then
					continue
				end
				if (cookie.PrimaryPart.Position - root.Position).Magnitude <= radius then
					collect(player, cookie, radius + 6)
					if state.carried >= GameConfig.getCapacity(state) then
						break
					end
				end
			end
		end
	end
end)

-- Feeding ------------------------------------------------------------------

local bebehs: { [number]: Model } = {}
for _, model in CollectionService:GetTagged("BigBebeh") do
	bebehs[model:GetAttribute("AreaIndex") :: number] = model
end

local function feed(player: Player, areaIndex: number)
	local state = PlayerState.get(player)
	if not state or state.carried <= 0 then
		return
	end

	local cfg = GameConfig.Areas[areaIndex]
	local remaining = cfg.HungerGoal - state.fed[areaIndex]
	if remaining <= 0 then
		return
	end

	local amount = math.min(state.carried, remaining)
	state.carried -= amount
	state.fed[areaIndex] += amount
	state.totalFed += amount

	local earned = math.floor(amount * GameConfig.SprinklesPerCookieFed * GameConfig.getRebirthMultiplier(state))
	state.sprinkles += earned

	local bebeh = bebehs[areaIndex]
	if bebeh then
		Remotes.FeedBurst:FireClient(player, bebeh, amount)
		if earned > 0 then
			Remotes.CookiePop:FireClient(
				player,
				bebeh:GetPivot().Position,
				`+{GameConfig.abbreviate(earned)} ✨`,
				SPRINKLE_COLOR
			)
		end
	end

	if state.fed[areaIndex] >= cfg.HungerGoal then
		if areaIndex < #GameConfig.Areas and state.maxArea == areaIndex then
			state.maxArea = areaIndex + 1
			local nextCfg = GameConfig.Areas[state.maxArea]
			toast(player, `🎉 {nextCfg.Name} unlocked!`, UNLOCK_COLOR)
		elseif areaIndex == #GameConfig.Areas then
			toast(player, "🏆 BIG BEBEH IS FULL — rebirth is ready!", UNLOCK_COLOR)
		end
	end

	sync(player)
end

task.spawn(function()
	while true do
		task.wait(GameConfig.FeedInterval)
		for player, state in PlayerState.all() do
			local character = player.Character
			local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
			if not root then
				continue
			end

			if root.Position.Y < GameConfig.VoidY then
				teleportToArea(player, math.min(state.maxArea, areaAtPosition(root.Position)))
				continue
			end

			if state.carried <= 0 then
				continue
			end

			for areaIndex = 1, state.maxArea do
				local bebeh = bebehs[areaIndex]
				if not bebeh or state.fed[areaIndex] >= GameConfig.Areas[areaIndex].HungerGoal then
					continue
				end
				-- Flat distance: his pivot sits well above the player's head.
				local offset = bebeh:GetPivot().Position - root.Position
				if Vector2.new(offset.X, offset.Z).Magnitude <= GameConfig.FeedRadius + 8 then
					feed(player, areaIndex)
					break
				end
			end
		end
	end
end)

-- Runes --------------------------------------------------------------------

local runeAltars: { BasePart } = {}
for _, crystal in CollectionService:GetTagged("RuneCrystal") do
	if crystal:IsA("BasePart") then
		table.insert(runeAltars, crystal)
	end
end

local function openRunes(player: Player, state: any)
	local bulk = GameConfig.getRuneBulk(state)
	local luck = GameConfig.getRuneLuck(state)
	local cloneChance = GameConfig.getRuneCloneChance(state)

	local drops: { { id: string, amount: number } } = {}
	for _ = 1, bulk do
		local rune = GameConfig.rollRune(luck)
		-- Rune Clone occasionally doubles a single roll.
		local amount = (math.random() < cloneChance) and 2 or 1
		state.runes[rune.Id] = (state.runes[rune.Id] or 0) + amount
		state.runesOpened += amount
		table.insert(drops, { id = rune.Id, amount = amount })
	end

	Remotes.RuneDrop:FireClient(player, drops)
	sync(player)
end

task.spawn(function()
	while true do
		task.wait(GameConfig.RuneOpenInterval)
		if #runeAltars == 0 then
			continue
		end
		for player, state in PlayerState.all() do
			local character = player.Character
			local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
			if not root then
				continue
			end
			for _, altar in runeAltars do
				local offset = altar.Position - root.Position
				if Vector2.new(offset.X, offset.Z).Magnitude <= GameConfig.RuneAltarRadius then
					openRunes(player, state)
					break
				end
			end
		end
	end
end)

-- Shop and rebirth ---------------------------------------------------------

Remotes.BuyUpgrade.OnServerEvent:Connect(function(player, upgradeId)
	if not AntiCheat.allow(player, "BuyUpgrade") then
		return
	end
	if type(upgradeId) ~= "string" then
		-- The real client only ever sends a string. Anything else was hand-built.
		AntiCheat.flag(player, "BadPayload", `BuyUpgrade sent a {typeof(upgradeId)}`)
		return
	end
	local state = PlayerState.get(player)
	local upgrade = GameConfig.getUpgrade(upgradeId)
	if not state or not upgrade then
		return
	end

	local level = GameConfig.getUpgradeLevel(state, upgradeId)
	if level >= upgrade.MaxLevel then
		toast(player, `{upgrade.Name} is already maxed out!`, DENY_COLOR, 1)
		return
	end

	local cost = GameConfig.getUpgradeCost(upgrade, level)
	if state.sprinkles < cost then
		toast(player, `Need {GameConfig.abbreviate(cost - state.sprinkles)} more sprinkles`, DENY_COLOR, 1)
		return
	end

	state.sprinkles -= cost
	state.upgrades[upgradeId] = level + 1
	applyWalkSpeed(player, state)
	toast(player, `{upgrade.Icon} {upgrade.Name} → level {level + 1}`, SPRINKLE_COLOR)
	sync(player)
end)

Remotes.Rebirth.OnServerEvent:Connect(function(player)
	if not AntiCheat.allow(player, "Rebirth") then
		return
	end
	local state = PlayerState.get(player)
	if not state then
		return
	end
	if not GameConfig.canRebirth(state) then
		toast(player, "Fill BIG BEBEH first to rebirth!", DENY_COLOR, 1)
		return
	end

	state.rebirths += 1
	state.maxArea = 1
	state.carried = 0
	for i = 1, #GameConfig.Areas do
		state.fed[i] = 0
	end
	state.sprinkles += GameConfig.RebirthSprinkleBonus
	-- Runes and upgrades survive a rebirth; only the areas reset.

	teleportToArea(player, 1)
	applyWalkSpeed(player, state)
	toast(
		player,
		`⭐ Rebirth {state.rebirths}! Everything you collect is now x{GameConfig.getRebirthMultiplier(state)}`,
		UNLOCK_COLOR
	)
	sync(player)
end)

-- Game passes --------------------------------------------------------------

--[[
	Ownership is answered by Roblox, on the server, once per session. It is never
	read from the save and never taken from the client, so neither an edited save
	nor a spoofed remote can hand somebody a paid perk.
]]
local function refreshPasses(player: Player, state: any)
	for _, pass in GameConfig.GamePasses do
		if pass.AssetId <= 0 then
			continue -- not configured yet; the button explains this to the player
		end
		local ok, owns = pcall(function()
			return MarketplaceService:UserOwnsGamePassAsync(player.UserId, pass.AssetId)
		end)
		if ok then
			state.passes[pass.Id] = owns
		else
			-- A failed check must not silently grant the perk.
			state.passes[pass.Id] = false
			warn(`[BigBebeh] Could not check {pass.Name} for {player.Name}: {owns}`)
		end
	end
end

-- Grant immediately on purchase, so nobody has to rejoin to see it work.
MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, assetId, purchased)
	if not purchased then
		return
	end
	local state = PlayerState.get(player)
	if not state then
		return
	end
	for _, pass in GameConfig.GamePasses do
		if pass.AssetId > 0 and pass.AssetId == assetId then
			state.passes[pass.Id] = true
			toast(player, `{pass.Icon} {pass.Name} active!`, UNLOCK_COLOR)
			sync(player)
		end
	end
end)

-- Players ------------------------------------------------------------------

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

	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	for _, name in { "Cookies", "Sprinkles", "Area", "Rebirths" } do
		local value = Instance.new("IntValue")
		value.Name = name
		value.Parent = stats
	end
	stats.Parent = player

	player.CharacterAdded:Connect(function()
		task.wait(0.5)
		applyWalkSpeed(player, state)
		sync(player)
	end)

	applyWalkSpeed(player, state)
	sync(player)
	toast(player, `Welcome! Collect cookies and feed {GameConfig.Areas[state.maxArea].BebehName}.`, COOKIE_COLOR)

	-- Asking Roblox who owns what is a web call. Run it after the first sync so a
	-- slow answer delays the pass button lighting up, not the entire HUD.
	task.spawn(function()
		refreshPasses(player, state)
		if PlayerState.get(player) == state then
			sync(player)
		end
	end)
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end

Players.PlayerRemoving:Connect(function(player)
	lastToast[player] = nil
	AntiCheat.forget(player)
	PlayerState.release(player)
end)

-- Movement sampling and Discord reporting. AntiCheat cannot require PlayerState
-- itself without a require cycle, so it is handed a way to read state instead.
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
end

-- The client pings this once its UI is built, so it never misses the first sync.
Remotes.SyncState.OnServerEvent:Connect(function(player)
	-- Cheap to serve but not free, and it is the easiest remote to sit in a loop.
	if not AntiCheat.allow(player, "SyncState") then
		return
	end
	sync(player)
end)

task.spawn(function()
	while true do
		task.wait(GameConfig.AutosaveInterval)
		for player in PlayerState.all() do
			PlayerState.save(player)
		end
	end
end)

game:BindToClose(function()
	for player in PlayerState.all() do
		PlayerState.save(player)
	end
end)
