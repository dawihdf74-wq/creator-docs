--[[
	Big Bebeh — Cookie Collector (client)

	Owns everything the player sees: the HUD, the upgrade shop, the spinning
	cookies, the gate that dissolves once you have unlocked the area behind it,
	and the juice (floating "+5", Bebeh bouncing when he eats, toasts).

	Gates are opened *locally*. The server decides whether you are allowed
	through; this script just stops drawing a wall you have already earned.
]]

local CollectionService = game:GetService("CollectionService")
local GuiService = game:GetService("GuiService")
local Players = game:GetService("Players")
local ProximityPromptService = game:GetService("ProximityPromptService")
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

-- Palette. Simulator UI leans on a few saturated accents against a near-black
-- panel, with every surface outlined -- flat fills with no outline are what
-- make a menu look unfinished.
local COOKIE_YELLOW = Color3.fromRGB(255, 206, 92)
local SPRINKLE_PINK = Color3.fromRGB(255, 132, 214)
local RUNE_PURPLE = Color3.fromRGB(176, 132, 255)
local PANEL_BG = Color3.fromRGB(19, 17, 28)
local ROW_BG = Color3.fromRGB(36, 32, 52)
local OUTLINE = Color3.fromRGB(8, 7, 14)
local TEXT_DIM = Color3.fromRGB(150, 145, 172)
local AFFORD_GREEN = Color3.fromRGB(72, 200, 116)
local DENY_GREY = Color3.fromRGB(70, 66, 86)

local state = {
	maxArea = 1,
	carried = 0,
	capacity = GameConfig.Areas[1].CarryCapacity,
	fed = table.create(#GameConfig.Areas, 0),
	totalFed = 0,
	sprinkles = 0,
	upgrades = {},
	rebirths = 0,
	runes = {},
	runesOpened = 0,
}

-- UI helpers ---------------------------------------------------------------

local function corner(parent: Instance, radius: number)
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, radius)
	c.Parent = parent
	return c
end

-- A crisp dark outline. Roblox UI reads as flat without one.
local function stroke(inst: Instance, thickness: number, color: Color3?, transparency: number?)
	local s = Instance.new("UIStroke")
	s.Thickness = thickness
	s.Color = color or OUTLINE
	s.Transparency = transparency or 0
	s.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	s.Parent = inst
	return s
end

-- Vertical sheen. Subtle, but it is most of the difference between a flat
-- rectangle and something that looks lit.
local function gradient(inst: Instance, top: number, bottom: number, rotation: number?)
	local g = Instance.new("UIGradient")
	g.Color = ColorSequence.new({
		ColorSequenceKeypoint.new(0, Color3.new(top, top, top)),
		ColorSequenceKeypoint.new(1, Color3.new(bottom, bottom, bottom)),
	})
	g.Rotation = rotation or 90
	g.Parent = inst
	return g
end

-- The standard container: dark, outlined, softly lit, with a drop shadow made
-- from an offset sibling rather than an image asset.
local function newPanel(parent: Instance, props: { [string]: any }): Frame
	local shadow = Instance.new("Frame")
	shadow.Name = "Shadow"
	shadow.BackgroundColor3 = Color3.new(0, 0, 0)
	shadow.BackgroundTransparency = 0.55
	shadow.BorderSizePixel = 0
	shadow.ZIndex = 0
	shadow.Parent = parent

	local frame = Instance.new("Frame")
	frame.BackgroundColor3 = PANEL_BG
	frame.BorderSizePixel = 0
	frame.ZIndex = 1
	for k, v in props do
		(frame :: any)[k] = v
	end
	frame.Parent = parent
	corner(frame, 14)
	stroke(frame, 3)
	gradient(frame, 1.12, 0.88)

	-- Keep the shadow glued under the panel.
	shadow.AnchorPoint = frame.AnchorPoint
	shadow.Size = frame.Size
	shadow.Position = frame.Position + UDim2.fromOffset(0, 5)
	corner(shadow, 14)

	-- A hidden panel used to leave its shadow behind as a black rectangle
	-- floating in the middle of the screen, so bind the two together.
	shadow.Visible = frame.Visible
	frame:GetPropertyChangedSignal("Visible"):Connect(function()
		shadow.Visible = frame.Visible
	end)

	return frame
end

