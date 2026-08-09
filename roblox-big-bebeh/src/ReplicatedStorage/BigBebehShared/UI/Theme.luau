--[[
	Theme — the design tokens every piece of UI reads from.

	Nothing in the interface should hard-code a colour, a font size or a gap.
	They come from here, so the whole game restyles from one file and spacing
	stays consistent instead of drifting a few pixels per screen.

	Three rules this encodes:

	  * One dark ground, a handful of saturated accents. Accents mean something
	    (cookie / sprinkle / rune / good / bad); they are not decoration.
	  * A type scale, not arbitrary sizes. Six steps, each clearly different
	    from its neighbour, so hierarchy reads at a glance.
	  * A 4px spacing grid. Every gap and inset is a multiple of it, which is
	    most of why a layout looks deliberate rather than nudged into place.
]]

local Theme = {}

-- Palette ------------------------------------------------------------------
Theme.color = {
	-- Surfaces, darkest to lightest.
	bg = Color3.fromRGB(14, 13, 21),
	surface = Color3.fromRGB(26, 24, 38),
	surfaceAlt = Color3.fromRGB(38, 35, 54),
	surfaceHi = Color3.fromRGB(52, 48, 72),
	line = Color3.fromRGB(9, 8, 15),

	-- Text ramp.
	text = Color3.fromRGB(245, 243, 252),
	textDim = Color3.fromRGB(152, 147, 174),
	textFaint = Color3.fromRGB(104, 100, 124),

	-- Accents. Each one owns a concept.
	cookie = Color3.fromRGB(255, 199, 74),
	sprinkle = Color3.fromRGB(255, 122, 205),
	rune = Color3.fromRGB(167, 122, 255),
	hunger = Color3.fromRGB(255, 138, 180),

	-- States.
	good = Color3.fromRGB(64, 200, 112),
	warn = Color3.fromRGB(255, 168, 64),
	bad = Color3.fromRGB(226, 74, 92),
	muted = Color3.fromRGB(62, 58, 80),
}

-- Type ---------------------------------------------------------------------
Theme.font = {
	display = Enum.Font.FredokaOne, -- headings, numbers, buttons
	bold = Enum.Font.GothamBold, -- labels that need weight
	body = Enum.Font.GothamMedium, -- descriptions
}

Theme.textSize = {
	xs = 12,
	sm = 14,
	md = 17,
	lg = 22,
	xl = 28,
	xxl = 36,
}

-- Spacing: a 4px grid. `Theme.space(3)` is 12px.
function Theme.space(steps: number): number
	return steps * 4
end

Theme.radius = {
	sm = 8,
	md = 12,
	lg = 16,
}

Theme.stroke = {
	thin = 2,
	thick = 3,
}

-- Motion. Shared curves keep every transition feeling like one product.
Theme.motion = {
	fast = TweenInfo.new(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out),
	normal = TweenInfo.new(0.22, Enum.EasingStyle.Quad, Enum.EasingDirection.Out),
	-- Slight overshoot, for things that should feel springy (pickups, unlocks).
	pop = TweenInfo.new(0.28, Enum.EasingStyle.Back, Enum.EasingDirection.Out),
}

--[[
	How far a surface is lit from the top. UIGradient multiplies the fill, so 1
	leaves a colour untouched and lower values darken. Brightening past 1 is not
	possible -- ColorSequence rejects it -- so the top sits at 1 and the bottom
	carries the shading.
]]
Theme.sheen = {
	panel = 0.82,
	button = 0.76,
	row = 0.9,
}

return Theme
