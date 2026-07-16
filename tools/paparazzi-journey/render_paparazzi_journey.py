#!/usr/bin/env python3
"""
Saturn Paparazzi Journey v3
A cinematic flight from the Sun to Saturn set to "Paparazzi" lyrics,
ending with a dive into Saturn's rings where the AREAJO watermark
rises out of the ring plane.

Renders 1080x1352 @ 30fps with:
  - smooth eased camera moves + motion blur on travel legs
  - procedural planet textures (craters, bands, continents, red spot)
  - raytraced Saturn: structured rings (C/B/Cassini/A/Encke/F),
    planet shadow on rings, ring shadow on planet, distance fog
  - continuous dive into the ring plane, 3D watermark reveal + glint
"""
import numpy as np
import cv2
import math
import sys
import os
from PIL import Image, ImageDraw, ImageFont

# ----------------------------------------------------------------------------
W, H = 1080, 1352
FPS = 30
FOCAL = 1150.0
DUR = 28.6
CX, CY = W / 2.0, H / 2.0

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_SERIF_IT = "/usr/share/fonts/truetype/liberation/LiberationSerif-BoldItalic.ttf"

F32 = np.float32

# ----------------------------------------------------------------------------
# math helpers
def clamp01(x):
    return np.clip(x, 0.0, 1.0)

def smootherstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * x * (x * (x * 6.0 - 15.0) + 10.0)

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0 + 1e-9), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)

def norm(v):
    return v / (np.linalg.norm(v) + 1e-12)

# ----------------------------------------------------------------------------
# noise
def value_noise(h, w, freq_y, freq_x, seed):
    r = np.random.default_rng(seed)
    g = r.random((freq_y + 1, freq_x + 1)).astype(F32)
    g[:, -1] = g[:, 0]  # horizontal wrap for equirect
    return cv2.resize(g, (w, h), interpolation=cv2.INTER_CUBIC)