-- Chunky pill button with a lighter top face, like the buy buttons in the genre.
local function newBigButton(parent: Instance, props: { [string]: any }): TextButton
	local button = Instance.new("TextButton")
	button.Font = Enum.Font.FredokaOne
	button.TextColor3 = Color3.fromRGB(255, 255, 255)
	button.TextScaled = true
	button.AutoButtonColor = true
	button.BorderSizePixel = 0
	button.BackgroundColor3 = AFFORD_GREEN
	for k, v in props do
		(button :: any)[k] = v
	end
	button.Parent = parent
	corner(button, 11)
	stroke(button, 3)
	gradient(button, 1.18, 0.82)

	local label = Instance.new("UITextSizeConstraint")
	label.MaxTextSize = 26
	label.Parent = button
	return button
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
-- Roblox draws its own chrome (logo, menu, chat) across the top-left. With
-- IgnoreGuiInset on, our HUD was rendering underneath those buttons. Respect
-- the inset, and additionally keep a clear strip on the left for the floating
-- button cluster, whose height GetGuiInset does not always report.
gui.IgnoreGuiInset = false
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
gui.Parent = playerGui

local TOPBAR_CLEARANCE = 8
local function topSafeY(extra: number): number
	local inset = GuiService:GetGuiInset()
	return inset.Y + TOPBAR_CLEARANCE + extra
end

-- HUD ----------------------------------------------------------------------

local areaTitle = newLabel({
	Name = "AreaTitle",
	AnchorPoint = Vector2.new(0.5, 0),
	Position = UDim2.new(0.5, 0, 0, topSafeY(0)),
	Size = UDim2.new(0, 460, 0, 46),
	Font = Enum.Font.FredokaOne,
	Text = GameConfig.Areas[1].Name,
	TextStrokeTransparency = 0.35,
})
areaTitle.Parent = gui

-- Sprinkle purse, top left.
local purse = newPanel(gui, {
	Name = "Purse",
	Position = UDim2.new(0, 14, 0, topSafeY(4)),
	Size = UDim2.new(0, 204, 0, 46),
})

local sprinkleLabel = newLabel({
	Name = "Sprinkles",
	Position = UDim2.new(0, 12, 0, 6),
	Size = UDim2.new(1, -24, 1, -12),
	Font = Enum.Font.FredokaOne,
	Text = "✨ 0",
	TextColor3 = SPRINKLE_PINK,
	TextStrokeTransparency = 0.35,
	TextXAlignment = Enum.TextXAlignment.Left,
})
sprinkleLabel.Parent = purse

local rebirthBadge = newLabel({
	Name = "RebirthBadge",
	Position = UDim2.new(0, 14, 0, topSafeY(52)),
	Size = UDim2.new(0, 190, 0, 26),
	Font = Enum.Font.GothamBold,
	Text = "",
	TextColor3 = Color3.fromRGB(255, 226, 130),
	TextStrokeTransparency = 0.4,
	TextXAlignment = Enum.TextXAlignment.Left,
})
rebirthBadge.Parent = gui

-- Toast stack, just under the title.
local toastHolder = Instance.new("Frame")
toastHolder.Name = "Toasts"
toastHolder.AnchorPoint = Vector2.new(0.5, 0)
toastHolder.Position = UDim2.new(0.5, 0, 0, topSafeY(52))
toastHolder.Size = UDim2.new(0, 520, 0, 160)
toastHolder.BackgroundTransparency = 1
toastHolder.Parent = gui

local toastLayout = Instance.new("UIListLayout")
toastLayout.HorizontalAlignment = Enum.HorizontalAlignment.Center
toastLayout.SortOrder = Enum.SortOrder.LayoutOrder
toastLayout.Padding = UDim.new(0, 6)
toastLayout.Parent = toastHolder

-- Bottom panel: what you are carrying, and how hungry the Bebeh still is.
local panel = newPanel(gui, {
	Name = "Panel",
	AnchorPoint = Vector2.new(0.5, 1),
	Position = UDim2.new(0.5, 0, 1, -18),
	Size = UDim2.new(0, 452, 0, 138),
})

local carryLabel = newLabel({
	Name = "Carry",
	Position = UDim2.new(0, 16, 0, 8),
	Size = UDim2.new(1, -32, 0, 34),
	Font = Enum.Font.FredokaOne,
	Text = "🍪 0 / 30",
	TextColor3 = COOKIE_YELLOW,
	TextStrokeTransparency = 0.35,
	TextXAlignment = Enum.TextXAlignment.Left,
})
carryLabel.Parent = panel

local carryBack = Instance.new("Frame")
carryBack.Name = "CarryBar"
carryBack.Position = UDim2.new(0, 16, 0, 44)
carryBack.Size = UDim2.new(1, -32, 0, 10)
carryBack.BackgroundColor3 = Color3.fromRGB(12, 11, 18)
carryBack.BorderSizePixel = 0
carryBack.Parent = panel
stroke(carryBack, 2, Color3.fromRGB(52, 48, 70))
corner(carryBack, 5)

