--[[
	WorldBuilder
	Generates the whole map from GameConfig: one floating platform per area, a
	bridge between each pair, a locked gate on every bridge, and a Big Bebeh
	waiting to be fed on each platform.

	Everything lands in Workspace.BigBebehWorld. It is rebuilt from scratch on
	each server start, so you can safely delete it in Studio and hit Play again.
]]

local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local GameConfig = require(ReplicatedStorage.BigBebehShared.GameConfig)
local BebehBuilder = require(script.Parent.BebehBuilder)

local WorldBuilder = {}

local WORLD_NAME = "BigBebehWorld"

local function makeAnchoredPart(name: string, size: Vector3, cf: CFrame, color: Color3, parent: Instance): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size
	p.CFrame = cf
	p.Color = color
	p.Anchored = true
	p.Material = Enum.Material.SmoothPlastic
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = parent
	return p
end

local function makeSign(text: string, size: UDim2, adornee: BasePart, offsetY: number): BillboardGui
	local billboard = Instance.new("BillboardGui")
	billboard.Name = "Sign"
	billboard.Size = size
	billboard.StudsOffsetWorldSpace = Vector3.new(0, offsetY, 0)
	billboard.MaxDistance = 300
	billboard.Adornee = adornee

	local label = Instance.new("TextLabel")
	label.Name = "Label"
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.FredokaOne
	label.Text = text
	label.TextColor3 = Color3.fromRGB(255, 255, 255)
	label.TextStrokeTransparency = 0
	label.TextScaled = true
	label.Parent = billboard

	billboard.Parent = adornee
	return billboard
end

-- A little market stall where Sprinkles get spent.
local function buildShop(center: Vector3, cfg: any, parent: Instance)
	local folder = Instance.new("Folder")
	folder.Name = "Shop"
	folder.Parent = parent

	local base = center + Vector3.new(62, 0, 62)

	makeAnchoredPart("Counter", Vector3.new(16, 6, 6), CFrame.new(base + Vector3.new(0, 3, 0)), Color3.fromRGB(168, 128, 92), folder).Material =
		Enum.Material.WoodPlanks
	for _, side in { -1, 1 } do
		makeAnchoredPart(
			"Post",
			Vector3.new(1.2, 14, 1.2),
			CFrame.new(base + Vector3.new(side * 7, 7, -2.6)),
			Color3.fromRGB(140, 104, 74),
			folder
		)
	end

	-- Striped awning.
	for i = -3, 3 do
		makeAnchoredPart(
			"Awning",
			Vector3.new(2.4, 0.6, 9),
			CFrame.new(base + Vector3.new(i * 2.4, 14.5, 0)) * CFrame.Angles(math.rad(-16), 0, 0),
			(i % 2 == 0) and Color3.fromRGB(240, 96, 110) or Color3.fromRGB(250, 246, 238),
			folder
		)
	end

	local sign = makeAnchoredPart(
		"ShopSign",
		Vector3.new(1, 1, 1),
		CFrame.new(base + Vector3.new(0, 19, 0)),
		cfg.AccentColor,
		folder
	)
	sign.Transparency = 1
	sign.CanCollide = false
	makeSign("🛒 UPGRADE SHOP", UDim2.fromScale(16, 4), sign, 0)

	-- Walking up opens the same panel as the on-screen button.
	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = "Open shop"
	prompt.ObjectText = "Upgrades"
	prompt.KeyboardKeyCode = Enum.KeyCode.E
	prompt.RequiresLineOfSight = false
	prompt.MaxActivationDistance = 16
	prompt.Parent = folder:FindFirstChild("Counter")
	CollectionService:AddTag(prompt, "ShopPrompt")

	return folder
end

