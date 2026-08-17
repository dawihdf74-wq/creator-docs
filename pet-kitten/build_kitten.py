#!/usr/bin/env python3
"""
Generates a Pet-Simulator-X-style kitten pet, rigged and animated, exported for Roblox Studio.

Run with Blender-as-a-module:      python3 build_kitten.py
Or with a Blender executable:      blender --background --python build_kitten.py

Everything is built from script, so the model is reproducible: tweak the constants below and
re-run to get a new build. Nothing is authored by hand in a .blend.

Design notes
------------
* All rounded forms are subdivided cubes ("quad spheres") rather than UV spheres or cones, so
  the mesh is 100% quads with no pole triangles or n-gon caps. Roblox asks for quads where
  possible, and Catmull-Clark blobs give exactly the soft PSX silhouette we want anyway.
* Roblox allows one material per mesh object, so colour comes from a palette atlas: a texture of
  flat colour swatches with each part's UVs pinned inside its swatch. Eyes, blush and highlights
  are geometry mapped to a swatch, not painted texture detail, so the pet stays crisp at any
  distance and still reads correctly even if the texture goes missing.
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

# Palette atlas. 256px, 4x4 grid of 64px swatches; UVs sit in the middle 50% of each swatch so
# mipmapping can never bleed one colour into its neighbour.
ATLAS_PX = 256
ATLAS_GRID = 4

PINK = 0      # body, head, ears, legs, tail
HOTPINK = 1   # inner ears, blush, nose
BLACK = 2     # eyes, bow, mouth
WHITE = 3     # eye highlights, muzzle, chest, paw tips

PALETTE = {
    PINK: "#F7B6CE",
    HOTPINK: "#FF6FA5",
    BLACK: "#1A1A1A",
    WHITE: "#FFFFFF",
}

# Head is an ellipsoid; face features are placed on its surface analytically.
HEAD_C = Vector((0.0, 0.0, 50.0))
HEAD_R = Vector((24.0, 21.0, 21.0))

# The muzzle is its own ellipsoid, and the nose and mouth are placed against *it* rather than
# against the head, otherwise they end up buried inside it.
MUZZLE_C = Vector((0.0, -18.5, 41.5))
MUZZLE_R = Vector((7.5, 5.0, 5.0))

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


def make_blob(name, location=(0, 0, 0), scale=(1, 1, 1), rotation=(0, 0, 0),
              subdiv=3, taper_axis=None, taper_neg=1.0, taper_pos=1.0,
              bend_angle=0.0, bend_axis="X"):
    """
    A rounded all-quad form: a cube, optionally tapered along one axis, then Catmull-Clark
    subdivided into a smooth blob. This is the single building block for the whole pet.

    taper_neg / taper_pos scale the cross-section at the negative / positive end of taper_axis,
    which turns the cube into a cone, teardrop or bow lobe before it gets rounded off.

    After subdivision the blob is normalised so `scale` means the final half-extents on each
    axis. Catmull-Clark shrinks a cube to roughly 78% of its cage, and without normalising that
    the face features computed against HEAD_R would float off the head.

    All transforms are baked straight into the mesh data. Reading obj.matrix_world here would
    return a stale identity, because a freshly linked object has not been through a depsgraph
    evaluation yet.
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

    mod = obj.modifiers.new("subsurf", "SUBSURF")
    mod.levels = subdiv
    mod.render_levels = subdiv
    apply_modifiers(obj)

    # Normalise to unit half-extents, then out to the requested size.
    verts = obj.data.vertices
    extent = [max(abs(v.co[i]) for v in verts) for i in range(3)]
    for v in verts:
        for i in range(3):
            if extent[i] > 1e-9:
                v.co[i] = v.co[i] / extent[i] * scale[i]

    # Bend once the part is at its true proportions, about the origin it is still centred on.
    if bend_angle:
        bend = obj.modifiers.new("bend", "SIMPLE_DEFORM")
        bend.deform_method = "BEND"
        bend.deform_axis = bend_axis
        bend.angle = bend_angle
        apply_modifiers(obj)

    matrix = Matrix.Translation(Vector(location)) @ Euler(rotation, "XYZ").to_matrix().to_4x4()
    obj.data.transform(matrix)

    for poly in obj.data.polygons:
        poly.use_smooth = True

    return obj


