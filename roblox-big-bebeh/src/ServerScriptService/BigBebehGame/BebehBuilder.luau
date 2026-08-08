--[[
	BebehBuilder
	Builds Big Bebeh out of parts: a chunky brown cube head, floppy yellow bunny
	ears, sleepy closed eyes, blushy cheeks, a blue bib and a big blue pacifier.

	Want your own model instead? Drop a Model named "BigBebeh" into ServerStorage
	and this module will clone and scale that instead of building the blocky one.
]]

local CollectionService = game:GetService("CollectionService")
local ServerStorage = game:GetService("ServerStorage")

local BebehBuilder = {}

local BROWN = Color3.fromRGB(150, 108, 74)
local DARK_BROWN = Color3.fromRGB(118, 82, 55)
local EAR_YELLOW = Color3.fromRGB(248, 226, 74)
local BIB_BLUE = Color3.fromRGB(150, 215, 240)
local PACI_BLUE = Color3.fromRGB(86, 150, 240)
local PACI_PURPLE = Color3.fromRGB(150, 120, 226)
local BLUSH = Color3.fromRGB(240, 140, 140)
local DIAPER = Color3.fromRGB(245, 243, 236)

local function makePart(name: string, size: Vector3, cf: CFrame, color: Color3, shape: Enum.PartType?): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size
	p.CFrame = cf
	p.Color = color
	p.Shape = shape or Enum.PartType.Block
	p.Anchored = true
	p.CanCollide = false
	p.CanTouch = false
	p.CanQuery = false
	p.Material = Enum.Material.SmoothPlastic
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	return p
end

