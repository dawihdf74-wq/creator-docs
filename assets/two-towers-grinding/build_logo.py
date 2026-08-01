#!/usr/bin/env python3
"""Generate the 'GRINDING TOWERS' Roblox-style stacked-tower logo as a self-contained SVG."""
import base64, math, pathlib

HERE = pathlib.Path(__file__).parent
OUT = pathlib.Path("/home/user/creator-docs/assets/two-towers-grinding")
OUT.mkdir(parents=True, exist_ok=True)

font_b64 = base64.b64encode((HERE / "package/files/luckiest-guy-latin-400-normal.woff2").read_bytes()).decode()

DX, DY = 36, -24  # isometric depth offset


OL = "#241048"   # unified cartoon outline


def block(x0, x1, y0, y1, front, top, right, rx=0, sw=5):
    """A 2.5D box: front face + top face + right face, each with a dark toon outline."""
    o = f'stroke="{OL}" stroke-width="{sw}" stroke-linejoin="round"'
    p = []
    p.append(f'<polygon points="{x0},{y0} {x0+DX},{y0+DY} {x1+DX},{y0+DY} {x1},{y0}" fill="{top}" {o}/>')
    p.append(f'<polygon points="{x1},{y0} {x1+DX},{y0+DY} {x1+DX},{y1+DY} {x1},{y1}" fill="{right}" {o}/>')
    p.append(f'<rect x="{x0}" y="{y0}" width="{x1-x0}" height="{y1-y0}" fill="{front}" rx="{rx}" {o}/>')
    return "\n      ".join(p)


def rays(cx, cy, n=14, r=760):
    out = []
    for i in range(n):
        a0 = (360 / n) * i
        a1 = a0 + (360 / n) * 0.5
        x0 = cx + r * math.cos(math.radians(a0)); y0 = cy + r * math.sin(math.radians(a0))
        x1 = cx + r * math.cos(math.radians(a1)); y1 = cy + r * math.sin(math.radians(a1))
        out.append(f'<polygon points="{cx},{cy} {x0:.1f},{y0:.1f} {x1:.1f},{y1:.1f}" fill="#ffffff" opacity="0.10"/>')
    return "\n    ".join(out)


def star(cx, cy, r, color, op=1.0, rot=0):
    """Four-point sparkle."""
    k = r * 0.26
    d = (f"M{cx},{cy-r} Q{cx+k},{cy-k} {cx+r},{cy} Q{cx+k},{cy+k} {cx},{cy+r} "
         f"Q{cx-k},{cy+k} {cx-r},{cy} Q{cx-k},{cy-k} {cx},{cy-r} Z")
    return f'<path d="{d}" fill="{color}" opacity="{op}" transform="rotate({rot} {cx} {cy})"/>'


def coin(cx, cy, r, rot=0):
    return (f'<g transform="rotate({rot} {cx} {cy})">'
            f'<ellipse cx="{cx}" cy="{cy+r*0.12}" rx="{r}" ry="{r}" fill="#c76f00"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#gold)" stroke="#8a4b00" stroke-width="{r*0.16:.1f}"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{r*0.55}" fill="none" stroke="#ffec9e" stroke-width="{r*0.16:.1f}" opacity="0.85"/>'
            f'<ellipse cx="{cx-r*0.3}" cy="{cy-r*0.42}" rx="{r*0.26}" ry="{r*0.14}" fill="#ffffff" opacity="0.9" transform="rotate(-35 {cx-r*0.3} {cy-r*0.42})"/>'
            f'</g>')


def window(x, y, w, h):
    return (f'<g><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{w*0.28:.1f}" fill="#1b2a5e"/>'
            f'<rect x="{x+3}" y="{y+3}" width="{w-6}" height="{h-6}" rx="{w*0.2:.1f}" fill="url(#glass)"/>'
            f'<path d="M{x+5},{y+h-6} L{x+w-6},{y+5} L{x+w-6},{y+15} L{x+14},{y+h-6} Z" fill="#ffffff" opacity="0.45"/></g>')


