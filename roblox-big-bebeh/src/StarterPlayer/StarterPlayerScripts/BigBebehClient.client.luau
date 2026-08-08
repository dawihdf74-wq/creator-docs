--[[
	Big Bebeh — Cookie Collector (client)

	Owns everything the player sees: the HUD, the spinning cookies, the gate that
	dissolves once you have unlocked the area behind it, and the little bits of
	juice (floating "+5", Bebeh bouncing when he eats, toast messages).

	Gates are opened *locally*. The server decides whether you are allowed
	through; this script just stops drawing a wall you have already earned.
]]

local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

-- WaitForChild, because the client can start before ReplicatedStorage replicates.
local sharedFolder = ReplicatedStorage:WaitForChild("BigBebehShared")
local GameConfig = require(sharedFolder:WaitForChild("GameConfig"))
local Remotes = require(sharedFolder:WaitForChild("Remotes"))

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")
local camera = workspace.CurrentCamera

local COOKIE_YELLOW = Color3.fromRGB(255, 214, 120)
local PANEL_BG = Color3.fromRGB(28, 26, 38)

local state = {
	maxArea = 1,
	carried = 0,
	capacity = GameConfig.Areas[1].CarryCapacity,
	fed = table.create(#GameConfig.Areas, 0),
	totalFed = 0,
}

-- HUD ----------------------------------------------------------------------

local function corner(parent: Instance, radius: number)
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, radius)
	c.Parent = parent
	return c
end

local function newLabel(props: { [string]: any }): TextLabel
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.GothamBold
	label.TextColor3 = Color3.fromRGB(255, 255, 255)
	label.TextScaled = true
	for k, v in props do
		(label :: any)[k] = v
	end
	return label
end

local gui = Instance.new("ScreenGui")
gui.Name = "BigBebehHUD"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
gui.Parent = playerGui

-- Area title, top centre.
local areaTitle = newLabel({
	Name = "AreaTitle",
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, 12),
	Size = UDim2.new(0, 460, 0, 46),
	Font = Enum.Font.FredokaOne,
	Text = GameConfig.Areas[1].Name,
	TextStrokeTransparency = 0.35,
})
areaTitle.Parent = gui

-- Toast stack, just under the title.
local toastHolder = Instance.new("Frame")
toastHolder.Name = "Toasts"
toastHolder.AnchorPoint = Vector2.new(0.5, 0)
toastHolder.Position = UDim2.new(0.5, 0, 0, 64)
toastHolder.Size = UDim2.new(0, 520, 0, 160)
toastHolder.BackgroundTransparency = 1
toastHolder.Parent = gui

local toastLayout = Instance.new("UIListLayout")
toastLayout.HorizontalAlignment = Enum.HorizontalAlignment.Center
toastLayout.SortOrder = Enum.SortOrder.LayoutOrder
toastLayout.Padding = UDim.new(0, 6)
toastLayout.Parent = toastHolder

-- Bottom panel: what you are carrying, and how hungry the Bebeh still is.
local panel = Instance.new("Frame")
panel.Name = "Panel"
panel.AnchorPoint = Vector2.new(0.5, 1)
panel.Position = UDim2.new(0.5, 0, 1, -18)
panel.Size = UDim2.new(0, 440, 0, 132)
panel.BackgroundColor3 = PANEL_BG
panel.BackgroundTransparency = 0.15
panel.BorderSizePixel = 0
panel.Parent = gui
corner(panel, 16)

local carryLabel = newLabel({
	Name = "Carry",
	Position = UDim2.new(0, 16, 0, 8),
	Size = UDim2.new(1, -32, 0, 34),
	Font = Enum.Font.FredokaOne,
	Text = "🍪 0 / 30",
	TextColor3 = COOKIE_YELLOW,
	TextXAlignment = Enum.TextXAlignment.Left,
})
carryLabel.Parent = panel

local carryBack = Instance.new("Frame")
carryBack.Name = "CarryBar"
carryBack.Position = UDim2.new(0, 16, 0, 44)
carryBack.Size = UDim2.new(1, -32, 0, 10)
carryBack.BackgroundColor3 = Color3.fromRGB(60, 56, 76)
carryBack.BorderSizePixel = 0
carryBack.Parent = panel
corner(carryBack, 5)

