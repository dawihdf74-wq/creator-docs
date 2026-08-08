#!/usr/bin/env python3
"""
Builds Big Bebeh in Blender and exports him for Roblox Studio's 3D importer.

Blender is Z-up and Roblox is Y-up, so he is modelled standing along +Z facing
-Y, and the FBX/glTF exporters convert that to Roblox's Y-up / -Z-forward.
Sizes are in studs, so he arrives at roughly the right scale.

Two techniques do most of the work:

  * Face features are placed with `head_front` / `head_side`, which solve the
    rounded box's surface analytically. Eyes, blush and the stripe therefore sit
    flush on the curvature instead of floating off it or sinking in.

  * Ears, bib and eyes are swept curves with per-point radii, so they taper.
    An earlier version bent a low-poly box and the ears came out visibly kinked.

Object names matter: the Roblox importer carries them onto the MeshParts, and
the Lua colours each part by name.
"""

import math
import os
import sys

import bpy

OUT = os.path.dirname(os.path.abspath(__file__))

# Head as a rounded box: half-extents plus corner radius.
HX, HY, HZ, HR = 7.0, 6.5, 6.0, 2.6

PALETTE = {
    "Head": (150, 104, 66),
    "HeadSide": (106, 68, 40),
    "Stripe": (247, 226, 30),
    "Ear": (247, 226, 30),
    "EarInner": (222, 188, 18),
    "Eye": (20, 18, 18),
    "Blush": (226, 118, 104),
    "Bib": (108, 204, 238),
    "Bow": (132, 215, 243),
    "PaciShield": (48, 128, 222),
    "PaciKnob": (104, 186, 246),
    "PaciDot": (36, 104, 178),
    "PaciRing": (134, 106, 205),
    "Diaper": (248, 246, 240),
    "Foot": (150, 104, 66),
    "Tail": (247, 226, 30),
    "CookieBase": (210, 154, 92),
    "CookieRim": (188, 130, 74),
    "CookieChip": (72, 42, 26),
}

# Materials that want a different finish from the default soft plastic.
FINISH = {
    "Head": dict(rough=0.74, subsurf=0.14),
    "HeadSide": dict(rough=0.76, subsurf=0.10),
    "Foot": dict(rough=0.74, subsurf=0.14),
    "Ear": dict(rough=0.55, subsurf=0.06),
    "EarInner": dict(rough=0.60),
    "Tail": dict(rough=0.72, subsurf=0.06),
    "Bib": dict(rough=0.84, sheen=0.30),
    "Bow": dict(rough=0.84, sheen=0.30),
    "Diaper": dict(rough=0.88, sheen=0.25),
    "PaciKnob": dict(rough=0.30),
    "PaciRing": dict(rough=0.28),
    "PaciShield": dict(rough=0.42),
    "PaciDot": dict(rough=0.30),
    "Eye": dict(rough=0.42),
    "Blush": dict(rough=0.82, subsurf=0.30),
    "CookieBase": dict(rough=0.92),
    "CookieRim": dict(rough=0.92),
    "CookieChip": dict(rough=0.55),
}


def srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


# Surface solvers ------------------------------------------------------------

def head_front(x, z, lift=0.0):
    """Y of the head's front surface directly at (x, z), pushed out by `lift`."""
    dx = max(0.0, abs(x) - (HX - HR))
    dz = max(0.0, abs(z) - (HZ - HR))
    bulge = math.sqrt(max(0.0, HR * HR - dx * dx - dz * dz))
    return -((HY - HR) + bulge + lift)


def head_side(sign, y, z, lift=0.0):
    """X of the head's left/right surface at (y, z)."""
    dy = max(0.0, abs(y) - (HY - HR))
    dz = max(0.0, abs(z) - (HZ - HR))
    bulge = math.sqrt(max(0.0, HR * HR - dy * dy - dz * dz))
    return sign * ((HX - HR) + bulge + lift)


# Blender helpers ------------------------------------------------------------

def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.curves,
                 bpy.data.objects, bpy.data.lights):
        for item in list(coll):
            coll.remove(item)


_materials = {}


