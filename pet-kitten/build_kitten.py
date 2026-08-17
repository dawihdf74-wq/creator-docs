#!/usr/bin/env python3
"""
Generates a Pet-Simulator-X-style kitten pet, rigged and animated, exported for Roblox Studio.

Run with Blender-as-a-module:      python3 build_kitten.py
Or with a Blender executable:      blender --background --python build_kitten.py

Everything is built from script, so the model is reproducible: tweak the constants below and
re-run to get a new build. Nothing is authored by hand in a .blend.

Design notes
------------
* Everything is a flat-shaded cuboid - hard edges, no subdivision, no smooth shading. That is
  the Pet Sim cube-pet look, and it lands at ~156 triangles. Wedge shapes (ears, bow lobes)
  taper to a narrow edge rather than collapsing to a point, so every face stays a quad.
* Roblox allows one material per mesh object, so the single texture carries both the drawn face
  and a grid of flat colour swatches. Every face pins into a swatch except the head box's front,
  which the face art is projected onto. The head's front face is deliberately square, because a
  non-square one stretches the artwork.
* The face is drawn procedurally, but dropping a square image at textures/face_source.png
  overrides it - the way to get a true 1-to-1 with hand-drawn brand art.
* Animations use location and rotation keys only. Roblox drives joints with CFrames, which carry
  no scale, so bone-scale squash-and-stretch would be silently dropped on import. The bounce
  fakes squash by moving parts instead.

Specs enforced (see content/en-us/art/modeling/specifications.md in this repo):
  <= 20,000 triangles, watertight, quads, single material, <= 4 bone influences per vertex,
  root bone at origin carrying no weights, bone rest transforms frozen.
"""

import math
import os
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector, Euler, Matrix

# --------------------------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))
DIR_SOURCE = os.path.join(HERE, "source")
DIR_BUILD = os.path.join(HERE, "build")
DIR_TEX = os.path.join(HERE, "textures")
DIR_PREVIEW = os.path.join(HERE, "previews")

NAME = "Kitten"

# Blender scene is set to 1 unit = 1 cm (unit scale 0.01, length centimetres) per Roblox's
# export requirements. 1 Roblox stud is ~28 cm, so ~80 units tall is a ~2.9 stud pet.
STUD_CM = 28.0
TARGET_HEIGHT_CM = 80.0

# Texture atlas, 512px, split into two zones:
#   - the face is drawn into the top-left quadrant and mapped onto the head box's front face
#   - the bottom half is a 4x2 grid of flat colour swatches every other face pins into
# UVs sit in the middle 50% of each swatch so mipmapping cannot bleed one colour into its
# neighbour.
ATLAS_PX = 512
SWATCH_COLS = 4
SWATCH_ROWS = 2
SWATCH_ZONE_V = 0.5                     # swatches occupy v in [0, 0.5]

FACE_RECT = (0.02, 0.52, 0.48, 0.98)    # u0, v0, u1, v1 - the drawn face, inset from the edges

# Drop a square image here to use real artwork as the face instead of the procedural one.
FACE_SOURCE = os.path.join(DIR_TEX, "face_source.png")

PINK = 0      # body, head, ears, tail
HOTPINK = 1   # inner ears
BLACK = 2     # bow, feet
WHITE = 3     # spare / fail-soft

PALETTE = {
    PINK: "#F7B6CE",
    HOTPINK: "#FF6FA5",
    BLACK: "#1A1A1A",
    WHITE: "#FFFFFF",
}

# The kitten faces -Y. With up = +Z that puts the character's own left at +X.
FRONT = -1.0

BONE_NAMES = [
    "Root", "Body", "Head", "Ear_L", "Ear_R",
    "Tail_01", "Tail_02", "Leg_FL", "Leg_FR", "Leg_BL", "Leg_BR",
]

MAX_TRIS = 20000
MAX_INFLUENCES = 4


def log(msg):
    print(f"[kitten] {msg}", flush=True)


# --------------------------------------------------------------------------------------------
# Scene helpers
# --------------------------------------------------------------------------------------------

def reset_scene():
    """Wipe the startup scene and set Roblox's expected units."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 0.01      # 1 Blender unit == 1 cm
    scene.unit_settings.length_unit = "CENTIMETERS"
    log(f"scene units: scale_length={scene.unit_settings.scale_length} "
        f"length_unit={scene.unit_settings.length_unit}")


def apply_modifiers(obj):
    """Bake an object's modifier stack into its mesh (depsgraph route, safe in background)."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    baked = bpy.data.meshes.new_from_object(evaluated)
    obj.modifiers.clear()
    old = obj.data
    obj.data = baked
    bpy.data.meshes.remove(old)


def make_box(name, location=(0, 0, 0), scale=(1, 1, 1), rotation=(0, 0, 0),
             taper_axis=None, taper_neg=1.0, taper_pos=1.0):
    """
    A flat-shaded cuboid - the single building block for the whole pet.

    taper_neg / taper_pos scale the cross-section at the negative / positive end of taper_axis,
    turning the cube into a wedge for the ears and the bow lobes. Tapering to a narrow edge
    rather than collapsing to a point keeps every face a quad while still reading as a triangle.

    `scale` is the half-extent on each axis. No subdivision and no smooth shading: the hard
    edges and flat facets are the whole point of the look.

    All transforms are baked straight into the mesh data via matrix_basis. Reading
    obj.matrix_world here would return a stale identity, because a freshly linked object has not
    been through a depsgraph evaluation yet.
    """
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)

    if taper_axis is not None:
        axis = {"X": 0, "Y": 1, "Z": 2}[taper_axis]
        others = [i for i in (0, 1, 2) if i != axis]
        for v in bm.verts:
            factor = taper_pos if v.co[axis] > 0 else taper_neg
            for i in others:
                v.co[i] *= factor

    bm.to_mesh(mesh)
    bm.free()

    for v in mesh.vertices:
        for i in range(3):
            v.co[i] *= scale[i]

    matrix = Matrix.Translation(Vector(location)) @ Euler(rotation, "XYZ").to_matrix().to_4x4()
    mesh.transform(matrix)

    for poly in mesh.polygons:
        poly.use_smooth = False

    return obj