local carryFill = Instance.new("Frame")
carryFill.Name = "Fill"
carryFill.Size = UDim2.fromScale(0, 1)
carryFill.BackgroundColor3 = COOKIE_YELLOW
carryFill.BorderSizePixel = 0
carryFill.Parent = carryBack
corner(carryFill, 5)

local hungerLabel = newLabel({
	Name = "Hunger",
	Position = UDim2.new(0, 16, 0, 62),
	Size = UDim2.new(1, -32, 0, 28),
	Text = "Baby Bebeh  0 / 60",
	TextXAlignment = Enum.TextXAlignment.Left,
})
hungerLabel.Parent = panel

local hungerBack = Instance.new("Frame")
hungerBack.Name = "HungerBar"
hungerBack.Position = UDim2.new(0, 16, 0, 92)
hungerBack.Size = UDim2.new(1, -32, 0, 14)
hungerBack.BackgroundColor3 = Color3.fromRGB(60, 56, 76)
hungerBack.BorderSizePixel = 0
hungerBack.Parent = panel
corner(hungerBack, 7)

local hungerFill = Instance.new("Frame")
hungerFill.Name = "Fill"
hungerFill.Size = UDim2.fromScale(0, 1)
hungerFill.BackgroundColor3 = Color3.fromRGB(255, 150, 190)
hungerFill.BorderSizePixel = 0
hungerFill.Parent = hungerBack
corner(hungerFill, 7)

local hintLabel = newLabel({
	Name = "Hint",
	Position = UDim2.new(0, 16, 0, 108),
	Size = UDim2.new(1, -32, 0, 20),
	Font = Enum.Font.Gotham,
	Text = "Walk over cookies, then stand on the glowing pad to feed him.",
	TextColor3 = Color3.fromRGB(190, 186, 205),
	TextXAlignment = Enum.TextXAlignment.Left,
})
hintLabel.Parent = panel

-- HUD updates --------------------------------------------------------------

