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
local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ProximityPromptService = game:GetService("ProximityPromptService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

-- WaitForChild, because the client can start before ReplicatedStorage replicates.
local sharedFolder = ReplicatedStorage:WaitForChild("BigBebehShared")
local GameConfig = require(sharedFolder:WaitForChild("GameConfig"))
local Remotes = require(sharedFolder:WaitForChild("Remotes"))

-- Design system. Screens are being migrated onto this one at a time; anything
-- still using the old local helpers below has not been converted yet.
local uiFolder = sharedFolder:WaitForChild("UI")
local Theme = require(uiFolder:WaitForChild("Theme"))
local UI = require(uiFolder:WaitForChild("Components"))

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")
local camera = workspace.CurrentCamera

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
	passes = {},
}

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

--[[
	If this script errors partway through, everything below that line silently
	never gets built and the player is left staring at half a HUD with no clue
	why. This flag is set on the last line of the script; if it is still false a
	few seconds in, something threw, so say so on screen and point at Output.
]]
local hudReady = false
task.spawn(function()
	task.wait(5)
	if hudReady then
		return
	end
	local banner = Instance.new("TextLabel")
	banner.Name = "HudError"
	banner.AnchorPoint = Vector2.new(0.5, 0)
	banner.Position = UDim2.new(0.5, 0, 0, 90)
	banner.Size = UDim2.new(0, 620, 0, 54)
	banner.BackgroundColor3 = Color3.fromRGB(150, 30, 40)
	banner.BorderSizePixel = 0
	banner.Font = Enum.Font.GothamBold
	banner.TextColor3 = Color3.fromRGB(255, 255, 255)
	banner.TextScaled = true
	banner.Text = "HUD failed to finish loading — open View ▸ Output for the error"
	banner.Parent = gui
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, 10)
	c.Parent = banner
	warn("[BigBebeh] The client script stopped early. The red error above this line is the cause.")
end)

local TOPBAR_CLEARANCE = 8
local function topSafeY(extra: number): number
	local inset = GuiService:GetGuiInset()
	return inset.Y + TOPBAR_CLEARANCE + extra
end

-- HUD ----------------------------------------------------------------------

--[[
	Currency rail, top left. A vertical stack rather than scattered labels, so
	adding a currency later means appending one pill and nothing has to move.
]]
local rail = Instance.new("Frame")
rail.Name = "CurrencyRail"
rail.Position = UDim2.new(0, Theme.space(4), 0, topSafeY(4))
rail.Size = UDim2.new(0, 200, 0, 120)
rail.BackgroundTransparency = 1
rail.Parent = gui
UI.list(rail, 2)

local _, sprinkleLabel = UI.pill(rail, {
	icon = "✦",
	color = Theme.color.sprinkle,
	text = "0",
	props = { Name = "Sprinkles", LayoutOrder = 1 },
})

local rebirthPill, rebirthLabel = UI.pill(rail, {
	icon = "★",
	color = Theme.color.cookie,
	text = "x1",
	props = { Name = "Rebirth", LayoutOrder = 2, Visible = false },
})

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

--[[
	Bottom HUD. Two readouts that matter while you play: how full your hands are,
	and how full the Bebeh is. The zone name sits above them as quiet context.

	Everything is on the 4px grid and every colour comes from the theme, so this
	panel reads as part of the same product as the currency rail.
]]
local hud = UI.panel(gui, {
	Name = "Hud",
	AnchorPoint = Vector2.new(0.5, 1),
	Position = UDim2.new(0.5, 0, 1, -Theme.space(5)),
	Size = UDim2.new(0, 468, 0, 166),
})
UI.padding(hud, 4)

-- Header: zone name and number, both quiet. This is context, not the subject.
local zoneName = UI.label(hud, {
	Name = "ZoneName",
	Size = UDim2.new(1, -80, 0, 18),
	Font = Theme.font.bold,
	Text = "COOKIE NURSERY",
	TextColor3 = Theme.color.textFaint,
	TextSize = Theme.textSize.xs,
})