def swatch_rect(swatch):
    """UV rect of a flat colour cell, inset so mip levels can't bleed between neighbours."""
    cell_u = 1.0 / SWATCH_COLS
    cell_v = SWATCH_ZONE_V / SWATCH_ROWS
    col = swatch % SWATCH_COLS
    row = swatch // SWATCH_COLS
    iu, iv = cell_u * 0.25, cell_v * 0.25
    return (col * cell_u + iu, row * cell_v + iv,
            (col + 1) * cell_u - iu, (row + 1) * cell_v - iv)


def face_direction(normal):
    """Classify a box face by its normal's dominant axis and sign."""
    axis = max(range(3), key=lambda i: abs(normal[i]))
    positive = normal[axis] > 0
    if axis == 0:
        return "left" if positive else "right"      # character's left is +X
    if axis == 1:
        return "back" if positive else "front"      # the pet faces -Y
    return "top" if positive else "bottom"


def set_part_uv(obj, swatch, overrides=None):
    """
    Pin each face into a palette swatch, with optional per-direction overrides.

    An override value is either another swatch index or the literal string "face", which
    projects the drawn face texture onto that side.
    """
    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    uvs = mesh.uv_layers[0]
    overrides = overrides or {}

    for poly in mesh.polygons:
        target = overrides.get(face_direction(poly.normal), swatch)

        if target == "face":
            project_face_uv(mesh, poly, uvs)
            continue

        u0, v0, u1, v1 = swatch_rect(target)
        corners = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
        for i, loop_index in enumerate(poly.loop_indices):
            uvs.data[loop_index].uv = corners[i % 4]


def project_face_uv(mesh, poly, uvs):
    """
    Map the drawn face onto a front-facing quad, derived from vertex positions rather than loop
    order so the orientation is deterministic.

    Viewed from -Y with up = +Z, screen-right is -X. So u must grow as x shrinks; getting that
    backwards gives a mirrored face, and swapping v gives an upside-down one - neither of which
    any geometry assertion would catch.
    """
    coords = [mesh.vertices[i].co for i in poly.vertices]
    x_min, x_max = min(c.x for c in coords), max(c.x for c in coords)
    z_min, z_max = min(c.z for c in coords), max(c.z for c in coords)
    u0, v0, u1, v1 = FACE_RECT

    for loop_index, vert_index in zip(poly.loop_indices, poly.vertices):
        co = mesh.vertices[vert_index].co
        fu = (x_max - co.x) / (x_max - x_min) if x_max > x_min else 0.0
        fv = (co.z - z_min) / (z_max - z_min) if z_max > z_min else 0.0
        uvs.data[loop_index].uv = (u0 + fu * (u1 - u0), v0 + fv * (v1 - v0))


def set_part_bones(obj, bones):
    """
    Weight a part to one bone, or blend it across several. join() merges vertex groups by name,
    so tagging each part before the join is all the skinning this model needs - no heat-map
    solve to fail, and the influence count is known by construction.
    """
    if isinstance(bones, str):
        bones = {bones: 1.0}
    indices = range(len(obj.data.vertices))
    for bone_name, weight in bones.items():
        if weight <= 0.0:
            continue
        group = obj.vertex_groups.new(name=bone_name)
        group.add(indices, weight, "REPLACE")


def part(name, bone, swatch, overrides=None, **kwargs):
    """Build one body part and tag it with its bone(s) and palette colour."""
    obj = make_box(name, **kwargs)
    set_part_uv(obj, swatch, overrides)
    set_part_bones(obj, bone)
    return obj


# --------------------------------------------------------------------------------------------
# Texture
# --------------------------------------------------------------------------------------------

def rgb01(hex_colour):
    """
    Hex to 0..1, with no sRGB-to-linear conversion.

    Blender writes byte-image pixels straight through to the PNG without applying the datablock's
    colourspace, so values written here land in the file verbatim. Converting to linear first
    would bake the transform into the file and ship visibly oversaturated colours.
    """
    return np.array([int(hex_colour[i:i + 2], 16) / 255.0 for i in (1, 3, 5)], dtype=np.float32)


# Face layout in 0..1 coordinates of the face zone, origin bottom-left.
#
# This reproduces the kawaii face from the user's own template art - large dark doll eyes with
# lashes at the outer corners, big glossy highlights, soft pink blush and a small "w" mouth.
# Deliberately no cat whiskers: those came from the Pet Sim reference, not from their brand art.
#
# BLUSH_X is measured out from the centre line - keep it wide enough to land on the cheeks, or
# the blush merges with the mouth into one pink band across the middle of the face.
EYE_X, EYE_Y = 0.275, 0.585
EYE_RX, EYE_RY = 0.135, 0.170
LASH_COUNT = 3
MOUTH_Y = 0.330
BLUSH_X, BLUSH_Y = 0.330, 0.345


def _ellipse(xx, yy, cx, cy, rx, ry):
    return ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1.0