local carryFill = Instance.new("Frame")
carryFill.Name = "Fill"
carryFill.Size = UDim2.fromScale(0, 1)
carryFill.BackgroundColor3 = COOKIE_YELLOW
carryFill.BorderSizePixel = 0
carryFill.Parent = carryBack
corner(carryFill, 5)
gradient(carryFill, 1.25, 0.85)

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
hungerBack.BackgroundColor3 = Color3.fromRGB(12, 11, 18)
hungerBack.BorderSizePixel = 0
hungerBack.Parent = panel
stroke(hungerBack, 2, Color3.fromRGB(52, 48, 70))
corner(hungerBack, 7)

local hungerFill = Instance.new("Frame")
hungerFill.Name = "Fill"
hungerFill.Size = UDim2.fromScale(0, 1)
hungerFill.BackgroundColor3 = Color3.fromRGB(255, 150, 190)
hungerFill.BorderSizePixel = 0
hungerFill.Parent = hungerBack
corner(hungerFill, 7)
gradient(hungerFill, 1.25, 0.85)

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

-- Shop ---------------------------------------------------------------------

local shopButton = newBigButton(gui, {
	Name = "ShopButton",
	AnchorPoint = Vector2.new(1, 1),
	Position = UDim2.new(1, -14, 1, -18),
	Size = UDim2.new(0, 146, 0, 56),
	BackgroundColor3 = Color3.fromRGB(236, 92, 138),
	Text = "🛒 SHOP",
})

local shop = newPanel(gui, {
	Name = "Shop",
	AnchorPoint = Vector2.new(0.5, 0.5),
	Position = UDim2.new(0.5, 0, 0.5, 0),
	Size = UDim2.new(0, 500, 0, 536),
	Visible = false,
})

local shopTitle = newLabel({
	Position = UDim2.new(0, 20, 0, 14),
	Size = UDim2.new(1, -110, 0, 34),
	Font = Enum.Font.FredokaOne,
	Text = "🛒 Upgrade Shop",
	TextXAlignment = Enum.TextXAlignment.Left,
})
shopTitle.Parent = shop

local shopPurse = newLabel({
	Position = UDim2.new(0, 20, 0, 50),
	Size = UDim2.new(1, -110, 0, 26),
	Text = "✨ 0 sprinkles",
	TextColor3 = SPRINKLE_PINK,
	TextXAlignment = Enum.TextXAlignment.Left,
})
shopPurse.Parent = shop

local closeButton = newBigButton(shop, {
	AnchorPoint = Vector2.new(1, 0),
	Position = UDim2.new(1, -14, 0, 14),
	Size = UDim2.new(0, 44, 0, 44),
	BackgroundColor3 = Color3.fromRGB(196, 66, 84),
	Text = "✕",
})

local list = Instance.new("ScrollingFrame")
list.Position = UDim2.new(0, 14, 0, 88)
list.Size = UDim2.new(1, -28, 1, -180)
list.BackgroundTransparency = 1
list.BorderSizePixel = 0
list.ScrollBarThickness = 5
list.AutomaticCanvasSize = Enum.AutomaticSize.Y
list.CanvasSize = UDim2.new()
list.Parent = shop

local listLayout = Instance.new("UIListLayout")
listLayout.SortOrder = Enum.SortOrder.LayoutOrder
listLayout.Padding = UDim.new(0, 8)
listLayout.Parent = list

-- One row per upgrade, built once and refreshed whenever state changes.
local rows: { [string]: { buy: TextButton, name: TextLabel, effect: TextLabel } } = {}

for index, upgrade in GameConfig.Upgrades do
	local row = Instance.new("Frame")
	row.Name = upgrade.Id
	row.Size = UDim2.new(1, -6, 0, 82)
	row.BackgroundColor3 = ROW_BG
	row.BorderSizePixel = 0
	row.LayoutOrder = index
	row.Parent = list
	corner(row, 12)
	stroke(row, 2)
	gradient(row, 1.1, 0.92)

	local nameLabel = newLabel({
		Position = UDim2.new(0, 14, 0, 8),
		Size = UDim2.new(1, -150, 0, 26),
		Font = Enum.Font.FredokaOne,
		Text = `{upgrade.Icon} {upgrade.Name}`,
		TextXAlignment = Enum.TextXAlignment.Left,
	})
	nameLabel.Parent = row

	local blurb = newLabel({
		Position = UDim2.new(0, 14, 0, 34),
		Size = UDim2.new(1, -150, 0, 20),
		Font = Enum.Font.Gotham,
		Text = upgrade.Blurb,
		TextColor3 = Color3.fromRGB(180, 176, 196),
		TextXAlignment = Enum.TextXAlignment.Left,
	})
	blurb.Parent = row

	local effect = newLabel({
		Position = UDim2.new(0, 14, 0, 54),
		Size = UDim2.new(1, -150, 0, 20),
		Font = Enum.Font.GothamBold,
		Text = "",
		TextColor3 = COOKIE_YELLOW,
		TextXAlignment = Enum.TextXAlignment.Left,
	})
	effect.Parent = row

	local buy = newBigButton(row, {
		AnchorPoint = Vector2.new(1, 0.5),
		Position = UDim2.new(1, -12, 0.5, 0),
		Size = UDim2.new(0, 122, 0, 58),
		BackgroundColor3 = AFFORD_GREEN,
		Text = "✨ 40",
	})

	buy.Activated:Connect(function()
		Remotes.BuyUpgrade:FireServer(upgrade.Id)
	end)

	rows[upgrade.Id] = { buy = buy, name = nameLabel, effect = effect }
