--[[
	Components — the primitives every screen is built from.

	One definition per widget. A panel looks the same everywhere because there
	is exactly one function that makes panels, not thirty hand-set Frames that
	drifted apart.

	Every constructor takes (parent, props) and returns the instance. Props are
	applied last so a caller can override anything, and parenting happens inside
	so it can never be forgotten.
]]

local TweenService = game:GetService("TweenService")

local Theme = require(script.Parent.Theme)

local Components = {}

-- Internals ----------------------------------------------------------------

local function apply(instance: Instance, props: { [string]: any }?)
	if not props then
		return instance
	end
	for key, value in props do
		(instance :: any)[key] = value
	end
	return instance
end

local function round(instance: Instance, radius: number)
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, radius)
	c.Parent = instance
	return c
end

local function outline(instance: Instance, thickness: number, color: Color3?)
	local s = Instance.new("UIStroke")
	s.Thickness = thickness
	s.Color = color or Theme.color.line
	s.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	s.Parent = instance
	return s
end

--[[
	Top-down sheen. Values are clamped because ColorSequence rejects anything
	outside 0-1 and one out-of-range value takes down the whole script.
]]
local function sheen(instance: Instance, bottom: number)
	local function grey(v: number)
		local c = math.clamp(v, 0, 1)
		return Color3.new(c, c, c)
	end
	local g = Instance.new("UIGradient")
	g.Color = ColorSequence.new({
		ColorSequenceKeypoint.new(0, grey(1)),
		ColorSequenceKeypoint.new(1, grey(bottom)),
	})
	g.Rotation = 90
	g.Parent = instance
	return g
end

Components.round = round
Components.outline = outline
Components.sheen = sheen

-- Layout helpers -----------------------------------------------------------

function Components.padding(parent: Instance, steps: number)
	local pad = Instance.new("UIPadding")
	local amount = UDim.new(0, Theme.space(steps))
	pad.PaddingTop = amount
	pad.PaddingBottom = amount
	pad.PaddingLeft = amount
	pad.PaddingRight = amount
	pad.Parent = parent
	return pad
end

function Components.list(parent: Instance, gapSteps: number, horizontal: boolean?)
	local layout = Instance.new("UIListLayout")
	layout.Padding = UDim.new(0, Theme.space(gapSteps))
	layout.FillDirection = horizontal and Enum.FillDirection.Horizontal or Enum.FillDirection.Vertical
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Parent = parent
	return layout
end

-- Widgets ------------------------------------------------------------------

function Components.label(parent: Instance, props: { [string]: any }?): TextLabel
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Font = Theme.font.bold
	label.TextColor3 = Theme.color.text
	label.TextSize = Theme.textSize.md
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.RichText = true
	apply(label, props)
	label.Parent = parent
	return label
end

function Components.panel(parent: Instance, props: { [string]: any }?): Frame
	local frame = Instance.new("Frame")
	frame.BackgroundColor3 = Theme.color.surface
	frame.BorderSizePixel = 0
	apply(frame, props)
	frame.Parent = parent
	round(frame, Theme.radius.lg)
	outline(frame, Theme.stroke.thick)
	sheen(frame, Theme.sheen.panel)
	return frame
end

