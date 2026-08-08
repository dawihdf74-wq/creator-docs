# Big Bebeh — Cookie Collector 🍪

A complete, playable Roblox game: collect cookies, feed them to Big Bebeh, and
his gate opens so you can reach the next area. Five areas, each with a bigger,
hungrier Bebeh than the last.

The whole map builds itself at runtime from a config file — drop the scripts
into an empty place, press Play, and it works.

## The loop

1. **Collect** — cookies lie scattered around each area. Walk over one to grab it.
2. **Fill up** — your hands only hold so many. The bar at the bottom shows how full you are.
3. **Feed** — stand on the glowing pad in front of Big Bebeh and he eats everything you carry.
4. **Unlock** — fill his hunger bar and the gate behind him opens *for you*, revealing the next area with better cookies and a bigger carrying capacity.

| # | Area | Cookie value | Carry capacity | To feed the Bebeh |
|---|------|-------------:|---------------:|------------------:|
| 1 | Cookie Nursery | 1 | 30 | 60 |
| 2 | Sugar Sandbox | 4 | 120 | 400 |
| 3 | Frosting Fields | 15 | 450 | 1,800 |
| 4 | Choco Chip Canyon | 60 | 1,800 | 9,000 |
| 5 | Golden Crumb Summit | 250 | 7,500 | 45,000 |

## Installing

### Option A — open the place file (easiest)

Download **`BigBebehCookieCollector.rbxlx`** from this folder and either
double-click it, or in Studio use **File → Open from File…** and pick it.
Everything is already wired up — press **Play**.

To put it into a game you are already working on instead, use
**File → Open from File…** to open it as its own place, then copy
`BigBebehShared`, `BigBebehGame` and `BigBebehClient` across.

### Option B — Rojo

```sh
rojo serve   # from this folder, then connect from the Roblox Studio plugin
```

### Option C — by hand in Studio

Create these and paste in the matching file's contents:

| Studio location | Instance | Name | File |
|---|---|---|---|
| `ReplicatedStorage` | Folder | `BigBebehShared` | — |
| `ReplicatedStorage/BigBebehShared` | ModuleScript | `GameConfig` | `src/ReplicatedStorage/BigBebehShared/GameConfig.luau` |
| `ReplicatedStorage/BigBebehShared` | ModuleScript | `Remotes` | `src/ReplicatedStorage/BigBebehShared/Remotes.luau` |
| `ServerScriptService` | **Script** | `BigBebehGame` | `src/ServerScriptService/BigBebehGame/init.server.luau` |
| `ServerScriptService/BigBebehGame` | ModuleScript | `PlayerState` | `src/ServerScriptService/BigBebehGame/PlayerState.luau` |
| `ServerScriptService/BigBebehGame` | ModuleScript | `WorldBuilder` | `src/ServerScriptService/BigBebehGame/WorldBuilder.luau` |
| `ServerScriptService/BigBebehGame` | ModuleScript | `BebehBuilder` | `src/ServerScriptService/BigBebehGame/BebehBuilder.luau` |
| `StarterPlayer/StarterPlayerScripts` | LocalScript | `BigBebehClient` | `src/StarterPlayer/StarterPlayerScripts/BigBebehClient.client.luau` |

`PlayerState`, `WorldBuilder` and `BebehBuilder` go **inside** the `BigBebehGame`
Script as children — that is what `require(script.PlayerState)` refers to.

Then hit Play. The world (platforms, bridges, gates, Bebehs, cookies) is
generated on server start, so you do not need to build anything yourself.

## Using your own Big Bebeh model

The included Bebeh is built from parts to match the reference: brown cube head,
floppy yellow ears, sleepy eyes, blush, a blue bib and a big pacifier. To swap in
your own:

1. Put your model in **ServerStorage** and name it `BigBebeh`.
2. Set its `PrimaryPart` (so it scales and positions cleanly).

Each area clones it and scales it by that area's `BebehScale`, so one model
covers all five sizes.

## Tuning

Everything is in `src/ReplicatedStorage/BigBebehShared/GameConfig.luau`:

- `Areas` — add, remove or reorder areas. The map, gates, cookies and Bebehs all
  follow automatically. Names, colours, cookie values, capacities and hunger
  goals live here.
- `FeedRadius` — how close you must stand to feed him.
- `CookieRespawnTime` — how quickly a collected cookie comes back.
- `SaveEnabled` — set to `false` to disable DataStore saving while testing.

Adding a sixth area is just one more entry in the `Areas` table.

## How it fits together

**Server** (`init.server.luau`) is the authority. It builds the world, spawns
cookies, handles pickups (`Touched`, with a distance sanity check), runs the
auto-feed proximity loop, decides when an area unlocks, and saves progress.

**Client** (`BigBebehClient.client.luau`) draws the HUD, spins the cookies, bobs
the Bebehs, and — importantly — opens gates *locally*. Progress is per-player, so
the gate has to be solid for one player and invisible for another standing right
next to them. The client turns off `CanCollide` only for areas the server has
already told it are unlocked; the server never trusts the client for anything
that matters.

**Saving** uses a DataStore, with everything loaded back through a `sanitize`
pass so an old or corrupt save can never hand a player an out-of-range area or a
negative cookie count. Progress autosaves every two minutes, on leave, and on
server shutdown.

Notes:

- Studio needs **Game Settings → Security → Enable Studio Access to API Services**
  for saving to work locally. Without it the game still runs, just without saves.
- The build deletes the default `Baseplate` and any existing `SpawnLocation` so
  they do not sit in the middle of the generated map.