end

local rebirthButton = newBigButton(shop, {
	AnchorPoint = Vector2.new(0.5, 1),
	Position = UDim2.new(0.5, 0, 1, -16),
	Size = UDim2.new(1, -32, 0, 66),
	BackgroundColor3 = DENY_GREY,
	Text = "⭐ REBIRTH",
})

rebirthButton.Activated:Connect(function()
	Remotes.Rebirth:FireServer()
end)

local function setShopOpen(open: boolean)
	shop.Visible = open
end

shopButton.Activated:Connect(function()
	setShopOpen(not shop.Visible)
end)
closeButton.Activated:Connect(function()
	setShopOpen(false)
end)

ProximityPromptService.PromptTriggered:Connect(function(prompt)
	if CollectionService:HasTag(prompt, "ShopPrompt") then
		setShopOpen(true)
	end
end)

local function refreshShop()
	shopPurse.Text = `✨ {GameConfig.abbreviate(state.sprinkles)} sprinkles`

	for _, upgrade in GameConfig.Upgrades do
		local row = rows[upgrade.Id]
		local level = GameConfig.getUpgradeLevel(state, upgrade.Id)

		row.name.Text = `{upgrade.Icon} {upgrade.Name}  ({level}/{upgrade.MaxLevel})`
		row.effect.Text = GameConfig.describeUpgrade(state, upgrade)

		if level >= upgrade.MaxLevel then
			row.buy.Text = "MAX"
			row.buy.BackgroundColor3 = DENY_GREY
		else
			local cost = GameConfig.getUpgradeCost(upgrade, level)
			row.buy.Text = `✨ {GameConfig.abbreviate(cost)}`
			row.buy.BackgroundColor3 = state.sprinkles >= cost and AFFORD_GREEN or DENY_GREY
		end
	end

	if GameConfig.canRebirth(state) then
		local nextMultiplier = 1 + GameConfig.RebirthMultiplierPerLevel * (state.rebirths + 1)
		rebirthButton.Text = `⭐ REBIRTH → x{nextMultiplier} forever`
		rebirthButton.BackgroundColor3 = Color3.fromRGB(226, 160, 60)
	else
		rebirthButton.Text = "⭐ Fill BIG BEBEH to rebirth"
		rebirthButton.BackgroundColor3 = DENY_GREY
	end
end

-- Runes --------------------------------------------------------------------

--[[
	Two panels, laid out like the rune menus these games use: the ladder on the
	left (every tier, its odds, how many you hold), a running summary on the
	right. A strip of family tabs sits above them -- there is one family today,
	but the menu is built to switch between them.
]]

local selectedRuneType = GameConfig.RuneTypes[1].Id
local openingSince: number? = nil -- set when the first rune of the session lands

local runeMenu = Instance.new("Frame")
runeMenu.Name = "RuneMenu"
runeMenu.AnchorPoint = Vector2.new(0.5, 0.5)
runeMenu.Position = UDim2.new(0.5, 0, 0.5, 0)
runeMenu.Size = UDim2.new(0, 780, 0, 546)
runeMenu.BackgroundTransparency = 1
runeMenu.Visible = false
runeMenu.Parent = gui

-- Family tabs.
local tabStrip = Instance.new("Frame")
tabStrip.Size = UDim2.new(1, -64, 0, 46)
tabStrip.Position = UDim2.new(0, 0, 0, 0)
tabStrip.BackgroundTransparency = 1
tabStrip.Parent = runeMenu

local tabLayout = Instance.new("UIListLayout")
tabLayout.FillDirection = Enum.FillDirection.Horizontal
tabLayout.Padding = UDim.new(0, 8)
tabLayout.SortOrder = Enum.SortOrder.LayoutOrder
tabLayout.Parent = tabStrip

local runeClose = newBigButton(runeMenu, {
	AnchorPoint = Vector2.new(1, 0),
	Position = UDim2.new(1, 0, 0, 0),
	Size = UDim2.new(0, 46, 0, 46),
	BackgroundColor3 = Color3.fromRGB(196, 66, 84),
	Text = "✕",
})

-- Left: the ladder.
local ladderPanel = newPanel(runeMenu, {
	Position = UDim2.new(0, 0, 0, 58),
	Size = UDim2.new(0, 452, 1, -58),
})