def surface_y(centre, radii, x, z, out=0.0):
    """
    Front-facing Y on an ellipsoid for a given (x, z), so features sit on its surface.

    `out` is signed along the facing direction: positive pushes the feature outward, in front of
    the surface; negative sinks it in. Getting this backwards buries the feature inside the body
    it was meant to sit on.
    """
    nx = (x - centre.x) / radii.x
    nz = (z - centre.z) / radii.z
    inner = max(0.0, 1.0 - nx * nx - nz * nz)
    return centre.y + FRONT * (radii.y * math.sqrt(inner) + out)


def head_surface_y(x, z, out=0.0):
    return surface_y(HEAD_C, HEAD_R, x, z, out)


def muzzle_surface_y(x, z, out=0.0):
    return surface_y(MUZZLE_C, MUZZLE_R, x, z, out)


def set_part_uv(obj, swatch):
    """Pin every face of a part inside its palette swatch (non-degenerate, mip-safe)."""
    cell = 1.0 / ATLAS_GRID
    col = swatch % ATLAS_GRID
    row = swatch // ATLAS_GRID
    inset = cell * 0.25
    u0, u1 = col * cell + inset, (col + 1) * cell - inset
    v0, v1 = row * cell + inset, (row + 1) * cell - inset
    corners = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]

    mesh = obj.data
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    uvs = mesh.uv_layers[0]
    for poly in mesh.polygons:
        for i, loop_index in enumerate(poly.loop_indices):
            uvs.data[loop_index].uv = corners[i % 4]


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


def part(name, bone, swatch, **kwargs):
    """Build one body part and tag it with its bone(s) and palette colour."""
    obj = make_blob(name, **kwargs)
    set_part_uv(obj, swatch)
    set_part_bones(obj, bone)
    return obj


# --------------------------------------------------------------------------------------------
# Texture
# --------------------------------------------------------------------------------------------

def srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def build_texture():
    """Write the flat-colour palette atlas that the single material samples."""
    img = bpy.data.images.new(f"{NAME}_ALB", ATLAS_PX, ATLAS_PX, alpha=False)
    img.colorspace_settings.name = "sRGB"

    pixels = np.zeros((ATLAS_PX, ATLAS_PX, 4), dtype=np.float32)
    pixels[:, :, 3] = 1.0
    cell_px = ATLAS_PX // ATLAS_GRID

    # Unused swatches default to the body pink, so a UV mistake fails soft rather than black.
    default = [srgb_to_linear(int(PALETTE[PINK][i:i + 2], 16)) for i in (1, 3, 5)]
    pixels[:, :, 0:3] = default

    for swatch, hex_colour in PALETTE.items():
        rgb = [srgb_to_linear(int(hex_colour[i:i + 2], 16)) for i in (1, 3, 5)]
        col = swatch % ATLAS_GRID
        row = swatch // ATLAS_GRID
        y0, y1 = row * cell_px, (row + 1) * cell_px
        x0, x1 = col * cell_px, (col + 1) * cell_px
        pixels[y0:y1, x0:x1, 0:3] = rgb

    img.pixels = pixels.reshape(-1).tolist()

    out = os.path.join(DIR_TEX, f"{NAME}_ALB.png")
    img.filepath_raw = out
    img.file_format = "PNG"
    img.save()
    log(f"texture: {out} ({ATLAS_PX}x{ATLAS_PX}, {len(PALETTE)} swatches)")
    return img, out


def build_material(img):
    """One material, one image texture, nearest-neighbour so swatch edges never blend."""
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
    tex.interpolation = "Closest"

    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


# --------------------------------------------------------------------------------------------
# Model
# --------------------------------------------------------------------------------------------

TAIL_P0 = Vector((0.0, 15.0, 25.0))    # tucked into the rear of the body
TAIL_P1 = Vector((0.0, 36.0, 28.0))    # sweeps backward, staying low
TAIL_P2 = Vector((0.0, 38.0, 46.0))    # then curls up, staying clear of the head
# Segments must overlap generously or the tail reads as a string of beads rather than a tube.
TAIL_SEGMENTS = 14
TAIL_WHITE_TIP = 3