def fbm(h, w, base=4, octaves=6, seed=0, gain=0.5):
    out = np.zeros((h, w), F32)
    amp, fy, fx, tot = 1.0, base, base * 2, 0.0
    for o in range(octaves):
        out += amp * value_noise(h, w, min(int(fy), h // 2),
                                 min(int(fx), w // 2), seed * 101 + o)
        tot += amp
        amp *= gain
        fy *= 2
        fx *= 2
    return out / tot

def fbm1d(n, base=6, octaves=6, seed=0, gain=0.55):
    r = np.random.default_rng(seed)
    out = np.zeros(n, F32)
    amp, f, tot = 1.0, base, 0.0
    x = np.linspace(0, 1, n)
    for o in range(octaves):
        k = int(f) + 1
        g = r.random(k + 1).astype(F32)
        out += amp * np.interp(x * k, np.arange(k + 1), g).astype(F32)
        tot += amp
        amp *= gain
        f *= 2
    return out / tot

# ----------------------------------------------------------------------------
# planet textures  (equirect, HxWx3 float 0..1)
TH, TW = 1200, 2400

def warp_noise(base_field, wx, wy, amt):
    """domain-warp a field by two noise fields (wraps horizontally)."""
    xx, yy = np.meshgrid(np.arange(TW, dtype=F32), np.arange(TH, dtype=F32))
    mx = xx + (wx - 0.5) * amt
    my = yy + (wy - 0.5) * amt
    return cv2.remap(base_field, mx, my, cv2.INTER_LINEAR,
                     borderMode=cv2.BORDER_WRAP)

def swirl_apply(field, centers):
    """rotate the field locally around vortex centers (cx,cy,rad,strength)."""
    xx, yy = np.meshgrid(np.arange(TW, dtype=F32), np.arange(TH, dtype=F32))
    mx = xx.copy()
    my = yy.copy()
    for (cx, cy, rad, k) in centers:
        dx = xx - cx
        dy = (yy - cy) * 2.2  # squash vertically -> oval storms
        d2 = (dx * dx + dy * dy) / (rad * rad)
        m = np.exp(-d2).astype(F32)
        ang = k * m
        ca, sa = np.cos(ang), np.sin(ang)
        mx += (dx * ca - dy * sa - dx) * m
        my += ((dx * sa + dy * ca - dy) / 2.2) * m
    return cv2.remap(field, mx, my, cv2.INTER_LINEAR,
                     borderMode=cv2.BORDER_WRAP)

def relief(height, strength):
    """cheap baked relief lighting (sun from upper-left in texture space)."""
    gy, gx = np.gradient(height.astype(F32))
    s = strength / (np.std(gx) + np.std(gy) + 1e-8)
    return np.clip(1.0 + (-gx - gy * 0.7) * s, 0.55, 1.45).astype(F32)

def crater_field(rng_seed, n, rmax, ray_count=0):
    """returns (height, rays) maps: bowls with raised rims + ejecta rays."""
    h = np.zeros((TH, TW), F32)
    rays = np.zeros((TH, TW), F32)
    r = np.random.default_rng(rng_seed)
    for _ in range(n):
        cx = int(r.integers(0, TW))
        cy = int(TH * 0.5 + (r.random() - 0.5) * TH * 0.96)
        rad = max(2, int(rmax * r.random() ** 3.2))
        bowl = np.zeros((TH, TW), F32) if False else None
        cv2.circle(h, (cx, cy), rad, -1.0 * (0.4 + 0.6 * r.random()), -1,
                   lineType=cv2.LINE_AA)
        cv2.circle(h, (cx, cy), rad, float(1.1 + 0.4 * r.random()),
                   max(1, rad // 4), lineType=cv2.LINE_AA)
    for _ in range(ray_count):
        cx = int(r.integers(0, TW))
        cy = int(TH * 0.5 + (r.random() - 0.5) * TH * 0.7)
        nrays = int(7 + r.integers(0, 8))
        for k in range(nrays):
            a = r.random() * 2 * math.pi
            ln = int(40 + 130 * r.random())
            ex = int(cx + math.cos(a) * ln)
            ey = int(cy + math.sin(a) * ln * 0.5)
            cv2.line(rays, (cx, cy), (ex, ey), float(0.25 + 0.3 * r.random()),
                     1, lineType=cv2.LINE_AA)
    h = cv2.GaussianBlur(h, (0, 0), 2.0)
    rays = cv2.GaussianBlur(rays, (0, 0), 2.5)
    return h, rays

def tex_mercury(seed=42, tone=(1.0, 0.95, 0.88)):
    base = 0.34 + 0.30 * fbm(TH, TW, 5, 7, seed=seed)
    maria = smoothstep(0.58, 0.70, fbm(TH, TW, 3, 5, seed=seed + 1))
    base *= 1.0 - 0.22 * maria
    h, rays = crater_field(seed, 1500, 60, ray_count=10)
    rel = relief(h, 0.16)
    v = clamp01(base * rel + clamp01(rays) * 0.18)
    col = np.stack([v * tone[0], v * tone[1], v * tone[2]], -1)
    return clamp01(col).astype(F32)

def tex_venus():
    yy = np.linspace(0, 1, TH)[:, None] * np.ones((1, TW), F32)
    xx = np.linspace(0, 1, TW)[None, :] * np.ones((TH, 1), F32)
    w1 = fbm(TH, TW, 3, 6, seed=21)
    w2 = fbm(TH, TW, 6, 7, seed=22)
    # V-shaped equatorial cloud streaks (Venus "Y feature")
    chevron = yy + 0.05 * np.abs(np.sin(xx * math.pi * 2)) * \
        np.sign(yy - 0.5) * -1.0
    band = 0.5 + 0.5 * np.sin((chevron + 0.16 * (w1 - 0.5) +
                               0.05 * (w2 - 0.5)) * math.pi * 9.0)
    band = warp_noise(band.astype(F32), w2, w1, 60)
    band = cv2.GaussianBlur(band, (0, 0), sigmaX=10, sigmaY=3)
    fine = fbm(TH, TW, 10, 24, seed=23)
    fine = cv2.GaussianBlur(fine, (0, 0), sigmaX=6, sigmaY=1)
    v = clamp01(0.50 + 0.30 * (band - 0.5) + 0.42 * (fine - 0.5))
    c0 = np.array([0.72, 0.55, 0.33], F32)
    c1 = np.array([1.00, 0.94, 0.74], F32)
    col = c0[None, None] + (c1 - c0)[None, None] * v[..., None]
    return clamp01(col).astype(F32)

def tex_earth():
    lat = np.abs(np.linspace(-1, 1, TH))[:, None] * np.ones((1, TW), F32)
    # domain-warped continents with ridged coast detail
    w1 = fbm(TH, TW, 4, 6, seed=36)
    w2 = fbm(TH, TW, 4, 6, seed=37)
    cont = warp_noise(fbm(TH, TW, 4, 7, seed=31), w1, w2, 220)
    ridge = 1.0 - np.abs(2 * fbm(TH, TW, 9, 12, seed=32) - 1.0)
    field = cont + 0.10 * (ridge - 0.5)
    land = smoothstep(0.545, 0.565, field)
    # ocean with coastal shelves
    depth = smoothstep(0.30, 0.545, field)
    ocean = np.zeros((TH, TW, 3), F32)
    deep = np.array([0.015, 0.06, 0.22], F32)
    shelf = np.array([0.05, 0.26, 0.45], F32)
    ocean += deep[None, None] + (shelf - deep)[None, None] * \
        (depth[..., None] ** 2.2)
    # biomes: humidity + temperature -> desert / forest / tundra
    humid = fbm(TH, TW, 5, 7, seed=33)
    temp = 1.0 - lat + 0.15 * (fbm(TH, TW, 6, 6, seed=38) - 0.5)
    forest = np.array([0.06, 0.22, 0.06], F32)
    grass = np.array([0.25, 0.32, 0.12], F32)
    desert = np.array([0.62, 0.48, 0.26], F32)
    tundra = np.array([0.42, 0.40, 0.33], F32)
    veg = clamp01((humid - 0.35) * 2.2)
    warmth = clamp01((temp - 0.25) * 2.0)
    landc = desert[None, None] * (1 - veg[..., None]) + \
        (forest[None, None] * 0.6 + grass[None, None] * 0.4) * veg[..., None]
    landc = landc * warmth[..., None] + \
        tundra[None, None] * (1 - warmth[..., None])
    # mountains: ridged relief + snow caps on high ridges
    mont = clamp01((ridge - 0.55) * 2.0) * land
    landc = landc * (1 - 0.45 * mont[..., None]) + \
        np.array([0.45, 0.40, 0.34], F32)[None, None] * 0.5 * mont[..., None]
    snow = clamp01((ridge - 0.80) * 5.0) * land * clamp01((lat - 0.25) * 3)
    col = ocean * (1 - land[..., None]) + landc * land[..., None]
    col = col * (1 - snow[..., None]) + \
        np.array([0.93, 0.95, 0.97], F32)[None, None] * snow[..., None]
    # polar ice
    ice = smoothstep(0.86, 0.94, lat + 0.05 * (fbm(TH, TW, 6, 6, seed=34) - 0.5))
    col = col * (1 - ice[..., None]) + \
        np.array([0.93, 0.95, 0.98], F32)[None, None] * ice[..., None]
    col *= relief(field * 40 * land, 0.05)[..., None]
    # clouds: zonal streaks + cyclone swirls, with ground shadows
    cl = fbm(TH, TW, 6, 12, seed=35)
    cl = clamp01((cl - 0.46) * 2.4) ** 1.5
    cl = cv2.GaussianBlur(cl, (0, 0), sigmaX=9, sigmaY=2)
    r = np.random.default_rng(9)
    centers = [(int(r.integers(0, TW)),
                int(TH * (0.18 + 0.64 * r.random())),
                float(40 + 90 * r.random()), float(2.4 * (1 if r.random() < 0.5 else -1)))
               for _ in range(9)]
    cl = swirl_apply(cl, centers)
    cl2 = clamp01((fbm(TH, TW, 12, 30, seed=39) - 0.52) * 2.0)
    cl2 = cv2.GaussianBlur(cl2, (0, 0), sigmaX=5, sigmaY=1)
    cloud = clamp01(cl * 0.85 + cl2 * 0.45)
    shadow = np.roll(cloud, (6, 6), (0, 1))
    col *= (1 - 0.30 * shadow[..., None])
    col = col * (1 - cloud[..., None]) + \
        np.array([0.97, 0.98, 1.00], F32)[None, None] * cloud[..., None]
    spec = ((1 - land) * (1 - cloud) * (1 - ice)).astype(F32)
    return clamp01(col).astype(F32), spec

def tex_mars():
    lat = np.abs(np.linspace(-1, 1, TH))[:, None] * np.ones((1, TW), F32)
    w1 = fbm(TH, TW, 4, 6, seed=46)
    w2 = fbm(TH, TW, 4, 6, seed=47)
    base = 0.66 + 0.38 * (warp_noise(fbm(TH, TW, 5, 8, seed=41), w1, w2, 140) - 0.5)
    # southern highlands darker + cratered, northern plains smooth
    hemis = smoothstep(0.35, 0.65, np.linspace(0, 1, TH))[:, None]
    maria = smoothstep(0.55, 0.68, fbm(TH, TW, 3, 5, seed=42))
    base *= 1.0 - 0.30 * maria - 0.08 * hemis
    h, _ = crater_field(43, 700, 34)
    rel = relief(h * (0.3 + 0.7 * hemis), 0.10)
    # Valles Marineris: a long equatorial canyon
    canyon = np.zeros((TH, TW), F32)
    pts = []
    for k in range(40):
        u = k / 39
        pts.append((int(TW * (0.30 + 0.25 * u)),
                    int(TH * (0.52 + 0.05 * math.sin(u * 5)))))
    for a, b in zip(pts[:-1], pts[1:]):
        cv2.line(canyon, a, b, 1.0, 7, lineType=cv2.LINE_AA)
    canyon = cv2.GaussianBlur(canyon, (0, 0), 4)
    # Tharsis volcanoes
    volc = np.zeros((TH, TW), F32)
    for (vx, vy, vr) in [(0.16, 0.42, 26), (0.13, 0.50, 22), (0.19, 0.56, 20),
                         (0.10, 0.38, 30)]:
        cv2.circle(volc, (int(TW * vx), int(TH * vy)), vr, 0.9, -1,
                   lineType=cv2.LINE_AA)
    volc = cv2.GaussianBlur(volc, (0, 0), 6)
    v = clamp01(base * rel * (1 - 0.35 * canyon) * (1 - 0.18 * volc))
    col = np.stack([v * 0.88, v * 0.50, v * 0.30], -1)
    # dust streaks
    dust = cv2.GaussianBlur(fbm(TH, TW, 8, 30, seed=44), (0, 0),
                            sigmaX=8, sigmaY=1)
    col = clamp01(col * (0.92 + 0.16 * dust[..., None]))
    cap = smoothstep(0.88, 0.95, lat + 0.04 * (fbm(TH, TW, 7, 7, seed=45) - 0.5))
    col = col * (1 - cap[..., None]) + \
        np.array([0.96, 0.94, 0.91], F32)[None, None] * cap[..., None]
    return clamp01(col).astype(F32)

def _band_planet(seed, cols, warp_amt=0.035, freq=11.0, contrast=1.0):
    yy = np.linspace(0, 1, TH)[:, None] * np.ones((1, TW), F32)
    warp = fbm(TH, TW, 3, 24, seed=seed) - 0.5           # streaky warp
    warp = cv2.GaussianBlur(warp, (0, 0), sigmaX=8, sigmaY=1)
    prof = fbm1d(2048, base=int(freq), octaves=5, seed=seed + 7)
    prof = (prof - prof.min()) / (np.ptp(prof) + 1e-9)
    yv = clamp01(yy + warp_amt * warp)
    v = np.interp((yv * 2047).ravel(), np.arange(2048), prof).reshape(TH, TW).astype(F32)
    v = clamp01(0.5 + (v - 0.5) * contrast)
    idx = v * (len(cols) - 1)
    lo = np.clip(idx.astype(np.int32), 0, len(cols) - 2)
    fr = (idx - lo)[..., None]
    carr = np.array(cols, F32)
    return (carr[lo] * (1 - fr) + carr[lo + 1] * fr).astype(F32)

def tex_jupiter():
    # zonal band profile (zones = pale, belts = brown/rust)
    yy = np.linspace(0, 1, TH)[:, None] * np.ones((1, TW), F32)
    knots_y = [0.00, 0.08, 0.16, 0.26, 0.33, 0.40, 0.46, 0.52, 0.58,
               0.66, 0.74, 0.82, 0.90, 1.00]
    knots_c = [(0.55, 0.44, 0.35), (0.78, 0.65, 0.51), (0.55, 0.34, 0.21),
               (0.94, 0.88, 0.76), (0.47, 0.28, 0.16), (0.96, 0.91, 0.80),
               (0.63, 0.40, 0.25), (0.98, 0.94, 0.85), (0.60, 0.37, 0.23),
               (0.93, 0.86, 0.73), (0.52, 0.34, 0.22), (0.81, 0.69, 0.55),
               (0.62, 0.49, 0.39), (0.55, 0.44, 0.35)]
    # streaky domain warp, stronger at band boundaries
    w1 = cv2.GaussianBlur(fbm(TH, TW, 6, 20, seed=51), (0, 0),
                          sigmaX=10, sigmaY=2)
    w2 = cv2.GaussianBlur(fbm(TH, TW, 8, 26, seed=52), (0, 0),
                          sigmaX=8, sigmaY=2)
    yw = clamp01(yy + 0.035 * (w1 - 0.5) + 0.012 * (w2 - 0.5))
    # dense LUT: flat band cores with narrow smoothstep edges
    kc = np.array(knots_c, F32)
    LN = 2048
    lut = np.zeros((LN, 3), F32)
    ys = np.linspace(0, 1, LN)
    for i in range(len(knots_y) - 1):
        y0, y1 = knots_y[i], knots_y[i + 1]
        m = (ys >= y0) & (ys <= y1)
        u = (ys[m] - y0) / (y1 - y0 + 1e-9)
        e = smoothstep(0.32, 0.68, u)[:, None]
        lut[m] = kc[i][None] * (1 - e) + kc[i + 1][None] * e
    idx = np.clip((yw * (LN - 1)).astype(np.int32), 0, LN - 1)
    col = lut[idx]
    # vortex chains along belt edges
    r = np.random.default_rng(8)
    centers = []
    for by in [0.30, 0.44, 0.62, 0.71]:
        for _ in range(5):
            centers.append((int(r.integers(0, TW)),
                            int(TH * (by + 0.02 * (r.random() - 0.5))),
                            float(24 + 40 * r.random()),
                            float(2.8 * (1 if r.random() < 0.5 else -1))))
    for ch in range(3):
        col[..., ch] = swirl_apply(col[..., ch], centers)
    # great red spot: rust oval + pale collar + internal swirl
    xx = np.linspace(0, 1, TW)[None, :] * np.ones((TH, 1), F32)
    d = ((xx - 0.60) / 0.034) ** 2 + ((yy - 0.330) / 0.019) ** 2
    spot = np.exp(-(d ** 1.6)).astype(F32)          # flatter, sharper oval
    outline = np.exp(-np.abs(d - 1.35) * 2.5).astype(F32)
    collar = np.exp(-np.abs(d - 2.6) * 1.2).astype(F32)
    grs = np.array([0.82, 0.30, 0.16], F32)
    col = col * (1 - 0.95 * spot[..., None]) + grs[None, None] * spot[..., None]
    col *= (1 - 0.30 * outline[..., None])           # dark rim around the spot
    col = clamp01(col + np.array([0.12, 0.10, 0.07], F32)[None, None] *
                  collar[..., None])
    for ch in range(3):
        col[..., ch] = swirl_apply(col[..., ch],
                                   [(int(TW * 0.60), int(TH * 0.330), 40, 3.2)])
    # fine streaks
    fine = cv2.GaussianBlur(fbm(TH, TW, 14, 60, seed=53), (0, 0),
                            sigmaX=5, sigmaY=0.8)
    col = clamp01(col * (0.90 + 0.20 * fine[..., None]))
    return col.astype(F32)

def tex_saturn():
    cols = [(0.72, 0.62, 0.46), (0.86, 0.77, 0.60), (0.95, 0.89, 0.74),
            (0.80, 0.70, 0.53), (0.99, 0.94, 0.82)]
    col = _band_planet(61, cols, warp_amt=0.020, freq=9, contrast=0.95)
    # fine zonal streaks
    fine = cv2.GaussianBlur(fbm(TH, TW, 12, 50, seed=62), (0, 0),
                            sigmaX=6, sigmaY=1)
    col = clamp01(col * (0.93 + 0.14 * fine[..., None]))
    lat = np.abs(np.linspace(-1, 1, TH))[:, None]
    polar = smoothstep(0.62, 0.95, lat)
    col = col * (1 - 0.22 * polar[..., None]) + \
        np.array([0.06, 0.07, 0.10], F32)[None, None] * 0.4 * polar[..., None]
    return clamp01(col).astype(F32)

def tex_sun_gran():
    g = 0.80 + 0.45 * (fbm(TH, TW, 10, 12, seed=71) - 0.5)
    return clamp01(g).astype(F32)

# ----------------------------------------------------------------------------
# Saturn ring radial profile with mip chain
R_IN, R_OUT = 1.20, 2.36
RN = 6000

def build_rings():
    r = np.linspace(R_IN, R_OUT, RN).astype(F32)
    a = np.zeros(RN, F32)
    bright = np.ones(RN, F32)

    def seg(r0, r1, v0, v1, feather=0.008):
        m = smoothstep(r0 - feather, r0 + feather, r) * \
            (1 - smoothstep(r1 - feather, r1 + feather, r))
        return m * np.interp(r, [r0, r1], [v0, v1]).astype(F32)

    a += seg(1.24, 1.525, 0.06, 0.30)            # C ring
    a += seg(1.525, 1.95, 0.92, 1.00)            # B ring
    a += seg(2.027, 2.269, 0.62, 0.55)           # A ring
    a += seg(1.95, 2.027, 0.10, 0.13)            # Cassini division (faint)
    a += seg(2.318, 2.326, 0.28, 0.28, 0.003)    # F ring
    # Encke gap
    a *= 1.0 - 0.92 * np.exp(-((r - 2.214) / 0.006) ** 2)
    # fine radial structure (grooves)
    n1 = fbm1d(RN, base=160, octaves=5, seed=81)
    n2 = fbm1d(RN, base=36, octaves=4, seed=82)
    a = clamp01(a * (0.52 + 0.48 * (0.55 * n1 + 0.45 * n2) * 1.9))
    bright = 0.72 + 0.52 * n2 + 0.28 * (n1 - 0.5)
    # color: cream in B, dustier in C / Cassini
    warm = np.interp(r, [R_IN, 1.5, 1.75, 2.0, R_OUT], [0.55, 0.8, 1.0, 0.85, 0.9]).astype(F32)
    base = np.array([0.93, 0.87, 0.74], F32)
    dust = np.array([0.52, 0.48, 0.45], F32)
    col = (dust[None] + (base - dust)[None] * warm[:, None]) * bright[:, None]
    col = clamp01(col).astype(F32)
    # mip chain
    sig = [0, 2, 6, 16, 40, 110, 260]
    a_m, c_m = [], []
    for s in sig:
        if s == 0:
            a_m.append(a.copy())
            c_m.append(col.copy())
        else:
            a_m.append(cv2.GaussianBlur(a.reshape(-1, 1), (1, 0), s).ravel())
            c_m.append(cv2.GaussianBlur(col, (1, 0), s))
    return np.stack(a_m), np.stack(c_m)  # (M,RN), (M,RN,3)

RING_A, RING_C = build_rings()
RING_M = RING_A.shape[0]
DR_IDX = (R_OUT - R_IN) / RN  # r-units per profile sample

def ring_lookup(rr, fp):
    """rr: radii in planet-radius units; fp: radial footprint (r-units/pixel)."""
    idx = np.clip((rr - R_IN) / (R_OUT - R_IN) * (RN - 1), 0, RN - 1).astype(np.int32)
    lvl = np.clip(np.log2(np.maximum(fp / DR_IDX, 1.0)) * 0.55, 0, RING_M - 1.001)
    l0 = lvl.astype(np.int32)
    frac = (lvl - l0).astype(F32)
    a = RING_A[l0, idx] * (1 - frac) + RING_A[np.minimum(l0 + 1, RING_M - 1), idx] * frac
    c = RING_C[l0, idx] * (1 - frac[..., None]) + \
        RING_C[np.minimum(l0 + 1, RING_M - 1), idx] * frac[..., None]
    return a, c

def ring_alpha_at(rr):
    idx = np.clip((rr - R_IN) / (R_OUT - R_IN) * (RN - 1), 0, RN - 1).astype(np.int32)
    return RING_A[2][idx]

# ----------------------------------------------------------------------------
# sky
def build_sky():
    SH, SW = 1600, 3200
    neb = fbm(SH, SW, 4, 7, seed=91)
    neb2 = fbm(SH, SW, 10, 12, seed=92)
    n = clamp01((neb - 0.40) * 1.7) * (0.55 + 0.45 * neb2)
    sky = np.zeros((SH, SW, 3), F32)
    sky += n[..., None] * np.array([0.10, 0.075, 0.185], F32)[None, None]
    sky += (clamp01((neb2 - 0.55) * 1.4) * n)[..., None] * \
        np.array([0.09, 0.045, 0.04], F32)[None, None]
    layers = []
    r = np.random.default_rng(7)
    for li, (count, bmax, sig) in enumerate([(3400, 0.7, 0.7), (900, 1.15, 0.9),
                                             (140, 1.7, 1.3)]):
        st = np.zeros((SH, SW), F32)
        ys = r.integers(0, SH, count)
        xs = r.integers(0, SW, count)
        bs = (r.random(count) ** 2.2 * bmax + 0.05).astype(F32)
        st[ys, xs] = bs
        st = cv2.GaussianBlur(st, (0, 0), sig) * (sig * 4)
        layers.append(st)
    return sky, layers

SKY_BASE, SKY_STARS = build_sky()
SH, SW = SKY_BASE.shape[:2]

def sky_image(t):
    tw0 = 0.82 + 0.18 * math.sin(t * 2.1)
    tw1 = 0.82 + 0.18 * math.sin(t * 3.3 + 1.7)
    tw2 = 0.90 + 0.10 * math.sin(t * 1.3 + 0.6)
    img = SKY_BASE + (SKY_STARS[0] * tw0 + SKY_STARS[1] * tw1 +
                      SKY_STARS[2] * tw2)[..., None]
    return img

# ----------------------------------------------------------------------------
# world
# towards the sun: upper-left (screen up = -y), angled for visible terminator
LIGHT = norm(np.array([-0.62, -0.45, -0.46]))

class Body:
    def __init__(self, name, pos, R, tex, spin=0.06, atmo=None, spec=None,
                 tilt=0.0):
        self.name = name
        self.pos = np.array(pos, F32)
        self.R = R
        self.tex = tex
        self.spin = spin
        self.atmo = atmo      # (r,g,b,strength)
        self.spec = spec      # specular mask (earth ocean)
        self.tilt = tilt

_earth_tex, _earth_spec = tex_earth()

SATURN_POS = np.array([0.0, 0.0, 236.0], F32)
SATURN_R = 3.0
SAT_TILT = math.radians(-21.0)   # rings tip toward camera

BODIES = [
    Body("mercury", (1.25, 0.10, 34.0), 1.00, tex_mercury(), spin=0.05),
    Body("venus", (-1.45, -0.05, 68.0), 1.55, tex_venus(), spin=-0.04,
         atmo=(1.0, 0.9, 0.65, 0.5)),
    Body("earth", (1.35, 0.08, 104.0), 1.65, _earth_tex, spin=0.10,
         atmo=(0.35, 0.6, 1.0, 1.0), spec=_earth_spec),
    Body("moon", (3.6, 0.9, 106.5), 0.40,
         tex_mercury(seed=77, tone=(0.95, 0.95, 0.95)), spin=0.02),
    Body("mars", (-1.30, 0.05, 140.0), 1.15, tex_mars(), spin=0.07,
         atmo=(1.0, 0.6, 0.4, 0.25)),
    Body("jupiter", (1.85, -0.05, 182.0), 3.60, tex_jupiter(), spin=0.14,
         tilt=0.04),
    Body("saturn", tuple(SATURN_POS), SATURN_R, tex_saturn(), spin=0.09),
]
SUN_POS = np.array([0.0, 0.4, 0.0], F32)
SUN_R = 4.2
SUN_GRAN = tex_sun_gran()

# ----------------------------------------------------------------------------
# camera path
# rows: (time, z, x, y, pitch_rad); mode = interp to next key
CAM_KEYS = [
    (0.00, -14.0, 0.00, 0.00, 0.000, 'lin'),
    (3.00, -11.2, 0.10, 0.04, 0.000, 'smooth'),   # sun dwell -> travel
    (4.50, 30.30, 0.95, 0.06, 0.000, 'lin'),      # mercury
    (6.30, 30.85, 1.05, 0.08, 0.000, 'smooth'),
    (7.80, 63.40, -1.10, -0.04, 0.000, 'lin'),    # venus
    (9.60, 63.95, -1.22, -0.02, 0.000, 'smooth'),
    (11.10, 99.20, 1.02, 0.05, 0.000, 'lin'),     # earth
    (13.10, 99.80, 1.14, 0.07, 0.000, 'smooth'),
    (14.60, 136.10, -1.00, 0.02, 0.000, 'lin'),   # mars
    (16.30, 136.65, -1.10, 0.04, 0.000, 'smooth'),
    (17.80, 173.60, 1.40, -0.02, 0.000, 'lin'),   # jupiter
    (19.40, 174.20, 1.52, 0.00, 0.000, 'smooth'),
    (21.00, 224.50, 0.30, 2.05, -0.060, 'lin'),   # saturn dwell (above, look down)
    (23.10, 225.30, 0.20, 2.00, -0.060, 'smooth'),
    (26.40, 238.30, -4.55, None, 0.300, 'lin'),   # dive over the sunlit A ring
    (28.60, 238.90, -4.60, None, 0.300, 'lin'),
]
DIVE_T0, DIVE_T1 = 23.10, 26.40
SKIM_H = 0.42          # camera height above ring plane at the end of the dive

def plane_y_world(x, z):
    """y of Saturn's (tilted) ring plane in world coords at (x, z)."""
    return SATURN_POS[1] + math.tan(SAT_TILT) * (z - SATURN_POS[2])

def camera_at(t):
    ks = CAM_KEYS
    t = min(max(t, ks[0][0]), ks[-1][0] - 1e-4)
    for i in range(len(ks) - 1):
        if ks[i][0] <= t <= ks[i + 1][0]:
            t0, z0, x0, y0, p0, mode = ks[i]
            t1, z1, x1, y1, p1, _ = ks[i + 1]
            u = (t - t0) / (t1 - t0 + 1e-9)
            if mode == 'smooth':
                u = float(smootherstep(u))
            z = z0 + (z1 - z0) * u
            x = x0 + (x1 - x0) * u
            p = p0 + (p1 - p0) * u
            # dive: descend to skim just above the tilted ring plane
            # (screen-up is -y, so "above the plane" = plane_y - height).
            # blend the *height above the plane*, not absolute y, so the
            # camera never crosses through the ring plane mid-dive.
            if t0 == DIVE_T0:
                h0 = z0 * 0.0 + (y0 - plane_y_world(x0, z0))
                y = plane_y_world(x, z) + h0 + (-SKIM_H - h0) * u
            elif y0 is None or y1 is None or t0 >= DIVE_T1 - 1e-6:
                y = plane_y_world(x, z) - SKIM_H
            else:
                y = y0 + (y1 - y0) * u
            return np.array([x, y, z], F32), p
    return np.array([ks[-1][2], 0, ks[-1][1]], F32), ks[-1][4]

# ----------------------------------------------------------------------------
# ray grid
_px, _py = np.meshgrid(np.arange(W, dtype=F32), np.arange(H, dtype=F32))
_bx = (_px - CX) / FOCAL
_by = (_py - CY) / FOCAL

def ray_dirs(pitch):
    dx = _bx
    dy = _by * math.cos(pitch) - math.sin(pitch)
    dz = _by * math.sin(pitch) + math.cos(pitch)
    n = np.sqrt(dx * dx + dy * dy + dz * dz)
    return dx / n, dy / n, dz / n

def project(p, cam, pitch):
    """world point -> (sx, sy, depth) under pitched camera"""
    v = p - cam
    vy = v[1] * math.cos(pitch) + v[2] * math.sin(pitch)
    vz = -v[1] * math.sin(pitch) + v[2] * math.cos(pitch)
    if vz <= 0.05:
        return None
    return CX + v[0] / vz * FOCAL, CY + vy / vz * FOCAL, vz

# ----------------------------------------------------------------------------
# sphere shading
def draw_sphere(img, cam, pitch, dxs, dys, dzs, body, t):
    pr = project(body.pos, cam, pitch)
    if pr is None:
        return
    sx, sy, dist = pr
    rs = FOCAL * body.R / dist
    if rs < 0.6:
        if rs > 0.15 and 0 <= sx < W and 0 <= sy < H:
            cv2.circle(img, (int(sx), int(sy)), 1, (0.5, 0.5, 0.55), -1,
                       lineType=cv2.LINE_AA)
        return
    pad = rs * (1.35 if body.atmo else 1.12) + 6
    x0, x1 = int(max(0, sx - pad)), int(min(W, sx + pad))
    y0, y1 = int(max(0, sy - pad)), int(min(H, sy + pad))
    if x1 <= x0 or y1 <= y0:
        return
    d = np.stack([dxs[y0:y1, x0:x1], dys[y0:y1, x0:x1], dzs[y0:y1, x0:x1]], -1)
    oc = (cam - body.pos).astype(F32)
    b = d @ oc
    c0 = float(oc @ oc - body.R ** 2)
    disc = b * b - c0
    hit = disc > 0
    if not hit.any():
        return
    tt = -b - np.sqrt(np.maximum(disc, 0))
    hit &= tt > 0
    p = cam[None, None] + d * tt[..., None]
    n = (p - body.pos[None, None]) / body.R
    # spin about (slightly tilted) y axis
    ang = body.spin * t
    ca, sa = math.cos(ang), math.sin(ang)
    nx = n[..., 0] * ca - n[..., 2] * sa
    nz = n[..., 0] * sa + n[..., 2] * ca
    ny = n[..., 1]
    if body.tilt:
        ct, st = math.cos(body.tilt), math.sin(body.tilt)
        ny, nz = ny * ct - nz * st, ny * st + nz * ct
    u = ((np.arctan2(nx, nz) / (2 * math.pi) + 0.5) * (TW - 1)).astype(F32)
    v = ((0.5 - np.arcsin(np.clip(ny, -1, 1)) / math.pi) * (TH - 1)).astype(F32)
    texel = cv2.remap(body.tex, u, v, cv2.INTER_LINEAR)
    ndl = n @ LIGHT
    diff = smoothstep(-0.05, 0.35, ndl) ** 0.9
    mu = np.maximum(-(n * d).sum(-1), 0)
    gas = body.name in ("jupiter", "venus")
    limb = (0.42 + 0.58 * mu ** 0.75) if gas else (0.50 + 0.50 * mu ** 0.55)
    shade = (0.045 + 0.985 * diff) * limb
    col = texel * shade[..., None]
    if body.name == "earth":
        # rayleigh-ish blue tint toward the lit limb
        fres = (1 - mu) ** 2.2 * diff
        col += fres[..., None] * np.array([0.25, 0.45, 0.9], F32)[None, None] * 0.4
    if body.spec is not None:
        sm = cv2.remap(body.spec, u, v, cv2.INTER_LINEAR)
        hv = norm(LIGHT - np.array([0, 0, 1], F32))
        spec = np.maximum(n @ hv, 0) ** 60 * sm * diff
        col += spec[..., None] * np.array([1.0, 0.98, 0.9], F32)[None, None] * 0.7
    # feather edge (screen space)
    dpx = np.sqrt((_px[y0:y1, x0:x1] - sx) ** 2 + (_py[y0:y1, x0:x1] - sy) ** 2)
    alpha = clamp01((rs - dpx) / 1.6) * hit
    if body.atmo:
        ar, ag, ab, s = body.atmo
        rimin = clamp01(1 - np.abs(rs - dpx) / (rs * 0.10)) * (dpx < rs)
        glow = clamp01(1 - (dpx - rs) / (rs * 0.085)) * (dpx >= rs)
        add = (rimin * 0.5 + glow * 0.75) * s * 0.85
        col += add[..., None] * np.array([ar, ag, ab], F32)[None, None] * 0.55
        alpha = np.maximum(alpha, clamp01(glow * s * 0.8))
    sub = img[y0:y1, x0:x1]
    a3 = alpha[..., None]
    img[y0:y1, x0:x1] = sub * (1 - a3) + np.nan_to_num(col) * a3

# ----------------------------------------------------------------------------
# sun
def draw_sun(img, cam, pitch, t):
    pr = project(SUN_POS, cam, pitch)
    if pr is None:
        return
    sx, sy, dist = pr
    rs = FOCAL * SUN_R / dist
    if rs < 1:
        return
    dx = (_px - sx) / rs
    dy = (_py - sy) / rs
    dd = np.sqrt(dx * dx + dy * dy)
    # halo
    halo = 1.0 / (1.0 + (dd * 2.4) ** 2.6)
    img += halo[..., None] * np.array([1.0, 0.88, 0.62], F32)[None, None] * 1.15
    # spikes
    th = np.arctan2(dy, dx)
    sp = (np.maximum(0, np.cos(3 * (th + 0.25 + t * 0.02))) ** 60 * 0.55 +
          np.maximum(0, np.cos(4 * (th - 0.6 - t * 0.015))) ** 120 * 0.30)
    sp *= np.exp(-dd / 4.5) * (dd > 0.15)
    img += sp[..., None] * np.array([1.0, 0.95, 0.85], F32)[None, None] * 0.55
    # core with granulation
    core = clamp01((1.0 - dd) * rs / 1.5)
    if core.any():
        uu = clamp01(dx * 0.25 + 0.5) * (TW - 1)
        vv = clamp01(dy * 0.5 + 0.5) * (TH - 1)
        g = cv2.remap(SUN_GRAN, uu.astype(F32), vv.astype(F32), cv2.INTER_LINEAR)
        cc = np.stack([np.full_like(g, 1.0), 0.92 * g * 0.4 + 0.72,
                       0.55 * g * 0.5 + 0.42], -1)
        cc = clamp01(cc + (1 - dd[..., None]) * 0.6)
        img[:] = img * (1 - core[..., None]) + cc * core[..., None]

# ----------------------------------------------------------------------------
# Saturn: raytraced sphere + rings
_cS, _sS = math.cos(SAT_TILT), math.sin(SAT_TILT)

def to_sat(v):
    """world vec -> saturn local (tilt about x)"""
    x = v[..., 0]
    y = v[..., 1] * _cS - v[..., 2] * _sS
    z = v[..., 1] * _sS + v[..., 2] * _cS
    return x, y, z

L_loc = np.array(to_sat(LIGHT[None]))[:, 0].astype(F32)

def draw_saturn(img, sky, cam, pitch, dxs, dys, dzs, t, fog_amt):
    body = BODIES[-1]
    pr = project(body.pos, cam, pitch)
    rs_est = 0
    if pr is not None:
        rs_est = FOCAL * body.R * 2.4 / pr[2]
    full = pr is None or rs_est > 500 or fog_amt > 0
    if pr is not None and not full:
        sx, sy, _ = pr
        pad = rs_est + 10
        x0, x1 = int(max(0, sx - pad)), int(min(W, sx + pad))
        y0, y1 = int(max(0, sy - pad)), int(min(H, sy + pad))
        if x1 <= x0 or y1 <= y0:
            return
    else:
        x0, y0, x1, y1 = 0, 0, W, H

    dx = dxs[y0:y1, x0:x1]
    dy = dys[y0:y1, x0:x1]
    dz = dzs[y0:y1, x0:x1]
    # to saturn frame
    ox, oy, oz = to_sat((cam - body.pos)[None])
    ox, oy, oz = float(ox[0]), float(oy[0]), float(oz[0])
    ldx = dx
    ldy = dy * _cS - dz * _sS
    ldz = dy * _sS + dz * _cS
    R = body.R

    # sphere
    b = ox * ldx + oy * ldy + oz * ldz
    c0 = ox * ox + oy * oy + oz * oz - R * R
    disc = b * b - c0
    sph = disc > 0
    ts = -b - np.sqrt(np.maximum(disc, 0))
    sph &= ts > 0.01

    scol = np.zeros((y1 - y0, x1 - x0, 3), F32)
    if sph.any():
        px = ox + ts * ldx
        py = oy + ts * ldy
        pz = oz + ts * ldz
        nx, ny, nz = px / R, py / R, pz / R
        ang = body.spin * t
        ca, sa = math.cos(ang), math.sin(ang)
        rx = nx * ca - nz * sa
        rz = nx * sa + nz * ca
        u = ((np.arctan2(rx, rz) / (2 * math.pi) + 0.5) * (TW - 1)).astype(F32)
        v = ((0.5 - np.arcsin(np.clip(ny, -1, 1)) / math.pi) * (TH - 1)).astype(F32)
        texel = cv2.remap(body.tex, u, v, cv2.INTER_LINEAR)
        ndl = nx * L_loc[0] + ny * L_loc[1] + nz * L_loc[2]
        diff = smoothstep(-0.05, 0.35, ndl) ** 0.9
        mu = np.maximum(-(nx * ldx + ny * ldy + nz * ldz), 0)
        limb = 0.48 + 0.52 * mu ** 0.55
        # ring shadow on planet: path to sun crossing ring plane
        sL = np.where(np.abs(L_loc[1]) > 1e-4, -py / L_loc[1], -1.0)
        rcx = px + sL * L_loc[0]
        rcz = pz + sL * L_loc[2]
        rc = np.sqrt(rcx * rcx + rcz * rcz) / R
        ra = np.where((sL > 0) & (rc > R_IN) & (rc < R_OUT), ring_alpha_at(rc), 0.0)
        shade = (0.045 + 0.985 * diff * (1 - 0.82 * ra)) * limb
        scol = texel * shade[..., None]

    # rings
    tr = np.where(np.abs(ldy) > 1e-5, -oy / ldy, -1.0)
    rpx = ox + tr * ldx
    rpz = oz + tr * ldz
    rr = np.sqrt(rpx * rpx + rpz * rpz) / R
    rhit = (tr > 0.01) & (rr > R_IN) & (rr < R_OUT)
    ra = np.zeros_like(tr)
    rcol = np.zeros((y1 - y0, x1 - x0, 3), F32)
    if rhit.any():
        fp = tr / FOCAL / np.maximum(np.abs(ldy), 0.015) / R * 0.30
        a_, c_ = ring_lookup(rr, fp)
        # planet shadow on rings (soft)
        qx, qy, qz = rpx, np.zeros_like(rpx), rpz
        bq = qx * L_loc[0] + qz * L_loc[2]
        along = np.maximum(-(qx * L_loc[0] + qy * L_loc[1] + qz * L_loc[2]), 0)
        dmin2 = qx * qx + qz * qz - along ** 2
        dmin = np.sqrt(np.maximum(dmin2, 0))
        shad = smoothstep(R * 0.96, R * 1.22, dmin)
        shad = np.where(along > 0, shad, 1.0)
        lit = 0.55 + 0.65 * abs(float(L_loc[1]))
        c_ = c_ * (0.18 + 0.82 * shad[..., None]) * lit
        # unlit side is dimmer, bluish
        if oy * L_loc[1] < 0:
            c_ *= np.array([0.55, 0.57, 0.66], F32)[None, None]
        # distance fog
        if fog_amt > 0:
            fog = (1 - np.exp(-(tr / 30.0) ** 1.6)) * fog_amt
            haze = np.array([0.115, 0.10, 0.125], F32)
            c_ = c_ * (1 - fog[..., None]) + haze[None, None] * fog[..., None]
            a_ = a_ * (1 - 0.55 * fog) + 0.30 * fog
        ra = np.where(rhit, a_, 0)
        rcol = c_

    # composite into img
    sub = img[y0:y1, x0:x1]
    out = sub.copy()
    # sphere over sky, feathered by disc
    if sph.any():
        feather = clamp01(disc / (R * 0.02 * np.maximum(ts, 1.0)))
        af = (sph * feather)
        out = out * (1 - af[..., None]) + np.nan_to_num(scol) * af[..., None]
    # rings in front of sphere OR where no sphere
    front = rhit & ((~sph) | (tr < ts))
    af = np.where(front, ra, 0)
    out = out * (1 - af[..., None]) + np.nan_to_num(rcol) * af[..., None]
    img[y0:y1, x0:x1] = out

# ----------------------------------------------------------------------------
# ring dust particles for the dive
def build_particles():
    r = np.random.default_rng(3)
    n = 520
    rad = 1.55 + (R_OUT - 1.6) * r.random(n)
    th = -0.98 + (r.random(n) - 0.5) * 2.4  # angular slice around camera path
    x = rad * SATURN_R * np.sin(th)
    z = rad * SATURN_R * np.cos(th)
    y = -(0.02 + 0.30 * r.random(n) ** 2)  # hover above plane (up = -y)
    b = 0.3 + 0.7 * r.random(n)
    return np.stack([x, y, z], -1).astype(F32), b.astype(F32)

PART_P, PART_B = build_particles()

def sat_to_world(p):
    x = p[..., 0]
    y = p[..., 1] * _cS + p[..., 2] * _sS
    z = -p[..., 1] * _sS + p[..., 2] * _cS
    return np.stack([x, y, z], -1) + SATURN_POS[None]

PART_W = sat_to_world(PART_P)

def draw_particles(img, cam, pitch, amt):
    if amt <= 0:
        return
    v = PART_W - cam[None]
    vy = v[:, 1] * math.cos(pitch) + v[:, 2] * math.sin(pitch)
    vz = -v[:, 1] * math.sin(pitch) + v[:, 2] * math.cos(pitch)
    ok = vz > 0.15
    sx = CX + v[:, 0] / vz * FOCAL
    sy = CY + vy / vz * FOCAL
    layer = np.zeros((H, W), F32)
    for i in np.where(ok)[0]:
        if -20 < sx[i] < W + 20 and -20 < sy[i] < H + 20:
            r = min(6.0, 0.55 / vz[i] * FOCAL * 0.02 + 0.6)
            bright = PART_B[i] * min(1.0, 2.2 / vz[i]) * amt
            cv2.circle(layer, (int(sx[i]), int(sy[i])), max(1, int(r)),
                       float(bright), -1, lineType=cv2.LINE_AA)
    layer = cv2.GaussianBlur(layer, (0, 0), 1.2)
    img += layer[..., None] * np.array([1.0, 0.96, 0.88], F32)[None, None] * 0.45

# ----------------------------------------------------------------------------
# captions
_caption_cache = {}

def caption_bitmap(text, size=58, font_path=FONT_BOLD, tracking=4):
    key = (text, size, font_path, tracking)
    if key in _caption_cache:
        return _caption_cache[key]
    font = ImageFont.truetype(font_path, size)
    widths = [font.getbbox(ch)[2] for ch in text]
    tw = int(sum(widths) + tracking * (len(text) - 1) + 40)
    th_ = size * 2
    im = Image.new("L", (tw, th_), 0)
    dr = ImageDraw.Draw(im)
    x = 20
    for ch, w_ in zip(text, widths):
        dr.text((x, size // 2), ch, fill=255, font=font)
        x += w_ + tracking
    a = np.asarray(im, F32) / 255.0
    ys, xs = np.where(a > 0.02)
    if len(xs) == 0:
        return np.zeros((4, 4), F32)
    a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    _caption_cache[key] = a
    return a

# phrases reveal like typing: full phrase stays centered, prefix stages
# slide the reveal edge to the right. (t_in, t_out, size, [(prefix, t), ...])
CAPTIONS = [
    (1.00, 3.60, 62, [("papa", 1.00), ("paparazzi", 2.05)]),
    (4.60, 6.75, 56, [("promise", 4.60), ("promise i'll be kind", 5.40)]),
    (7.90, 10.10, 56, [("but", 7.90), ("but i won't stop", 8.70)]),
    (11.20, 13.60, 56, [("the boy", 11.20), ("the boy is mine", 12.10)]),
    (14.70, 16.85, 56, [("baby", 14.70), ("baby you'll be", 15.50)]),
    (17.90, 21.10, 46, [("chase", 17.90), ("chase you down", 18.60),
                        ("chase you down until you love me", 19.60)]),
]
PAPARAZZI_FINAL = (21.60, 23.80, "paparazzi", 96)
CAP_TRACK = 4

def prefix_width(full, prefix, size, font_path=FONT_BOLD, tracking=CAP_TRACK):
    font = ImageFont.truetype(font_path, size)
    w = 0.0
    for ch in full[:len(prefix)]:
        w += font.getbbox(ch)[2] + tracking
    return w

def draw_caption(img, t):
    for (t0, t1, size, stages) in CAPTIONS:
        if not (t0 - 0.35 < t < t1 + 0.30):
            continue
        full = stages[-1][0]
        a_in = smoothstep(t0 - 0.30, t0 + 0.12, t)
        a_out = 1 - smoothstep(t1 - 0.05, t1 + 0.28, t)
        alpha = float(a_in * a_out)
        if alpha <= 0.01:
            continue
        bm = caption_bitmap(full, size)
        # animated reveal edge (px in full-phrase bitmap space)
        edges = [prefix_width(full, s, size) for s, _ in stages]
        edge = edges[0] * float(smoothstep(t0 - 0.30, t0 + 0.25, t))
        for k in range(1, len(stages)):
            u = smoothstep(stages[k][1], stages[k][1] + 0.40, t)
            edge = edge + (edges[k] - edge) * float(u)
        xs = np.arange(bm.shape[1], dtype=F32)
        mask = clamp01((edge - xs) / 34.0)[None, :]
        rise = (1 - a_in) * 14
        blit_text(img, bm * mask, H * 0.845 + rise, alpha, glow=0.35)
    t0, t1, text, size = PAPARAZZI_FINAL
    if t0 - 0.5 < t < t1 + 0.5:
        a_in = smoothstep(t0 - 0.45, t0 + 0.30, t)
        a_out = 1 - smoothstep(t1 - 0.1, t1 + 0.45, t)
        alpha = float(a_in * a_out)
        if alpha > 0.01:
            bm = caption_bitmap(text, size, FONT_SERIF_IT, tracking=10)
            blit_text(img, bm, H * 0.875, alpha, glow=0.8)

def blit_text(img, bm, ycenter, alpha, glow=0.4, xcenter=None, tint=(1, 1, 1),
              boost=1.0):
    hh, ww = bm.shape
    xc = CX if xcenter is None else xcenter
    x0 = int(xc - ww / 2)
    y0 = int(ycenter - hh / 2)
    x0c, y0c = max(0, x0), max(0, y0)
    x1c, y1c = min(W, x0 + ww), min(H, y0 + hh)
    if x1c <= x0c or y1c <= y0c:
        return
    sub = bm[y0c - y0:y1c - y0, x0c - x0:x1c - x0]
    if glow > 0:
        g = cv2.GaussianBlur(sub, (0, 0), 6) * glow * alpha
        img[y0c:y1c, x0c:x1c] += g[..., None] * np.array(tint, F32)[None, None] * 0.5
    a = (sub * alpha)[..., None]
    shadow = cv2.GaussianBlur(sub, (0, 0), 2.5) * alpha * 0.75
    img[y0c:y1c, x0c:x1c] *= (1 - shadow[..., None] * 0.5)
    col = np.array(tint, F32)[None, None] * 0.96 * boost
    img[y0c:y1c, x0c:x1c] = img[y0c:y1c, x0c:x1c] * (1 - a) + col * a

# ----------------------------------------------------------------------------
# watermark: letters standing on the ring plane
WM_TEXT = "AREAJO"
WM_T0 = 24.45          # first letter starts rising
WM_STAG = 0.16         # per-letter stagger
WM_RISE = 1.05         # rise duration
WM_GLINT = 26.35

def build_letters():
    font = ImageFont.truetype(FONT_BOLD, 340)
    out = []
    for ch in WM_TEXT:
        bb = font.getbbox(ch)
        im = Image.new("L", (bb[2] - bb[0] + 24, 480), 0)
        ImageDraw.Draw(im).text((12 - bb[0], 40 - bb[1]), ch, fill=255, font=font)
        a = np.asarray(im, F32) / 255.0
        ys, xs = np.where(a > 0.02)
        a = a[:, xs.min():xs.max() + 1]
        # vertical crop to glyph
        a = a[ys.min():ys.max() + 1]
        out.append(a)
    return out

LETTERS = build_letters()
LET_H = 0.20           # world height of a letter (saturn-local units)
LET_GAP = 0.035
LET_TRACK_Y = 0.015    # baseline gap above ring plane

def letter_layout():
    ws = [LET_H * (a.shape[1] / a.shape[0]) for a in LETTERS]
    total = sum(ws) + LET_GAP * (len(ws) - 1)
    xs = []
    x = -total / 2
    for w_ in ws:
        xs.append(x + w_ / 2)
        x += w_ + LET_GAP
    return xs, ws

LET_XS, LET_WS = letter_layout()
# anchor: in saturn-local frame, ahead of the camera's end position
WM_ANCHOR = np.array([4.58, 0.0, 0.0], F32)  # local x, y(plane), z set below
WM_LOCAL_Z = None

def wm_world(lx, ly):
    """letter-local (x offset, y above plane) -> world position"""
    p = np.array([WM_ANCHOR[0] + lx, ly, WM_ANCHOR[2]], F32)
    return sat_to_world(p[None])[0]

def setup_wm():
    global WM_LOCAL_Z
    # camera end world position -> local frame, put letters ahead of it
    cam_end, _ = camera_at(27.5)
    ce = cam_end - SATURN_POS
    lz = ce[1] * _sS + ce[2] * _cS
    WM_LOCAL_Z = lz + 1.55
    WM_ANCHOR[2] = WM_LOCAL_Z
    WM_ANCHOR[0] = cam_end[0]

def draw_watermark(img, cam, pitch, t, master_alpha=1.0):
    if t < WM_T0 - 0.1:
        return
    # plane screen-line for the rising reveal
    for i, (bm, lx, lw) in enumerate(zip(LETTERS, LET_XS, LET_WS)):
        ts = WM_T0 + WM_STAG * i
        u = (t - ts) / WM_RISE
        if u <= 0:
            continue
        e = float(smootherstep(min(u, 1.0)))
        # rise out of the ring plane: up is -y in this world
        y_final = -(LET_TRACK_Y + LET_H / 2)
        y_start = LET_H * 0.70
        ly = y_start + (y_final - y_start) * e
        alpha = float(clamp01(u * 2.2)) * master_alpha
        pw = wm_world(lx, ly)
        pr = project(pw, cam, pitch)
        if pr is None:
            continue
        sx, sy, depth = pr
        scale = FOCAL * LET_H / depth / bm.shape[0]
        nw = max(2, int(bm.shape[1] * scale))
        nh = max(2, int(bm.shape[0] * scale))
        bms = cv2.resize(bm, (nw, nh), interpolation=cv2.INTER_AREA)
        # world-y of plane at this letter -> screen y
        pr_pl = project(wm_world(lx, 0.0), cam, pitch)
        if pr_pl is not None:
            ycut = pr_pl[1]
            yy = np.arange(nh, dtype=F32) + (sy - nh / 2)
            below = clamp01((yy - ycut) / 6.0 + 1)[:, None]
            bms = bms * (1 - 0.9 * below)
        # metallic vertical gradient
        grad = np.linspace(1.12, 0.72, nh, dtype=F32)[:, None]
        # glint sweep
        gl = 0.0
        if t > WM_GLINT:
            gx = (t - WM_GLINT) / 0.9
            xx = (np.arange(nw, dtype=F32) + (sx - nw / 2) - CX) / W + 0.5
            gl = np.exp(-((xx - gx * 1.3 + 0.15) / 0.06) ** 2)[None, :] * 1.3 * \
                float(1 - smoothstep(0.95, 1.2, gx))
        tintv = 0.94 * grad + gl
        blit_letter(img, bms, sx, sy, alpha, tintv)
        # base sparkle while rising
        if u < 1.15 and pr_pl is not None:
            bx, by = int(sx), int(pr_pl[1])
            if 0 <= bx < W and 0 <= by < H:
                s = float((1 - abs(u - 0.5) * 2) if u < 1 else 0) * 0.8
                if s > 0:
                    lay = np.zeros((H, W), F32)
                    cv2.circle(lay, (bx, by), int(10 + 26 * u), s, -1,
                               lineType=cv2.LINE_AA)
                    lay = cv2.GaussianBlur(lay, (0, 0), 9)
                    img += lay[..., None] * np.array([1.0, 0.95, 0.85],
                                                     F32)[None, None] * 0.35

def blit_letter(img, bm, sx, sy, alpha, tintv):
    hh, ww = bm.shape
    x0 = int(sx - ww / 2)
    y0 = int(sy - hh / 2)
    x0c, y0c = max(0, x0), max(0, y0)
    x1c, y1c = min(W, x0 + ww), min(H, y0 + hh)
    if x1c <= x0c or y1c <= y0c:
        return
    sub = bm[y0c - y0:y1c - y0, x0c - x0:x1c - x0]
    tv = tintv if np.isscalar(tintv) else \
        (tintv[y0c - y0:y1c - y0] if tintv.shape[1] == 1 else
         tintv[y0c - y0:y1c - y0, x0c - x0:x1c - x0])
    g = cv2.GaussianBlur(sub, (0, 0), 7) * 0.55 * alpha
    img[y0c:y1c, x0c:x1c] += g[..., None] * np.array([0.9, 0.92, 1.0],
                                                     F32)[None, None] * 0.6
    a = (sub * alpha)[..., None]
    col = np.stack([np.ones_like(sub) * tv] * 3, -1) * \
        np.array([0.97, 0.97, 1.0], F32)[None, None]
    img[y0c:y1c, x0c:x1c] = img[y0c:y1c, x0c:x1c] * (1 - a) + \
        np.clip(col, 0, 1.6) * a

# ----------------------------------------------------------------------------
# shooting star
def draw_shooting_star(img, t):
    t0, t1 = 13.55, 14.35
    if not (t0 < t < t1):
        return
    u = (t - t0) / (t1 - t0)
    x0, y0 = W * 1.05, H * 0.12
    x1, y1 = W * 0.35, H * 0.34
    hx = x0 + (x1 - x0) * u
    hy = y0 + (y1 - y0) * u
    lay = np.zeros((H, W), F32)
    tail = 0.22
    for k in range(14):
        uu = max(0, u - tail * k / 14)
        px = x0 + (x1 - x0) * uu
        py = y0 + (y1 - y0) * uu
        b = (1 - k / 14) ** 2 * 0.9
        cv2.circle(lay, (int(px), int(py)), max(1, 3 - k // 5), b, -1,
                   lineType=cv2.LINE_AA)
    lay = cv2.GaussianBlur(lay, (0, 0), 1.6)
    fade = math.sin(u * math.pi)
    img += lay[..., None] * np.array([0.95, 0.97, 1.0], F32)[None, None] * fade

# ----------------------------------------------------------------------------
# frame assembly
VIGNETTE = 1.0 - 0.38 * clamp01(
    (np.sqrt(((_px - CX) / (W * 0.62)) ** 2 + ((_py - CY) / (H * 0.62)) ** 2) - 0.55) / 0.6) ** 1.6
VIGNETTE = VIGNETTE.astype(F32)[..., None]

def render_scene(t):
    cam, pitch = camera_at(t)
    dxs, dys, dzs = ray_dirs(pitch)
    # sky via equirect lookup (slow drift)
    yaw = 0.02 * t
    u = ((np.arctan2(dxs * math.cos(yaw) - dzs * math.sin(yaw),
                     dxs * math.sin(yaw) + dzs * math.cos(yaw)) /
          (2 * math.pi) + 0.5) * (SW - 1)).astype(F32)
    v = ((0.5 - np.arcsin(np.clip(dys, -1, 1)) / math.pi) * (SH - 1)).astype(F32)
    sky = sky_image(t)
    img = cv2.remap(sky, u, v, cv2.INTER_LINEAR)

    fog_amt = float(smoothstep(DIVE_T0 + 0.4, DIVE_T0 + 2.0, t))
    # draw far -> near
    order = sorted([b for b in BODIES], key=lambda b: -(b.pos[2] - cam[2]))
    for bdy in order:
        # saturn's rings extend well past its center: keep drawing it even
        # when the camera has flown past the planet itself
        behind_limit = -12 if bdy.name == "saturn" else -2
        if bdy.pos[2] - cam[2] < behind_limit:
            continue
        if bdy.name == "saturn":
            draw_saturn(img, sky, cam, pitch, dxs, dys, dzs, t, fog_amt)
        else:
            if bdy.pos[2] - cam[2] > 0.5:
                draw_sphere(img, cam, pitch, dxs, dys, dzs, bdy, t)
    if cam[2] < 30:
        draw_sun(img, cam, pitch, t)
    draw_particles(img, cam, pitch, fog_amt)
    draw_shooting_star(img, t)
    return img, cam, pitch

def cam_speed(t):
    (c0, _), (c1, _) = camera_at(t - 0.02), camera_at(t + 0.02)
    return float(np.linalg.norm(c1 - c0) / 0.04)

def render_frame(t, rng_grain):
    spd = cam_speed(t)
    nsamp = 3 if spd > 18 else (2 if spd > 7 else 1)
    acc = None
    for k in range(nsamp):
        tt = t + (k - (nsamp - 1) / 2) * (0.55 / FPS / max(nsamp - 1, 1)) if nsamp > 1 else t
        im, cam, pitch = render_scene(tt)
        acc = im if acc is None else acc + im
    img = acc / nsamp
    cam, pitch = camera_at(t)

    # bloom
    lum = img.max(-1)
    bright = clamp01((lum - 0.90) * 2.2)[..., None] * img
    bloom = cv2.GaussianBlur(bright, (0, 0), 12)
    img = img + bloom * 0.33

    # text
    draw_caption(img, t)

    # grade: vignette + scene fades (watermark drawn after so it lingers)
    img *= VIGNETTE
    fade = float(smoothstep(0.0, 0.9, t)) * \
        (1.0 - float(smoothstep(27.15, 28.25, t)))
    img *= fade

    fade_wm = float(smoothstep(0.0, 0.9, t)) * \
        (1.0 - float(smoothstep(27.95, 28.55, t)))
    draw_watermark(img, cam, pitch, t, master_alpha=fade_wm)

    grain = rng_grain.standard_normal((H // 2, W // 2, 1)).astype(F32)
    grain = cv2.resize(grain, (W, H))[..., None]
    img += grain * 0.007 * fade_wm
    return np.clip(img, 0, 1)

# ----------------------------------------------------------------------------
def main():
    setup_wm()
    args = sys.argv[1:]
    if args and args[0] == "--stills":
        ts = [float(x) for x in args[1].split(",")]
        os.makedirs("stills", exist_ok=True)
        for t in ts:
            rg = np.random.default_rng(int(t * 1000))
            img = render_frame(t, rg)
            cv2.imwrite(f"stills/t{t:05.2f}.jpg",
                        cv2.cvtColor((img * 255).astype(np.uint8),
                                     cv2.COLOR_RGB2BGR),
                        [cv2.IMWRITE_JPEG_QUALITY, 90])
            print("still", t, flush=True)
        return
    import imageio
    out = args[0] if args else "saturn_paparazzi_v3.mp4"
    n = int(DUR * FPS)
    wr = imageio.get_writer(out, fps=FPS, codec="libx264", quality=8,
                            pixelformat="yuv420p", macro_block_size=1)
    rg = np.random.default_rng(0)
    import time
    t0 = time.time()
    for i in range(n):
        t = i / FPS
        img = render_frame(t, rg)
        wr.append_data((img * 255).astype(np.uint8))
        if i % 60 == 0:
            el = time.time() - t0
            print(f"frame {i}/{n}  {el:.0f}s elapsed", flush=True)
    wr.close()
    print("wrote", out, flush=True)

if __name__ == "__main__":
    main()