local ladderTitle = newLabel({
	Position = UDim2.new(0, 16, 0, 14),
	Size = UDim2.new(1, -32, 0, 38),
	Font = Enum.Font.FredokaOne,
	Text = "Cookie Rune",
	TextColor3 = COOKIE_YELLOW,
	TextStrokeTransparency = 0.4,
})
ladderTitle.Parent = ladderPanel

local ladderSubtitle = newLabel({
	Position = UDim2.new(0, 16, 0, 52),
	Size = UDim2.new(1, -32, 0, 24),
	Font = Enum.Font.GothamBold,
	Text = "0 Opened",
	TextColor3 = TEXT_DIM,
})
ladderSubtitle.Parent = ladderPanel

local ladderList = Instance.new("ScrollingFrame")
ladderList.Position = UDim2.new(0, 12, 0, 84)
ladderList.Size = UDim2.new(1, -24, 1, -96)
ladderList.BackgroundTransparency = 1
ladderList.BorderSizePixel = 0
ladderList.ScrollBarThickness = 4
ladderList.ScrollBarImageColor3 = RUNE_PURPLE
ladderList.AutomaticCanvasSize = Enum.AutomaticSize.Y
ladderList.CanvasSize = UDim2.new()
ladderList.Parent = ladderPanel

local ladderLayout = Instance.new("UIListLayout")
ladderLayout.SortOrder = Enum.SortOrder.LayoutOrder
ladderLayout.Padding = UDim.new(0, 6)
ladderLayout.Parent = ladderList

-- Right: the summary.
local statsPanel = newPanel(runeMenu, {
	Position = UDim2.new(0, 466, 0, 58),
	Size = UDim2.new(1, -466, 1, -58),
})

local statsTitle = newLabel({
	Position = UDim2.new(0, 14, 0, 14),
	Size = UDim2.new(1, -28, 0, 34),
	Font = Enum.Font.FredokaOne,
	Text = "Cookie Rune",
	TextColor3 = COOKIE_YELLOW,
	TextStrokeTransparency = 0.4,
})
statsTitle.Parent = statsPanel

local statsSince = newLabel({
	Position = UDim2.new(0, 14, 0, 52),
	Size = UDim2.new(1, -28, 0, 22),
	Font = Enum.Font.Gotham,
	Text = "Not opening",
	TextColor3 = TEXT_DIM,
})
statsSince.Parent = statsPanel

local statsOpened = newLabel({
	Position = UDim2.new(0, 14, 0, 76),
	Size = UDim2.new(1, -28, 0, 26),
	Font = Enum.Font.GothamBold,
	Text = "Opened 0",
	TextColor3 = COOKIE_YELLOW,
})
statsOpened.Parent = statsPanel

local statsLuck = newLabel({
	Position = UDim2.new(0, 14, 0, 106),
	Size = UDim2.new(1, -28, 0, 26),
	Font = Enum.Font.FredokaOne,
	Text = "x1 Rune Luck",
	TextColor3 = RUNE_PURPLE,
})
statsLuck.Parent = statsPanel

local statsNote = newLabel({
	Position = UDim2.new(0, 14, 0, 136),
	Size = UDim2.new(1, -28, 0, 46),
	Font = Enum.Font.Gotham,
	Text = "",
	TextColor3 = Color3.fromRGB(112, 108, 132),
	TextScaled = false,
	TextSize = 13,
	TextWrapped = true,
})
statsNote.Parent = statsPanel

local earnedHeader = newLabel({
	Position = UDim2.new(0, 14, 0, 188),
	Size = UDim2.new(1, -28, 0, 26),
	Font = Enum.Font.FredokaOne,
	Text = "Earned Runes:",
	TextColor3 = Color3.fromRGB(236, 232, 250),
	TextXAlignment = Enum.TextXAlignment.Left,
})
earnedHeader.Parent = statsPanel

local earnedList = Instance.new("Frame")
earnedList.Position = UDim2.new(0, 14, 0, 218)
earnedList.Size = UDim2.new(1, -28, 1, -280)
earnedList.BackgroundTransparency = 1
earnedList.Parent = statsPanel

local earnedLayout = Instance.new("UIListLayout")
earnedLayout.SortOrder = Enum.SortOrder.LayoutOrder
earnedLayout.Padding = UDim.new(0, 4)
earnedLayout.Parent = earnedList

local boostSummary = newLabel({
	AnchorPoint = Vector2.new(0.5, 1),
	Position = UDim2.new(0.5, 0, 1, -12),
	Size = UDim2.new(1, -28, 0, 48),
	Font = Enum.Font.FredokaOne,
	Text = "",
	TextColor3 = COOKIE_YELLOW,
	TextScaled = false,
	TextSize = 19,
	TextWrapped = true,
})
boostSummary.Parent = statsPanel

