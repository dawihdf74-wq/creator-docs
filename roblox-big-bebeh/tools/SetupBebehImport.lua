--[[
	Fix a freshly imported Big Bebeh: colour it, resize it, and file it away.

	Roblox's 3D importer drops the mesh in at whatever unit scale it picked and
	leaves every MeshPart plain grey, because FBX material colours are not
	carried across. The game fixes both when it clones him at runtime, so a raw
	import looking huge and grey is expected -- but you cannot see whether the
	import worked until you press Play.

	This does the same work immediately: tints each part by name, rescales him to
	the height the game uses, and moves him to ServerStorage under the name the
	game looks for.

	Paste into Studio's Command Bar (View -> Command Bar) and press Enter.
]]

local ServerScriptService = game:GetService("ServerScriptService")
local ServerStorage = game:GetService("ServerStorage")

local TARGET_HEIGHT = 33 -- matches BebehBuilder.IMPORT_TARGET_HEIGHT

local gameFolder = ServerScriptService:FindFirstChild("BigBebehGame")
local builderModule = gameFolder and gameFolder:FindFirstChild("BebehBuilder")
if not builderModule then
	warn("[BigBebeh] Cannot find ServerScriptService.BigBebehGame.BebehBuilder.")
	return
end

local BebehBuilder = require(builderModule)

-- A Bebeh is any model holding parts whose names the colour table recognises.
local function looksLikeBebeh(model: Instance): boolean
	if not model:IsA("Model") then
		return false
	end
	for _, part in model:GetDescendants() do
		if part:IsA("BasePart") and BebehBuilder.colorFor(part.Name) then
			return true
		end
	end
	return false
end

local target = ServerStorage:FindFirstChild("BigBebeh")
if not target then
	for _, child in workspace:GetChildren() do
		if looksLikeBebeh(child) then
			target = child
			break
		end
	end
end

if not target then
	warn("[BigBebeh] No imported Bebeh found in Workspace or ServerStorage.")
	warn("[BigBebeh] Import models/BigBebeh.fbx first (File -> Import 3D), then run this again.")
	return
end

local matched = BebehBuilder.styleImported(target)
if matched == 0 then
	warn("[BigBebeh] None of the part names were recognised, so colours were left alone.")
	warn("[BigBebeh] The importer may have merged the meshes -- re-import without merging.")
end

BebehBuilder.normalizeHeight(target, TARGET_HEIGHT, 1)

local _, size = target:GetBoundingBox()
target.Name = "BigBebeh"
target.Parent = ServerStorage

print(string.format("[BigBebeh] Coloured %d parts and resized to %.1f studs tall.", matched, size.Y))
print("[BigBebeh] Moved to ServerStorage as 'BigBebeh'. Press Play and he is in the game.")
print("[BigBebeh] To look at him now, drag BigBebeh from ServerStorage into Workspace.")