local function currentAreaIndex(): number
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	local x = root and root.Position.X or camera.CFrame.Position.X
	return math.clamp(math.round(x / GameConfig.AreaSpacing) + 1, 1, #GameConfig.Areas)
end

-- Which Bebeh the HUD should track: the one where you are standing if he is
-- still hungry, otherwise the earliest one that is not yet full.
local function trackedAreaIndex(): number
	local here = currentAreaIndex()
	if here <= state.maxArea and state.fed[here] < GameConfig.Areas[here].HungerGoal then
		return here
	end
	for i = 1, state.maxArea do
		if state.fed[i] < GameConfig.Areas[i].HungerGoal then
			return i
		end
	end
	return state.maxArea
end

local function refreshPanel()
	local here = currentAreaIndex()
	areaTitle.Text = `{here}. {GameConfig.Areas[here].Name}`

	carryLabel.Text = `🍪 {GameConfig.abbreviate(state.carried)} / {GameConfig.abbreviate(state.capacity)}`
	local carryRatio = state.capacity > 0 and math.clamp(state.carried / state.capacity, 0, 1) or 0
	carryFill.Size = UDim2.fromScale(carryRatio, 1)
	carryFill.BackgroundColor3 = carryRatio >= 1 and Color3.fromRGB(255, 130, 110) or COOKIE_YELLOW

	local tracked = trackedAreaIndex()
	local cfg = GameConfig.Areas[tracked]
	local fed = state.fed[tracked] or 0
	hungerLabel.Text = `{cfg.BebehName}  {GameConfig.abbreviate(fed)} / {GameConfig.abbreviate(cfg.HungerGoal)}`
	hungerFill.Size = UDim2.fromScale(math.clamp(fed / cfg.HungerGoal, 0, 1), 1)

	if carryRatio >= 1 then
		hintLabel.Text = "Hands full — go feed Big Bebeh!"
	elseif fed >= cfg.HungerGoal then
		hintLabel.Text = tracked < #GameConfig.Areas and "He's full! Head through the open gate →"
			or "You fed BIG BEBEH everything. Legend."
	else
		hintLabel.Text = "Walk over cookies, then stand on the glowing pad to feed him."
	end
end

-- Gates --------------------------------------------------------------------

local function refreshGate(gate: BasePart)
	local areaIndex = gate:GetAttribute("AreaIndex") :: number
	if not areaIndex then
		return
	end
	local unlocked = state.maxArea >= areaIndex
	local cfg = GameConfig.Areas[areaIndex]

	gate.CanCollide = not unlocked
	gate.Transparency = unlocked and 1 or 0.35

	local sign = gate:FindFirstChild("Sign") :: BillboardGui?
	local label = sign and sign:FindFirstChild("Label") :: TextLabel?
	if label and sign then
		sign.Enabled = not unlocked
		local prev = GameConfig.Areas[areaIndex - 1]
		local remaining = math.max(0, prev.HungerGoal - (state.fed[areaIndex - 1] or 0))
		label.Text = `🔒 {cfg.Name}\nFeed {prev.BebehName} {GameConfig.abbreviate(remaining)} more`
	end
end

local function refreshAllGates()
	for _, gate in CollectionService:GetTagged("AreaGate") do
		if gate:IsA("BasePart") then
			refreshGate(gate)
		end
	end
end

CollectionService:GetInstanceAddedSignal("AreaGate"):Connect(function(gate)
	if gate:IsA("BasePart") then
		refreshGate(gate)
	end
end)

-- Bebeh nameplates ---------------------------------------------------------

local function refreshBebeh(model: Model)
	local areaIndex = model:GetAttribute("AreaIndex") :: number
	if not areaIndex then
		return
	end
	local cfg = GameConfig.Areas[areaIndex]
	local billboard = model:FindFirstChild("BebehStatus", true) :: BillboardGui?
	if not billboard then
		return
	end

	local status = billboard:FindFirstChild("Status") :: TextLabel?
	local barBack = billboard:FindFirstChild("BarBack")
	local fill = barBack and barBack:FindFirstChild("BarFill") :: Frame?
	if not status or not fill then
		return
	end

	local fed = state.fed[areaIndex] or 0
	local locked = state.maxArea < areaIndex

	if locked then
		status.Text = "🔒 Locked"
		fill.Size = UDim2.fromScale(0, 1)
	elseif fed >= cfg.HungerGoal then
		status.Text = "😴 Full & happy"
		fill.Size = UDim2.fromScale(1, 1)
		fill.BackgroundColor3 = Color3.fromRGB(130, 240, 160)
	else
		status.Text = `{GameConfig.abbreviate(fed)} / {GameConfig.abbreviate(cfg.HungerGoal)} cookies`
		fill.Size = UDim2.fromScale(math.clamp(fed / cfg.HungerGoal, 0, 1), 1)
	end
end

local function refreshAllBebehs()
	for _, model in CollectionService:GetTagged("BigBebeh") do
		if model:IsA("Model") then
			refreshBebeh(model)
		end
	end
end

CollectionService:GetInstanceAddedSignal("BigBebeh"):Connect(function(model)
	if model:IsA("Model") then
		refreshBebeh(model)
	end
end)

-- Remote handlers ----------------------------------------------------------

Remotes.SyncState.OnClientEvent:Connect(function(newState)
	state = newState
	refreshPanel()
	refreshAllGates()
	refreshAllBebehs()
end)

local toastOrder = 0
Remotes.Toast.OnClientEvent:Connect(function(message: string, color: Color3)
	toastOrder += 1

	local frame = Instance.new("Frame")
	frame.Size = UDim2.new(1, 0, 0, 34)
	frame.BackgroundColor3 = PANEL_BG
	frame.BackgroundTransparency = 0.2
	frame.BorderSizePixel = 0
	frame.LayoutOrder = toastOrder
	frame.Parent = toastHolder
	corner(frame, 10)

	local label = newLabel({
		Size = UDim2.new(1, -20, 1, -8),
		Position = UDim2.new(0, 10, 0, 4),
		Text = message,
		TextColor3 = color,
	})
	label.Parent = frame

	task.delay(3.5, function()
		TweenService:Create(frame, TweenInfo.new(0.4), { BackgroundTransparency = 1 }):Play()
		TweenService:Create(label, TweenInfo.new(0.4), { TextTransparency = 1 }):Play()
		task.wait(0.45)
		frame:Destroy()
	end)
end)

Remotes.CookiePop.OnClientEvent:Connect(function(position: Vector3, text: string, color: Color3)
	local anchor = Instance.new("Attachment")
	anchor.WorldPosition = position + Vector3.new(0, 2, 0)
	anchor.Parent = workspace.Terrain

	local billboard = Instance.new("BillboardGui")
	billboard.Size = UDim2.fromScale(6, 2)
	billboard.AlwaysOnTop = true
	billboard.Adornee = anchor
	billboard.Parent = anchor

	local label = newLabel({
		Size = UDim2.fromScale(1, 1),
		Font = Enum.Font.FredokaOne,
		Text = text,
		TextColor3 = color,
		TextStrokeTransparency = 0.2,
	})
	label.Parent = billboard

	local info = TweenInfo.new(0.75, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
	TweenService:Create(anchor, info, { WorldPosition = anchor.WorldPosition + Vector3.new(0, 6, 0) }):Play()
	TweenService:Create(label, info, { TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
	task.delay(0.8, function()
		anchor:Destroy()
	end)
end)

-- Bebeh idle motion, plus the squish when he eats.
local bebehBase: { [Model]: CFrame } = {}
local bebehBounce: { [Model]: number } = {}

Remotes.FeedBurst.OnClientEvent:Connect(function(model: Model, amount: number)
	if not model then
		return
	end
	bebehBounce[model] = 1

	local anchor = Instance.new("Attachment")
	anchor.WorldPosition = model:GetPivot().Position
	anchor.Parent = workspace.Terrain

	local emitter = Instance.new("ParticleEmitter")
	emitter.Texture = "rbxasset://textures/particles/sparkles_main.dds"
	emitter.Color = ColorSequence.new(COOKIE_YELLOW)
	emitter.Size = NumberSequence.new(1.5)
	emitter.Lifetime = NumberRange.new(0.4, 0.8)
	emitter.Speed = NumberRange.new(8, 16)
	emitter.SpreadAngle = Vector2.new(180, 180)
	emitter.Rate = 0
	emitter.Parent = anchor
	emitter:Emit(math.clamp(12 + amount // 4, 12, 60))

	task.delay(1.2, function()
		anchor:Destroy()
	end)
end)

-- Per-frame world animation ------------------------------------------------

local cookiesFolder = workspace:WaitForChild("BigBebehWorld"):WaitForChild("Cookies")
local cookieBase: { [Model]: CFrame } = {}

cookiesFolder.ChildRemoved:Connect(function(child)
	cookieBase[child :: any] = nil
end)

RunService.RenderStepped:Connect(function()
	local now = os.clock()
	local eye = camera.CFrame.Position

	for _, cookie in cookiesFolder:GetChildren() do
		if not cookie:IsA("Model") or not cookie.PrimaryPart then
			continue
		end
		local base = cookieBase[cookie]
		if not base then
			base = cookie:GetPivot()
			cookieBase[cookie] = base
		end
		-- Skip anything the player cannot see anyway.
		if (base.Position - eye).Magnitude > 180 then
			continue
		end
		local bob = math.sin(now * 2.5 + base.Position.X * 0.35) * 0.35
		cookie:PivotTo(base * CFrame.new(0, bob, 0) * CFrame.Angles(0, now * 1.8, 0))
	end

	for _, model in CollectionService:GetTagged("BigBebeh") do
		if not model:IsA("Model") then
			continue
		end
		local base = bebehBase[model]
		if not base then
			base = model:GetPivot()
			bebehBase[model] = base
		end
		if (base.Position - eye).Magnitude > 260 then
			continue
		end

		local bounce = bebehBounce[model] or 0
		if bounce > 0 then
			bounce = math.max(0, bounce - 2.5 / 60)
			bebehBounce[model] = bounce
		end

		local breathe = math.sin(now * 1.4) * 0.6
		local hop = math.abs(math.sin(now * 14)) * bounce * 2.5
		local sway = math.sin(now * 0.8) * 0.03
		model:PivotTo(base * CFrame.new(0, breathe + hop, 0) * CFrame.Angles(0, sway, 0))
	end
end)

player.CharacterAdded:Connect(function()
	task.wait(0.5)
	refreshPanel()
end)

-- Tell the server we are ready, so we get the first state even if we loaded late.
Remotes.SyncState:FireServer()

task.spawn(function()
	while true do
		task.wait(0.25)
		refreshPanel()
	end
end)