local zoneNumber = UI.label(hud, {
	Name = "ZoneNumber",
	AnchorPoint = Vector2.new(1, 0),
	Position = UDim2.new(1, 0, 0, 0),
	Size = UDim2.new(0, 76, 0, 18),
	Font = Theme.font.bold,
	Text = "ZONE 1",
	TextColor3 = Theme.color.textFaint,
	TextSize = Theme.textSize.xs,
	TextXAlignment = Enum.TextXAlignment.Right,
})

-- Carry: the headline number, so it gets the icon chip and the largest type.
local carryChip = Instance.new("Frame")
carryChip.Name = "CarryChip"
carryChip.Position = UDim2.new(0, 0, 0, Theme.space(6))
carryChip.Size = UDim2.fromOffset(38, 38)
carryChip.BackgroundColor3 = Theme.color.cookie
carryChip.BorderSizePixel = 0
carryChip.Parent = hud
UI.round(carryChip, Theme.radius.sm)
UI.sheen(carryChip, 0.8)
UI.label(carryChip, {
	Size = UDim2.fromScale(1, 1),
	Font = Theme.font.display,
	Text = "🍪",
	TextSize = Theme.textSize.lg,
	TextXAlignment = Enum.TextXAlignment.Center,
})

local carryValue = UI.label(hud, {
	Name = "CarryValue",
	Position = UDim2.new(0, Theme.space(12), 0, Theme.space(6)),
	Size = UDim2.new(1, -Theme.space(12), 0, 38),
	Font = Theme.font.display,
	Text = "0",
	TextSize = Theme.textSize.xl,
	TextStrokeTransparency = 0.5,
})

local _, setCarry = UI.bar(hud, {
	color = Theme.color.cookie,
	height = 14,
	props = { Name = "CarryBar", Position = UDim2.new(0, 0, 0, Theme.space(19)) },
})

-- Feed: the goal you are working toward. Label left, value right.
local feedName = UI.label(hud, {
	Name = "FeedName",
	Position = UDim2.new(0, 0, 0, Theme.space(24)),
	Size = UDim2.new(1, -120, 0, 22),
	Font = Theme.font.bold,
	Text = "BABY BEBEH",
	TextColor3 = Theme.color.textDim,
	TextSize = Theme.textSize.sm,
})

local feedValue = UI.label(hud, {
	Name = "FeedValue",
	AnchorPoint = Vector2.new(1, 0),
	Position = UDim2.new(1, 0, 0, Theme.space(24)),
	Size = UDim2.new(0, 160, 0, 22),
	Font = Theme.font.display,
	Text = "0",
	TextSize = Theme.textSize.md,
	TextXAlignment = Enum.TextXAlignment.Right,
})

local _, setFeed = UI.bar(hud, {
	color = Theme.color.hunger,
	height = 14,
	props = { Name = "FeedBar", Position = UDim2.new(0, 0, 0, Theme.space(31)) },
})

-- Game passes --------------------------------------------------------------

--[[
	One button per paid perk, above the menu buttons. It shows what the perk does
	when you do not own it and confirms it is active when you do, so the same
	control answers both "what is this" and "is it working".

	The button only prompts; whether you own it is decided by the server.
]]
local passButtons: { [string]: TextButton } = {}

local passRail = Instance.new("Frame")
passRail.Name = "PassRail"
passRail.AnchorPoint = Vector2.new(1, 1)
passRail.Position = UDim2.new(1, -Theme.space(4), 1, -Theme.space(21))
passRail.Size = UDim2.new(0, 296, 0, 60)
passRail.BackgroundTransparency = 1
passRail.Parent = gui
UI.list(passRail, 2)

for index, pass in GameConfig.GamePasses do
	passButtons[pass.Id] = UI.button(passRail, {
		text = `{pass.Icon} {string.upper(pass.Name)}`,
		color = Theme.color.warn,
		props = {
			Name = pass.Id,
			Size = UDim2.new(1, 0, 0, 56),
			LayoutOrder = index,
			TextSize = Theme.textSize.lg,
		},
		onClick = function()
			if GameConfig.ownsPass(state, pass.Id) then
				return -- already active; nothing to buy
			end
			if pass.AssetId <= 0 then
				warn(`[BigBebeh] {pass.Name} has no AssetId set in GameConfig.GamePasses.`)
				warn("[BigBebeh] Create the pass on Roblox, then paste its id there.")
				return
			end
			MarketplaceService:PromptGamePassPurchase(player, pass.AssetId)
		end,
	})
