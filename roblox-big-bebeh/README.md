# Big Bebeh — Cookie Collector 🍪

A complete, playable Roblox game: collect cookies, feed them to Big Bebeh, and
his gate opens so you can reach the next area. Five areas, each with a bigger,
hungrier Bebeh than the last.

The whole map builds itself at runtime from a config file — drop the scripts
into an empty place, press Play, and it works.

## The loop

1. **Collect** — cookies lie scattered around each area. Walk over one to grab it.
2. **Fill up** — your hands only hold so many. The bar at the bottom shows how full you are.
3. **Feed** — stand on the glowing pad in front of Big Bebeh and he eats everything you carry, paying out **Sprinkles** ✨ as he goes.
4. **Unlock** — fill his hunger bar and the gate behind him opens *for you*, revealing the next area with better cookies and a bigger carrying capacity.
5. **Upgrade** — spend Sprinkles at the market stall on each platform (or the 🛒 button).
6. **Rebirth** — once BIG BEBEH is full, start over with a permanent multiplier.

| # | Area | Cookie value | Carry capacity | To feed the Bebeh |
|---|------|-------------:|---------------:|------------------:|
| 1 | Cookie Nursery | 1 | 30 | 60 |
| 2 | Sugar Sandbox | 4 | 120 | 400 |
| 3 | Frosting Fields | 15 | 450 | 1,800 |
| 4 | Choco Chip Canyon | 60 | 1,800 | 9,000 |
| 5 | Golden Crumb Summit | 250 | 7,500 | 45,000 |

## Upgrades

Bought with Sprinkles, earned 1-for-1 for every cookie Big Bebeh eats.

| Upgrade | What it does | Levels | Cost to max |
|---|---|---:|---:|
| 🧤 Bigger Hands | +20% carrying capacity per level | 20 | 105.7K |
| 👟 Sugar Rush | +2 walk speed per level | 15 | 52.4K |
| 🧲 Cookie Magnet | Vacuums cookies from 9 → 36 studs away | 12 | 41.7K |
| 🍀 Double Chip | +5% chance a cookie counts twice | 10 | 36.3K |

One complete run through all five areas earns about **56K** sprinkles, and maxing
everything costs about **236K** — so it takes roughly four rebirths to finish the
tree. That gap is deliberate: the first upgrade is affordable from area 1 alone,
but no single run can buy out the shop, which is what gives rebirth a point.

## Rebirth

Once BIG BEBEH is completely full, the shop's rebirth button lights up. Rebirthing
resets your areas back to the Cookie Nursery but **keeps every upgrade and
sprinkle**, hands you a 2,500-sprinkle bonus, and permanently multiplies
everything you collect by `1 + 0.5 × rebirths`. Your second run is half again as
fast, your third is twice as fast, and so on.

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

## Changing how Big Bebeh looks

There are three ways to get a Bebeh, and the game picks the first one available.

### 1. Your own artwork (easiest)

Roblox will not let a script upload an image — asset ids only exist once *you*
have uploaded the file to *your* account. Once you have, it is a one-line change.

1. Go to [create.roblox.com](https://create.roblox.com) → **Development Items →
   Decals** → **Upload Decal**, and upload your picture.
2. Open the decal you just uploaded and copy the number out of its URL.
3. In `GameConfig.luau`, set:

   ```lua
   GameConfig.BebehImageId = "rbxassetid://123456789"
   ```

Every Bebeh becomes a cutout of your image, printed on both faces and scaled per
area. If it comes out stretched, adjust `GameConfig.BebehImageAspect` to your
image's real width ÷ height.

> Moderation usually takes a minute or two, and a brand-new decal id renders
> blank until it clears. If the cutout is invisible, wait and rejoin before
> assuming the id is wrong.

### 2. A model you built

Put a Model named `BigBebeh` in **ServerStorage** and set its `PrimaryPart`. Each
area clones and scales it by that area's `BebehScale`, so one model covers all
five sizes. This beats both other options.

### 3. The built-in part model (default)

Roblox has no rounded-box primitive, so every chunky shape on him is assembled
the way modelling packages do it — a core of slabs, cylinders along each edge and
spheres at each corner. That is what stops him reading as a stack of bricks. He
comes out at 159 parts: rounded head, two-segment floppy ears with inner shading,
sleepy eyes drawn as an arc of beads, blush, a bib with shoulder straps and a
bow, a pacifier whose ring is a twelve-bead torus, plus diaper, feet and tail.

A single invisible box does all the colliding, so players bump into a clean shape
instead of snagging on ears and pacifier beads.

## Tuning

Everything is in `src/ReplicatedStorage/BigBebehShared/GameConfig.luau`:

- `Areas` — add, remove or reorder areas. The map, gates, cookies, shops and
  Bebehs all follow automatically. Names, colours, cookie values, capacities and
  hunger goals live here.
- `Upgrades` — each entry's `BaseCost` and `CostMultiplier` set the curve;
  `MaxLevel` caps it. Add an entry and a new shop row appears by itself, though a
  brand-new upgrade id also needs its effect wiring up in the helpers below the
  table.
- `SprinklesPerCookieFed` / `RebirthMultiplierPerLevel` — the economy dials.
- `FeedRadius` — how close you must stand to feed him.
- `CookieRespawnTime` — how quickly a collected cookie comes back.
- `SaveEnabled` — set to `false` to disable DataStore saving while testing.

Adding a sixth area is just one more entry in the `Areas` table.

Note that the DataStore key is `BigBebehCookies_v2`. Saves written by the earlier
version load fine — missing upgrade fields default to zero — but if you want a
clean slate, bump the name again.

## How it fits together

**Server** (`init.server.luau`) is the authority. It builds the world, spawns
cookies, handles pickups (`Touched`, with a distance sanity check), runs the
auto-feed and magnet proximity loops, prices and applies upgrades, decides when
an area unlocks, and saves progress. The client never sends a number — it asks
for an upgrade *by id* and the server looks up what that costs.

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