-- Rows, rebuilt whenever the selected family changes.
local ladderRows: { [string]: TextLabel } = {}
local earnedRows: { [string]: TextLabel } = {}

local function buildRuneRows()
	for _, child in ladderList:GetChildren() do
		if not child:IsA("UIListLayout") then
			child:Destroy()
		end
	end
	for _, child in earnedList:GetChildren() do
		if not child:IsA("UIListLayout") then
			child:Destroy()
		end
	end
	table.clear(ladderRows)
	table.clear(earnedRows)

	for index, rune in GameConfig.getRunesOfType(selectedRuneType) do
		local row = Instance.new("Frame")
		row.Size = UDim2.new(1, -4, 0, 42)
		row.BackgroundColor3 = ROW_BG
		row.BorderSizePixel = 0
		row.LayoutOrder = index
		row.Parent = ladderList
		corner(row, 9)
		stroke(row, 2)

		local pip = Instance.new("Frame")
		pip.Size = UDim2.new(0, 5, 1, -14)
		pip.Position = UDim2.new(0, 8, 0, 7)
		pip.BackgroundColor3 = rune.Color
		pip.BorderSizePixel = 0
		pip.Parent = row
		corner(pip, 3)

		local label = newLabel({
			Position = UDim2.new(0, 20, 0, 0),
			Size = UDim2.new(1, -32, 1, 0),
			Font = Enum.Font.GothamBold,
			Text = "",
			TextColor3 = rune.Color,
			TextScaled = false,
			TextSize = 18,
			TextStrokeTransparency = 0.6,
			TextXAlignment = Enum.TextXAlignment.Left,
		})
		label.Parent = row
		ladderRows[rune.Id] = label

		local earned = newLabel({
			Size = UDim2.new(1, 0, 0, 22),
			Font = Enum.Font.GothamBold,
			Text = "",
			TextColor3 = rune.Color,
			TextScaled = false,
			TextSize = 16,
			TextXAlignment = Enum.TextXAlignment.Left,
			LayoutOrder = index,
		})
		earned.Parent = earnedList
		earnedRows[rune.Id] = earned
	end
end

local function elapsedText(): string
	if not openingSince then
		return "Not opening — stand on the altar"
	end
	local secs = math.max(0, math.floor(os.clock() - openingSince))
	local h = secs // 3600
	local m = (secs % 3600) // 60
	local s = secs % 60
	if h > 0 then
		return `Opening since {h}h {m}m {s}s`
	elseif m > 0 then
		return `Opening since {m}m {s}s`
	end
	return `Opening since {s}s`
end

local function refreshRunes()
	local runeType = GameConfig.getRuneType(selectedRuneType)
	if not runeType then
		return
	end

	ladderTitle.Text = runeType.Name
	ladderTitle.TextColor3 = runeType.Color
	statsTitle.Text = runeType.Name
	statsTitle.TextColor3 = runeType.Color
	statsNote.Text = runeType.Blurb
	ladderSubtitle.Text = `{GameConfig.abbreviate(state.runesOpened or 0)} Opened`

	statsSince.Text = elapsedText()
	statsOpened.Text = `Opened {GameConfig.abbreviate(state.runesOpened or 0)}`
	statsOpened.TextColor3 = runeType.Color
	statsLuck.Text = `x{string.format("%.2g", GameConfig.getRuneLuck(state))} Rune Luck`

	for _, rune in GameConfig.getRunesOfType(selectedRuneType) do
		local count = GameConfig.getRuneCount(state, rune.Id)
		local boost = GameConfig.getRuneBoost(rune, count)
		local effect = GameConfig.RuneEffectNames[rune.Effect] or rune.Effect

		local row = ladderRows[rune.Id]
		if row then
			row.Text = `{rune.Name} [1/{rune.Odds}] (x{GameConfig.abbreviate(count)})`
			row.TextTransparency = count > 0 and 0 or 0.45
		end

		local earned = earnedRows[rune.Id]
		if earned then
			if count > 0 then
				local maxed = count >= rune.MaxStack and "  MAX" or ""
				earned.Text = `{rune.Name}: {GameConfig.abbreviate(count)}   +x{string.format("%.2f", boost)} {effect}{maxed}`
				earned.TextTransparency = 0
			else
				earned.Text = `{rune.Name}: —`
				earned.TextTransparency = 0.55
			end
		end
	end

	boostSummary.Text = `🍪 x{string.format("%.2f", GameConfig.getCookieMultiplier(state))} cookies`
		.. `   ·   ⛏ {GameConfig.getRuneBulk(state)}x bulk`
		.. `   ·   ❖ {math.floor(GameConfig.getRuneCloneChance(state) * 100)}% clone`