end

local function refreshPasses()
	for _, pass in GameConfig.GamePasses do
		local button = passButtons[pass.Id]
		if not button then
			continue
		end
		if GameConfig.ownsPass(state, pass.Id) then
			button.Text = `{pass.Icon} {string.upper(pass.Name)}  ✓`
			button.BackgroundColor3 = Theme.color.good
		else
			button.Text = `{pass.Icon} {string.upper(pass.Name)}`
			button.BackgroundColor3 = Theme.color.warn
		end
	end
end

-- Shop ---------------------------------------------------------------------

--[[
	Upgrade shop. One row per upgrade: identity chip, what it does now, and the
	price. Rebirth gets its own footer rather than sitting in the list, because
	it is not a purchase -- it resets your run, and it should not look like the
	next thing to buy.
]]
local shop, shopBody, shopHeader = UI.modal(gui, {
	title = "UPGRADES",
	accent = Theme.color.cookie,
	size = UDim2.fromOffset(560, 596),
	props = { Name = "Shop" },
})

local _, shopBalance = UI.pill(shopHeader, {
	icon = "✦",
	color = Theme.color.sprinkle,
	text = "0",
	props = {
		AnchorPoint = Vector2.new(1, 0.5),
		Position = UDim2.new(1, -Theme.space(14), 0.5, 0),
		Size = UDim2.fromOffset(150, 42),
	},
})

local REBIRTH_FOOTER_H = 84
local shopList = UI.scroller(shopBody, 2, {
	Size = UDim2.new(1, 0, 1, -REBIRTH_FOOTER_H),
})

local shopRows: { [string]: { level: TextLabel, effect: TextLabel, buy: TextButton } } = {}

for index, upgrade in GameConfig.Upgrades do
	local row = UI.row(shopList, { Name = upgrade.Id, LayoutOrder = index })

	UI.chip(row, {
		icon = upgrade.Icon,
		color = Theme.color.cookie,
		size = 44,
		props = { Position = UDim2.new(0, Theme.space(3), 0.5, -22) },
	})

	UI.label(row, {
		Position = UDim2.new(0, Theme.space(15), 0, Theme.space(3)),
		Size = UDim2.new(1, -Theme.space(47), 0, 22),
		Font = Theme.font.display,
		Text = upgrade.Name,
		TextSize = Theme.textSize.md,
	})

	local effect = UI.label(row, {
		Position = UDim2.new(0, Theme.space(15), 0, Theme.space(9)),
		Size = UDim2.new(1, -Theme.space(47), 0, 20),
		Font = Theme.font.body,
		Text = upgrade.Blurb,
		TextColor3 = Theme.color.textDim,
		TextSize = Theme.textSize.sm,
	})

	local level = UI.label(row, {
		Position = UDim2.new(0, Theme.space(15), 0, Theme.space(14)),
		Size = UDim2.new(1, -Theme.space(47), 0, 18),
		Font = Theme.font.bold,
		Text = "",
		TextColor3 = Theme.color.textFaint,
		TextSize = Theme.textSize.xs,
	})

	local buy = UI.button(row, {
		text = "0",
		color = Theme.color.good,
		props = {
			AnchorPoint = Vector2.new(1, 0.5),
			Position = UDim2.new(1, -Theme.space(3), 0.5, 0),
			Size = UDim2.fromOffset(128, 58),
			TextSize = Theme.textSize.md,
		},
		onClick = function()
			Remotes.BuyUpgrade:FireServer(upgrade.Id)
		end,
	})

	shopRows[upgrade.Id] = { level = level, effect = effect, buy = buy }
end

-- Rebirth footer, visually separate from the purchase list.
local rebirthButton = UI.button(shopBody, {
	text = "REBIRTH",
	color = Theme.color.muted,
	props = {
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, 0),
		Size = UDim2.new(1, -Theme.space(2), 0, 64),
		TextSize = Theme.textSize.lg,
	},
	onClick = function()
		Remotes.Rebirth:FireServer()
	end,
})

