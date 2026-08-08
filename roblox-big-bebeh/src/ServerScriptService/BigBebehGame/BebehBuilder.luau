--[[
	BebehBuilder
	Builds Big Bebeh: a chunky rounded brown head, long floppy yellow ears,
	sleepy arced eyes, blushy cheeks, a blue bib and a big blue pacifier.

	Three ways to get a Bebeh, in priority order:
	  1. A Model named "BigBebeh" in ServerStorage — cloned and scaled. This is
	     what you get after importing models/BigBebeh.fbx (see the README).
	  2. GameConfig.BebehImageId — a flat cutout of your own artwork.
	  3. Otherwise, the part-built one below.

	Roblox has no rounded-box primitive, so the chunky shapes here are built the
	way modelling packages do it: a core of slabs, cylinders along the edges and
	spheres at the corners. That is what stops him reading as a stack of bricks.
]]

local CollectionService = game:GetService("CollectionService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")

local GameConfig = require(ReplicatedStorage.BigBebehShared.GameConfig)

local BebehBuilder = {}

local BROWN = Color3.fromRGB(150, 104, 66)
local BROWN_DARK = Color3.fromRGB(106, 68, 40)
local EAR_YELLOW = Color3.fromRGB(247, 226, 30)
local EAR_YELLOW_DARK = Color3.fromRGB(222, 188, 18)
local BIB_BLUE = Color3.fromRGB(108, 204, 238)
local BIB_BLUE_LIGHT = Color3.fromRGB(132, 215, 243)
local PACI_BLUE = Color3.fromRGB(48, 128, 222)
local PACI_KNOB = Color3.fromRGB(104, 186, 246)
local PACI_PURPLE = Color3.fromRGB(134, 106, 205)
local BLUSH = Color3.fromRGB(226, 118, 104)
local DIAPER = Color3.fromRGB(248, 246, 240)
local INK = Color3.fromRGB(20, 18, 18)

-- How tall an imported Bebeh should stand at BebehScale = 1. The part-built one
-- is about this height, so the feed radius and camera framing stay tuned.
local IMPORT_TARGET_HEIGHT = 33

--[[
	Colours for an imported mesh, keyed by the object names the Blender script
	uses. Roblox's 3D importer carries those names onto the MeshParts, so a
	freshly imported model can be tinted without anyone editing it by hand.
	Longest prefix wins, so "EarInner" beats "Ear" and "HeadSide" beats "Head".
]]
local MESH_COLORS: { [string]: Color3 } = {
	Head = BROWN,
	HeadSide = BROWN_DARK,
	Stripe = EAR_YELLOW,
	Ear = EAR_YELLOW,
	EarInner = EAR_YELLOW_DARK,
	Eye = INK,
	Blush = BLUSH,
	Bib = BIB_BLUE,
	Bow = BIB_BLUE_LIGHT,
	PaciShield = PACI_BLUE,
	PaciDot = Color3.fromRGB(36, 104, 178),
	PaciKnob = PACI_KNOB,
	PaciRing = PACI_PURPLE,
	Diaper = DIAPER,
	Foot = BROWN,
	Tail = EAR_YELLOW,
	CookieBase = Color3.fromRGB(210, 154, 92),
	CookieChip = Color3.fromRGB(72, 42, 26),
}

local MESH_COLOR_KEYS: { string } = {}
for key in MESH_COLORS do
	table.insert(MESH_COLOR_KEYS, key)
end
table.sort(MESH_COLOR_KEYS, function(a, b)
	return #a > #b
end)

