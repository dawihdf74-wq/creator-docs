# Saturn Paparazzi Journey (v3)

Procedural renderer for the "Paparazzi" planet-journey video: a cinematic
flight from the Sun past Mercury, Venus, Earth, Mars and Jupiter to Saturn,
ending with a continuous dive into Saturn's rings where the **AREAJO**
watermark rises out of the ring plane in 3D.

## What changed vs. v2

- **Smoother travel** — the camera path uses quintic ease-in/ease-out between
  planets, gentler lateral drift, and 2–3 sample motion blur on fast legs, so
  the planet-to-planet moves no longer feel jerky or intense.
- **Reworked Saturn** — fully raytraced sphere + rings: structured C/B/A
  rings with the Cassini division, Encke gap and fine grooves, the planet's
  shadow falling across the rings, ring shadows on the planet, distance fog,
  and a tilted ring plane the camera can fly along.
- **New ending** — after the final "paparazzi" caption the same shot keeps
  going: the camera sinks toward the sunlit ring plane and skims across the
  A ring while the AREAJO letters rise one-by-one out of the rings, catch a
  light glint, hold, and fade out last.
- **Super-realistic planets** — high-res procedural textures: cratered
  Mercury with ejecta rays, swirled Venus cloud bands, Earth with
  domain-warped continents, biomes, cyclonic clouds and a blue atmosphere
  limb, Mars with Valles Marineris / Tharsis volcanoes / polar caps, Jupiter
  with flat turbulent belts, vortex chains and the Great Red Spot.
- Extras: richer starfield + nebula, twinkle, a shooting star, ring dust
  particles streaming past during the dive, bloom, vignette and film grain.

## Usage

```bash
pip install numpy opencv-python-headless pillow imageio imageio-ffmpeg
python3 render_paparazzi_journey.py out.mp4          # full render (~28.6 s)
python3 render_paparazzi_journey.py --stills 22.0,25.4   # quick test frames
```

Output: 1080x1352 @ 30 fps, H.264. Everything (textures, rings, camera path,
captions, watermark timing) is procedural and seeded — tweak the constants at
the top of each section.