local function refreshShop()
	shopBalance.Text = GameConfig.abbreviate(state.sprinkles)

	for _, upgrade in GameConfig.Upgrades do
		local row = shopRows[upgrade.Id]
		local owned = GameConfig.getUpgradeLevel(state, upgrade.Id)

		row.effect.Text = GameConfig.describeUpgrade(state, upgrade)
		row.level.Text = `LEVEL {owned} / {upgrade.MaxLevel}`

		if owned >= upgrade.MaxLevel then
			row.buy.Text = "MAX"
			row.buy.BackgroundColor3 = Theme.color.muted
		else
			local price = GameConfig.getUpgradeCost(upgrade, owned)
			row.buy.Text = `✦ {GameConfig.abbreviate(price)}`
			-- Affordability is the one thing you scan for, so it is colour-coded.
			row.buy.BackgroundColor3 = state.sprinkles >= price and Theme.color.good or Theme.color.muted
		end
	end

	if GameConfig.canRebirth(state) then
		local nextMultiplier = 1 + GameConfig.RebirthMultiplierPerLevel * (state.rebirths + 1)
		rebirthButton.Text = `★ REBIRTH  →  x{nextMultiplier} FOREVER`
		rebirthButton.BackgroundColor3 = Theme.color.warn
	else
		rebirthButton.Text = "★ FILL BIG BEBEH TO REBIRTH"
		rebirthButton.BackgroundColor3 = Theme.color.muted
	end
end

local _shopButton = UI.button(gui, {
	text = "SHOP",
	color = Theme.color.sprinkle,
	props = {
		Name = "ShopButton",
		AnchorPoint = Vector2.new(1, 1),
		Position = UDim2.new(1, -Theme.space(4), 1, -Theme.space(5)),
		Size = UDim2.fromOffset(150, 58),
	},
	onClick = function()
		shop.Visible = not shop.Visible
		if shop.Visible then
			refreshShop()
		end
	end,
})

ProximityPromptService.PromptTriggered:Connect(function(prompt)
	if CollectionService:HasTag(prompt, "ShopPrompt") then
		shop.Visible = true
		refreshShop()
	end
end)

-- Runes --------------------------------------------------------------------

--[[
	Rune menu. The ladder on the left is the reference -- every tier, its odds
	and how many you hold. The right column is the answer to "so what do I have":
	the totals those runes add up to.

	Family tabs sit above both. There is one family today and the menu is built
	to switch, so a second is a config entry rather than a rewrite.
]]
local selectedRuneType = GameConfig.RuneTypes[1].Id
local openingSince: number? = nil -- set when the first rune of the session lands

local runeMenu, runeBody, _ = UI.modal(gui, {
	title = "RUNES",
	accent = Theme.color.rune,
	size = UDim2.fromOffset(788, 596),
	props = { Name = "RuneMenu" },
})

local tabStrip = Instance.new("Frame")
tabStrip.Name = "Tabs"
tabStrip.BackgroundTransparency = 1
tabStrip.Size = UDim2.new(1, 0, 0, 46)
tabStrip.Parent = runeBody
UI.list(tabStrip, 2, true)

local columns = Instance.new("Frame")
columns.Name = "Columns"
columns.BackgroundTransparency = 1
columns.Position = UDim2.new(0, 0, 0, Theme.space(14))
columns.Size = UDim2.new(1, 0, 1, -Theme.space(14))
columns.Parent = runeBody

local ladderHead = UI.label(columns, {
	Size = UDim2.new(0.58, -Theme.space(2), 0, 20),
	Font = Theme.font.bold,
	Text = "LADDER",
	TextColor3 = Theme.color.textFaint,
	TextSize = Theme.textSize.xs,
})

local ladder = UI.scroller(columns, 2, {
	Position = UDim2.new(0, 0, 0, Theme.space(7)),
	Size = UDim2.new(0.58, -Theme.space(2), 1, -Theme.space(7)),
})

local statsPanel = Instance.new("Frame")
statsPanel.Name = "Stats"
statsPanel.BackgroundColor3 = Theme.color.bg
statsPanel.BorderSizePixel = 0
statsPanel.AnchorPoint = Vector2.new(1, 0)
statsPanel.Position = UDim2.new(1, 0, 0, 0)
statsPanel.Size = UDim2.new(0.42, -Theme.space(2), 1, 0)
statsPanel.Parent = columns
UI.round(statsPanel, Theme.radius.md)
UI.outline(statsPanel, Theme.stroke.thin, Theme.color.surfaceHi)
UI.padding(statsPanel, 4)