def build_tail():
    """Bead tapering spheres along a quadratic Bezier, white for the last few."""
    segments = []
    for i in range(TAIL_SEGMENTS):
        t = i / (TAIL_SEGMENTS - 1)
        pos = ((1 - t) ** 2 * TAIL_P0 + 2 * (1 - t) * t * TAIL_P1 + t ** 2 * TAIL_P2)
        radius = 5.0 * (1 - t) + 2.6 * t
        if i == TAIL_SEGMENTS - 1:
            radius *= 1.35                       # slightly bulbous tip
        # Smoothstep the weight along the tail so it bends as a chain, not a hinge.
        w = t * t * (3 - 2 * t)
        segments.append(part(
            f"tail_{i}",
            {"Tail_01": 1.0 - w, "Tail_02": w},
            WHITE if i >= TAIL_SEGMENTS - TAIL_WHITE_TIP else PINK,
            location=pos, scale=(radius, radius, radius), subdiv=2))
    return segments


def build_model(mat):
    """Assemble the kitten from tagged parts, then join into a single mesh object."""
    parts = []

    # --- torso and head -----------------------------------------------------------------
    # The head is deliberately wider than the body: that top-heavy ratio is the whole PSX look.
    parts.append(part("body", "Body", PINK,
                      location=(0, 0, 21), scale=(15.5, 17.5, 13), subdiv=3))
    parts.append(part("chest", "Body", WHITE,
                      location=(0, -15.0, 19), scale=(8.0, 4.6, 7.0), subdiv=2))
    parts.append(part("head", "Head", PINK,
                      location=HEAD_C, scale=HEAD_R, subdiv=3))

    # --- legs: four stubby cylinders with white paw tips --------------------------------
    for tag, sx, sy in (("FL", 1, FRONT), ("FR", -1, FRONT), ("BL", 1, -FRONT), ("BR", -1, -FRONT)):
        parts.append(part(f"leg_{tag}", f"Leg_{tag}", PINK,
                          location=(sx * 9.5, sy * 11.5, 7), scale=(6.8, 7.0, 7.2), subdiv=2))
        # Paws are wider than the leg at their height, or they hide inside it.
        parts.append(part(f"paw_{tag}", f"Leg_{tag}", WHITE,
                          location=(sx * 9.5, sy * 11.5, 2.8), scale=(7.4, 7.8, 3.6), subdiv=2))

    # --- ears: tapered teardrops with hot-pink inners -----------------------------------
    for tag, sx in (("L", 1), ("R", -1)):
        # A hard taper made these read as horns from the side; keep the tips rounded.
        parts.append(part(f"ear_{tag}", f"Ear_{tag}", PINK,
                          location=(sx * 11.5, 0.5, 66), scale=(7.8, 5.8, 11),
                          rotation=(0, sx * math.radians(-12), 0),
                          subdiv=3, taper_axis="Z", taper_neg=1.0, taper_pos=0.24))
        parts.append(part(f"ear_inner_{tag}", f"Ear_{tag}", HOTPINK,
                          location=(sx * 11.5, -3.4, 65), scale=(4.6, 3.2, 7.4),
                          rotation=(0, sx * math.radians(-12), 0),
                          subdiv=2, taper_axis="Z", taper_neg=1.0, taper_pos=0.24))

    # --- face ---------------------------------------------------------------------------
    parts.append(part("muzzle", "Head", WHITE,
                      location=MUZZLE_C, scale=MUZZLE_R, subdiv=2))

    for tag, sx in (("L", 1), ("R", -1)):
        eye_x, eye_z = sx * 10.5, 54.0
        parts.append(part(f"eye_{tag}", "Head", BLACK,
                          location=(eye_x, head_surface_y(eye_x, eye_z, -1.0), eye_z),
                          scale=(6.2, 4.0, 7.8), subdiv=3))
        # Two highlights per eye - the big glossy dot plus a small sparkle, the PSX signature.
        # Both must clear the eye's own front surface, not just the head's.
        parts.append(part(f"glint_{tag}", "Head", WHITE,
                          location=(eye_x + sx * 2.0,
                                    head_surface_y(eye_x, eye_z, 4.2), eye_z + 2.6),
                          scale=(2.2, 1.5, 2.6), subdiv=2))
        parts.append(part(f"sparkle_{tag}", "Head", WHITE,
                          location=(eye_x - sx * 2.3,
                                    head_surface_y(eye_x, eye_z, 3.6), eye_z - 3.0),
                          scale=(1.2, 1.0, 1.4), subdiv=1))
        blush_x, blush_z = sx * 17.5, 47.0
        parts.append(part(f"blush_{tag}", "Head", HOTPINK,
                          location=(blush_x, head_surface_y(blush_x, blush_z, 0.3), blush_z),
                          scale=(4.6, 2.4, 3.2), subdiv=2))

    # Nose and mouth sit centred *on* the muzzle surface, so half of each reads as a raised
    # bump. Offsetting them outward instead left them floating in front of the face.
    nose_z = 44.0
    parts.append(part("nose", "Head", HOTPINK,
                      location=(0, muzzle_surface_y(0, nose_z), nose_z),
                      scale=(2.4, 1.8, 1.8), subdiv=2))
    mouth_z = 39.0
    parts.append(part("mouth", "Head", BLACK,
                      location=(0, muzzle_surface_y(0, mouth_z), mouth_z),
                      scale=(2.0, 1.4, 1.2), subdiv=1))

    # --- bow: two tapered lobes and a knot, matching the reference art ------------------
    # Sits on the forehead where the head is still wide enough to carry it, in front of the ears.
    bow_z, bow_y = 65.0, -13.0
    for sx in (1, -1):
        parts.append(part(f"bow_lobe_{'L' if sx > 0 else 'R'}", "Head", BLACK,
                          location=(sx * 8.0, bow_y, bow_z), scale=(6.5, 4.2, 5.0),
                          rotation=(0, 0, sx * math.radians(18)),
                          subdiv=3, taper_axis="X",
                          taper_neg=0.18 if sx > 0 else 1.0,
                          taper_pos=1.0 if sx > 0 else 0.18))
    parts.append(part("bow_knot", "Head", BLACK,
                      location=(0, bow_y - 0.6, bow_z), scale=(2.6, 2.6, 2.6), subdiv=2))

    # --- tail: blobs swept along a curve -------------------------------------------------
    # A tapered-and-bent single blob came out looking like a shark fin. Beading spheres along a
    # Bezier gives a tail that actually curls, and the weight blend along it comes for free.
    parts.extend(build_tail())

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
BONE_LAYOUT = [
    ("Root",    (0, 0, 0),                 (0, 0, 8),                  None),
    ("Body",    (0, 0, 18),                (0, 0, 32),                 "Root"),
    ("Head",    (0, 0, 34),                (0, 0, 58),                 "Body"),
    ("Ear_L",   (10, 0, 66),               (13, 0, 80),                "Head"),
    ("Ear_R",   (-10, 0, 66),              (-13, 0, 80),               "Head"),
    ("Tail_01", (0, -FRONT * 20, 26),      (0, -FRONT * 26, 38),       "Body"),
    ("Tail_02", (0, -FRONT * 26, 38),      (0, -FRONT * 27, 52),       "Tail_01"),
    ("Leg_FL",  (12, FRONT * 14, 12),      (12, FRONT * 14, 0),        "Body"),
    ("Leg_FR",  (-12, FRONT * 14, 12),     (-12, FRONT * 14, 0),       "Body"),
    ("Leg_BL",  (12, -FRONT * 14, 12),     (12, -FRONT * 14, 0),       "Body"),
    ("Leg_BR",  (-12, -FRONT * 14, 12),    (-12, -FRONT * 14, 0),      "Body"),
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

    # frame, body dz, head dz, head pitch, leg splay
    beats = [
        (1,   0.0,   0.0,   0,   0),
        (7,  -4.0,  -2.5,   6,  14),   # crouch
        (13,  9.0,   2.0,  -8, -18),   # launch
        (20, 13.0,   3.0,  -5, -10),   # apex
        (27, -3.5,  -2.0,   7,  16),   # land
        (33,  1.5,   0.8,  -2,  -4),   # rebound
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

    # Diagonal pairs swing opposite each other.
    swing = 22
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

    # A soft near-neutral backdrop: a saturated pink world bounces enough colour onto the model
    # to stop the white paws, chest and tail tip from reading as white.
    world = bpy.data.worlds.new("PreviewWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.97, 0.945, 0.96, 1.0)
    bg.inputs["Strength"].default_value = 0.85

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
    add_light("key", (-90, -120, 140), 900000, 120)
    add_light("fill", (130, -90, 60), 300000, 150)
    add_light("rim", (40, 130, 110), 500000, 100)


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