end

-- Family tabs, one per rune family.
for index, runeType in GameConfig.RuneTypes do
	local tab = newBigButton(tabStrip, {
		Size = UDim2.new(0, 190, 1, 0),
		BackgroundColor3 = runeType.Color,
		Text = `{runeType.Icon} {runeType.Name}`,
		LayoutOrder = index,
	})
	tab.Activated:Connect(function()
		selectedRuneType = runeType.Id
		buildRuneRows()
		refreshRunes()
	end)
end

buildRuneRows()

local runesButton = newBigButton(gui, {
	Name = "RunesButton",
	AnchorPoint = Vector2.new(1, 1),
	Position = UDim2.new(1, -168, 1, -18),
	Size = UDim2.new(0, 146, 0, 56),
	BackgroundColor3 = RUNE_PURPLE,
	Text = "✦ RUNES",
})

runesButton.Activated:Connect(function()
	runeMenu.Visible = not runeMenu.Visible
	if runeMenu.Visible then
		refreshRunes()
	end
end)
runeClose.Activated:Connect(function()
	runeMenu.Visible = false
end)

-- Keep the session clock ticking while the menu is open.
task.spawn(function()
	while true do
		task.wait(1)
		if runeMenu.Visible then
			statsSince.Text = elapsedText()
		end
	end
end)

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

	sprinkleLabel.Text = `✨ {GameConfig.abbreviate(state.sprinkles)}`
	rebirthBadge.Text = state.rebirths > 0
			and `⭐ Rebirth {state.rebirths}  •  x{GameConfig.getRebirthMultiplier(state)}`
		or ""

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
	elseif GameConfig.canRebirth(state) then
		hintLabel.Text = "BIG BEBEH is full. Open the shop and rebirth!"
	elseif fed >= cfg.HungerGoal then
		hintLabel.Text = "He's full! Head through the open gate →"
	else
		hintLabel.Text = "Walk over cookies, then stand on the glowing pad to feed him."
	end
end

-- Upgrade board -------------------------------------------------------------

--[[
	The board in the world shows the same upgrades as the shop panel. It is drawn
	client-side onto a SurfaceGui because levels and prices are per-player -- two
	players standing at the same board must see their own numbers.

	SurfaceGui buttons only receive clicks when the SurfaceGui lives in PlayerGui
	with Adornee pointing at the part, which is why it is built here rather than
	by the server.
]]
local boardRows: { { level: TextLabel, cost: TextLabel, button: TextButton } } = {}