local statsOpened = UI.label(statsPanel, {
	Size = UDim2.new(1, 0, 0, 34),
	Font = Theme.font.display,
	Text = "0",
	TextColor3 = Theme.color.rune,
	TextSize = Theme.textSize.xl,
})

local _statsOpenedCaption = UI.label(statsPanel, {
	Position = UDim2.new(0, 0, 0, Theme.space(8)),
	Size = UDim2.new(1, 0, 0, 18),
	Font = Theme.font.bold,
	Text = "RUNES OPENED",
	TextColor3 = Theme.color.textFaint,
	TextSize = Theme.textSize.xs,
})

local statsSince = UI.label(statsPanel, {
	Position = UDim2.new(0, 0, 0, Theme.space(13)),
	Size = UDim2.new(1, 0, 0, 18),
	Font = Theme.font.body,
	Text = "Not opening",
	TextColor3 = Theme.color.textDim,
	TextSize = Theme.textSize.xs,
})

-- The three totals a player actually acts on.
local _totalsHead = UI.label(statsPanel, {
	Position = UDim2.new(0, 0, 0, Theme.space(19)),
	Size = UDim2.new(1, 0, 0, 18),
	Font = Theme.font.bold,
	Text = "TOTALS",
	TextColor3 = Theme.color.textFaint,
	TextSize = Theme.textSize.xs,
})

local totalRows = {}
for i, spec in {
	{ key = "cookie", icon = "🍪", label = "Cookies", color = Theme.color.cookie },
	{ key = "luck", icon = "✦", label = "Rune Luck", color = Theme.color.rune },
	{ key = "bulk", icon = "⛏", label = "Bulk", color = Theme.color.good },
	{ key = "clone", icon = "❖", label = "Clone", color = Theme.color.sprinkle },
} do
	local y = Theme.space(24 + (i - 1) * 11)
	UI.chip(statsPanel, {
		icon = spec.icon,
		color = spec.color,
		size = 32,
		props = { Position = UDim2.new(0, 0, 0, y) },
	})
	UI.label(statsPanel, {
		Position = UDim2.new(0, Theme.space(10), 0, y),
		Size = UDim2.new(1, -Theme.space(10), 0, 16),
		Font = Theme.font.bold,
		Text = string.upper(spec.label),
		TextColor3 = Theme.color.textFaint,
		TextSize = Theme.textSize.xs,
	})
	totalRows[spec.key] = UI.label(statsPanel, {
		Position = UDim2.new(0, Theme.space(10), 0, y + 15),
		Size = UDim2.new(1, -Theme.space(10), 0, 18),
		Font = Theme.font.display,
		Text = "-",
		TextSize = Theme.textSize.md,
	})
end

-- Ladder rows, rebuilt when the family changes.
local ladderRows: { [string]: { count: TextLabel, boost: TextLabel } } = {}

local function buildRuneRows()
	for _, child in ladder:GetChildren() do
		if not child:IsA("UIListLayout") then
			child:Destroy()
		end
	end
	table.clear(ladderRows)

	for index, rune in GameConfig.getRunesOfType(selectedRuneType) do
		local row = UI.row(ladder, { Name = rune.Id, LayoutOrder = index, Size = UDim2.new(1, -6, 0, 62) })

		-- The rarity colour lives on a bar down the edge, so the name can stay
		-- white and legible instead of being tinted to the point of straining.
		local edge = Instance.new("Frame")
		edge.Size = UDim2.new(0, 6, 1, -Theme.space(4))
		edge.Position = UDim2.new(0, Theme.space(2), 0, Theme.space(2))
		edge.BackgroundColor3 = rune.Color
		edge.BorderSizePixel = 0
		edge.Parent = row
		UI.round(edge, 3)

		UI.label(row, {
			Position = UDim2.new(0, Theme.space(5), 0, Theme.space(2)),
			Size = UDim2.new(1, -Theme.space(28), 0, 20),
			Font = Theme.font.display,
			Text = rune.Name,
			TextColor3 = rune.Color,
			TextSize = Theme.textSize.md,
		})

		local boost = UI.label(row, {
			Position = UDim2.new(0, Theme.space(5), 0, Theme.space(8)),
			Size = UDim2.new(1, -Theme.space(28), 0, 18),
			Font = Theme.font.body,
			Text = "",
			TextColor3 = Theme.color.textDim,
			TextSize = Theme.textSize.xs,
		})

		local count = UI.label(row, {
			AnchorPoint = Vector2.new(1, 0.5),
			Position = UDim2.new(1, -Theme.space(3), 0.5, 0),
			Size = UDim2.new(0, 96, 0, 30),
			Font = Theme.font.display,
			Text = "0",
			TextSize = Theme.textSize.lg,
			TextXAlignment = Enum.TextXAlignment.Right,
		})

		ladderRows[rune.Id] = { count = count, boost = boost }
	end