def get_material(key):
    if key in _materials:
        return _materials[key]
    rgb = PALETTE[key]
    spec = FINISH.get(key, {})
    mat = bpy.data.materials.new(f"M_{key}")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]

    def put(socket, value):
        if socket in bsdf.inputs:
            bsdf.inputs[socket].default_value = value

    put("Base Color", (*[srgb_to_linear(c) for c in rgb], 1.0))
    put("Roughness", spec.get("rough", 0.62))
    put("Specular IOR Level", 0.28)
    if "subsurf" in spec:
        put("Subsurface Weight", spec["subsurf"])
        put("Subsurface Radius", (1.4, 0.7, 0.5))
    if "sheen" in spec:
        put("Sheen Weight", spec["sheen"])
        put("Sheen Roughness", 0.4)
    _materials[key] = mat
    return mat


def finish(obj, name, mat_key, smooth=True, smooth_angle=48):
    obj.name = name
    obj.data.name = name
    obj.data.materials.clear()
    obj.data.materials.append(get_material(mat_key))
    bpy.context.view_layer.objects.active = obj
    if smooth:
        bpy.ops.object.shade_smooth()
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))
        except Exception:
            pass
    return obj


def solo_select(obj):
    for other in list(bpy.context.selected_objects):
        other.select_set(False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)


def apply_all(obj):
    solo_select(obj)
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def rounded_box(name, size, loc, mat_key, radius=1.0, segments=6, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    bev = obj.modifiers.new("Bevel", "BEVEL")
    bev.width = radius
    bev.segments = segments
    bev.limit_method = "ANGLE"
    bev.angle_limit = math.radians(30)
    apply_all(obj)
    return finish(obj, name, mat_key)


def ball(name, size, loc, mat_key, rot=(0, 0, 0), segments=40, rings=20):
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=0.5, location=(0, 0, 0), segments=segments, ring_count=rings
    )
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    obj.rotation_euler = rot
    obj.location = loc
    bpy.ops.object.transform_apply(location=True, rotation=True)
    return finish(obj, name, mat_key)


def torus(name, major, minor, loc, mat_key, rot=(0, 0, 0), squash=None):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor,
        major_segments=44, minor_segments=16, location=(0, 0, 0),
    )
    obj = bpy.context.object
    if squash:
        obj.scale = squash
        bpy.ops.object.transform_apply(scale=True)
    obj.rotation_euler = rot
    obj.location = loc
    bpy.ops.object.transform_apply(location=True, rotation=True)
    return finish(obj, name, mat_key)


def sweep(name, points, thickness, mat_key, radii=None, flatten=None,
          loc=(0, 0, 0), rot=(0, 0, 0), res=14, caps=True, handles=None):
    """
    A smooth swept tube through the given points, optionally tapered per point
    and squashed into a blade.

    `flatten` scales about the object origin, so a band sitting at y = -7 would
    be dragged to y = -2 and end up buried inside the head. The points are
    therefore recentred on their own centroid first and the centroid is folded
    back into the final location, which keeps the squash purely local.
    """
    if flatten:
        n = len(points)
        cx = sum(p[0] for p in points) / n
        cy = sum(p[1] for p in points) / n
        cz = sum(p[2] for p in points) / n
        points = [(p[0] - cx, p[1] - cy, p[2] - cz) for p in points]
        loc = (loc[0] + cx, loc[1] + cy, loc[2] + cz)

    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = thickness
    curve.bevel_resolution = 8
    curve.resolution_u = res
    curve.use_fill_caps = caps
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for i, p in enumerate(points):
        bp = spline.bezier_points[i]
        bp.co = p
        kind = handles[i] if handles else "AUTO"
        bp.handle_left_type = kind
        bp.handle_right_type = kind
        if radii:
            bp.radius = radii[i]

    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    solo_select(obj)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    if flatten:
        obj.scale = flatten
        bpy.ops.object.transform_apply(scale=True)
    obj.rotation_euler = rot
    obj.location = loc
    bpy.ops.object.transform_apply(location=True, rotation=True)
    return finish(obj, name, mat_key)


# The model ------------------------------------------------------------------

