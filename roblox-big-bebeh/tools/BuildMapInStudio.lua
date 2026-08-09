--[[
	Build the map in Studio's EDIT mode.

	The world is generated at runtime, so in edit mode Workspace is empty and
	there is nothing to look at or place things against. Paste this whole file
	into Studio's Command Bar (View -> Command Bar) and press Enter, and the map
	appears exactly as it does in game.

	The map is regenerated on every server start, so anything you build inside
	Workspace.BigBebehWorld is thrown away when you press Play. Treat what this
	produces as a preview for measuring and positioning -- to change the map for
	real, edit GameConfig and run this again.

	Undo (Ctrl+Z) removes it, or just delete the BigBebehWorld folder.
]]

local ServerScriptService = game:GetService("ServerScriptService")

local gameFolder = ServerScriptService:FindFirstChild("BigBebehGame")
if not gameFolder then
	warn("[BigBebeh] ServerScriptService.BigBebehGame is missing — is the place set up?")
	return
end

local worldBuilder = gameFolder:FindFirstChild("WorldBuilder")
if not worldBuilder then
	warn("[BigBebeh] BigBebehGame.WorldBuilder is missing.")
	return
end

local ok, err = pcall(function()
	require(worldBuilder).build()
end)

if ok then
	print("[BigBebeh] Map built. Look in Workspace.BigBebehWorld.")
	print("[BigBebeh] Reminder: this preview is replaced when you press Play.")
else
	warn("[BigBebeh] Build failed: " .. tostring(err))
end