end

local function elapsedText(): string
	if not openingSince then
		return "Stand on the altar to open"
	end
	local secs = math.max(0, math.floor(os.clock() - openingSince))
	local h, m, s = secs // 3600, (secs % 3600) // 60, secs % 60
	if h > 0 then
		return `Opening for {h}h {m}m`
	elseif m > 0 then
		return `Opening for {m}m {s}s`
	end
	return `Opening for {s}s`
end

local function refreshRunes()
	local runeType = GameConfig.getRuneType(selectedRuneType)
	if not runeType then
		return
	end

	ladderHead.Text = string.upper(runeType.Name)
	statsOpened.Text = GameConfig.abbreviate(state.runesOpened or 0)
	statsOpened.TextColor3 = runeType.Color
	statsSince.Text = elapsedText()

	totalRows.cookie.Text = `x{string.format("%.2f", GameConfig.getCookieMultiplier(state))}`
	totalRows.luck.Text = `x{string.format("%.2f", GameConfig.getRuneLuck(state))}`
	totalRows.bulk.Text = `{GameConfig.getRuneBulk(state)} per open`
	totalRows.clone.Text = `{math.floor(GameConfig.getRuneCloneChance(state) * 100)}%`

	for _, rune in GameConfig.getRunesOfType(selectedRuneType) do
		local row = ladderRows[rune.Id]
		if not row then
			continue
		end
		local owned = GameConfig.getRuneCount(state, rune.Id)
		local boost = GameConfig.getRuneBoost(rune, owned)
		local effect = GameConfig.RuneEffectNames[rune.Effect] or rune.Effect

		row.count.Text = GameConfig.abbreviate(owned)
		-- Tiers you have never seen stay dimmed, so the ladder shows progress.
		row.count.TextTransparency = owned > 0 and 0 or 0.6
		if owned >= rune.MaxStack then
			row.boost.Text = `1/{rune.Odds}  ·  MAXED  ·  +x{string.format("%.2f", boost)} {effect}`
		else
			row.boost.Text = `1/{rune.Odds}  ·  +x{string.format("%.2f", boost)} {effect}`
		end
	end
end

for index, runeType in GameConfig.RuneTypes do
	UI.button(tabStrip, {
		text = `{runeType.Icon} {string.upper(runeType.Name)}`,
		color = runeType.Color,
		props = { Size = UDim2.fromOffset(210, 46), LayoutOrder = index, TextSize = Theme.textSize.md },
		onClick = function()
			selectedRuneType = runeType.Id
			buildRuneRows()
			refreshRunes()
		end,
	})
end

buildRuneRows()

