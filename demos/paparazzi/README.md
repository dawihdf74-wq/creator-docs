# PAPARAZZI

An original electro-glam single, synthesized live in the browser and cut to a
beat-synced 35 mm film frame. Open `index.html` in any modern browser — it is a
single self-contained file with no build step, no dependencies and no network
requests.

**2:56.** Nothing is sampled, streamed or pre-recorded. The melody, chord
progression, arrangement and lyrics were written for this page; every sound is
generated at play time by the Web Audio API, and every frame is drawn to a
canvas.

## How it works

One clock drives everything. Song position is derived from the `AudioContext`
sample clock, and every visual is a function of that position, so picture and
score cannot drift and seeking stays honest.

| Part | Notes |
| --- | --- |
| Score | 120 BPM, A minor, 88 bars across 8 sections (intro, verse, pre-chorus, chorus, breakdown, bridge, chorus II, outro) |
| Voices | Kick, clap, hats, SLR-shutter percussion, sidechained bass, arp, pad, supersaw lead, riser, sub impact, film-wind texture |
| Effects | Generated 2.6 s convolution reverb, 3/16 delay with feedback, waveshaper drive, bus compression |
| Picture | Step-and-repeat backdrop, sweeping beams, red carpet, a rim-lit figure with a flash-thrown cast shadow, a wall of shooters whose lenses are where the bursts actually originate, film grain and chromatic fringing |
| Frame | The page is a 35 mm still frame on film base — rebate strips carry live edge printing, sprockets wind, and the exposure counter climbs 1 → 36 |

The piece opens as a contact sheet whose twelve thumbnails are real frames:
the scene renderer is run at twelve song times into twelve small picture rects.
Frame 07 is circled in grease pencil and blows up to full bleed on play.

## Accessibility and photosensitivity

The subject is camera flashes, so the page contains repeated bright light.

- **Reduce flashing** (the `✕` button in the transport) damps every burst and
  caps the rate. It is enabled by default when the system reports
  `prefers-reduced-motion`.
- Full-frame exposure lifts are reserved for hero bursts on chorus downbeats —
  roughly 0.25 Hz. The constant patter of smaller bulbs is local to a lens
  rather than full-field. Inverted flash cuts last ~110 ms, one per bar.
- Playback is always user-initiated; nothing moves or sounds until you press
  **Roll film**.

## Controls

| Input | Action |
| --- | --- |
| `Space` / click the frame | Play / pause |
| `←` `→` | Seek 5 s |
| `M` | Mute |
| `F` | Fullscreen |

The scrubber is a native range input, so it is keyboard-operable, and the
section ticks beneath it show the arrangement.

## Rendering

Canvas 2D throughout, DPR-aware, with an adaptive quality path: if the frame
rate drops below ~34 fps the piece sheds a crowd row, thins the particles and
drops the grain pass. Typography is DejaVu Sans Bold (display, optically
condensed on canvas) and DejaVu Sans Mono (utility), subset to the glyphs used
and inlined as WOFF2 — both are under the DejaVu licence, which permits
embedding.