def build():
    clear_scene()
    parts = []

    # Head -------------------------------------------------------------------
    parts.append(
        rounded_box("Head", (HX * 2, HY * 2, HZ * 2), (0, 0, 0), "Head",
                    radius=HR, segments=12)
    )

    # The reference has his left side in shadow as a distinctly darker panel.
    parts.append(
        rounded_box("HeadSide", (0.30, 6.4, 6.2), (-6.99, 0.5, 0.0), "HeadSide",
                    radius=2.0, segments=8)
    )

    # Yellow stripe down his left side, following the side's curvature.
    stripe_pts, stripe_radii = [], []
    for i in range(7):
        t = i / 6
        z = 3.5 - t * 7.0
        stripe_pts.append((head_side(-1, 0.9, z, lift=0.06), 0.9, z))
        stripe_radii.append(1.0 - 0.28 * abs(t - 0.5) * 2)
    parts.append(
        sweep("Stripe", stripe_pts, 1.6, "Stripe", radii=stripe_radii,
              flatten=(0.13, 1.0, 1.0))
    )

    # Ears -------------------------------------------------------------------
    # Long tapered blades sweeping up and out, with a gentle backward curl.
    for side, tag in ((-1, "L"), (1, "R")):
        path = [
            (side * 2.6, 0.9, 3.0),
            (side * 5.6, 0.5, 7.4),
            (side * 9.6, -0.1, 11.2),
            (side * 13.8, -0.8, 14.2),
            (side * 17.0, -1.5, 16.0),
        ]
        parts.append(
            sweep(f"Ear{tag}", path, 2.0, "Ear",
                  radii=[1.00, 1.10, 1.00, 0.68, 0.13],
                  flatten=(1.0, 0.50, 1.0))
        )
        # Inner ear rides the same path, so the two can never misalign.
        inner = [(x * 0.985, y - 0.62, z) for (x, y, z) in path[:-1]]
        parts.append(
            sweep(f"EarInner{tag}", inner, 1.9, "EarInner",
                  radii=[0.46, 0.56, 0.46, 0.22],
                  flatten=(1.0, 0.24, 1.0))
        )

    # Eyes -------------------------------------------------------------------
    # Sleepy closed arcs, thick in the middle and tapering to a point, sitting
    # exactly on the face curvature.
    for side, tag in ((-1, "L"), (1, "R")):
        # inner tip -> apex -> outer tip, with VECTOR handles so the apex stays
        # a crisp point and the legs run straight, matching the reference.
        shape = [(side * 1.45, 1.60), (side * 3.40, 4.15), (side * 6.25, -0.30)]
        pts = [(x, head_front(x, z, lift=0.03), z) for (x, z) in shape]
        parts.append(
            sweep(f"Eye{tag}", pts, 0.56, "Eye", radii=[0.46, 1.0, 0.38],
                  res=18, handles=["VECTOR", "AUTO", "VECTOR"])
        )

    # Blush ------------------------------------------------------------------
    for side, tag in ((-1, "L"), (1, "R")):
        x, z = side * 5.2, 0.15
        parts.append(
            ball(f"Blush{tag}", (4.4, 1.3, 2.8),
                 (x, head_front(x, z, lift=-0.35), z), "Blush",
                 rot=(0, 0, math.radians(side * -6)))
        )

    # Bib --------------------------------------------------------------------
    # One sweeping band across the chin and up both sides, tapered at the tips.
    bib_pts, bib_radii = [], []
    for i in range(7):
        t = i / 6
        x = -6.1 + t * 12.2
        z = -1.1 - 3.4 * math.cos((t - 0.5) * math.pi * 0.92)
        bib_pts.append((x, head_front(x, z, lift=0.55), z))
        bib_radii.append(0.46 + 0.54 * math.sin(t * math.pi) ** 0.5)
    parts.append(
        sweep("Bib", bib_pts, 2.5, "Bib", radii=bib_radii,
              flatten=(1.0, 0.30, 1.0), res=16)
    )

    # Bow at the centre of the bib.
    bow_z = -6.05
    bow_y = head_front(0, -4.2, lift=0.55) - 1.05  # just proud of the bib face
    for side, tag in ((-1, "L"), (1, "R")):
        parts.append(
            torus(f"BowLoop{tag}", 1.30, 0.40, (side * 1.75, bow_y, bow_z + 0.15), "Bow",
                  rot=(math.radians(90), 0, math.radians(side * 26)),
                  squash=(1.0, 0.55, 1.0))
        )
        # Ribbon tails trailing down and outward from the knot.
        parts.append(
            sweep(f"BowTail{tag}", [(0, 0, 0), (side * 0.85, -0.1, -1.05),
                                    (side * 1.45, -0.2, -2.15)],
                  0.72, "Bow", radii=[0.95, 0.82, 0.52],
                  flatten=(1.0, 0.45, 1.0), loc=(side * 0.45, bow_y + 0.05, bow_z - 0.45))
        )
    parts.append(ball("BowKnot", (1.30, 1.05, 1.15), (0, bow_y - 0.35, bow_z), "Bow"))

    # Pacifier ---------------------------------------------------------------
    # Shield, knob and ring all share one centre line so they read as one object.
    paci_z = -3.15
    paci_y = head_front(0, paci_z)
    parts.append(
        ball("PaciShield", (7.0, 1.8, 4.4), (0, paci_y - 0.9, paci_z), "PaciShield")
    )
    for side, tag in ((-1, "L"), (1, "R")):
        parts.append(
            ball(f"PaciDot{tag}", (0.62, 0.62, 0.62),
                 (side * 2.0, paci_y - 1.72, paci_z + 1.0), "PaciDot")
        )
    parts.append(
        ball("PaciKnob", (3.5, 2.7, 3.5), (0, paci_y - 1.9, paci_z), "PaciKnob")
    )
    parts.append(
        torus("PaciRing", 1.85, 0.46, (0, paci_y - 3.2, paci_z - 1.0), "PaciRing",
              rot=(math.radians(90), 0, 0), squash=(1.0, 1.0, 0.94))
    )

    # Body -------------------------------------------------------------------
    parts.append(
        rounded_box("Diaper", (13.2, 13.2, 3.8), (0, 0, -8.3), "Diaper",
                    radius=1.7, segments=8)
    )
    # Folded-over tab at the front of the diaper.
    parts.append(
        rounded_box("DiaperTab", (7.4, 1.6, 2.5), (0, -6.9, -7.4),
                    "Diaper", radius=0.75, segments=6)
    )

    for side, tag in ((-1, "L"), (1, "R")):
        parts.append(
            ball(f"Foot{tag}", (4.7, 6.4, 3.0), (side * 3.4, -1.6, -10.7), "Foot",
                 rot=(0, 0, math.radians(side * 7)))
        )
    parts.append(ball("Tail", (3.4, 3.4, 3.2), (0, 6.9, -8.8), "Tail"))

    return parts