local _runesButton = UI.button(gui, {
	text = "✦ RUNES",
	color = Theme.color.rune,
	props = {
		Name = "RunesButton",
		AnchorPoint = Vector2.new(1, 1),
		Position = UDim2.new(1, -Theme.space(44), 1, -Theme.space(5)),
		Size = UDim2.fromOffset(150, 58),
	},
	onClick = function()
		runeMenu.Visible = not runeMenu.Visible
		if runeMenu.Visible then
			refreshRunes()
		end
	end,
})

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
	zoneName.Text = string.upper(GameConfig.Areas[here].Name)
	zoneNumber.Text = `ZONE {here}`

	sprinkleLabel.Text = GameConfig.abbreviate(state.sprinkles)
	-- The rebirth pill only earns its space once you have actually rebirthed.
	rebirthPill.Visible = state.rebirths > 0
	rebirthLabel.Text = `x{GameConfig.getRebirthMultiplier(state)}`

	-- The capacity is dimmed inline, so the eye lands on what you are carrying.
	local capacity = state.capacity or 0
	local carryRatio = capacity > 0 and state.carried / capacity or 0
	carryValue.Text = string.format(
		'%s<font color="#6B6780"> / %s</font>',
		GameConfig.abbreviate(state.carried),
		GameConfig.abbreviate(capacity)
	)
	setCarry(carryRatio, carryRatio >= 1 and Theme.color.warn or Theme.color.cookie)

	local tracked = trackedAreaIndex()
	local cfg = GameConfig.Areas[tracked]
	local fed = state.fed[tracked] or 0
	feedName.Text = string.upper(cfg.BebehName)
	feedValue.Text = string.format(
		'%s<font color="#6B6780"> / %s</font>',
		GameConfig.abbreviate(fed),
		GameConfig.abbreviate(cfg.HungerGoal)
	)
	setFeed(fed / cfg.HungerGoal)
end

-- Upgrade board -------------------------------------------------------------

--[[
	The board in the world shows the same upgrades as the shop panel, one card
	per upgrade. It is drawn client-side onto a SurfaceGui because levels and
	prices are per-player -- two players at the same board must see their own
	numbers -- and because SurfaceGui buttons only take clicks when the GUI lives
	in PlayerGui with Adornee pointed at the part.
]]
local boardRows: { { level: TextLabel, effect: TextLabel, buy: TextButton } } = {}

local function buildBoard(face: BasePart)
	local surface = Instance.new("SurfaceGui")
	surface.Name = "UpgradeBoardGui"
	surface.Adornee = face
	surface.Face = Enum.NormalId.Front
	surface.CanvasSize = Vector2.new(1040, 440)
	surface.LightInfluence = 0
	surface.MaxDistance = 170
	surface.Parent = playerGui

	local bg = Instance.new("Frame")
	bg.Size = UDim2.fromScale(1, 1)
	bg.BackgroundColor3 = Theme.color.bg
	bg.BorderSizePixel = 0
	bg.Parent = surface
	UI.padding(bg, 5)

	UI.label(bg, {
		Size = UDim2.new(1, 0, 0, 54),
		Font = Theme.font.display,
		Text = "COOKIE UPGRADES",
		TextColor3 = Theme.color.cookie,
		TextSize = 44,
		TextXAlignment = Enum.TextXAlignment.Center,
	})

	local grid = Instance.new("Frame")
	grid.Position = UDim2.new(0, 0, 0, 70)
	grid.Size = UDim2.new(1, 0, 1, -70)
	grid.BackgroundTransparency = 1
	grid.Parent = bg
	UI.list(grid, 3, true)

	local count = #GameConfig.Upgrades
	for index, upgrade in GameConfig.Upgrades do
		local card = UI.row(grid, {
			LayoutOrder = index,
			Size = UDim2.new(1 / count, -Theme.space(3), 1, 0),
		})

		UI.chip(card, {
			icon = upgrade.Icon,
			color = Theme.color.cookie,
			size = 58,
			props = { AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, Theme.space(3)) },
		})

		UI.label(card, {
			Position = UDim2.new(0, Theme.space(2), 0, Theme.space(19)),
			Size = UDim2.new(1, -Theme.space(4), 0, 30),
			Font = Theme.font.display,
			Text = upgrade.Name,
			TextSize = 24,
			TextXAlignment = Enum.TextXAlignment.Center,
		})

		local effect = UI.label(card, {
			Position = UDim2.new(0, Theme.space(2), 0, Theme.space(27)),
			Size = UDim2.new(1, -Theme.space(4), 0, 24),
			Font = Theme.font.body,
			Text = "",
			TextColor3 = Theme.color.textDim,
			TextSize = 18,
			TextXAlignment = Enum.TextXAlignment.Center,
		})

		local level = UI.label(card, {
			Position = UDim2.new(0, Theme.space(2), 0, Theme.space(33)),
			Size = UDim2.new(1, -Theme.space(4), 0, 22),
			Font = Theme.font.bold,
			Text = "",
			TextColor3 = Theme.color.textFaint,
			TextSize = 16,
			TextXAlignment = Enum.TextXAlignment.Center,
		})

		local buy = UI.button(card, {
			text = "0",
			color = Theme.color.good,
			props = {
				AnchorPoint = Vector2.new(0.5, 1),
				Position = UDim2.new(0.5, 0, 1, -Theme.space(3)),
				Size = UDim2.new(1, -Theme.space(6), 0, 62),
				TextSize = 26,
			},
			onClick = function()
				Remotes.BuyUpgrade:FireServer(upgrade.Id)
			end,
		})

		table.insert(boardRows, { level = level, effect = effect, buy = buy })
	end