-- The model is authored around the origin facing -Z (Roblox's "forward").
local function buildBlockyBebeh(scale: number): Model
	local model = Instance.new("Model")

	local function s(n: number)
		return n * scale
	end
	local function v(x: number, y: number, z: number)
		return Vector3.new(s(x), s(y), s(z))
	end
	local function at(x: number, y: number, z: number)
		return CFrame.new(s(x), s(y), s(z))
	end

	local pieces = {}
	local function add(p: Part)
		table.insert(pieces, p)
		return p
	end

	-- Head ------------------------------------------------------------------
	local head = add(makePart("Head", v(14, 13, 13), at(0, 0, 0), BROWN))
	head.CanCollide = true
	head.CanQuery = true
	model.PrimaryPart = head

	-- The darker band and yellow stripe running down his left side.
	add(makePart("SideShade", v(0.3, 13.1, 13.1), at(-6.9, 0, 0), DARK_BROWN))
	add(makePart("Stripe", v(0.35, 13.15, 3.2), at(-7.0, 0, 1.2), EAR_YELLOW))

	-- Ears ------------------------------------------------------------------
	-- Long floppy bunny ears splayed out in a V above the head.
	for _, side in { -1, 1 } do
		local ear = add(makePart("Ear", v(2.4, 13, 1.1), CFrame.new(), EAR_YELLOW))
		ear.CFrame = at(side * 3.2, 6.5, 0.5)
			* CFrame.Angles(math.rad(-8), 0, math.rad(side * 38))
			* CFrame.new(0, s(6), 0)
	end

	-- Eyes ------------------------------------------------------------------
	-- Sleepy closed eyes: two strokes per eye meeting at the bottom.
	local faceZ = -6.6
	for _, side in { -1, 1 } do
		for _, lash in { -1, 1 } do
			add(makePart(
				"Eye",
				v(0.55, 3.6, 0.35),
				at(side * 3.6 + lash * 1.05, 2.6, faceZ) * CFrame.Angles(0, 0, math.rad(lash * -22)),
				Color3.fromRGB(15, 15, 15)
			))
		end
	end

	-- Blushy cheeks ---------------------------------------------------------
	for _, side in { -1, 1 } do
		local cheek = add(makePart("Blush", v(3.4, 2.2, 1), at(side * 4.6, -0.6, faceZ + 0.1), BLUSH, Enum.PartType.Ball))
		cheek.Transparency = 0.35
	end

	-- Bib -------------------------------------------------------------------
	add(makePart("Bib", v(12.6, 4.2, 0.7), at(0, -4.4, faceZ - 0.1), BIB_BLUE))
	add(makePart("BibLeft", v(2.6, 3.2, 0.7), at(-6.6, -2.6, faceZ - 0.1), BIB_BLUE))
	add(makePart("BibRight", v(2.6, 3.2, 0.7), at(6.6, -2.6, faceZ - 0.1), BIB_BLUE))
	-- Little bow in the middle of the bib.
	for _, side in { -1, 1 } do
		add(makePart(
			"BowLoop",
			v(2.2, 1.6, 0.6),
			at(side * 1.6, -5.6, faceZ - 0.5) * CFrame.Angles(0, 0, math.rad(side * 18)),
			BIB_BLUE
		))
	end
	add(makePart("BowKnot", v(1.1, 1.1, 0.7), at(0, -5.5, faceZ - 0.6), Color3.fromRGB(180, 232, 248)))

	-- Pacifier --------------------------------------------------------------
	add(makePart("PaciShield", v(5.4, 3.6, 1.6), at(0, -2.4, faceZ - 0.7), BIB_BLUE, Enum.PartType.Ball))
	add(makePart("PaciKnob", v(2.8, 2.8, 2.4), at(0, -2.2, faceZ - 1.8), PACI_BLUE, Enum.PartType.Ball))
	-- The ring is faked with eight short segments so it reads as a torus.
	for i = 0, 7 do
		local angle = (i / 8) * math.pi * 2
		add(makePart(
			"PaciRing",
			v(0.85, 0.85, 1.7),
			at(0, -3.6, faceZ - 2.4)
				* CFrame.new(math.cos(angle) * s(1.7), math.sin(angle) * s(1.7), 0)
				* CFrame.Angles(0, 0, angle),
			PACI_PURPLE
		))
	end

	-- Diaper and feet -------------------------------------------------------
	add(makePart("Diaper", v(13.4, 3.4, 13.4), at(0, -7.6, 0), DIAPER))
	for _, side in { -1, 1 } do
		add(makePart("Foot", v(4, 2.6, 5.4), at(side * 3.6, -10, -1.6), BROWN))
	end
	add(makePart("Tail", v(2.6, 2.6, 2.6), at(0, -8.6, 7), EAR_YELLOW, Enum.PartType.Ball))

	for _, p in pieces do
		p.Parent = model
	end

	return model
end

--[[
	Builds one Bebeh for an area.
	@param areaIndex  which area this Bebeh belongs to
	@param areaConfig the entry from GameConfig.Areas
	@param pivot      where to stand him, already facing the right way
]]
function BebehBuilder.build(areaIndex: number, areaConfig: any, pivot: CFrame): Model
	local scale = areaConfig.BebehScale

	local model: Model
	local template = ServerStorage:FindFirstChild("BigBebeh")
	if template and template:IsA("Model") then
		model = template:Clone()
		local ok, err = pcall(function()
			model:ScaleTo(scale)
		end)
		if not ok then
			warn(`[BigBebeh] Could not scale ServerStorage.BigBebeh: {err}`)
		end
	else
		model = buildBlockyBebeh(scale)
	end

	model.Name = areaConfig.BebehName
	model:PivotTo(pivot)

	-- Lift him so his feet rest on the platform instead of sinking into it.
	-- Measuring after the move keeps this correct for custom models too.
	local boxCFrame, size = model:GetBoundingBox()
	local bottom = boxCFrame.Position.Y - size.Y / 2
	model:PivotTo(model:GetPivot() + Vector3.new(0, pivot.Position.Y - bottom, 0))
	model:SetAttribute("AreaIndex", areaIndex)

	-- Floating nameplate. The numbers are per-player, so the client fills them in.
	local billboard = Instance.new("BillboardGui")
	billboard.Name = "BebehStatus"
	billboard.Size = UDim2.fromScale(14, 4.2)
	billboard.StudsOffsetWorldSpace = Vector3.new(0, size.Y / 2 + 4 * scale, 0)
	billboard.MaxDistance = 220
	billboard.AlwaysOnTop = false

	local title = Instance.new("TextLabel")
	title.Name = "Title"
	title.Size = UDim2.fromScale(1, 0.42)
	title.BackgroundTransparency = 1
	title.Font = Enum.Font.FredokaOne
	title.Text = areaConfig.BebehName
	title.TextColor3 = Color3.fromRGB(255, 255, 255)
	title.TextStrokeTransparency = 0
	title.TextScaled = true
	title.Parent = billboard

	local status = Instance.new("TextLabel")
	status.Name = "Status"
	status.Position = UDim2.fromScale(0, 0.44)
	status.Size = UDim2.fromScale(1, 0.3)
	status.BackgroundTransparency = 1
	status.Font = Enum.Font.GothamBold
	status.Text = "Bring me cookies!"
	status.TextColor3 = Color3.fromRGB(255, 240, 170)
	status.TextStrokeTransparency = 0.2
	status.TextScaled = true
	status.Parent = billboard

	local barBack = Instance.new("Frame")
	barBack.Name = "BarBack"
	barBack.Position = UDim2.fromScale(0.1, 0.78)
	barBack.Size = UDim2.fromScale(0.8, 0.16)
	barBack.BackgroundColor3 = Color3.fromRGB(30, 30, 40)
	barBack.BorderSizePixel = 0
	barBack.Parent = billboard
	Instance.new("UICorner").Parent = barBack

	local barFill = Instance.new("Frame")
	barFill.Name = "BarFill"
	barFill.Size = UDim2.fromScale(0, 1)
	barFill.BackgroundColor3 = Color3.fromRGB(255, 196, 60)
	barFill.BorderSizePixel = 0
	barFill.Parent = barBack
	Instance.new("UICorner").Parent = barFill

	-- Custom models may not set a PrimaryPart, so fall back to any part.
	local anchorPart = model.PrimaryPart or model:FindFirstChildWhichIsA("BasePart", true)
	billboard.Adornee = anchorPart
	billboard.Parent = anchorPart or model

	CollectionService:AddTag(model, "BigBebeh")
	return model
end

return BebehBuilder
