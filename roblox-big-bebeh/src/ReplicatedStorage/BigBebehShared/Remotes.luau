--[[
	Remotes
	Creates the RemoteEvent folder on the server, waits for it on the client.
	require() this from either side and index the events by name.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local FOLDER_NAME = "BigBebehRemotes"
local REMOTE_NAMES = {
	"SyncState", -- server -> client: the player's full progress table
	"Toast", -- server -> client: a short message for the notification stack
	"CookiePop", -- server -> client: "+N" floating text at a world position
	"FeedBurst", -- server -> client: make a Bebeh bounce and spit crumbs
	"BuyUpgrade", -- client -> server: "I want the next level of this upgrade"
	"Rebirth", -- client -> server: "start me over for the multiplier"
}

local folder: Folder

if RunService:IsServer() then
	folder = ReplicatedStorage:FindFirstChild(FOLDER_NAME) :: Folder
	if not folder then
		folder = Instance.new("Folder")
		folder.Name = FOLDER_NAME
		folder.Parent = ReplicatedStorage
	end
	for _, name in REMOTE_NAMES do
		if not folder:FindFirstChild(name) then
			local remote = Instance.new("RemoteEvent")
			remote.Name = name
			remote.Parent = folder
		end
	end
else
	folder = ReplicatedStorage:WaitForChild(FOLDER_NAME) :: Folder
end

local Remotes = {}
for _, name in REMOTE_NAMES do
	Remotes[name] = folder:WaitForChild(name) :: RemoteEvent
end

return Remotes