def _segment(xx, yy, x0, y0, x1, y1, width):
    """Distance field to a line segment, for whiskers and mouth strokes."""
    dx, dy = x1 - x0, y1 - y0
    length_sq = dx * dx + dy * dy
    t = np.clip(((xx - x0) * dx + (yy - y0) * dy) / length_sq, 0.0, 1.0)
    return np.hypot(xx - (x0 + t * dx), yy - (y0 + t * dy)) <= width


def load_face_image(size):
    """
    Use the artist's own face artwork if they've dropped it in, instead of the drawn face.

    Put a square image at textures/face_source.png and it becomes the pet's face verbatim - the
    only way to get a true 1-to-1 with hand-drawn brand art. Anything with alpha is composited
    over the body pink so the face still sits flush on the box. Returns None when absent.
    """
    if not os.path.exists(FACE_SOURCE):
        return None

    img = bpy.data.images.load(FACE_SOURCE)
    w, h = img.size
    src = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)

    if img.colorspace_settings.name != "sRGB":
        log(f"  note: {os.path.basename(FACE_SOURCE)} is not sRGB, colours may shift")

    # Nearest-neighbour resample to the atlas slot - no scipy/Pillow in this environment.
    rows = (np.arange(size) * h // size).clip(0, h - 1)
    cols = (np.arange(size) * w // size).clip(0, w - 1)
    resampled = src[rows][:, cols]

    rgb, alpha = resampled[:, :, 0:3], resampled[:, :, 3:4]
    return rgb * alpha + rgb01(PALETTE[PINK]) * (1.0 - alpha)


def draw_face(size):
    """
    Draw the cat face at `size` px square, returning linear RGB.

    Rendered at 4x and box-downsampled, because the alternative - hard boolean masks at final
    resolution - gives visibly jagged eyes on a face this large on screen.
    """
    ss = 4
    n = size * ss
    axis = (np.arange(n, dtype=np.float32) + 0.5) / n
    xx, yy = np.meshgrid(axis, axis)          # yy grows upward, matching Blender's image origin

    pink, hotpink = rgb01(PALETTE[PINK]), rgb01(PALETTE[HOTPINK])
    black, white = rgb01(PALETTE[BLACK]), rgb01(PALETTE[WHITE])

    buf = np.empty((n, n, 3), dtype=np.float32)
    buf[:, :] = pink

    def paint(mask, colour):
        buf[mask] = colour

    for sx in (-1, 1):
        cx = 0.5 + sx * EYE_X

        # Blush first, so the eye sits over it rather than being cut into by it.
        paint(_ellipse(xx, yy, 0.5 + sx * BLUSH_X, BLUSH_Y, 0.082, 0.052), hotpink)

        # Lashes fan up and out from the eye's outer corner.
        for i in range(LASH_COUNT):
            t = i / max(LASH_COUNT - 1, 1)
            angle = math.radians(18.0 + t * 42.0)
            x0 = cx + sx * EYE_RX * 0.80
            y0 = EYE_Y + EYE_RY * (0.30 + t * 0.52)
            reach = 0.088 - t * 0.018
            paint(_segment(xx, yy, x0, y0,
                           x0 + sx * reach * math.cos(angle),
                           y0 + reach * math.sin(angle), 0.0088), black)

        # Big dark doll eye with two glossy highlights - the template's signature look.
        paint(_ellipse(xx, yy, cx, EYE_Y, EYE_RX, EYE_RY), black)
        paint(_ellipse(xx, yy, cx - sx * 0.040, EYE_Y + 0.058, 0.050, 0.058), white)
        paint(_ellipse(xx, yy, cx + sx * 0.052, EYE_Y - 0.060, 0.028, 0.032), white)

    # Small "w" mouth, centred.
    for sx in (-1, 1):
        paint(_segment(xx, yy, 0.5, MOUTH_Y + 0.034,
                       0.5 + sx * 0.048, MOUTH_Y - 0.002, 0.0090), black)
        paint(_segment(xx, yy, 0.5 + sx * 0.048, MOUTH_Y - 0.002,
                       0.5 + sx * 0.088, MOUTH_Y + 0.036, 0.0090), black)

    return buf.reshape(size, ss, size, ss, 3).mean(axis=(1, 3))


def build_texture():
    """Write the atlas: flat colour swatches plus the drawn face."""
    img = bpy.data.images.new(f"{NAME}_ALB", ATLAS_PX, ATLAS_PX, alpha=False)
    img.colorspace_settings.name = "sRGB"

    pixels = np.zeros((ATLAS_PX, ATLAS_PX, 4), dtype=np.float32)
    pixels[:, :, 3] = 1.0
    # Anything not explicitly painted falls back to body pink, so a UV mistake fails soft
    # rather than showing up as a black patch.
    pixels[:, :, 0:3] = rgb01(PALETTE[PINK])

    cell_w = ATLAS_PX // SWATCH_COLS
    cell_h = int(ATLAS_PX * SWATCH_ZONE_V) // SWATCH_ROWS
    for swatch, hex_colour in PALETTE.items():
        col, row = swatch % SWATCH_COLS, swatch // SWATCH_COLS
        pixels[row * cell_h:(row + 1) * cell_h,
               col * cell_w:(col + 1) * cell_w, 0:3] = rgb01(hex_colour)

    u0, v0, u1, v1 = FACE_RECT
    x0, x1 = int(u0 * ATLAS_PX), int(u1 * ATLAS_PX)
    y0, y1 = int(v0 * ATLAS_PX), int(v1 * ATLAS_PX)
    face_px = min(x1 - x0, y1 - y0)

    supplied = load_face_image(face_px)
    if supplied is not None:
        pixels[y0:y0 + face_px, x0:x0 + face_px, 0:3] = supplied
        source = f"from {os.path.basename(FACE_SOURCE)}"
    else:
        pixels[y0:y0 + face_px, x0:x0 + face_px, 0:3] = draw_face(face_px)
        source = "drawn"

    img.pixels = pixels.reshape(-1).tolist()

    out = os.path.join(DIR_TEX, f"{NAME}_ALB.png")
    img.filepath_raw = out
    img.file_format = "PNG"
    img.save()
    log(f"texture: {out} ({ATLAS_PX}x{ATLAS_PX}, {len(PALETTE)} swatches, "
        f"{face_px}px face, {source})")
    return img, out


def build_material(img):
    """
    One material, one image texture. Linear interpolation, unlike the flat-swatch-only version:
    the drawn face needs smoothing, and the swatches are unaffected because their UVs sit well
    inside each cell.
    """
    mat = bpy.data.materials.new(f"{NAME}_Mat")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputMaterial")
    out.location = (400, 0)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (100, 0)
    bsdf.inputs["Roughness"].default_value = 0.45
    tex = nodes.new("ShaderNodeTexImage")
    tex.location = (-250, 0)
    tex.image = img
    tex.interpolation = "Linear"

    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


# --------------------------------------------------------------------------------------------
# Model
# --------------------------------------------------------------------------------------------

# The head box's front face is deliberately SQUARE (x and z half-extents equal). The face
# texture is square, so any other aspect would stretch the artwork - 46x40 stretched it 15%
# horizontally, which is exactly the kind of distortion that ruins a 1-to-1 with brand art.
HEAD_C = Vector((0.0, -7.0, 44.0))     # dominant front box, carries the face
HEAD_R = Vector((23.0, 18.0, 23.0))
# Deep enough to reach forward over the front feet as well as back to the rear ones. A shallower
# body left the front feet floating with nothing joining them to the model.
BODY_C = Vector((0.0, 8.0, 21.0))      # smaller box tucked behind and below
BODY_R = Vector((16.5, 20.0, 15.0))


def build_model(mat):
    """Assemble the kitten from tagged boxes, then join into a single mesh object."""
    parts = []

    # --- head and body: two cuboids, the head dominant and carrying the drawn face -------
    parts.append(part("head", "Head", PINK, overrides={"front": "face"},
                      location=HEAD_C, scale=HEAD_R))
    parts.append(part("body", "Body", PINK, location=BODY_C, scale=BODY_R))

    # --- feet: small black boxes, the reference's contrast accent ------------------------
    # Tall enough to overlap the body box; any gap reads as floating limbs.
    for tag, sx, sy in (("FL", 1, FRONT), ("FR", -1, FRONT),
                        ("BL", 1, -FRONT), ("BR", -1, -FRONT)):
        parts.append(part(f"foot_{tag}", f"Leg_{tag}", BLACK,
                          location=(sx * 12.0, sy * 13.0 + 3.0, 5.5),
                          scale=(6.0, 6.5, 5.5)))

    # --- ears: thin wedges, tapered to a narrow top edge so they stay all-quads ----------
    for tag, sx in (("L", 1), ("R", -1)):
        parts.append(part(f"ear_{tag}", f"Ear_{tag}", PINK,
                          overrides={"front": HOTPINK},
                          # Kept clear of the head's side faces at x=+-23: an ear reaching the
                          # full width pokes its base corner through the side when it tilts.
                          location=(sx * 13.5, -7.0, 70.0), scale=(7.5, 4.5, 9.0),
                          rotation=(0, sx * math.radians(-8), 0),
                          taper_axis="Z", taper_neg=1.0, taper_pos=0.12))

    # --- bow: two tapered lobes and a knot, the template's signature element -------------
    bow_z, bow_y = 62.0, -25.5
    for sx in (1, -1):
        parts.append(part(f"bow_lobe_{'L' if sx > 0 else 'R'}", "Head", BLACK,
                          location=(sx * 8.5, bow_y, bow_z), scale=(6.5, 3.6, 5.0),
                          rotation=(0, 0, sx * math.radians(16)),
                          taper_axis="X",
                          taper_neg=0.22 if sx > 0 else 1.0,
                          taper_pos=1.0 if sx > 0 else 0.22))
    parts.append(part("bow_knot", "Head", BLACK,
                      location=(0, bow_y - 0.8, bow_z), scale=(2.8, 3.0, 2.8)))

    # --- tail: three boxy segments stepping up behind the body ---------------------------
    # Two chunky segments rather than three thin ones: three read as a row of disjointed steps,
    # and they overlap deeply on purpose. Rigid boxes weighted to different bones pull apart the
    # moment the tail bones rotate, and a shallow overlap opened a visible gap on the idle sway.
    tail_steps = [
        ((0.0, 26.0, 30.0), (6.0, 7.0, 10.0), -25, "Tail_01"),
        ((0.0, 29.0, 44.0), (5.0, 6.0, 10.0), -10, "Tail_02"),
    ]
    for i, (loc, scale, tilt, bone) in enumerate(tail_steps):
        parts.append(part(f"tail_{i}", bone, PINK,
                          location=loc, scale=scale,
                          rotation=(math.radians(tilt), 0, 0)))

    # --- join into one mesh object -------------------------------------------------------
    bpy.ops.object.select_all(action="DESELECT")
    for obj in parts:
        obj.select_set(True)
    merged = parts[0]
    bpy.context.view_layer.objects.active = merged
    bpy.ops.object.join()

    merged.name = NAME
    merged.data.name = f"{NAME}_Mesh"
    merged.data.materials.clear()
    merged.data.materials.append(mat)

    # Drop the pet onto the ground plane so it imports standing on z=0 rather than floating or
    # sunk. The rig is shifted to match, except Root, which Roblox requires to stay at origin.
    min_z = min(v.co.z for v in merged.data.vertices)
    merged.data.transform(Matrix.Translation(Vector((0, 0, -min_z))))

    log(f"model: {len(parts)} parts joined -> {len(merged.data.polygons)} faces "
        f"(dropped {min_z:+.2f} to ground)")
    return merged, -min_z


# --------------------------------------------------------------------------------------------
# Rig
# --------------------------------------------------------------------------------------------

# head, tail, parent. Root is deliberately non-deforming and sits at the origin.
# Positioned against the boxy parts: Head at the base of the head box, legs at the foot tops.
BONE_LAYOUT = [
    ("Root",    (0, 0, 0),           (0, 0, 8),            None),
    ("Body",    (0, 13, 14),         (0, 13, 30),          "Root"),
    ("Head",    (0, -2, 24),         (0, -2, 50),          "Body"),
    ("Ear_L",   (13.5, -7, 64),      (13.5, -7, 80),       "Head"),
    ("Ear_R",   (-13.5, -7, 64),     (-13.5, -7, 80),      "Head"),
    ("Tail_01", (0, 25, 24),         (0, 30, 34),          "Body"),
    ("Tail_02", (0, 30, 34),         (0, 34, 50),          "Tail_01"),
    ("Leg_FL",  (12, -10, 11),       (12, -10, 0),         "Body"),
    ("Leg_FR",  (-12, -10, 11),      (-12, -10, 0),        "Body"),
    ("Leg_BL",  (12, 16, 11),        (12, 16, 0),          "Body"),
    ("Leg_BR",  (-12, 16, 11),       (-12, 16, 0),         "Body"),
]


def build_armature(z_offset=0.0):
    armature = bpy.data.armatures.new(f"{NAME}_Armature")
    rig = bpy.data.objects.new(f"{NAME}_Rig", armature)
    bpy.context.collection.objects.link(rig)

    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    created = {}
    for name, head, tail, parent in BONE_LAYOUT:
        bone = armature.edit_bones.new(name)
        # Root must stay pinned at the origin; everything else follows the mesh to the ground.
        shift = Vector((0, 0, 0 if name == "Root" else z_offset))
        bone.head = Vector(head) + shift
        bone.tail = Vector(tail) + shift
        bone.use_connect = False
        if parent:
            bone.parent = created[parent]
        created[name] = bone
    bpy.ops.object.mode_set(mode="OBJECT")

    # Roblox: no influences on the root bone.
    armature.bones["Root"].use_deform = False

    log(f"rig: {len(armature.bones)} bones, root at {tuple(armature.bones['Root'].head_local)}")
    return rig


def bind(mesh_obj, rig):
    """
    Bind by the vertex groups the parts already carry - deterministic, and it cannot fail the
    way an automatic-weights heat solve can on overlapping shells like these.
    """
    mesh_obj.parent = rig
    mod = mesh_obj.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    mod.use_vertex_groups = True

    groups = sorted(g.name for g in mesh_obj.vertex_groups)
    log(f"bind: armature modifier + {len(groups)} vertex groups")


# --------------------------------------------------------------------------------------------
# Animation
# --------------------------------------------------------------------------------------------

def key(pose_bone, frame, location=None, rotation=None):
    """Key location/rotation only - Roblox joint CFrames carry no scale."""
    if location is not None:
        pose_bone.location = Vector(location)
        pose_bone.keyframe_insert("location", frame=frame)
    if rotation is not None:
        pose_bone.rotation_mode = "XYZ"
        pose_bone.rotation_euler = Euler([math.radians(a) for a in rotation], "XYZ")
        pose_bone.keyframe_insert("rotation_euler", frame=frame)


def new_action(rig, name):
    action = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = action
    for pose_bone in rig.pose.bones:
        pose_bone.rotation_mode = "XYZ"
        pose_bone.location = (0, 0, 0)
        pose_bone.rotation_euler = (0, 0, 0)
    return action


def set_interpolation(action, mode="BEZIER"):
    for fcurve in action.fcurves:
        for kp in fcurve.keyframe_points:
            kp.interpolation = mode


def anim_idle(rig):
    """Gentle breathing bob, ear twitch and tail sway. 60 frames, loops."""
    action = new_action(rig, "Idle")
    p = rig.pose.bones

    for f, dz in ((1, 0.0), (15, 1.6), (30, 0.0), (45, -1.2), (60, 0.0)):
        key(p["Body"], f, location=(0, 0, dz))
    for f, rot in ((1, 0), (15, -2.5), (30, 0), (45, 2.0), (60, 0)):
        key(p["Head"], f, rotation=(rot, 0, 0))
    # Ears lag behind the head for a bit of secondary motion.
    for tag, sign in (("Ear_L", 1), ("Ear_R", -1)):
        for f, rot in ((1, 0), (20, 5.0), (38, -3.0), (60, 0)):
            key(p[tag], f, rotation=(0, sign * rot, 0))
    for f, rot in ((1, -7), (30, 7), (60, -7)):
        key(p["Tail_01"], f, rotation=(0, 0, rot))
        key(p["Tail_02"], f, rotation=(0, 0, rot * 0.8))

    set_interpolation(action)
    return action, 1, 60


def anim_bounce(rig):
    """
    Happy hop. Squash is faked with translation, not bone scale, because Roblox joints are
    CFrames and would drop scale keys on import.
    """
    action = new_action(rig, "Bounce")
    p = rig.pose.bones

    # frame, body dz, head dz, head pitch, leg splay.
    # Splay is kept modest: these are rigid boxes, and a large rotation swings a foot's top face
    # clean out of the body box, which reads as a detached limb.
    beats = [
        (1,   0.0,   0.0,   0,   0),
        (7,  -4.0,  -2.5,   6,   9),   # crouch
        (13,  9.0,   2.0,  -8, -12),   # launch
        (20, 13.0,   3.0,  -5,  -7),   # apex
        (27, -3.5,  -2.0,   7,  11),   # land
        (33,  1.5,   0.8,  -2,  -3),   # rebound
        (40,  0.0,   0.0,   0,   0),
    ]
    for f, body_dz, head_dz, pitch, splay in beats:
        key(p["Body"], f, location=(0, 0, body_dz))
        key(p["Head"], f, location=(0, 0, head_dz), rotation=(pitch, 0, 0))
        for tag, sign in (("Leg_FL", 1), ("Leg_FR", 1), ("Leg_BL", -1), ("Leg_BR", -1)):
            key(p[tag], f, rotation=(sign * splay, 0, 0))
        for tag, sign in (("Ear_L", 1), ("Ear_R", -1)):
            key(p[tag], f, rotation=(-pitch * 1.4, sign * 4, 0))
        key(p["Tail_01"], f, rotation=(pitch * 0.8, 0, 0))
        key(p["Tail_02"], f, rotation=(pitch * 1.2, 0, 0))

    set_interpolation(action)
    return action, 1, 40


def anim_walk(rig):
    """Hop-forward cycle - PSX pets bob along rather than truly walking. 30 frames, loops."""
    action = new_action(rig, "Walk")
    p = rig.pose.bones

    for f, dz in ((1, 0.0), (8, 3.5), (15, 0.0), (23, 3.5), (30, 0.0)):
        key(p["Body"], f, location=(0, 0, dz))
    for f, pitch in ((1, 0), (8, -4), (15, 0), (23, -4), (30, 0)):
        key(p["Head"], f, rotation=(pitch, 0, 0))

    # Diagonal pairs swing opposite each other. Modest for the same rigid-box reason as Bounce.
    swing = 15
    for tag, phase in (("Leg_FL", 0), ("Leg_BR", 0), ("Leg_FR", 1), ("Leg_BL", 1)):
        for f in (1, 8, 15, 23, 30):
            t = (f - 1) / 29.0
            angle = math.sin(2 * math.pi * (t + 0.5 * phase)) * swing
            key(p[tag], f, rotation=(angle, 0, 0))

    for f, rot in ((1, -9), (15, 9), (30, -9)):
        key(p["Tail_01"], f, rotation=(0, 0, rot))
        key(p["Tail_02"], f, rotation=(0, 0, rot * 0.7))
    for tag, sign in (("Ear_L", 1), ("Ear_R", -1)):
        for f, rot in ((1, 0), (8, 6), (15, 0), (23, 6), (30, 0)):
            key(p[tag], f, rotation=(0, sign * rot, 0))

    set_interpolation(action)
    return action, 1, 30


def build_animations(rig):
    clips = []
    for builder in (anim_idle, anim_bounce, anim_walk):
        action, start, end = builder(rig)
        action.use_fake_user = True
        clips.append((action, start, end))
        log(f"anim: {action.name} frames {start}-{end}, {len(action.fcurves)} curves")
    rig.animation_data.action = None
    for pose_bone in rig.pose.bones:
        pose_bone.location = (0, 0, 0)
        pose_bone.rotation_euler = (0, 0, 0)
    return clips


# --------------------------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------------------------

def validate(mesh_obj, rig):
    """Fail loudly rather than shipping a model Studio will reject."""
    problems = []
    mesh = mesh_obj.data

    bm = bmesh.new()
    bm.from_mesh(mesh)

    tris = sum(len(f.verts) - 2 for f in bm.faces)
    quads = sum(1 for f in bm.faces if len(f.verts) == 4)
    ngons = sum(1 for f in bm.faces if len(f.verts) > 4)
    raw_tris = sum(1 for f in bm.faces if len(f.verts) == 3)
    non_manifold = sum(1 for e in bm.edges if not e.is_manifold)
    loose = sum(1 for v in bm.verts if not v.link_faces)
    bm.free()

    if tris > MAX_TRIS:
        problems.append(f"{tris} triangles exceeds the {MAX_TRIS} limit")
    if non_manifold:
        problems.append(f"{non_manifold} non-manifold edges (must be watertight)")
    if loose:
        problems.append(f"{loose} loose vertices")
    if ngons:
        problems.append(f"{ngons} n-gons present")
    if len(mesh.materials) != 1:
        problems.append(f"{len(mesh.materials)} materials, Roblox allows exactly 1")

    # Influence count and root weighting.
    root_index = mesh_obj.vertex_groups["Root"].index if "Root" in mesh_obj.vertex_groups else None
    worst = 0
    root_weighted = 0
    unweighted = 0
    for vert in mesh.vertices:
        active = [g for g in vert.groups if g.weight > 0.0]
        worst = max(worst, len(active))
        if not active:
            unweighted += 1
        if root_index is not None and any(g.group == root_index and g.weight > 0 for g in active):
            root_weighted += 1
    if worst > MAX_INFLUENCES:
        problems.append(f"a vertex has {worst} influences, limit is {MAX_INFLUENCES}")
    if root_weighted:
        problems.append(f"{root_weighted} vertices weighted to Root (not allowed)")
    if unweighted:
        problems.append(f"{unweighted} vertices carry no weight")

    # Rest-pose transforms must be frozen.
    for pose_bone in rig.pose.bones:
        if tuple(round(s, 5) for s in pose_bone.scale) != (1.0, 1.0, 1.0):
            problems.append(f"bone {pose_bone.name} rest scale is not 1,1,1")
        if any(abs(a) > 1e-5 for a in pose_bone.rotation_euler):
            problems.append(f"bone {pose_bone.name} rest rotation is not 0,0,0")
    root = rig.data.bones["Root"]
    if tuple(round(c, 5) for c in root.head_local) != (0.0, 0.0, 0.0):
        problems.append(f"Root bone is at {tuple(root.head_local)}, must be 0,0,0")

    dims = mesh_obj.dimensions
    log("-" * 78)
    log(f"faces {len(mesh.polygons)}  quads {quads}  tris {raw_tris}  ngons {ngons}")
    log(f"triangles {tris} / {MAX_TRIS}   vertices {len(mesh.vertices)}")
    log(f"non-manifold edges {non_manifold}   loose verts {loose}   materials {len(mesh.materials)}")
    log(f"max influences/vertex {worst}   root-weighted {root_weighted}   unweighted {unweighted}")
    log(f"size {dims.x:.1f} x {dims.y:.1f} x {dims.z:.1f} cm  "
        f"= {dims.x / STUD_CM:.2f} x {dims.y / STUD_CM:.2f} x {dims.z / STUD_CM:.2f} studs")
    log("-" * 78)

    if problems:
        for p in problems:
            log(f"FAIL: {p}")
        raise SystemExit("validation failed")
    log("validation passed")

    return {
        "triangles": tris, "vertices": len(mesh.vertices), "faces": len(mesh.polygons),
        "quads": quads, "ngons": ngons, "non_manifold": non_manifold,
        "influences": worst, "dims_cm": (dims.x, dims.y, dims.z),
        "dims_studs": (dims.x / STUD_CM, dims.y / STUD_CM, dims.z / STUD_CM),
    }


# --------------------------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------------------------

FBX_COMMON = dict(
    use_selection=False,
    object_types={"ARMATURE", "MESH"},   # keeps preview cameras/lights out of the file
    path_mode="COPY",
    embed_textures=True,
    add_leaf_bones=False,
    global_scale=1.0,                    # scene is already at 0.01 unit scale; don't double it
    apply_unit_scale=True,
    apply_scale_options="FBX_SCALE_NONE",
    bake_space_transform=False,
    mesh_smooth_type="FACE",
    use_mesh_modifiers=False,            # keep the armature modifier live, don't bake it in
    primary_bone_axis="Y",
    secondary_bone_axis="X",
)


def export_all(rig, clips):
    written = []

    base = os.path.join(DIR_BUILD, f"{NAME}_Base.fbx")
    rig.animation_data.action = None
    bpy.ops.export_scene.fbx(filepath=base, bake_anim=False, **FBX_COMMON)
    written.append(base)
    log(f"export: {os.path.basename(base)} (mesh + rig, no animation)")

    original_scene_name = bpy.context.scene.name
    for action, start, end in clips:
        rig.animation_data.action = action
        bpy.context.scene.frame_start = int(start)
        bpy.context.scene.frame_end = int(end)
        # The FBX take is named "<rig>|<scene>", so name the scene after the clip to get a
        # meaningful track name in Studio instead of a generic "Scene".
        bpy.context.scene.name = action.name
        path = os.path.join(DIR_BUILD, f"{NAME}_{action.name}.fbx")
        bpy.ops.export_scene.fbx(
            filepath=path, bake_anim=True, bake_anim_use_all_actions=False,
            bake_anim_use_nla_strips=False, bake_anim_simplify_factor=0.0,
            bake_anim_step=1.0, **FBX_COMMON)
        written.append(path)
        log(f"export: {os.path.basename(path)} (single track '{action.name}')")

    bpy.context.scene.name = original_scene_name
    rig.animation_data.action = None
    glb = os.path.join(DIR_BUILD, f"{NAME}.glb")
    bpy.ops.export_scene.gltf(
        filepath=glb, export_format="GLB", export_apply=False,
        export_animations=True, export_animation_mode="ACTIONS",
        use_visible=False, use_renderable=False)
    written.append(glb)
    log(f"export: {os.path.basename(glb)} (all clips, engine-agnostic)")

    return written


def verify_exports(expected_bones, clip_names):
    """Round-trip each FBX through a clean scene and confirm it actually survived."""
    log("=" * 78)
    log("verifying exports by re-importing")
    results = []

    for filename in [f"{NAME}_Base.fbx"] + [f"{NAME}_{c}.fbx" for c in clip_names]:
        path = os.path.join(DIR_BUILD, filename)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.scene.unit_settings.scale_length = 0.01
        bpy.ops.import_scene.fbx(filepath=path)

        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
        rigs = [o for o in bpy.data.objects if o.type == "ARMATURE"]
        problems = []
        if len(meshes) != 1:
            problems.append(f"expected 1 mesh, got {len(meshes)}")
        if len(rigs) != 1:
            problems.append(f"expected 1 armature, got {len(rigs)}")

        detail = ""
        if meshes and rigs:
            got_bones = {b.name for b in rigs[0].data.bones}
            missing = set(expected_bones) - got_bones
            if missing:
                problems.append(f"missing bones: {sorted(missing)}")
            actions = [a.name for a in bpy.data.actions]
            if filename == f"{NAME}_Base.fbx":
                if actions:
                    problems.append(f"base file should carry no animation, found {actions}")
            elif len(actions) != 1:
                problems.append(f"expected exactly 1 animation track, found {actions}")
            d = meshes[0].dimensions
            detail = (f"{len(meshes[0].data.polygons)} faces, {len(got_bones)} bones, "
                      f"{d.x:.1f}x{d.y:.1f}x{d.z:.1f}cm, actions={actions or 'none'}")

        size_kb = os.path.getsize(path) / 1024
        status = "OK  " if not problems else "FAIL"
        log(f"  {status} {filename:<24} {size_kb:7.1f} KB  {detail}")
        for p in problems:
            log(f"       -> {p}")
        results.append((filename, not problems))

    log("=" * 78)
    if not all(ok for _, ok in results):
        raise SystemExit("export verification failed")
    return results


# --------------------------------------------------------------------------------------------
# Previews
# --------------------------------------------------------------------------------------------

def setup_preview_world(resolution=700, samples=64):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = resolution
    scene.render.resolution_y = resolution
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"

    # Flat-shaded boxes show blown highlights far more readily than curved surfaces did - a face
    # lit straight on just clips to white. So most of the light is ambient, with the lamps only
    # separating the facets.
    world = bpy.data.worlds.new("PreviewWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.97, 0.945, 0.96, 1.0)
    bg.inputs["Strength"].default_value = 0.75

    def add_light(name, location, energy, size):
        data = bpy.data.lights.new(name, type="AREA")
        data.energy = energy
        data.size = size
        obj = bpy.data.objects.new(name, data)
        obj.location = location
        bpy.context.collection.objects.link(obj)
        direction = Vector((0, 0, 45)) - Vector(location)
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        return obj

    # Light values are in watts against a centimetre-scaled scene, hence the large numbers.
    # Tuned by sampling a rendered flat face against the texture's own pink: these land within
    # ~0.04 of the true albedo, where the earlier values clipped the front face to pure white.
    add_light("key", (-90, -120, 140), 150000, 160)
    add_light("fill", (130, -90, 60), 63000, 170)
    add_light("rim", (40, 130, 110), 97500, 120)


def add_camera(location, target=Vector((0, 0, 42))):
    data = bpy.data.cameras.new("PreviewCam")
    data.lens = 70
    cam = bpy.data.objects.new("PreviewCam", data)
    cam.location = Vector(location)
    cam.rotation_euler = (target - Vector(location)).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


def render_to(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    log(f"render: {os.path.basename(path)}")


def tile_horizontally(paths, out_path):
    """Stitch equally sized renders into one contact sheet."""
    strips = []
    for path in paths:
        img = bpy.data.images.load(path)
        w, h = img.size
        strips.append(np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4))
        bpy.data.images.remove(img)

    sheet = np.hstack(strips)
    h, w, _ = sheet.shape
    out = bpy.data.images.new("sheet", w, h, alpha=True)
    out.pixels = sheet.reshape(-1).tolist()
    out.filepath_raw = out_path
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    log(f"sheet: {os.path.basename(out_path)} ({len(paths)} frames, {w}x{h})")


def render_previews(blend_path, clip_names):
    """Turnaround stills plus one pose sheet per clip, so the design can be judged before import."""
    views = {
        "front": (0, -230, 60),
        "three_quarter": (-150, -180, 95),
        "side": (-235, 0, 60),
        "back": (0, 235, 70),
    }

    for name, loc in views.items():
        bpy.ops.wm.open_mainfile(filepath=blend_path)
        setup_preview_world()
        add_camera(loc)
        render_to(os.path.join(DIR_PREVIEW, f"{NAME}_{name}.png"))

    for clip in clip_names:
        frame_paths = []
        for i in range(4):
            bpy.ops.wm.open_mainfile(filepath=blend_path)
            setup_preview_world(resolution=420, samples=40)
            add_camera((-150, -180, 95))
            rig = bpy.data.objects[f"{NAME}_Rig"]
            action = bpy.data.actions[clip]
            rig.animation_data_create()
            rig.animation_data.action = action
            start, end = (int(v) for v in action.frame_range)
            frame = start + round(i * (end - start) / 4.0)
            bpy.context.scene.frame_set(frame)
            tmp = os.path.join(DIR_PREVIEW, f".{clip.lower()}_{i}.png")
            render_to(tmp)
            frame_paths.append(tmp)

        tile_horizontally(frame_paths, os.path.join(DIR_PREVIEW, f"{NAME}_{clip.lower()}_sheet.png"))
        for tmp in frame_paths:
            os.remove(tmp)


# --------------------------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------------------------

def main():
    for d in (DIR_SOURCE, DIR_BUILD, DIR_TEX, DIR_PREVIEW):
        os.makedirs(d, exist_ok=True)

    reset_scene()

    img, _ = build_texture()
    mat = build_material(img)
    mesh_obj, z_offset = build_model(mat)
    rig = build_armature(z_offset)
    bind(mesh_obj, rig)
    clips = build_animations(rig)

    stats = validate(mesh_obj, rig)

    # Pack the texture so the .blend is self-contained, then save the source.
    img.pack()
    blend_path = os.path.join(DIR_SOURCE, f"{NAME.lower()}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    log(f"source: {blend_path}")

    export_all(rig, clips)

    clip_names = [a.name for a, _, _ in clips]
    verify_exports(BONE_NAMES, clip_names)

    if "--no-render" not in sys.argv:
        render_previews(blend_path, clip_names)

    log("")
    log(f"done. {stats['triangles']} tris, {stats['dims_studs'][2]:.2f} studs tall.")


if __name__ == "__main__":
    main()