-- One platform, its fence, its name sign and its Bebeh.
local function buildArea(areaIndex: number, parent: Instance)
	local cfg = GameConfig.Areas[areaIndex]
	local center = GameConfig.getAreaCenter(areaIndex)
	local size = GameConfig.PlatformSize

	local folder = Instance.new("Folder")
	folder.Name = `Area{areaIndex}_{cfg.Name}`
	folder.Parent = parent

	-- Floor. Its top surface sits exactly at Y = 0.
	local floor = makeAnchoredPart(
		"Floor",
		size,
		CFrame.new(center + Vector3.new(0, -size.Y / 2, 0)),
		cfg.FloorColor,
		folder
	)
	floor.Material = Enum.Material.Grass

	-- A skirt underneath so the platform reads as a floating island.
	makeAnchoredPart(
		"Base",
		Vector3.new(size.X * 0.82, 22, size.Z * 0.82),
		CFrame.new(center + Vector3.new(0, -size.Y - 11, 0)),
		cfg.FloorColor:Lerp(Color3.new(0, 0, 0), 0.4),
		folder
	).Material = Enum.Material.Slate

	-- Low fence around the rim so nobody walks off by accident.
	local fenceHeight = 5
	for _, sz in { -1, 1 } do
		makeAnchoredPart(
			"Fence",
			Vector3.new(size.X, fenceHeight, 2),
			CFrame.new(center + Vector3.new(0, fenceHeight / 2, sz * size.Z / 2)),
			cfg.AccentColor,
			folder
		)
	end

	-- The +X and -X walls have a doorway cut into them wherever a bridge lands:
	-- one on -X unless this is the first area, one on +X unless it is the last.
	local sideRun = (size.Z - GameConfig.BridgeWidth) / 2
	local hasBridge = { [-1] = areaIndex > 1, [1] = areaIndex < #GameConfig.Areas }
	for _, sx in { -1, 1 } do
		if hasBridge[sx] then
			for _, sz in { -1, 1 } do
				makeAnchoredPart(
					"Fence",
					Vector3.new(2, fenceHeight, sideRun),
					CFrame.new(
						center
							+ Vector3.new(sx * size.X / 2, fenceHeight / 2, sz * (GameConfig.BridgeWidth + sideRun) / 2)
					),
					cfg.AccentColor,
					folder
				)
			end
		else
			makeAnchoredPart(
				"Fence",
				Vector3.new(2, fenceHeight, size.Z),
				CFrame.new(center + Vector3.new(sx * size.X / 2, fenceHeight / 2, 0)),
				cfg.AccentColor,
				folder
			)
		end
	end

	-- Area name floating over the middle of the platform.
	local marker = makeAnchoredPart(
		"NameMarker",
		Vector3.new(1, 1, 1),
		CFrame.new(center + Vector3.new(0, 26, 60)),
		cfg.AccentColor,
		folder
	)
	marker.Transparency = 1
	marker.CanCollide = false
	makeSign(`{areaIndex}. {cfg.Name}`, UDim2.fromScale(24, 5), marker, 0)

	-- Big Bebeh, at the back of the platform, facing the middle.
	local bebehPos = center + Vector3.new(0, 0, -70)
	local bebeh = BebehBuilder.build(areaIndex, cfg, CFrame.lookAt(bebehPos, bebehPos + Vector3.new(0, 0, 1)))
	bebeh.Parent = folder

	-- A soft glowing pad so players know where to stand to feed him.
	local diameter = GameConfig.FeedRadius * 2
	local pad = makeAnchoredPart(
		"FeedPad",
		Vector3.new(0.4, diameter, diameter),
		CFrame.new(bebehPos + Vector3.new(0, 0.2, 8)) * CFrame.Angles(0, 0, math.rad(90)),
		cfg.AccentColor,
		folder
	)
	pad.Shape = Enum.PartType.Cylinder
	pad.CanCollide = false
	pad.CanTouch = false
	pad.Material = Enum.Material.Neon
	pad.Transparency = 0.6

	buildShop(center, cfg, folder)

	return { folder = folder, bebeh = bebeh, center = center }
end

-- The bridge from `areaIndex` to `areaIndex + 1`, plus the gate that blocks it.
local function buildBridge(areaIndex: number, parent: Instance)
	local fromCenter = GameConfig.getAreaCenter(areaIndex)
	local nextCfg = GameConfig.Areas[areaIndex + 1]
	local size = GameConfig.PlatformSize
	local gapLength = GameConfig.AreaSpacing - size.X

	local folder = Instance.new("Folder")
	folder.Name = `Bridge{areaIndex}to{areaIndex + 1}`
	folder.Parent = parent

	local bridgeCenter = fromCenter + Vector3.new(size.X / 2 + gapLength / 2, -1.5, 0)
	makeAnchoredPart(
		"Deck",
		Vector3.new(gapLength, 3, GameConfig.BridgeWidth),
		CFrame.new(bridgeCenter),
		Color3.fromRGB(168, 128, 92),
		folder
	).Material = Enum.Material.WoodPlanks

	for _, sz in { -1, 1 } do
		makeAnchoredPart(
			"Rail",
			Vector3.new(gapLength, 4, 1.5),
			CFrame.new(bridgeCenter + Vector3.new(0, 3, sz * GameConfig.BridgeWidth / 2)),
			Color3.fromRGB(120, 88, 62),
			folder
		)
	end

	-- The gate. Solid until this player has fed the Bebeh behind them; the
	-- client turns it off locally once the area is unlocked.
	local gate = makeAnchoredPart(
		"Gate",
		Vector3.new(2, 24, GameConfig.BridgeWidth + 3),
		CFrame.new(fromCenter + Vector3.new(size.X / 2 + 3, 12, 0)),
		nextCfg.AccentColor,
		folder
	)
	gate.Material = Enum.Material.ForceField
	gate.Transparency = 0.35
	gate.CanCollide = true
	gate:SetAttribute("AreaIndex", areaIndex + 1) -- the area this gate leads INTO
	CollectionService:AddTag(gate, "AreaGate")

	makeSign(`🔒 {nextCfg.Name}`, UDim2.fromScale(20, 6), gate, 16)

	return folder
end

function WorldBuilder.build()
	local existing = workspace:FindFirstChild(WORLD_NAME)
	if existing then
		existing:Destroy()
	end
	-- Studio's default baseplate would sit in the middle of everything.
	local baseplate = workspace:FindFirstChild("Baseplate")
	if baseplate then
		baseplate:Destroy()
	end

	local world = Instance.new("Folder")
	world.Name = WORLD_NAME
	world.Parent = workspace

	local areasFolder = Instance.new("Folder")
	areasFolder.Name = "Areas"
	areasFolder.Parent = world

	local cookiesFolder = Instance.new("Folder")
	cookiesFolder.Name = "Cookies"
	cookiesFolder.Parent = world

	local areas = {}
	for i = 1, #GameConfig.Areas do
		areas[i] = buildArea(i, areasFolder)
		if i < #GameConfig.Areas then
			buildBridge(i, areasFolder)
		end
	end

	-- Spawn everyone at the front of area 1.
	for _, old in workspace:GetDescendants() do
		if old:IsA("SpawnLocation") and not old:IsDescendantOf(world) then
			old:Destroy()
		end
	end
	local spawnPart = Instance.new("SpawnLocation")
	spawnPart.Name = "BebehSpawn"
	spawnPart.Size = Vector3.new(12, 1, 12)
	spawnPart.CFrame = CFrame.new(GameConfig.getAreaCenter(1) + Vector3.new(0, 0.5, 80))
	spawnPart.Anchored = true
	spawnPart.Color = GameConfig.Areas[1].AccentColor
	spawnPart.Material = Enum.Material.Neon
	spawnPart.Duration = 0
	spawnPart.Parent = world

	return {
		world = world,
		areas = areas,
		cookiesFolder = cookiesFolder,
	}
end

return WorldBuilder