def build_cookie():
    """A single cookie: domed disc with a rounded rim and embedded chips."""
    clear_scene()
    parts = []

    bpy.ops.mesh.primitive_cylinder_add(vertices=56, radius=1.62, depth=0.46,
                                        location=(0, 0, 0))
    disc = bpy.context.object
    bev = disc.modifiers.new("Bevel", "BEVEL")
    bev.width = 0.20
    bev.segments = 6
    bev.limit_method = "ANGLE"
    bev.angle_limit = math.radians(30)

    # A touch of noise so it reads as baked rather than machined.
    tex = bpy.data.textures.new("CookieNoise", "CLOUDS")
    tex.noise_scale = 0.85
    disp = disc.modifiers.new("Bump", "DISPLACE")
    disp.texture = tex
    disp.strength = 0.09
    disp.mid_level = 0.5
    apply_all(disc)
    parts.append(finish(disc, "CookieBase", "CookieBase"))

    # Chocolate chips, partly sunk into the top so they read as embedded.
    spots = [(0.00, 0.62), (0.78, -0.30), (-0.82, -0.18), (0.30, -0.95),
             (-0.55, 0.85), (1.02, 0.55), (-1.05, -0.78), (0.55, 1.02)]
    for i, (x, y) in enumerate(spots, start=1):
        parts.append(
            ball(f"CookieChip{i}", (0.46, 0.44, 0.38), (x, y, 0.20), "CookieChip",
                 rot=(0, 0, math.radians(i * 37)), segments=20, rings=12)
        )
    return parts


# Presentation ---------------------------------------------------------------