function BebehBuilder.colorFor(partName: string): Color3?
	for _, key in MESH_COLOR_KEYS do
		if string.sub(partName, 1, #key) == key then
			return MESH_COLORS[key]
		end
	end
	return nil
end

--[[
	Tints every part of an imported model by name and makes it inert: nothing
	collides or fires touch events, because the caller adds one clean collider.
	Returns how many parts were recognised, so a mismatched model can be spotted.
]]
function BebehBuilder.styleImported(model: Model): number
	local matched = 0
	for _, part in model:GetDescendants() do
		if part:IsA("BasePart") then
			part.Anchored = true
			part.CanCollide = false
			part.CanTouch = false
			part.CanQuery = false
			part.Material = Enum.Material.SmoothPlastic
			local color = BebehBuilder.colorFor(part.Name)
			if color then
				part.Color = color
				matched += 1
			end
		end
	end
	return matched
end

--[[
	Rescales a model so it stands `targetHeight` studs tall, then applies the
	area's own multiplier. Studio's 3D importer picks its own unit scale, so
	without this an imported Bebeh could arrive any size at all.
]]
function BebehBuilder.normalizeHeight(model: Model, targetHeight: number, scale: number)
	local ok = pcall(function()
		model:ScaleTo(1)
	end)
	if not ok then
		return
	end
	local _, size = model:GetBoundingBox()
	if size.Y <= 0.001 then
		return
	end
	pcall(function()
		model:ScaleTo((targetHeight / size.Y) * scale)
	end)
end

--[[
	Collects parts as we go. Every piece is authored around the origin with the
	face pointing down -Z, then the whole model is moved into place at the end.
]]
local function newBuilder(scale: number)
	local pieces: { Part } = {}

	local function s(n: number)
		return n * scale
	end

	local function add(name: string, size: Vector3, cf: CFrame, color: Color3, shape: Enum.PartType?, material: Enum.Material?): Part
		local p = Instance.new("Part")
		p.Name = name
		p.Size = size
		p.CFrame = cf
		p.Color = color
		p.Shape = shape or Enum.PartType.Block
		p.Material = material or Enum.Material.SmoothPlastic
		p.Anchored = true
		p.CanCollide = false
		p.CanTouch = false
		p.CanQuery = false
		p.TopSurface = Enum.SurfaceType.Smooth
		p.BottomSurface = Enum.SurfaceType.Smooth
		table.insert(pieces, p)
		return p
	end

	-- A box with every edge and corner rounded off: 3 slabs + 12 edges + 8 corners.
	local function roundedBox(name: string, size: Vector3, cf: CFrame, color: Color3, radius: number, material: Enum.Material?)
		local r = math.min(radius, size.X / 2, size.Y / 2, size.Z / 2)
		local ix, iy, iz = size.X - 2 * r, size.Y - 2 * r, size.Z - 2 * r
		local d = r * 2

		add(name, Vector3.new(size.X, iy, iz), cf, color, nil, material)
		add(name, Vector3.new(ix, size.Y, iz), cf, color, nil, material)
		add(name, Vector3.new(ix, iy, size.Z), cf, color, nil, material)

		for _, a in { -1, 1 } do
			for _, b in { -1, 1 } do
				-- Edges running along X, then Y, then Z.
				add(name, Vector3.new(ix, d, d), cf * CFrame.new(0, a * iy / 2, b * iz / 2), color, Enum.PartType.Cylinder, material)
				add(
					name,
					Vector3.new(iy, d, d),
					cf * CFrame.new(a * ix / 2, 0, b * iz / 2) * CFrame.Angles(0, 0, math.rad(90)),
					color,
					Enum.PartType.Cylinder,
					material
				)
				add(
					name,
					Vector3.new(iz, d, d),
					cf * CFrame.new(a * ix / 2, b * iy / 2, 0) * CFrame.Angles(0, math.rad(90), 0),
					color,
					Enum.PartType.Cylinder,
					material
				)
			end
		end

		for _, a in { -1, 1 } do
			for _, b in { -1, 1 } do
				for _, c in { -1, 1 } do
					add(
						name,
						Vector3.new(d, d, d),
						cf * CFrame.new(a * ix / 2, b * iy / 2, c * iz / 2),
						color,
						Enum.PartType.Ball,
						material
					)
				end
			end
		end
	end

	-- A flat slab with only its outline rounded — for ears, bibs and stripes.
	local function roundedPlate(name: string, size: Vector3, cf: CFrame, color: Color3, radius: number, material: Enum.Material?)
		local r = math.min(radius, size.X / 2, size.Y / 2)
		local ix, iy = size.X - 2 * r, size.Y - 2 * r
		local d = r * 2

		add(name, Vector3.new(size.X, iy, size.Z), cf, color, nil, material)
		add(name, Vector3.new(ix, size.Y, size.Z), cf, color, nil, material)
		for _, a in { -1, 1 } do
			for _, b in { -1, 1 } do
				add(
					name,
					Vector3.new(size.Z, d, d),
					cf * CFrame.new(a * ix / 2, b * iy / 2, 0) * CFrame.Angles(0, math.rad(90), 0),
					color,
					Enum.PartType.Cylinder,
					material
				)
			end
		end
	end

	return {
		pieces = pieces,
		s = s,
		add = add,
		roundedBox = roundedBox,
		roundedPlate = roundedPlate,
	}
end

local function buildBlockyBebeh(scale: number): Model
	local model = Instance.new("Model")
	local b = newBuilder(scale)
	local s, add = b.s, b.add

	local function at(x: number, y: number, z: number)
		return CFrame.new(s(x), s(y), s(z))
	end
	local function v(x: number, y: number, z: number)
		return Vector3.new(s(x), s(y), s(z))
	end

	local faceZ = -6.5 -- the front plane of the head

	-- Head -------------------------------------------------------------------
	b.roundedBox("Head", v(14, 13, 13), at(0, 0, 0), BROWN, s(2.6))

	-- Shading down his left side, and the yellow stripe from the reference.
	b.roundedPlate("SideShade", v(9, 11, 0.4), at(-7.05, 0, 0) * CFrame.Angles(0, math.rad(90), 0), BROWN_DARK, s(1.5))
	b.roundedPlate("Stripe", v(9.4, 3.2, 0.4), at(-7.15, 0.4, 0.6) * CFrame.Angles(0, math.rad(90), 0), EAR_YELLOW, s(1.4))

	-- Ears -------------------------------------------------------------------
	-- Two segments each so they taper and flop outward instead of standing stiff.
	for _, side in { -1, 1 } do
		local root = at(side * 3.4, 6.2, 0.4) * CFrame.Angles(math.rad(-10), 0, math.rad(side * 34))
		b.roundedPlate("Ear", v(3.4, 9, 1.1), root * CFrame.new(0, s(4.2), 0), EAR_YELLOW, s(1.5))
		-- The outer half bends a little further out, giving the floppy silhouette.
		local tip = root * CFrame.new(0, s(8.4), 0) * CFrame.Angles(0, 0, math.rad(side * 12))
		b.roundedPlate("EarTip", v(2.6, 7, 1.05), tip * CFrame.new(0, s(3.2), 0), EAR_YELLOW, s(1.2))
		b.roundedPlate("EarInner", v(1.5, 5.2, 0.3), root * CFrame.new(0, s(4.6), s(-0.5)), EAR_YELLOW_DARK, s(0.7))
	end

	-- Eyes -------------------------------------------------------------------
	-- Sleepy closed eyes, drawn as an arc of beads peaking in the middle.
	for _, side in { -1, 1 } do
		for i = 0, 6 do
			local t = (i / 6) * 2 - 1
			add(
				"Eye",
				v(0.9, 0.9, 0.5),
				at(side * 3.7 + t * 2.0, 2.5 - 1.35 * t * t, faceZ - 0.05),
				INK,
				Enum.PartType.Ball
			)
		end
	end

	-- Blush ------------------------------------------------------------------
	for _, side in { -1, 1 } do
		local cheek = add("Blush", v(3.8, 2.3, 0.9), at(side * 4.7, -0.4, faceZ), BLUSH, Enum.PartType.Ball)
		cheek.Transparency = 0.4
	end

	-- Bib --------------------------------------------------------------------
	b.roundedPlate("Bib", v(13, 4.6, 0.8), at(0, -4.3, faceZ - 0.25), BIB_BLUE, s(2))
	-- Shoulder straps sweeping up either side.
	for _, side in { -1, 1 } do
		b.roundedPlate(
			"BibStrap",
			v(3.4, 4.6, 0.8),
			at(side * 6.1, -2.2, faceZ - 0.25) * CFrame.Angles(0, 0, math.rad(side * -28)),
			BIB_BLUE,
			s(1.4)
		)
	end
	-- Bow.
	for _, side in { -1, 1 } do
		b.roundedPlate(
			"BowLoop",
			v(2.6, 1.9, 0.7),
			at(side * 1.9, -5.9, faceZ - 0.7) * CFrame.Angles(0, 0, math.rad(side * 20)),
			BIB_BLUE_LIGHT,
			s(0.85)
		)
	end
	add("BowKnot", v(1.3, 1.3, 1.3), at(0, -5.8, faceZ - 0.85), BIB_BLUE_LIGHT, Enum.PartType.Ball)

	-- Pacifier ---------------------------------------------------------------
	add("PaciShield", v(6, 4, 1.8), at(0, -2.3, faceZ - 0.8), PACI_BLUE, Enum.PartType.Ball)
	add("PaciKnob", v(3, 3, 2.6), at(0, -2.1, faceZ - 1.9), PACI_KNOB, Enum.PartType.Ball)
	-- The ring is a circle of beads, which reads as a torus from any angle.
	for i = 0, 11 do
		local angle = (i / 12) * math.pi * 2
		add(
			"PaciRing",
			v(1.05, 1.05, 1.05),
			at(0, -3.5, faceZ - 2.7) * CFrame.new(math.cos(angle) * s(1.9), math.sin(angle) * s(1.9), 0),
			PACI_PURPLE,
			Enum.PartType.Ball
		)
	end

	-- Body -------------------------------------------------------------------
	b.roundedBox("Diaper", v(13.2, 4, 13.2), at(0, -7.8, 0), DIAPER, s(1.8))
	for _, side in { -1, 1 } do
		add("Foot", v(4.4, 2.8, 5.8), at(side * 3.5, -10.2, -1.8), BROWN, Enum.PartType.Ball)
	end
	add("Tail", v(3, 3, 3), at(0, -8.4, 7.2), EAR_YELLOW, Enum.PartType.Ball)

	-- One invisible box does all the colliding, so players bump into a clean
	-- shape instead of catching on ears and pacifier beads.
	local collider = add("Collider", v(14.5, 22, 14), at(0, -4, 0), BROWN)
	collider.Transparency = 1
	collider.CanCollide = true
	collider.CanQuery = true
	model.PrimaryPart = collider

	for _, p in b.pieces do
		p.Parent = model
	end
	return model
end

-- A flat cutout of the user's own artwork, printed on both faces.
local function buildImageBebeh(scale: number, imageId: string): Model
	local model = Instance.new("Model")

	local height = 24 * scale
	local width = height * GameConfig.BebehImageAspect

	local board = Instance.new("Part")
	board.Name = "Bebeh"
	board.Size = Vector3.new(width, height, 0.6)
	board.CFrame = CFrame.new(0, 0, 0)
	board.Anchored = true
	board.CanCollide = true
	board.CanTouch = false
	board.Transparency = 1 -- decals still draw on an invisible part
	board.Parent = model
	model.PrimaryPart = board

	for _, face in { Enum.NormalId.Front, Enum.NormalId.Back } do
		local decal = Instance.new("Decal")
		decal.Texture = imageId
		decal.Face = face
		decal.Parent = board
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
	local imported = false
	local template = ServerStorage:FindFirstChild("BigBebeh")
	if template and template:IsA("Model") then
		model = template:Clone()
		imported = true
		if BebehBuilder.styleImported(model) == 0 then
			warn("[BigBebeh] Imported model had no recognisable part names; leaving its colours alone.")
		end
		BebehBuilder.normalizeHeight(model, IMPORT_TARGET_HEIGHT, scale)
	elseif GameConfig.BebehImageId ~= "" then
		model = buildImageBebeh(scale, GameConfig.BebehImageId)
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

	-- An imported mesh has no collider of its own, and letting every ear and
	-- pacifier bead collide would snag players. One clean box around the body
	-- does the job, and doubles as a stable PrimaryPart for the animation.
	if imported then
		local box, bodySize = model:GetBoundingBox()
		local collider = Instance.new("Part")
		collider.Name = "Collider"
		collider.Size = Vector3.new(bodySize.X * 0.5, bodySize.Y * 0.66, bodySize.Z * 0.6)
		collider.CFrame = CFrame.new(box.Position - Vector3.new(0, bodySize.Y * 0.15, 0))
		collider.Anchored = true
		collider.Transparency = 1
		collider.CanCollide = true
		collider.CanTouch = false
		collider.Parent = model
		model.PrimaryPart = collider
	end

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