local function buildBoard(face: BasePart)
	local surface = Instance.new("SurfaceGui")
	surface.Name = "UpgradeBoardGui"
	surface.Adornee = face
	surface.Face = Enum.NormalId.Front
	surface.CanvasSize = Vector2.new(920, 400)
	surface.LightInfluence = 0
	surface.MaxDistance = 160
	surface.Parent = playerGui

	local bg = Instance.new("Frame")
	bg.Size = UDim2.fromScale(1, 1)
	bg.BackgroundColor3 = PANEL_BG
	bg.BorderSizePixel = 0
	bg.Parent = surface
	gradient(bg, 1.1, 0.86)

	local title = newLabel({
		Position = UDim2.new(0, 20, 0, 10),
		Size = UDim2.new(1, -40, 0, 52),
		Font = Enum.Font.FredokaOne,
		Text = "🍪 COOKIE UPGRADES",
		TextColor3 = COOKIE_YELLOW,
		TextStrokeTransparency = 0.4,
	})
	title.Parent = bg

	local grid = Instance.new("Frame")
	grid.Position = UDim2.new(0, 16, 0, 70)
	grid.Size = UDim2.new(1, -32, 1, -86)
	grid.BackgroundTransparency = 1
	grid.Parent = bg

	local layout = Instance.new("UIListLayout")
	layout.FillDirection = Enum.FillDirection.Horizontal
	layout.Padding = UDim.new(0, 12)
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Parent = grid

	for index, upgrade in GameConfig.Upgrades do
		local card = Instance.new("Frame")
		card.Size = UDim2.new(1 / #GameConfig.Upgrades, -12, 1, 0)
		card.BackgroundColor3 = ROW_BG
		card.BorderSizePixel = 0
		card.LayoutOrder = index
		card.Parent = grid
		corner(card, 14)
		stroke(card, 3)
		gradient(card, 1.12, 0.9)

		local icon = newLabel({
			Position = UDim2.new(0, 8, 0, 8),
			Size = UDim2.new(1, -16, 0, 54),
			Font = Enum.Font.FredokaOne,
			Text = upgrade.Icon,
		})
		icon.Parent = card

		local name = newLabel({
			Position = UDim2.new(0, 8, 0, 62),
			Size = UDim2.new(1, -16, 0, 34),
			Font = Enum.Font.FredokaOne,
			Text = upgrade.Name,
			TextColor3 = COOKIE_YELLOW,
		})
		name.Parent = card

		local level = newLabel({
			Position = UDim2.new(0, 8, 0, 96),
			Size = UDim2.new(1, -16, 0, 28),
			Font = Enum.Font.Gotham,
			Text = "Level 0",
			TextColor3 = Color3.fromRGB(190, 186, 205),
		})
		level.Parent = card

		local cost = newLabel({
			Position = UDim2.new(0, 8, 0, 124),
			Size = UDim2.new(1, -16, 0, 28),
			Text = "",
			TextColor3 = Color3.fromRGB(220, 216, 235),
		})
		cost.Parent = card

		local buy = newBigButton(card, {
			AnchorPoint = Vector2.new(0.5, 1),
			Position = UDim2.new(0.5, 0, 1, -10),
			Size = UDim2.new(1, -20, 0, 62),
			BackgroundColor3 = AFFORD_GREEN,
			Text = "BUY",
		})
		buy.Activated:Connect(function()
			Remotes.BuyUpgrade:FireServer(upgrade.Id)
		end)

		table.insert(boardRows, { level = level, cost = cost, button = buy })
	end
end

local function refreshBoard()
	for index, upgrade in GameConfig.Upgrades do
		local row = boardRows[index]
		if not row then
			continue
		end
		local owned = GameConfig.getUpgradeLevel(state, upgrade.Id)
		row.level.Text = `Level {owned}/{upgrade.MaxLevel}`
		if owned >= upgrade.MaxLevel then
			row.cost.Text = GameConfig.describeUpgrade(state, upgrade)
			row.button.Text = "MAX"
			row.button.BackgroundColor3 = DENY_GREY
		else
			local price = GameConfig.getUpgradeCost(upgrade, owned)
			row.cost.Text = GameConfig.describeUpgrade(state, upgrade)
			row.button.Text = `✨ {GameConfig.abbreviate(price)}`
			row.button.BackgroundColor3 = state.sprinkles >= price and AFFORD_GREEN or DENY_GREY
		end
	end
end

-- One surface per board. Tag order is arbitrary, so wiring up only the first
-- tagged board could easily land the GUI on a different zone's board.
local wiredBoards: { [Instance]: boolean } = {}
local function tryBuildBoard(face: Instance)
	if wiredBoards[face] or not face:IsA("BasePart") then
		return
	end
	wiredBoards[face] = true
	buildBoard(face)
	refreshBoard()
end

for _, face in CollectionService:GetTagged("UpgradeBoard") do
	tryBuildBoard(face)
end
CollectionService:GetInstanceAddedSignal("UpgradeBoard"):Connect(tryBuildBoard)

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
	refreshShop()
	refreshRunes()
	refreshBoard()
	refreshAllGates()
	refreshAllBebehs()
end)

local toastOrder = 0
local function showToast(message: string, color: Color3)
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
end

Remotes.Toast.OnClientEvent:Connect(showToast)

-- A world-space label that rises and fades. Used for cookie pickups, sprinkle
-- payouts and rune drops.
local function floatText(position: Vector3, text: string, color: Color3)
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
end

Remotes.CookiePop.OnClientEvent:Connect(floatText)

-- Bebeh idle motion, plus the squish when he eats.
local crystalBase: { [BasePart]: Vector3 } = {}
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

Remotes.RuneDrop.OnClientEvent:Connect(function(drops)
	if type(drops) ~= "table" then
		return
	end
	-- Only announce the rarest thing in the batch; bulk opens would spam.
	local best, bestOdds = nil, 0
	for _, drop in drops do
		local rune = GameConfig.getRune(drop.id)
		if rune and rune.Odds > bestOdds then
			best, bestOdds = rune, rune.Odds
		end
	end
	openingSince = openingSince or os.clock()

	if not best or best.Odds <= 1 then
		return
	end

	showToast(`✦ {best.Name} [1/{best.Odds}]`, best.Color)

	-- Float the name off the player too, so it reads as a drop, not a notice.
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	if root then
		floatText(root.Position + Vector3.new(0, 4, 0), best.Name, best.Color)
	end
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

	for _, crystal in CollectionService:GetTagged("RuneCrystal") do
		if crystal:IsA("BasePart") then
			local base = crystalBase[crystal]
			if not base then
				base = crystal.Position
				crystalBase[crystal] = base
			end
			crystal.CFrame = CFrame.new(base + Vector3.new(0, math.sin(now * 1.6) * 0.8, 0))
				* CFrame.Angles(0, now * 0.9, math.rad(20))
		end
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
refreshShop()

task.spawn(function()
	while true do
		task.wait(0.25)
		refreshPanel()
	end
end)