def add_lighting_and_camera(shot):
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.30, 0.31, 0.34, 1)
    bg.inputs["Strength"].default_value = 1.0
    bpy.context.scene.world = world

    # Backdrop: a plain grey card so white parts stay readable and the world
    # can be kept dim enough not to blow out saturated colours.
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 90, 0),
                                     rotation=(math.radians(90), 0, 0))
    card = bpy.context.object
    card.name = "Backdrop"
    card_mat = bpy.data.materials.new("M_Backdrop")
    card_mat.use_nodes = True
    cb = card_mat.node_tree.nodes["Principled BSDF"]
    cb.inputs["Base Color"].default_value = (0.62, 0.63, 0.66, 1)
    cb.inputs["Roughness"].default_value = 1.0
    card.data.materials.append(card_mat)

    def area(name, loc, rot, energy, size):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.size = size
        obj = bpy.data.objects.new(name, data)
        obj.location = loc
        obj.rotation_euler = rot
        bpy.context.collection.objects.link(obj)

    area("Key", (-30, -38, 30), (math.radians(50), 0, math.radians(-38)), 52000, 30)
    area("Fill", (34, -26, 4), (math.radians(84), 0, math.radians(54)), 19000, 34)
    area("Rim", (12, 34, 26), (math.radians(-56), 0, math.radians(162)), 21000, 26)
    area("Under", (0, -20, -30), (math.radians(-58), 0, 0), 7000, 28)

    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 90
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam

    if shot == "cookie":
        cam_data.lens = 70
        cam.location = (-3.4, -4.6, 3.6)
        cam.rotation_euler = (math.radians(56), 0, math.radians(-36))
    elif shot == "front":
        cam.location = (0, -122, 2.0)
        cam.rotation_euler = (math.radians(90), 0, 0)
    else:
        cam.location = (-62, -92, 30)
        cam.rotation_euler = (math.radians(72), 0, math.radians(-34))


def render(path, shot, samples=110, res=(900, 940)):
    for obj in [o for o in bpy.data.objects
                if o.type in {"LIGHT", "CAMERA"} or o.name == "Backdrop"]:
        bpy.data.objects.remove(obj, do_unlink=True)
    add_lighting_and_camera(shot)

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.render.filepath = path
    scene.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)

    img = bpy.data.images.load(path)
    px = list(img.pixels)
    n = len(px) // 4
    clipped = sum(1 for i in range(n)
                  if max(px[i*4], px[i*4+1], px[i*4+2]) >= 0.999)
    bpy.data.images.remove(img)
    print(f"rendered {path}  clipped={100.0*clipped/n:.2f}% of pixels")


def export(parts, base="BigBebeh"):
    for obj in bpy.data.objects:
        obj.select_set(obj in parts)

    total, worst = 0, ("", 0)
    for obj in parts:
        obj.data.calc_loop_triangles()
        n = len(obj.data.loop_triangles)
        total += n
        if n > worst[1]:
            worst = (obj.name, n)
    print(f"MODEL {base}: {len(parts)} objects, {total} triangles total")
    print(f"       heaviest: {worst[0]} at {worst[1]} tris (Roblox allows 10k per mesh)")
    if worst[1] > 10000:
        print("       WARNING: over the per-mesh limit")

    fbx = os.path.join(OUT, f"{base}.fbx")
    bpy.ops.export_scene.fbx(
        filepath=fbx, use_selection=True, axis_forward="-Z", axis_up="Y",
        global_scale=1.0, apply_unit_scale=True, bake_space_transform=True,
        mesh_smooth_type="FACE", path_mode="COPY",
    )
    print("exported", fbx, os.path.getsize(fbx), "bytes")

    glb = os.path.join(OUT, f"{base}.glb")
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True)
    print("exported", glb, os.path.getsize(glb), "bytes")

    blend = os.path.join(OUT, f"{base}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print("saved", blend, os.path.getsize(blend), "bytes")


if __name__ == "__main__":
    if "--cookie" in sys.argv:
        cookie = build_cookie()
        if "--render" in sys.argv:
            render(os.path.join(OUT, "cookie.png"), "cookie", res=(560, 560))
        export(cookie, base="BigBebehCookie")
    else:
        parts = build()
        if "--render" in sys.argv:
            render(os.path.join(OUT, "bebeh_front.png"), "front")
            render(os.path.join(OUT, "bebeh_34.png"), "34")
        export(parts)