-- A compact stat readout: coloured icon, then a value. Used for currencies.
function Components.pill(parent: Instance, config: {
	icon: string,
	color: Color3,
	text: string?,
	props: { [string]: any }?,
}): (Frame, TextLabel)
	local frame = Instance.new("Frame")
	frame.BackgroundColor3 = Theme.color.surface
	frame.BorderSizePixel = 0
	frame.Size = UDim2.new(0, 196, 0, 44)
	apply(frame, config.props)
	frame.Parent = parent
	round(frame, Theme.radius.md)
	outline(frame, Theme.stroke.thick)
	sheen(frame, Theme.sheen.panel)

	-- A colour chip carries the identity, so the value can stay plain white and
	-- readable rather than tinted to the point of poor contrast.
	local chip = Instance.new("Frame")
	chip.Size = UDim2.new(0, 30, 0, 30)
	chip.Position = UDim2.new(0, Theme.space(2), 0.5, -15)
	chip.BackgroundColor3 = config.color
	chip.BorderSizePixel = 0
	chip.Parent = frame
	round(chip, Theme.radius.sm)
	sheen(chip, 0.8)

	Components.label(chip, {
		Size = UDim2.fromScale(1, 1),
		Font = Theme.font.display,
		Text = config.icon,
		TextSize = Theme.textSize.md,
		TextXAlignment = Enum.TextXAlignment.Center,
	})

	local value = Components.label(frame, {
		Name = "Value",
		Position = UDim2.new(0, Theme.space(11), 0, 0),
		Size = UDim2.new(1, -Theme.space(13), 1, 0),
		Font = Theme.font.display,
		Text = config.text or "0",
		TextSize = Theme.textSize.lg,
		TextStrokeTransparency = 0.4,
	})

	return frame, value
end

--[[
	A progress bar. Returns a setter rather than the fill frame, so callers deal
	in a 0-1 ratio and cannot forget to clamp it.
]]
function Components.bar(parent: Instance, config: {
	color: Color3,
	height: number?,
	props: { [string]: any }?,
}): (Frame, (number, Color3?) -> ())
	local track = Instance.new("Frame")
	track.BackgroundColor3 = Theme.color.bg
	track.BorderSizePixel = 0
	track.Size = UDim2.new(1, 0, 0, config.height or 12)
	apply(track, config.props)
	track.Parent = parent
	round(track, Theme.radius.sm)
	outline(track, Theme.stroke.thin, Theme.color.surfaceHi)

	local fill = Instance.new("Frame")
	fill.Name = "Fill"
	fill.Size = UDim2.fromScale(0, 1)
	fill.BackgroundColor3 = config.color
	fill.BorderSizePixel = 0
	fill.Parent = track
	round(fill, Theme.radius.sm)
	sheen(fill, 0.78)

	local function set(ratio: number, color: Color3?)
		local clamped = math.clamp(ratio, 0, 1)
		TweenService:Create(fill, Theme.motion.normal, { Size = UDim2.fromScale(clamped, 1) }):Play()
		if color then
			fill.BackgroundColor3 = color
		end
	end

	return track, set
end

function Components.button(parent: Instance, config: {
	text: string,
	color: Color3?,
	props: { [string]: any }?,
	onClick: (() -> ())?,
}): TextButton
	local button = Instance.new("TextButton")
	button.BackgroundColor3 = config.color or Theme.color.good
	button.BorderSizePixel = 0
	button.AutoButtonColor = true
	button.Font = Theme.font.display
	button.TextColor3 = Theme.color.text
	button.TextSize = Theme.textSize.lg
	button.Text = config.text
	button.Size = UDim2.new(0, 140, 0, 48)
	apply(button, config.props)
	button.Parent = parent
	round(button, Theme.radius.md)
	outline(button, Theme.stroke.thick)
	sheen(button, Theme.sheen.button)

	--[[
		A press should feel like a press. The rest size is captured once: reading
		button.Size at click time would measure a half-finished tween and the
		button would creep smaller with every press.
	]]
	local restSize = button.Size
	local pressedSize = restSize - UDim2.fromOffset(0, 3)
	button.MouseButton1Down:Connect(function()
		TweenService:Create(button, Theme.motion.fast, { Size = pressedSize }):Play()
	end)
	local function release()
		TweenService:Create(button, Theme.motion.fast, { Size = restSize }):Play()
	end
	button.MouseButton1Up:Connect(release)
	button.MouseLeave:Connect(release)

	if config.onClick then
		button.Activated:Connect(config.onClick)
	end
	return button
end

return Components
