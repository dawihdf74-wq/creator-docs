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
5. **Upgrade** — spend Sprinkles at the upgrade board or the market stall.
6. **Open runes** — stand on the rune altar for permanent cookie multipliers.
7. **Rebirth** — once BIG BEBEH is full, start over with a permanent multiplier.

| # | Area | Cookie value | Carry capacity | To feed the Bebeh |
|---|------|-------------:|---------------:|------------------:|
| 1 | Cookie Nursery* | 1 | 30 | 60 |
| 2 | Sugar Sandbox | 4 | 120 | 400 |
| 3 | Frosting Fields | 15 | 450 | 1,800 |
| 4 | Choco Chip Canyon | 60 | 1,800 | 9,000 |
| 5 | Golden Crumb Summit | 250 | 7,500 | 45,000 |

\* Zone 1 is a compact 130x130 starter arena rather than the 220x220 the other
zones use. Any area can override `PlatformSize`; bridges are built between real
platform edges, so mixing sizes needs no other change.

## Upgrades

Bought with Sprinkles, earned 1-for-1 for every cookie Big Bebeh eats.

| Upgrade | What it does | Levels | Cost to max |
|---|---|---:|---:|
| 🧤 Bigger Hands | +20% carrying capacity per level | 20 | 105.7K |
| 👟 Sugar Rush | +2 walk speed per level | 15 | 52.4K |
| 🧲 Cookie Magnet | Vacuums cookies from 9 → 36 studs away | 12 | 41.7K |
| ⏱️ Fresh Batch | Cookies respawn faster (5s → 1.4s) | 12 | 62.6K |
| 🍀 Double Chip | +5% chance a cookie counts twice | 10 | 36.3K |

One complete run through all five areas earns about **56K** sprinkles, and maxing
everything costs about **236K** — so it takes roughly four rebirths to finish the
tree. That gap is deliberate: the first upgrade is affordable from area 1 alone,
but no single run can buy out the shop, which is what gives rebirth a point.

## Runes

Zone 1 has a **rune altar**. Stand on the glowing pad and it opens runes by
itself — no button, no cost beyond the time you are not out collecting. The
`✦ RUNES` button opens a menu showing the ladder, how many of each you hold and
what they are worth.

| Rune | Odds | One gives | Maxed at | Maxed gives |
|---|---|---|---:|---|
| Basic Cookie | 1/1 | +x0.1 cookies | 1,000 | +x1 cookies |
| Rare Cookie | 1/7 | +x0.2 cookies | 2,500 | +x2 cookies |

Holding both maxed puts you at **x4 cookies**, stacking on top of the rebirth
multiplier.

The two boost numbers are read exactly as written. A rune declares what ONE is
worth and what a full stack is worth, and `getRuneBoost` solves the curve
between them, so the config reads in the same terms players see. Nothing has to
be hand-tuned when you add a tier — state the two numbers and it fits itself.

Runes also carry effect types the ladder does not use yet — **Rune Luck** (better
odds), **Rune Bulk** (more opens at once) and **Rune Clone** (chance of a double
drop). The plumbing is live, so a future tier only needs an `Effect` field:

```lua
{
    Id = "SkilledCookie", Name = "Skilled Cookie", Odds = 120,
    Effect = "RuneLuck", FirstBoost = 0.05, MaxStack = 500, MaxBoost = 0.5,
    Color = Color3.fromRGB(120, 255, 170),
}
```

Keep `GameConfig.Runes` sorted commonest-first — `rollRune` walks it
rarest-to-commonest and the first tier that hits wins, with the 1/1 tier as the
floor so a roll always yields something.

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

## Seeing the map in Studio

The world is generated when the **server starts**, so in edit mode Workspace is
empty and there is no GUI — client scripts do not run until you press Play. That
is expected, not a bug.

To look at the map while editing, paste `tools/BuildMapInStudio.lua` into
Studio's **Command Bar** (View → Command Bar) and press Enter. The whole map
appears under `Workspace.BigBebehWorld`. Undo removes it.

That preview is only for measuring and positioning: the map is rebuilt from
`GameConfig` on every server start, so anything you place inside `BigBebehWorld`
is discarded when you press Play. To change the map for real, edit `GameConfig`.

Note you do **not** need the map visible to install the Bebeh mesh — importing it
to `ServerStorage` as `BigBebeh` is all that is required, and the game positions
it for you.

## The Blender models

`models/` holds a sculpted Big Bebeh and a sculpted cookie, both generated by
`tools/build_models.py` (a headless Blender script — the `.blend` is included if
you want to open and tweak him).

![Big Bebeh](renders/bebeh-front.png)

| | Objects | Triangles |
|---|---:|---:|
| `BigBebeh.fbx` | 27 | 44,504 |
| `BigBebehCookie.fbx` | 9 | 5,084 |

Every mesh is well under Roblox's 10k-triangles-per-MeshPart limit.

### Importing them

A script cannot upload a mesh to Roblox, but Studio's importer reads a file
straight off disk, so this takes about a minute:

1. **File → Import 3D…**, pick `models/BigBebeh.fbx`.
2. In the import dialog leave the defaults and click **Import**.
3. Drag the resulting model into **ServerStorage** and name it exactly `BigBebeh`.
4. Repeat with `models/BigBebehCookie.fbx`, naming that one `CookieModel`.

Press Play. Every Bebeh in the game becomes the sculpted mesh, and every cookie
becomes the sculpted cookie. Nothing else needs changing.

**A raw import looks huge and grey — that is expected.** Roblox's importer picks
its own unit scale, and FBX material colours are not carried across, so the
MeshParts arrive plain. The game fixes both when it clones him at runtime, so he
is correct the moment you press Play.

If you would rather see him fixed straight away in the editor, paste
`tools/SetupBebehImport.lua` into the Command Bar. It tints every part, rescales
him to the height the game uses, and files him into ServerStorage under the right
name — the same work the game does, just done now so you can look at him.

Two things happen automatically so the import "just works":

- **Colours.** The importer keeps the Blender object names (`Head`, `EarInnerL`,
  `PaciRing`…) on the MeshParts, and `BebehBuilder` tints each one by matching
  the longest name prefix. You never have to colour 27 parts by hand.
- **Scale.** Studio's importer picks its own unit scale, so `normalizeHeight`
  rescales him to a known 33 studs before applying each area's multiplier. He
  comes out the right size whatever the dialog decides.

If you re-export from Blender, keep the object names — they are the contract
between the model and the colouring code.

## Changing how Big Bebeh looks

There are several ways to get a Bebeh, and the game picks the first available:
the `BigBebeh` model in ServerStorage (above), then an image, then parts.

### 1. Your own artwork

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

Put a Model named `BigBebeh` in **ServerStorage**. Each area clones it, tints any
parts whose names it recognises, normalises the height and scales it by that
area's `BebehScale`, so one model covers all five sizes. This beats every other
option — it is also what the Blender import above uses.

### 3. The built-in part model (fallback)

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