end

local function refreshBoard()
	for index, upgrade in GameConfig.Upgrades do
		local row = boardRows[index]
		if not row then
			continue
		end
		local owned = GameConfig.getUpgradeLevel(state, upgrade.Id)
		row.effect.Text = GameConfig.describeUpgrade(state, upgrade)
		row.level.Text = `LEVEL {owned} / {upgrade.MaxLevel}`
		if owned >= upgrade.MaxLevel then
			row.buy.Text = "MAX"
			row.buy.BackgroundColor3 = Theme.color.muted
		else
			local price = GameConfig.getUpgradeCost(upgrade, owned)
			row.buy.Text = `✦ {GameConfig.abbreviate(price)}`
			row.buy.BackgroundColor3 = state.sprinkles >= price and Theme.color.good or Theme.color.muted
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
	refreshPasses()
	refreshAllGates()
	refreshAllBebehs()
end)

local toastOrder = 0
local function showToast(message: string, color: Color3)
	toastOrder += 1

	local frame = UI.panel(toastHolder, {
		Size = UDim2.new(1, 0, 0, 38),
		BackgroundColor3 = Theme.color.surface,
		LayoutOrder = toastOrder,
	})

	local label = UI.label(frame, {
		Position = UDim2.new(0, Theme.space(3), 0, 0),
		Size = UDim2.new(1, -Theme.space(6), 1, 0),
		Font = Theme.font.display,
		Text = message,
		TextColor3 = color,
		TextSize = Theme.textSize.md,
		TextXAlignment = Enum.TextXAlignment.Center,
	})

	task.delay(3.5, function()
		TweenService:Create(frame, Theme.motion.normal, { BackgroundTransparency = 1 }):Play()
		TweenService:Create(label, Theme.motion.normal, { TextTransparency = 1 }):Play()
		task.wait(0.3)
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

	local label = UI.label(billboard, {
		Size = UDim2.fromScale(1, 1),
		Font = Theme.font.display,
		Text = text,
		TextColor3 = color,
		TextSize = Theme.textSize.lg,
		TextStrokeTransparency = 0.2,
		TextXAlignment = Enum.TextXAlignment.Center,
	})

	TweenService:Create(anchor, Theme.motion.pop, {
		WorldPosition = anchor.WorldPosition + Vector3.new(0, 6, 0),
	}):Play()
	TweenService:Create(label, Theme.motion.normal, {
		TextTransparency = 1,
		TextStrokeTransparency = 1,
	}):Play()
	task.delay(0.8, function()
		anchor:Destroy()
	end)
end

Remotes.CookiePop.OnClientEvent:Connect(floatText)

-- Bebeh idle motion, plus the squish when he eats.
local crystalBase: { [BasePart]: Vector3 } = {}
local padBase = setmetatable({}, {
	__index = function(self, pad)
		local d = pad.Size.Y
		rawset(self, pad, d)
		return d
	end,
})
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
	emitter.Color = ColorSequence.new(Theme.color.cookie)
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

	-- The feed pad brightens as your hands fill, so the place to go is obvious
	-- without reading the HUD.
	local fillRatio = state.capacity > 0 and math.clamp(state.carried / state.capacity, 0, 1) or 0
	for _, pad in CollectionService:GetTagged("FeedPad") do
		if pad:IsA("BasePart") then
			pad.Transparency = 0.85 - 0.45 * fillRatio
			local pulse = 1 + math.sin(now * 4) * 0.06 * fillRatio
			pad.Size = Vector3.new(0.4, padBase[pad] * pulse, padBase[pad] * pulse)
		end
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

-- Reached the end, so the watchdog above stands down.
hudReady = true