def word(text, cx, baseline, size, length, fill_id, tilt, ring="#ffffff"):
    """Chunky extruded cartoon text: dark 3D extrude -> black outline -> white inline -> gradient fill."""
    common = (f'x="{cx}" y="{baseline}" text-anchor="middle" font-family="LuckiestGuy" '
              f'font-size="{size}" textLength="{length}" lengthAdjust="spacingAndGlyphs" '
              f'stroke-linejoin="round" stroke-linecap="round"')
    layers = []
    depth = max(6, int(size * 0.14))
    for i in range(depth, 0, -1):
        shade = "#2a1250" if i > 2 else "#3b1c6b"
        layers.append(f'<text {common} transform="translate(0 {i})" fill="{shade}" stroke="{shade}" stroke-width="{size*0.26:.1f}">{text}</text>')
    layers.append(f'<text {common} fill="#180a33" stroke="#180a33" stroke-width="{size*0.30:.1f}">{text}</text>')
    layers.append(f'<text {common} fill="{ring}" stroke="{ring}" stroke-width="{size*0.14:.1f}">{text}</text>')
    layers.append(f'<text {common} fill="url(#{fill_id})">{text}</text>')
    return (f'<g transform="rotate({tilt} {cx} {baseline})" filter="url(#soft)">\n    '
            + "\n    ".join(layers) + "\n  </g>")


svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Grinding Towers game logo">
  <title>Grinding Towers</title>
  <defs>
    <style>
      @font-face {{
        font-family: 'LuckiestGuy';
        font-style: normal;
        font-weight: 400;
        src: url(data:font/woff2;base64,{font_b64}) format('woff2');
      }}
      text {{ font-family: 'LuckiestGuy', 'Arial Black', 'Impact', sans-serif; font-weight: 400; }}
    </style>

    <radialGradient id="sky" cx="50%" cy="38%" r="78%">
      <stop offset="0%" stop-color="#9df3ff"/>
      <stop offset="32%" stop-color="#5aa2ff"/>
      <stop offset="66%" stop-color="#8b3cf0"/>
      <stop offset="100%" stop-color="#2a0f5c"/>
    </radialGradient>

    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fff8c4"/><stop offset="42%" stop-color="#ffd23f"/>
      <stop offset="72%" stop-color="#ffa416"/><stop offset="100%" stop-color="#ff6f00"/>
    </linearGradient>
    <linearGradient id="ice" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#e8fdff"/><stop offset="38%" stop-color="#66e7ff"/>
      <stop offset="74%" stop-color="#17a4f2"/><stop offset="100%" stop-color="#0b53d6"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#b6f7ff"/><stop offset="60%" stop-color="#35c9ff"/><stop offset="100%" stop-color="#1a6ee0"/>
    </linearGradient>

    <linearGradient id="upF" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#5cebff"/><stop offset="100%" stop-color="#0f9fd6"/>
    </linearGradient>
    <linearGradient id="loF" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#c493ff"/><stop offset="100%" stop-color="#6d28d9"/>
    </linearGradient>
    <linearGradient id="corA" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffd07a"/><stop offset="100%" stop-color="#ff7a18"/>
    </linearGradient>
    <linearGradient id="corB" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ff9ec7"/><stop offset="100%" stop-color="#e0338a"/>
    </linearGradient>
    <linearGradient id="roofF" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ff8a8a"/><stop offset="100%" stop-color="#d61e5b"/>
    </linearGradient>

    <filter id="soft" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#1a0640" flood-opacity="0.45"/>
    </filter>
    <filter id="towerShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="12" stdDeviation="9" flood-color="#1a0640" flood-opacity="0.4"/>
    </filter>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="14" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>

    <clipPath id="frame"><rect x="0" y="0" width="512" height="512" rx="72"/></clipPath>
  </defs>

  <g clip-path="url(#frame)">
    <!-- sky + sunburst -->
    <rect width="512" height="512" fill="url(#sky)"/>
    {rays(256, 246)}
    <ellipse cx="256" cy="250" rx="210" ry="210" fill="#ffe9a8" opacity="0.20" filter="url(#glow)"/>

    <!-- clouds -->
    <g fill="#ffffff" opacity="0.55">
      <g transform="translate(58 112) scale(1.05)">
        <circle cx="0" cy="0" r="22"/><circle cx="26" cy="-8" r="17"/><circle cx="-24" cy="6" r="15"/><rect x="-26" y="-2" width="56" height="20" rx="10"/>
      </g>
      <g transform="translate(432 168) scale(0.85)">
        <circle cx="0" cy="0" r="24"/><circle cx="-28" cy="-6" r="17"/><circle cx="24" cy="6" r="14"/><rect x="-28" y="-1" width="54" height="20" rx="10"/>
      </g>
      <g transform="translate(96 300) scale(0.6)" opacity="0.8">
        <circle cx="0" cy="0" r="22"/><circle cx="26" cy="-8" r="16"/><rect x="-14" y="-2" width="42" height="18" rx="9"/>
      </g>
    </g>

    <g transform="translate(0 -10)">
    <ellipse cx="256" cy="486" rx="230" ry="42" fill="#1c0a45" opacity="0.35"/>
    <g filter="url(#towerShadow)">
      <!-- grass + dirt base platform -->
      {block(108, 404, 444, 484, "#8a5426", "#4ade80", "#15803d", rx=14)}
      <g fill="#6b3f1b" opacity="0.6"><ellipse cx="150" cy="468" rx="13" ry="7"/><ellipse cx="366" cy="464" rx="10" ry="6"/></g>
      <polygon points="108,444 144,420 404,420 404,436 108,460" fill="#34d399" stroke="{OL}" stroke-width="5" stroke-linejoin="round"/>

      <!-- ===== TOWER 2 (bottom, bigger) ===== -->
      {block(150, 360, 296, 456, "url(#loF)", "#e6d0ff", "#4c1d95", rx=8)}
      <rect x="162" y="300" width="14" height="152" fill="#ffffff" opacity="0.16"/>
      {window(170, 312, 42, 42)}
      {window(235, 312, 42, 42)}
      {window(300, 312, 42, 42)}
      <!-- doorway -->
      <path d="M222,456 L222,424 a34,34 0 0 1 68,0 L290,456 Z" fill="#2b1250" stroke="{OL}" stroke-width="5" stroke-linejoin="round"/>
      <path d="M229,456 L229,426 a27,27 0 0 1 54,0 L283,456 Z" fill="url(#corA)"/>
      <circle cx="272" cy="440" r="5" fill="#3b0f7a"/>
      <!-- cornice / cap of bottom tower -->
      {block(138, 372, 278, 302, "url(#corA)", "#ffc078", "#c74e05", rx=6)}

      <!-- ===== TOWER 1 (top, smaller footprint) ===== -->
      {block(182, 328, 152, 282, "url(#upF)", "#c9f7ff", "#0a72a6", rx=8)}
      <rect x="192" y="156" width="12" height="126" fill="#ffffff" opacity="0.2"/>
      <rect x="188" y="252" width="134" height="14" rx="7" fill="#0a72a6" opacity="0.35"/>
      <!-- cornice of top tower -->
      {block(172, 338, 136, 158, "url(#corB)", "#ffd3e6", "#a8145f", rx=6)}

      <!-- roof -->
      <polygon points="172,138 338,138 273,70" fill="url(#roofF)" stroke="{OL}" stroke-width="5" stroke-linejoin="round"/>
      <polygon points="338,138 374,114 273,70" fill="#a1123f" stroke="{OL}" stroke-width="5" stroke-linejoin="round"/>
      <polygon points="182,132 271,80 234,132" fill="#ffffff" opacity="0.18"/>
      <!-- flag -->
      <rect x="269" y="36" width="9" height="42" rx="4.5" fill="#a5642c" stroke="{OL}" stroke-width="4"/>
      <path d="M277,41 L325,55 L277,69 Z" fill="#ffd23f" stroke="{OL}" stroke-width="5" stroke-linejoin="round"/>
    </g>
    </g>

    <!-- floating loot -->
    {coin(86, 236, 20, -12)}
    {coin(430, 300, 24, 14)}
    {coin(408, 96, 16, -20)}
    <g>
      <path d="M84,372 l16,-26 16,26 -16,26 Z" fill="#6ee7ff" stroke="#0b53d6" stroke-width="4" stroke-linejoin="round"/>
      <path d="M430,366 l14,-22 14,22 -14,22 Z" fill="#ff8ad1" stroke="#a8145f" stroke-width="4" stroke-linejoin="round"/>
    </g>

    <!-- sparkles -->
    {star(70, 60, 18, "#ffffff", 0.95, 0)}
    {star(462, 52, 13, "#ffef9e", 0.95, 15)}
    {star(30, 400, 12, "#ffffff", 0.8, 0)}
    {star(486, 400, 15, "#ffffff", 0.85, 10)}
    {star(150, 168, 9, "#ffffff", 0.75, 0)}
    {star(364, 200, 8, "#ffffff", 0.7, 0)}

    <!-- ===== WORDMARK ===== -->
    {word("GRINDING", 256, 228, 78, 396, "gold", -3)}
    {word("TOWERS", 256, 388, 56, 222, "ice", 2)}

    <!-- frame -->
    <rect x="6" y="6" width="500" height="500" rx="66" fill="none" stroke="#180a33" stroke-width="12" opacity="0.9"/>
    <rect x="15" y="15" width="482" height="482" rx="58" fill="none" stroke="#ffffff" stroke-width="5" opacity="0.35"/>
  </g>
</svg>
'''

(OUT / "grinding-towers-logo.svg").write_text(svg)
print("wrote", OUT / "grinding-towers-logo.svg", len(svg), "bytes")
