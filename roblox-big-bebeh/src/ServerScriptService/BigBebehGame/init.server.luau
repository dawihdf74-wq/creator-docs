--[[
	Big Bebeh — Cookie Collector (server)

	The loop:
	  1. Cookies lie around each area. Walk over one to pick it up.
	  2. Your hands only hold so many; when they are full, go feed Big Bebeh.
	  3. Stand on his pad and he eats everything you are carrying.
	  4. Fill his hunger bar and the gate to the next area opens for you.

	All tuning lives in ReplicatedStorage/BigBebehShared/GameConfig.
]]

local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local GameConfig = require(ReplicatedStorage.BigBebehShared.GameConfig)
local Remotes = require(ReplicatedStorage.BigBebehShared.Remotes)
local PlayerState = require(script.PlayerState)
local WorldBuilder = require(script.WorldBuilder)

local COOKIE_COLOR = Color3.fromRGB(255, 226, 140)
local UNLOCK_COLOR = Color3.fromRGB(140, 255, 170)

local world = WorldBuilder.build()

local cookiePool = Instance.new("Folder")
cookiePool.Name = "CookiePool"
cookiePool.Parent = ServerStorage

-- Cookie spawning ----------------------------------------------------------

-- Somewhere on the platform that is not on top of the Bebeh or his feed pad.
local function randomCookiePosition(areaIndex: number): Vector3
	local center = GameConfig.getAreaCenter(areaIndex)
	local halfX = GameConfig.PlatformSize.X / 2 - 22
	local halfZ = GameConfig.PlatformSize.Z / 2 - 22

	for _ = 1, 12 do
		local pos = center + Vector3.new(math.random(-halfX, halfX), 2.4, math.random(-halfZ, halfZ))
		-- The Bebeh stands at z = -70 relative to the area centre.
		if (pos - (center + Vector3.new(0, 0, -70))).Magnitude > GameConfig.FeedRadius + 22 then
			return pos
		end
	end
	return center + Vector3.new(math.random(-halfX, halfX), 2.4, math.random(20, halfZ))
end

local function createCookie(areaIndex: number): Model
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
	local disc = model.PrimaryPart :: Part
	-- The cylinder's axis runs along its local X, so roll it 90° to lie flat.
	disc.CFrame = CFrame.new(pos) * CFrame.Angles(0, 0, math.rad(90))
	for _, chip in model:GetChildren() do
		if chip:IsA("BasePart") and chip.Name == "Chip" then
			chip.Position = pos + (chip:GetAttribute("Offset") :: Vector3)
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

local function sync(player: Player)
	local state = PlayerState.get(player)
	if not state then
		return
	end

	local stats = player:FindFirstChild("leaderstats")
	if stats then
		stats.Cookies.Value = state.carried
		stats.Fed.Value = state.totalFed
		stats.Area.Value = state.maxArea
	end

	Remotes.SyncState:FireClient(player, {
		maxArea = state.maxArea,
		carried = state.carried,
		capacity = GameConfig.getCapacity(state.maxArea),
		fed = state.fed,
		totalFed = state.totalFed,
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
	character:PivotTo(CFrame.new(center + Vector3.new(0, 6, 70)))
end

-- Collecting ---------------------------------------------------------------

local function collect(player: Player, model: Model)
	local state = PlayerState.get(player)
	if not state then
		return
	end

	local areaIndex = model:GetAttribute("AreaIndex") :: number
	if state.maxArea < areaIndex then
		toast(player, `Feed {GameConfig.Areas[areaIndex - 1].BebehName} first!`, nil, 3)
		return
	end

	local capacity = GameConfig.getCapacity(state.maxArea)
	if state.carried >= capacity then
		toast(player, "Hands full! Go feed Big Bebeh 🍪", Color3.fromRGB(255, 180, 120), 3)
		return
	end

	-- Distance check so a mis-fired Touched can't grab a cookie across the map.
	local root = player.Character and player.Character:FindFirstChild("HumanoidRootPart")
	if not root or not model.PrimaryPart then
		return
	end
	if (root.Position - model.PrimaryPart.Position).Magnitude > GameConfig.CollectRange then
		return
	end

	local value = model:GetAttribute("Value") :: number
	local gained = math.min(value, capacity - state.carried)
	state.carried += gained

	Remotes.CookiePop:FireClient(player, model.PrimaryPart.Position, `+{GameConfig.abbreviate(gained)}`, COOKIE_COLOR)
	sync(player)

	-- Hide it, then bring it back somewhere else on the same platform.
	model.Parent = cookiePool
	task.delay(GameConfig.CookieRespawnTime, function()
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
	for _ = 1, GameConfig.Areas[areaIndex].CookieCount do
		local cookie = createCookie(areaIndex)
		placeCookie(cookie)
		armCookie(cookie)
	end
end

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

	local bebeh = bebehs[areaIndex]
	if bebeh then
		Remotes.FeedBurst:FireClient(player, bebeh, amount)
	end

	if state.fed[areaIndex] >= cfg.HungerGoal then
		if areaIndex < #GameConfig.Areas and state.maxArea == areaIndex then
			state.maxArea = areaIndex + 1
			local nextCfg = GameConfig.Areas[state.maxArea]
			toast(player, `🎉 {nextCfg.Name} unlocked! Carry up to {GameConfig.abbreviate(nextCfg.CarryCapacity)}`, UNLOCK_COLOR)
		elseif areaIndex == #GameConfig.Areas then
			toast(player, "🏆 BIG BEBEH IS FULL. You win! 🏆", UNLOCK_COLOR)
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

-- Players ------------------------------------------------------------------

local function onPlayerAdded(player: Player)
	local state = PlayerState.load(player)

	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	for _, name in { "Cookies", "Fed", "Area" } do
		local value = Instance.new("IntValue")
		value.Name = name
		value.Parent = stats
	end
	stats.Parent = player

	player.CharacterAdded:Connect(function()
		task.wait(0.5)
		sync(player)
	end)

	sync(player)
	toast(player, `Welcome! Collect cookies and feed {GameConfig.Areas[state.maxArea].BebehName}.`, COOKIE_COLOR)
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in Players:GetPlayers() do
	task.spawn(onPlayerAdded, player)
end

Players.PlayerRemoving:Connect(function(player)
	lastToast[player] = nil
	PlayerState.release(player)
end)

-- The client pings this once its UI is built, so it never misses the first sync.
Remotes.SyncState.OnServerEvent:Connect(function(player)
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
