"""The robot typewriter: a chunky toy take on a 1960s portable, on an ISO board of 46 keys.

A rounded chassis on four short sprung feet with a screen face on its front, a stepped bank
of 53 round keys on piston stems (their tops a separate Legend part, UV'd into an 8x8 atlas),
a crown of 46 typebars on a semicircular segment that swing up and over to strike the
platen at one print point, two ribbon spools with lit hubs and a ribbon guide, a correction
tape arm, a carriage (platen with knurled knobs, return lever with a lit ball, paper bail,
margin scale, paper table and paper roll) that slides along the back, a bell with a lit
dome and a clapper, and a gauge with a needle on its left side.

Frame: Z up, faces -Y (the typist sits at -Y, their right is +X), floor z = 0, metres.
Every joint turns about its bone's own local X (bone names and axes: see BONES below and
the notes at the end of the file), so the runtime can pose everything with one rule.

The keys' positions (rows, ids, atlas) are read from src/typewriter/typewriter.json, which
also receives this file's "geometry" block; what the keys type is the page's (layouts.ts).
Built and exported by blender/build.sh.
"""

import json
import math
import os

import bpy
from mathutils import Matrix, Vector

import kit
import looks
from parts import FACING, ball, bolt, box, flat, puck

PI = math.pi
FACE = 'typewriter'
PREVIEW = dict(lift=0.0, width=1.5)

JSON_PATH = os.path.join(os.path.dirname(__file__), '..', 'src', 'typewriter', 'typewriter.json')
with open(JSON_PATH) as f:
    LAYOUT = json.load(f)
ROWS = LAYOUT['rows']
OTHERS = LAYOUT['others']
TYPE = LAYOUT['type']
ATLAS = LAYOUT['atlas']

# ---------------------------------------------------------------- dimensions

HW = 0.72  # the chassis's half width
FRONT = -1.13  # its front face
BASE_TOP = 0.26  # the front skirt's top
HUMP_TOP = 0.40  # the rear deck, round the basket
HUMP_FRONT = -0.64
BODY_Z0 = 0.07  # the chassis's underside (the feet are 0.07 high)
BACK = 0.45

CELL = 0.078  # a key's pitch along the row
CAP_R = 0.035
CAP_H = 0.012  # half height of a cap
ROW_Y = (-0.72, -0.80, -0.88, -0.96)  # back row first
DECK = (0.37, 0.34, 0.31, 0.28)  # the deck under each row
CAP_TOP = tuple(d + 0.065 for d in DECK)
SPACE_Y, SPACE_TOP = -1.04, 0.325
KEY_LEVER = 0.10  # pivot behind the cap: +0.12 rad dips the cap 12 mm

# The typebars lie in a half-round basket sunk into the rear deck.
R = 0.18  # the segment's radius about the print point's vertical
BETA = math.radians(58)  # a bar's elevation at the strike
BAR = R / math.cos(BETA)  # every bar's length: the tip reaches the print point's vertical
STRIKE = 1.85
REST_UP = PI - BETA - STRIKE  # at rest a bar points outward and up by this much (about 16 degrees)
DECK_TO_PRINT = 0.11
# The platen: its axis (y, z) where it has always been, and the print point round its front.
# PRINT_ANGLE is how far below the platen's front equator the print point is: negative is
# above it, so the line being typed faces up toward the typist (and the camera) instead of
# curling away under the platen.
PLATEN_R = 0.075
AXIS = (PLATEN_R * math.cos(math.radians(10)), HUMP_TOP + DECK_TO_PRINT + PLATEN_R * math.sin(math.radians(10)))
PRINT_ANGLE = math.radians(-25)
PRINT = (0.0, AXIS[0] - PLATEN_R * math.cos(PRINT_ANGLE), AXIS[1] - PLATEN_R * math.sin(PRINT_ANGLE))
ZS = PRINT[2] - BAR * math.sin(BETA)  # the bars' pivots' height
ARC = math.radians(80)  # the segment spans +-80 degrees
TUB = R + BAR * math.cos(REST_UP) + 0.065  # the basket's radius
TUB_FLOOR = 0.11
GUIDE_PIVOT = (0.0, -0.27, 0.30)
GUIDE_REST = math.radians(25)
TAPE_PIVOT = (0.03, -0.33, 0.22)
TAPE_REST = math.radians(26)

# The carriage.
COLS, PITCH, PAPER_W = TYPE['columns'], TYPE['pitch'], TYPE['paperWidth']
TRAVEL = COLS * PITCH
MARGIN = (PAPER_W - TRAVEL) / 2  # the paper's left margin beyond column 0
PAPER_X = (-MARGIN, -MARGIN + PAPER_W)  # the paper's edges at column 0, relative to the print point
XC = (PAPER_X[0] + PAPER_X[1]) / 2
PLATEN_X = (PAPER_X[0] - 0.04, PAPER_X[1] + 0.04)
PLATEN_LEN = PLATEN_X[1] - PLATEN_X[0]
CAP_X = PLATEN_LEN / 2 + 0.017  # the end caps' distance from the carriage's middle
ROLL = (0.28, 0.80)
ROLL_R = 0.06
TABLE_LOW = (AXIS[0] + 0.098, AXIS[1] + 0.012)  # where the paper meets the platen's back
TABLE_HIGH = (0.2, 0.74)
BAIL_ANGLE = math.radians(72)  # the bail's rollers sit this far above the platen's front equator, clear of the fresh lines
BAIL_R = PLATEN_R + 0.014

LEVER_X = -CAP_X + XC  # the left end cap
LEVER_PIVOT = (LEVER_X, 0.2, 0.68)
GAUGE = (-HW + 0.002, -0.45, 0.165)
BELL = (0.60, -0.42, HUMP_TOP)
CLAP_PIVOT = (BELL[0], BELL[1] - 0.095, HUMP_TOP - 0.015)
CLAP_TIP = (BELL[0], BELL[1] - 0.058, HUMP_TOP + 0.04)


# ---------------------------------------------------------------- helpers


def vec(*a):
    return Vector(a)


def frame_euler(direction, up=(0, 1, 0)):
    """Euler angles that turn local +Z along `direction`."""
    return Vector(direction).normalized().to_track_quat('Z', 'Y').to_euler()


def cuboids(name, specs):
    """Many little boxes in one mesh, flat shaded. A spec is (centre, half sizes) or
    (centre, half sizes, (ax, ay, az)) with the three unit vectors of the box's axes."""
    verts, faces = [], []
    corners = [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]
    quads = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (3, 0, 4, 7)]
    for spec in specs:
        c, h = Vector(spec[0]), spec[1]
        ax, ay, az = spec[2] if len(spec) > 2 else (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
        base = len(verts)
        for sx, sy, sz in corners:
            verts.append(tuple(c + ax * (sx * h[0]) + ay * (sy * h[1]) + az * (sz * h[2])))
        faces += [tuple(base + i for i in q) for q in quads]
    return flat(kit.mesh_object(name, verts, faces))


def ribbon(name, pts, half_w, half_t):
    """A flat band along a polyline (its width upright), for the ribbon. Returns (object, t)
    with t[i] how far along the band vertex i is."""
    pts = [Vector(p) for p in pts]
    verts, faces, ts = [], [], []
    total = sum((b - a).length for a, b in zip(pts, pts[1:]))
    run = 0.0
    for i, p in enumerate(pts):
        tan = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if i:
            run += (p - pts[i - 1]).length
        w = (Vector((0, 0, 1)) - tan * tan.z).normalized()
        n = tan.cross(w).normalized()
        for sw, sn in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append(tuple(p + w * (sw * half_w) + n * (sn * half_t)))
            ts.append(run / total)
    for i in range(len(pts) - 1):
        for k in range(4):
            a, b = i * 4 + k, i * 4 + (k + 1) % 4
            faces.append((a, b, b + 4, a + 4))
    faces.append((0, 1, 2, 3))
    last = (len(pts) - 1) * 4
    faces.append((last + 3, last + 2, last + 1, last))
    return kit.mesh_object(name, verts, faces), ts


def rig(name, bones):
    """An armature from (name, head, tail, parent, xaxis) tuples: like kit.armature, but each
    bone's local X axis is set (`xaxis`), so that rotating a bone about its own X is the
    joint's motion."""
    data = bpy.data.armatures.new(name)
    obj = kit.link(bpy.data.objects.new(name, data))
    scene = obj.users_scene[0]
    view_layer = scene.view_layers[0]
    view_layer.objects.active = obj
    override = dict(active_object=obj, object=obj, selected_objects=[obj])
    windows = bpy.context.window_manager.windows
    if windows:
        override.update(window=windows[0], screen=windows[0].screen, scene=scene, view_layer=view_layer)
    with bpy.context.temp_override(**override):
        bpy.ops.object.mode_set(mode='EDIT')
        for bone, head, tail, parent, xaxis in bones:
            eb = data.edit_bones.new(bone)
            eb.head, eb.tail = head, tail
            if xaxis is not None:
                y = (Vector(tail) - Vector(head)).normalized()
                x = Vector(xaxis)
                x = (x - y * x.dot(y)).normalized()
                eb.align_roll(x.cross(y))
            if parent:
                eb.parent = data.edit_bones[parent]
        bpy.ops.object.mode_set(mode='OBJECT')
    return obj


# ---------------------------------------------------------------- layout


def key_layout():
    """Every key: id -> dict(x, y, top, w (half width), row, cell)."""
    wide = {'back': 1.6, 'tab': 1.5, 'lock': 1.4, 'ret': 1.6, 'shiftL': 1.6, 'shiftR': 1.6}
    lines = [
        [(k, 1.0) for k in ROWS[0]] + [('back', wide['back'])],
        [('tab', wide['tab'])] + [(k, 1.0) for k in ROWS[1]],
        [('lock', wide['lock'])] + [(k, 1.0) for k in ROWS[2]] + [('ret', wide['ret'])],
        [('shiftL', wide['shiftL'])] + [(k, 1.0) for k in ROWS[3]] + [('shiftR', wide['shiftR'])],
    ]
    cells = {}
    index = 0
    for row in ROWS:
        for k in row:
            cells[k] = index
            index += 1
    for k in OTHERS:
        cells[k['id']] = index
        index += 1
    out = {}
    for r, line in enumerate(lines):
        total = sum(w for _, w in line) * CELL
        x = -total / 2
        for kid, w in line:
            out[kid] = dict(x=x + w * CELL / 2, y=ROW_Y[r], top=CAP_TOP[r], deck=DECK[r], hx=w * CELL / 2 - 0.006,
                            row=r, cell=cells[kid], wide=w > 1.0)
            x += w * CELL
    out['space'] = dict(x=0.0, y=SPACE_Y, top=SPACE_TOP, deck=BASE_TOP, hx=0.3, row=4, cell=cells['space'], wide=True)
    return out


def bar_slots(keys):
    """The 46 character keys left to right, each with its angle along the segment."""
    chars = [k for row in ROWS for k in row]
    order = sorted(chars, key=lambda i: (round(keys[i]['x'], 4), keys[i]['y']))
    n = len(order)
    return {kid: -ARC + 2 * ARC * i / (n - 1) for i, kid in enumerate(order)}


def bar_geometry(phi):
    """Pivot, rest direction, tip at rest, the bone's X axis and the strike direction of the
    bar at angle phi along the segment (0 = straight in front of the print point)."""
    out = Vector((math.sin(phi), -math.cos(phi), 0.0))  # outward, horizontally
    pivot = Vector((PRINT[0] + R * out.x, PRINT[1] + R * out.y, ZS))
    rest = (out * math.cos(REST_UP) + Vector((0, 0, math.sin(REST_UP)))).normalized()
    strike = (-out * math.cos(BETA) + Vector((0, 0, math.sin(BETA)))).normalized()
    tangent = Vector((math.cos(phi), math.sin(phi), 0.0))
    return pivot, rest, pivot + rest * BAR, -tangent, strike


def legend_uv(obj, cell, cx, cy, r):
    """Planar UVs from above into one cell of the atlas: row 0 at the top of the image,
    +Y (away from the typist) is up in the glyph, +X to its right."""
    cols, rows = ATLAS['columns'], ATLAS['rows']
    c, row = cell % cols, cell // cols
    uv = obj.data.uv_layers.new(name='UVMap')
    for loop in obj.data.loops:
        v = obj.data.vertices[loop.vertex_index].co
        u = c / cols + (0.5 + (v.x - cx) / (2 * r)) / cols
        w = 1 - (row + 1) / rows + (0.5 + (v.y - cy) / (2 * r)) / rows
        uv.data[loop.index].uv = (u, w)


def legend(name, cx, cy, z, r, cell, n=8):
    verts = [(cx, cy, z)] + [(cx + r * math.cos(2 * PI * i / n + PI / n), cy + r * math.sin(2 * PI * i / n + PI / n), z)
                             for i in range(n)]
    faces = [(0, 1 + i, 1 + (i + 1) % n) for i in range(n)]
    obj = kit.mesh_object(name, verts, faces)
    flat(obj)
    legend_uv(obj, cell, cx, cy, r)
    return obj


# ---------------------------------------------------------------- build


def bone_table(keys, slots):
    bones = [('root', (0, 0, 0), (0, 0, 0.06), None, (1, 0, 0)),
             ('body', (0, 0, BODY_Z0), (0, 0, 0.2), 'root', (1, 0, 0)),
             ('segment', (0, 0, ZS - 0.03), (0, 0, ZS + 0.05), 'body', (1, 0, 0))]
    for kid, phi in slots.items():
        pivot, rest, tip, xaxis, _ = bar_geometry(phi)
        bones.append((f'bar_{kid}', tuple(pivot), tuple(tip), 'segment', tuple(xaxis)))
    for kid, k in keys.items():
        z = k['top'] - CAP_H
        bones.append((f'key_{kid}', (k['x'], k['y'] + KEY_LEVER, z), (k['x'], k['y'], z), 'body', (1, 0, 0)))
    gl = math.hypot(PRINT[1] - GUIDE_PIVOT[1], PRINT[2] - GUIDE_PIVOT[2])
    tl = math.hypot(PRINT[1] - TAPE_PIVOT[1], PRINT[2] - TAPE_PIVOT[2])
    bones += [
        ('guide', GUIDE_PIVOT, (0, GUIDE_PIVOT[1] + gl * math.cos(GUIDE_REST), GUIDE_PIVOT[2] + gl * math.sin(GUIDE_REST)),
         'segment', (1, 0, 0)),
        ('tape', TAPE_PIVOT, (TAPE_PIVOT[0], TAPE_PIVOT[1] + tl * math.cos(TAPE_REST), TAPE_PIVOT[2] + tl * math.sin(TAPE_REST)),
         'segment', (1, 0, 0)),
        ('spoolL', (-SPOOL_X, SPOOL_Y, HUMP_TOP), (-SPOOL_X, SPOOL_Y, HUMP_TOP + 0.1), 'body', (1, 0, 0)),
        ('spoolR', (SPOOL_X, SPOOL_Y, HUMP_TOP), (SPOOL_X, SPOOL_Y, HUMP_TOP + 0.1), 'body', (1, 0, 0)),
        ('carriage', (XC, 0.34, 0.45), (XC + 0.1, 0.34, 0.45), 'body', (0, 1, 0)),
        ('platen', (XC, AXIS[0], AXIS[1]), (XC, AXIS[0], AXIS[1] + 0.1), 'carriage', (-1, 0, 0)),
        ('lever', LEVER_PIVOT, (LEVER_PIVOT[0], LEVER_PIVOT[1] - 0.15, LEVER_PIVOT[2]), 'carriage', (0, 0, 1)),
        ('bail', (XC, AXIS[0], AXIS[1]),
         (XC, AXIS[0] - BAIL_R * math.cos(BAIL_ANGLE), AXIS[1] + BAIL_R * math.sin(BAIL_ANGLE)), 'carriage', (-1, 0, 0)),
        ('roll', (XC, ROLL[0], ROLL[1]), (XC, ROLL[0], ROLL[1] + 0.1), 'carriage', (1, 0, 0)),
        ('bell', CLAP_PIVOT, CLAP_TIP, 'body', (-1, 0, 0)),
        ('needle', GAUGE, (GAUGE[0], GAUGE[1], GAUGE[2] + 0.06), 'body', (1, 0, 0)),
    ]
    return bones


SPOOL_X, SPOOL_Y = 0.62, 0.05


def tub_cutter():
    """The basket's hole: a half round (the typist's side) prism, from the floor up past the deck."""
    pts = [(TUB * math.sin(a), -TUB * math.cos(a)) for a in [-PI / 2 + PI * i / 40 for i in range(41)]]
    pts += [(TUB, 0.07), (-TUB, 0.07)]
    n = len(pts)
    verts = [(x, y, TUB_FLOOR) for x, y in pts] + [(x, y, HUMP_TOP + 0.1) for x, y in pts]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return kit.mesh_object('TubCutter', verts, faces)


def cut_tub(body):
    """Subtract the basket from the rear deck; returns a new object with sharp creases."""
    import bmesh
    cutter = tub_cutter()
    mod = body.modifiers.new('cut', 'BOOLEAN')
    mod.object, mod.operation, mod.solver = cutter, 'DIFFERENCE', 'EXACT'
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(body.evaluated_get(dg))
    bm = bmesh.new()
    bm.from_mesh(mesh)
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > 0.75:
            e.smooth = False
    bm.to_mesh(mesh)
    bm.free()
    loc = body.location.copy()
    bpy.data.objects.remove(cutter)
    bpy.data.objects.remove(body)
    obj = bpy.data.objects.new('Hump', mesh)
    obj.location = loc
    return kit.link(obj)


def build(look='ink', flame=None):
    m = looks.materials(look, flame, face=FACE)
    legend_mat = kit.material('Legend', '#f4f4f1', roughness=0.6)
    parts, skin = [], []

    def add(obj, mat, bone='body'):
        if mat is not None:
            kit.assign(obj, mat)
        parts.append(obj)
        skin.append((obj, bone))
        return obj

    keys = key_layout()
    slots = bar_slots(keys)
    shell, joint = m['shell'], m['joint']
    knob = m['role']('Knob', 'joint')

    # ---- the chassis: a long base, the rear deck with the basket sunk into it
    add(box('Base', (HW, (BACK - FRONT) / 2, (BASE_TOP - BODY_Z0) / 2), (0, (BACK + FRONT) / 2, (BASE_TOP + BODY_Z0) / 2), 0.16,
            seg=(40, 20)), shell)
    hump = box('Hump', (HW, (BACK - HUMP_FRONT) / 2, (HUMP_TOP - BODY_Z0) / 2), (0, (BACK + HUMP_FRONT) / 2, (HUMP_TOP + BODY_Z0) / 2),
               0.16, seg=(40, 20))
    add(cut_tub(hump), shell)
    # a floor for the basket, and a rim round its lip
    floor_pts = [(TUB * math.sin(a), -TUB * math.cos(a)) for a in [-PI / 2 + PI * i / 40 for i in range(41)]]
    fv = [(0.0, 0.0, TUB_FLOOR + 0.002)] + [(x, y, TUB_FLOOR + 0.002) for x, y in floor_pts]
    add(flat(kit.mesh_object('TubFloor', fv, [(0, 1 + i + 1, 1 + i) for i in range(len(floor_pts) - 1)])), m['bezel'])
    rim = [(x * 1.0, y * 1.0, HUMP_TOP + 0.003) for x, y in [(TUB * math.sin(a), -TUB * math.cos(a))
                                                               for a in [-PI / 2 + PI * i / 40 for i in range(41)]]]
    add(kit.tube('TubRim', rim, 0.013, ring=8)[0], joint)
    for k in range(9):  # bolts round the rim
        a = -PI / 2 + PI * (k + 0.5) / 9
        bolt(add, m, ((TUB + 0.045) * math.sin(a), -(TUB + 0.045) * math.cos(a), HUMP_TOP - 0.004), 0.011, 'top')
    for r in range(4):  # the stepped bank
        add(box(f'Step{r}', (0.66, 0.0425, 0.05), (0, ROW_Y[r], DECK[r] - 0.05), 0.3, seg=(24, 8)), shell)
    # panel seams and side vents, let into the sides
    seams = []
    for sx in (-1, 1):
        seams.append(((sx * 0.355, FRONT + 0.001, 0.165), (0.0025, 0.004, 0.085)))
        seams.append(((sx * (HW - 0.002), 0.0, 0.40), (0.004, 0.003, 0.0)))
    add(cuboids('Seams', seams[::2]), m['bezel'])
    vents = []
    for k in range(5):
        vents.append(((HW - 0.002, 0.18, 0.11 + k * 0.03), (0.004, 0.13, 0.008)))
    add(cuboids('Vents', vents), joint)
    for k in range(6):  # vent slots across the back of the deck
        add(box('BackVent', (0.09, 0.008, 0.004), (0.0, BACK - 0.045, 0.31 + k * 0.012), 0.4, seg=(8, 4)), joint)
    for sx in (-1, 1):
        for z in (0.225, 0.105):
            bolt(add, m, (sx * 0.56, FRONT + 0.002, z), 0.012, 'front')
        for y in (-0.52, 0.38):
            bolt(add, m, (sx * (HW - 0.09), y, HUMP_TOP - 0.001), 0.012, 'top')

    # ---- the face: a wide screen in the front skirt, lights and dials either side
    sc = dict(radii=(0.21, 0.014, 0.072), center=(0, FRONT - 0.002, 0.165), bezel=0.012)
    glass, bezel = kit.screen('Typewriter', sc['radii'], sc['center'], sc['bezel'], e=0.3, seg=(40, 20))
    add(glass, m['face'])
    add(bezel, m['bezel'])
    for sx, dot in ((-1, 0), (1, 1)):
        x = sx * 0.40
        add(ball('Light', 0.017, (x, FRONT - 0.004, 0.215), seg=(12, 8)), m['dot'](dot))
        add(kit.torus('LightRim', 0.023, 0.005, seg=(18, 6), location=(x, FRONT - 0.002, 0.215), rotation=FACING['front']), joint)
        add(kit.torus('KnobSkirt', 0.032, 0.005, seg=(18, 6), location=(x, FRONT - 0.001, 0.115), rotation=FACING['front']), joint)
        add(puck('DialKnob', 0.028, 0.012, (x, FRONT - 0.008, 0.115), 0.5, seg=(18, 8)), knob)
        add(box('DialPointer', (0.004, 0.004, 0.014), (x, FRONT - 0.02, 0.115 + 0.012), 0.4, seg=(6, 4)), m['glow'])

    # ---- feet: sprung, like the monitor's legs, but short
    for sx in (-1, 1):
        for y in (-0.9, 0.33):
            x = sx * 0.56
            add(box('Hip', (0.05, 0.05, 0.014), (x, y, BODY_Z0 - 0.006), 0.4, seg=(14, 6)), joint)
            add(kit.tube('Sleeve', [(x, y, BODY_Z0 - 0.004), (x, y, 0.115)], 0.03, ring=12)[0], m['role']('Leg'))
            add(kit.tube('Rod', [(x, y, 0.12), (x, y, 0.04)], 0.014, ring=8)[0], joint, 'root')
            for k in range(2):
                add(kit.torus('Coil', 0.022, 0.0042, seg=(12, 5), location=(x, y, 0.06 + k * 0.022),
                              rotation=(0.12 * (-1) ** k, 0, 0)), knob, 'root')
            add(kit.superellipsoid('Foot', (0.055, 0.055, 0.022), 0.5, 0.6, seg=(14, 7), location=(x, y, 0.024)),
                m['role']('Leg'), 'root')

    # ---- the keys
    cap_mat = m['role']('Cap')
    for kid, k in keys.items():
        x, y, top, deck = k['x'], k['y'], k['top'], k['deck']
        bone = f'key_{kid}'
        if kid == 'space':
            zc = top - 0.013
            add(box('SpaceBar', (0.3, 0.03, 0.013), (x, y, zc), 0.4, seg=(24, 8)), cap_mat, bone)
            add(box('SpaceRim', (0.306, 0.0325, 0.004), (x, y, zc - 0.011), 0.5, seg=(24, 6)), joint, bone)
            for sx in (-1, 1):
                add(box('SpaceArm', (0.012, 0.06, 0.009), (sx * 0.24, y + 0.06, zc - 0.002), 0.4, seg=(8, 6)), joint, bone)
                add(box('SpaceSleeve', (0.022, 0.022, 0.016), (sx * 0.24, y + 0.12, zc - 0.02), 0.5, seg=(8, 6)), joint)
            add(legend(f'Legend_{kid}', x, y, top + 0.0006, 0.03, k['cell']), legend_mat, bone)
            continue
        hx = k['hx']
        add(kit.superellipsoid(f'Cap_{kid}', (hx, CAP_R, CAP_H), 0.3, 0.55 if k['wide'] else 1.0, seg=(10, 4),
                               location=(x, y, top - CAP_H)), cap_mat, bone)
        rim = add(kit.torus(f'Rim_{kid}', CAP_R + 0.0015, 0.0045, seg=(8, 3), location=(x, y, top - 2 * CAP_H + 0.002)),
                  m['role']('Rim', 'joint'), bone)
        if k['wide']:
            kit.stretch(rim, (hx + 0.0015) / (CAP_R + 0.0015))
        add(legend(f'Legend_{kid}', x, y, top + 0.0006, 0.03, k['cell']), legend_mat, bone)
        add(kit.tube(f'Stem_{kid}', [(x, y, top - 2 * CAP_H), (x, y, deck + 0.004)], 0.0058, ring=5)[0], joint, bone)
        add(kit.torus(f'Coil_{kid}', 0.0115, 0.0026, seg=(6, 3), location=(x, y, deck + 0.022), rotation=(0.15, 0, 0)), knob, bone)
        add(kit.lathe(f'Sleeve_{kid}', [(0.0145, 0.016), (0.0145, 0.0), (0, 0.0)], seg=6, location=(x, y, deck)), joint)

    # ---- the typebar segment: a hoop on posts in the basket, a knuckle for every bar, the bars
    hoop = [(R * math.sin(a), -R * math.cos(a), ZS - 0.028)
            for a in [(-ARC - 0.12) + (2 * ARC + 0.24) * i / 20 for i in range(21)]]
    add(kit.tube('Hoop', hoop, 0.02, ring=8)[0], m['bezel'], 'segment')
    for a in (-1, -0.5, 0, 0.5, 1):
        ang = a * (ARC + 0.05)
        p = (R * math.sin(ang), -R * math.cos(ang))
        add(kit.tube('Post', [(p[0], p[1], TUB_FLOOR), (p[0], p[1], ZS - 0.03)], 0.021, ring=8)[0], joint, 'segment')
    for sx in (-1, 1):
        a = sx * (ARC + 0.12)
        add(ball('HoopEnd', 0.027, (R * math.sin(a), -R * math.cos(a), ZS - 0.028), seg=(12, 8)), knob, 'segment')
    verify = {}
    for kid, phi in slots.items():
        pivot, rest, tip, xaxis, strike_dir = bar_geometry(phi)
        bone = f'bar_{kid}'
        across, along = xaxis, rest
        up = across.cross(along)
        knuckle = kit.lathe(f'Knuckle_{kid}', [(0.0048, 0.0055), (0.0048, -0.0055), (0, -0.0055)], seg=8, location=tuple(pivot))
        knuckle.rotation_euler = frame_euler(across)
        add(knuckle, knob, bone)
        add(kit.tube(f'Bar_{kid}', [tuple(pivot + rest * 0.004), tuple(tip - rest * 0.016)], 0.0046, ring=6)[0], joint, bone)
        slug = cuboids(f'Slug_{kid}', [(tuple(tip - rest * 0.007), (0.0048, 0.008, 0.0075), (across, along, up))])
        add(slug, m['glow'], bone)
        verify[kid] = (slug, pivot, rest, tip)

    # ---- ribbon guide, tape arm
    gl = math.hypot(PRINT[1] - GUIDE_PIVOT[1], PRINT[2] - GUIDE_PIVOT[2])
    gtip = Vector(GUIDE_PIVOT) + Vector((0, math.cos(GUIDE_REST), math.sin(GUIDE_REST))) * gl
    add(kit.tube('GuidePost', [(0, GUIDE_PIVOT[1], TUB_FLOOR), GUIDE_PIVOT], 0.016, ring=8)[0], joint, 'segment')
    add(kit.tube('GuideArm', [GUIDE_PIVOT, tuple(gtip)], 0.012, ring=8)[0], joint, 'guide')
    add(ball('GuideKnuckle', 0.016, GUIDE_PIVOT, seg=(10, 6)), knob, 'guide')
    add(cuboids('GuideFork', [((0, gtip.y, gtip.z), (0.028, 0.008, 0.008)),
                              ((-0.026, gtip.y, gtip.z + 0.01), (0.004, 0.008, 0.014)),
                              ((0.026, gtip.y, gtip.z + 0.01), (0.004, 0.008, 0.014))]), knob, 'guide')
    tl = math.hypot(PRINT[1] - TAPE_PIVOT[1], PRINT[2] - TAPE_PIVOT[2])
    ttip = Vector(TAPE_PIVOT) + Vector((0, math.cos(TAPE_REST), math.sin(TAPE_REST))) * tl
    add(kit.tube('TapePost', [(TAPE_PIVOT[0], TAPE_PIVOT[1], TUB_FLOOR), TAPE_PIVOT], 0.013, ring=8)[0], joint, 'segment')
    add(kit.tube('TapeArm', [TAPE_PIVOT, tuple(ttip)], 0.01, ring=8)[0], joint, 'tape')
    add(ball('TapeKnuckle', 0.014, TAPE_PIVOT, seg=(10, 6)), knob, 'tape')
    add(cuboids('TapeJog', [((0.014, ttip.y, ttip.z), (0.016, 0.005, 0.005))]), joint, 'tape')
    add(box('TapePad', (0.012, 0.008, 0.01), (0, ttip.y, ttip.z), 0.4, seg=(8, 6)), m['role']('Tape', 'glow'), 'tape')
    add(puck('TapeReel', 0.024, 0.007, (0.03, TAPE_PIVOT[1] + 0.06, TAPE_PIVOT[2] + 0.016), 0.5, seg=(14, 6)),
        m['role']('Tape', 'glow'), 'tape')
    parts[-1].rotation_euler = (0, PI / 2, 0)

    # ---- ribbon spools on the deck, left and right, and the ribbon
    for sx, bone in ((-1, 'spoolL'), (1, 'spoolR')):
        x, y = sx * SPOOL_X, SPOOL_Y
        add(kit.superellipsoid('Spool', (0.078, 0.078, 0.024), 0.45, 1.0, seg=(20, 8), location=(x, y, HUMP_TOP + 0.03)), knob, bone)
        add(kit.torus('SpoolRim', 0.078, 0.0055, seg=(20, 5), location=(x, y, HUMP_TOP + 0.05)), joint, bone)
        add(kit.superellipsoid('SpoolHub', (0.036, 0.036, 0.014), 0.45, 1.0, seg=(14, 6), location=(x, y, HUMP_TOP + 0.058)),
            m['dot'](2), bone)
        add(box('SpoolArm', (0.06, 0.004, 0.004), (x, y, HUMP_TOP + 0.076), 0.4, seg=(6, 4)), joint, bone)
        add(box('SpoolArm', (0.004, 0.06, 0.004), (x, y, HUMP_TOP + 0.076), 0.4, seg=(6, 4)), joint, bone)
        add(kit.torus('SpoolSocket', 0.084, 0.008, seg=(20, 5), location=(x, y, HUMP_TOP + 0.004)), joint)
        # the ribbon wound on the spool, under its rim
        add(kit.lathe('RibbonPack', [(0.066, 0.014), (0.066, 0.0), (0.04, 0.0), (0.04, 0.014)], seg=24,
                      location=(x, y, HUMP_TOP + 0.052)), m['bezel'], bone)
        # the ribbon itself, two-tone like the real thing (black over red), each half its own band
        path = [(x - sx * 0.066, 0.03, HUMP_TOP + 0.06), (sx * 0.45, 0.028, 0.44), (sx * 0.25, 0.026, 0.455),
                (sx * 0.09, 0.026, 0.462), (sx * 0.012, float(gtip.y), float(gtip.z))]
        pts = kit.spline(path, 12)
        for half, dz, mat in (('Black', 0.008, m['bezel']), ('Red', -0.008, m['role']('Ribbon', 'bezel'))):
            band, ts = ribbon(f'Ribbon{half}.{bone[-1]}', [(p[0], p[1], p[2] + dz) for p in pts], 0.0078, 0.0025)
            add(band, mat, {'guide': [t ** 1.6 for t in ts], 'body': [1 - t ** 1.6 for t in ts]})

    # ---- the card holder: two thin fingers either side of the print point, just in front of
    # the paper and under the line, that show where the next letter lands without hiding it
    # (clear of the ribbon guide's fork)
    py, pz = PRINT[1] - 0.012, PRINT[2]
    fingers = []
    for sx in (-1, 1):
        fingers.append(((sx * 0.046, py, pz - 0.03), (0.007, 0.0018, 0.012)))
        fingers.append(((sx * 0.041, py, pz - 0.016), (0.0035, 0.0018, 0.003)))
    add(cuboids('CardHolder', fingers), m['glow'])
    for sx in (-1, 1):
        add(kit.tube('CardHolderArm', [(sx * 0.048, py, pz - 0.04), (sx * 0.07, py - 0.03, HUMP_TOP - 0.01)], 0.0035, ring=6)[0],
            joint)

    # ---- the rail along the back edge and the carriage on it
    add(box('Rail', (0.7, 0.06, 0.03), (0, 0.34, HUMP_TOP + 0.005), 0.35, seg=(32, 8)), joint)
    add(box('CarriageBeam', (PLATEN_LEN / 2 + 0.03, 0.05, 0.03), (XC, 0.34, 0.45), 0.35, seg=(28, 8)), shell, 'carriage')
    cap_y0, cap_y1 = 0.05, 0.40
    for sx in (-1, 1):
        x = XC + sx * CAP_X
        add(box('EndCap', (0.013, (cap_y1 - cap_y0) / 2, 0.115), (x, (cap_y0 + cap_y1) / 2, 0.545), 0.25, seg=(10, 14)), shell, 'carriage')
        add(box('AxleLug', (0.013, 0.05, 0.05), (x, AXIS[0], AXIS[1]), 0.4, seg=(8, 10)), shell, 'carriage')
        add(box('HolderArm', (0.013, 0.05, 0.14), (x, ROLL[0], ROLL[1] - 0.06), 0.3, seg=(8, 12)), shell, 'carriage')
        for yy, zz in ((0.1, 0.48), (0.1, 0.61), (0.35, 0.61), (0.35, 0.48)):
            bolt(add, m, (x + sx * 0.013, yy, zz), 0.009, 'left' if sx > 0 else 'right', 'carriage')
        add(kit.torus('Axle', 0.03, 0.006, seg=(16, 5), location=(x + sx * 0.014, AXIS[0], AXIS[1]), rotation=(0, PI / 2, 0)),
            joint, 'carriage')

    # platen: a rubber drum with end caps, two knurled knobs
    px0, px1 = PLATEN_X
    add(kit.lathe('Platen', [(0, 0.0), (PLATEN_R - 0.008, 0.0), (PLATEN_R, 0.008), (PLATEN_R, PLATEN_LEN - 0.008),
                             (PLATEN_R - 0.008, PLATEN_LEN), (0, PLATEN_LEN)], seg=28, location=(px0, AXIS[0], AXIS[1]),
                  rotation=(0, PI / 2, 0)), m['role']('Platen'), 'platen')
    for sx, x0 in ((-1, px0), (1, px1)):
        add(kit.tube('Spindle', [(x0, AXIS[0], AXIS[1]), (x0 + sx * 0.05, AXIS[0], AXIS[1])], 0.014, ring=8)[0], joint, 'platen')
        xk = x0 + sx * 0.06
        add(kit.lathe('Knob', [(0, 0.026), (0.04, 0.024), (0.046, 0.01), (0.046, 0.0), (0, 0.0)], seg=24,
                      location=(xk, AXIS[0], AXIS[1]), rotation=(0, sx * PI / 2, 0)), knob, 'platen')
        for k in range(12):  # knurls
            t = 2 * PI * k / 12
            add(box('Knurl', (0.014, 0.0045, 0.0045), (xk + sx * 0.012, AXIS[0] + 0.048 * math.cos(t), AXIS[1] + 0.048 * math.sin(t)),
                    0.3, seg=(4, 4), rotation=(t, 0, 0)), knob, 'platen')
        add(ball('KnobCap', 0.013, (xk + sx * 0.03, AXIS[0], AXIS[1]), seg=(10, 6)), joint, 'platen')

    # the bail: two arms from the platen's axle and a bar with two rollers
    bx = lambda s: XC + s * (PLATEN_LEN / 2 - 0.02)
    bdir = Vector((0, -math.cos(BAIL_ANGLE), math.sin(BAIL_ANGLE)))
    bar_c = Vector((0, AXIS[0], AXIS[1])) + bdir * BAIL_R
    for s in (-1, 1):
        add(kit.tube('BailArm', [(bx(s), AXIS[0], AXIS[1]), (bx(s), bar_c.y, bar_c.z)], 0.007, ring=8)[0], joint, 'bail')
    add(kit.tube('BailBar', [(bx(-1), bar_c.y, bar_c.z), (bx(1), bar_c.y, bar_c.z)], 0.0055, ring=8)[0], joint, 'bail')
    for x in (XC - 0.22, XC + 0.22):
        add(kit.lathe('BailRoller', [(0.018, 0.022), (0.018, -0.022), (0, -0.022)], seg=10, location=(x, bar_c.y, bar_c.z),
                      rotation=(0, PI / 2, 0)), m['role']('Platen'), 'bail')
    # the margin scale along the carriage beam, a tick for every column
    add(box('ScaleBar', (PLATEN_LEN / 2 + 0.02, 0.022, 0.006), (XC, 0.305, 0.4825), 0.35, seg=(24, 6)), m['bezel'], 'carriage')
    ticks = [((k * PITCH, 0.3, 0.4895), (0.0012, 0.008 if k % 4 == 0 else 0.005, 0.0015)) for k in range(COLS + 1)]
    add(cuboids('Ticks', ticks), m['glow'], 'carriage')
    # margin stops at either end of the line, riding the scale
    for k, sx in ((0, -1), (COLS, 1)):
        mx = k * PITCH + sx * 0.012
        add(box('MarginStop', (0.009, 0.016, 0.009), (mx, 0.305, 0.4945), 0.4, seg=(8, 6)), knob, 'carriage')
        add(cuboids('MarginPointer', [((mx - sx * 0.006, 0.288, 0.5), (0.0015, 0.004, 0.006))]), m['glow'], 'carriage')
    # carriage release levers on both end caps, the paper release behind the right one
    for sx in (-1, 1):
        x = XC + sx * CAP_X
        add(cuboids('ReleaseLever', [((x, 0.035, 0.668), (0.011, 0.03, 0.005),
                                      (Vector((1, 0, 0)), Vector((0, 1, 0.35)).normalized(), Vector((0, -0.35, 1)).normalized()))]),
            joint, 'carriage')
        add(ball('ReleaseTip', 0.011, (x, 0.008, 0.66), seg=(10, 6)), knob, 'carriage')
    x = XC + CAP_X
    add(kit.tube('PaperRelease', [(x, 0.36, 0.66), (x + 0.004, 0.38, 0.735)], 0.0065, ring=6)[0], joint, 'carriage')
    add(ball('PaperReleaseTip', 0.014, (x + 0.004, 0.38, 0.742), seg=(10, 6)), knob, 'carriage')

    # the paper table: a chute behind the platen, and the paper roll on its spindle
    (ylo, zlo), (yhi, zhi) = TABLE_LOW, TABLE_HIGH
    tl = math.hypot(yhi - ylo, zhi - zlo)
    tdir = Vector((0, yhi - ylo, zhi - zlo)).normalized()
    chute_c = Vector((XC, (ylo + yhi) / 2 + 0.02, (zlo + zhi) / 2))
    add(cuboids('Table', [(tuple(chute_c), (PAPER_W / 2 + 0.03, tl / 2, 0.006), (Vector((1, 0, 0)), tdir, Vector((0, -tdir.z, tdir.y))))]),
        m['bezel'], 'carriage')
    ry, rz = ROLL
    rx0, rx1 = PAPER_X
    add(kit.lathe('PaperRoll', [(0, 0.0), (ROLL_R, 0.0), (ROLL_R, PAPER_W), (0, PAPER_W)], seg=24, location=(rx0, ry, rz),
                  rotation=(0, PI / 2, 0)), m['role']('Paper', 'glow'), 'roll')
    add(kit.lathe('PaperCore', [(0, -0.016), (0.022, -0.016), (0.022, PAPER_W + 0.016), (0, PAPER_W + 0.016)], seg=12,
                  location=(rx0, ry, rz), rotation=(0, PI / 2, 0)), joint, 'roll')
    for sx, x0 in ((-1, rx0 - 0.014), (1, rx1 + 0.014)):
        add(kit.lathe('RollFlange', [(0.078, 0.008), (0.078, -0.008), (0, -0.008)], seg=20, location=(x0, ry, rz),
                      rotation=(0, PI / 2, 0)), knob, 'roll')
        x = XC + sx * CAP_X
        add(kit.tube('RollSpindle', [(x + sx * 0.02, ry, rz), (x0 + sx * 0.0, ry, rz)], 0.012, ring=8)[0], joint, 'carriage')
        add(ball('SpindleCap', 0.022, (x + sx * 0.018, ry, rz), seg=(10, 6)), knob, 'carriage')

    # the return lever: a slim arm from the left end cap, out past the platen knob and forward,
    # ending in a flat paddle to push (well clear of the paper, so it never hides the type)
    lp = Vector(LEVER_PIVOT)
    arm = [tuple(lp), (lp.x - 0.05, lp.y - 0.03, lp.z + 0.03), (lp.x - 0.11, lp.y - 0.1, lp.z + 0.045),
           (lp.x - 0.14, lp.y - 0.2, lp.z + 0.035), (lp.x - 0.15, lp.y - 0.27, lp.z + 0.02)]
    add(ball('LeverHub', 0.022, tuple(lp), seg=(12, 8)), knob, 'lever')
    add(kit.tube('LeverArm', kit.spline(arm, 12), 0.008, ring=8)[0], joint, 'lever')
    add(kit.superellipsoid('LeverPaddle', (0.016, 0.03, 0.007), 0.4, 0.8, seg=(12, 6), location=arm[-1]), knob, 'lever')
    add(ball('LeverTip', 0.008, (arm[-1][0], arm[-1][1] - 0.03, arm[-1][2]), seg=(10, 6)), m['beacon'], 'lever')
    add(kit.tube('LeverPost', [(lp.x, lp.y, lp.z - 0.03), tuple(lp)], 0.016, ring=8)[0], joint, 'carriage')

    # ---- the bell: a lit dome and a clapper
    bx0, by0, bz0 = BELL
    add(kit.superellipsoid('BellBase', (0.078, 0.078, 0.008), 0.4, 1.0, seg=(20, 6), location=(bx0, by0, bz0 + 0.002)), joint)
    add(kit.lathe('BellDome', [(0, 0.066), (0.03, 0.062), (0.054, 0.045), (0.066, 0.02), (0.069, 0.006), (0, 0.006)], seg=24,
                  location=(bx0, by0, bz0 + 0.004)), m['dot'](1))
    add(ball('BellKnob', 0.01, (bx0, by0, bz0 + 0.072), seg=(8, 6)), joint)
    add(box('ClapperMount', (0.016, 0.02, 0.01), (CLAP_PIVOT[0], CLAP_PIVOT[1] - 0.004, CLAP_PIVOT[2] - 0.006), 0.4, seg=(8, 6)), joint)
    add(kit.tube('ClapperStem', [CLAP_PIVOT, CLAP_TIP], 0.0065, ring=6)[0], joint, 'bell')
    add(ball('Clapper', 0.016, CLAP_TIP, seg=(10, 6)), knob, 'bell')

    # ---- the gauge with its needle, on the left side
    gx, gy, gz = GAUGE
    add(puck('GaugePlate', 0.07, 0.008, (gx, gy, gz), 0.5, seg=(24, 8)), m['bezel'])
    parts[-1].rotation_euler = (0, PI / 2, 0)
    add(kit.torus('GaugeRim', 0.074, 0.007, seg=(24, 6), location=(gx - 0.004, gy, gz), rotation=(0, PI / 2, 0)), joint)
    ticks = []
    for k in range(9):
        a = math.radians(-70 + k * 17.5)
        radial, tang = Vector((0, math.sin(a), math.cos(a))), Vector((0, math.cos(a), -math.sin(a)))
        ticks.append(((gx - 0.01, gy + 0.054 * math.sin(a), gz + 0.054 * math.cos(a)),
                      (0.002, 0.0025, 0.006 if k % 2 == 0 else 0.004), (Vector((1, 0, 0)), tang, radial)))
    add(cuboids('GaugeTicks', ticks), m['glow'])
    add(ball('GaugeLamp', 0.009, (gx - 0.008, gy, gz - 0.026), seg=(10, 6)), m['dot'](4))
    add(box('Needle', (0.003, 0.0035, 0.03), (gx - 0.016, gy, gz + 0.022), 0.4, seg=(6, 6)), m['glow'], 'needle')
    add(ball('NeedleHub', 0.011, (gx - 0.016, gy, gz), seg=(10, 6)), joint, 'needle')

    bones = bone_table(keys, slots)
    armature = rig('TypewriterRig', bones)
    out = looks.finish(armature, parts, skin, m)
    global VERIFY
    VERIFY = verify
    return out


# ---------------------------------------------------------------- the geometry block


def geometry():
    """The measurements the runtime needs, rounded; written into typewriter.json."""
    r = lambda v: round(v, 4)
    pv = [r(v) for v in PRINT]
    return {
        '_': 'Owned by typewriter.py: rewritten from the model whenever it changes (blender/build.sh). '
             'Metres in Blender frame (Z up, machine faces -Y, typist right = +X). Positions are at rest and '
             '[y, z] pairs lie in the plane x = 0 unless a key says otherwise. The carriage bone rests with column 0 '
             'at the print point and steps -X one pitch per character (travel = columns * pitch); the platen turns '
             'about its local X, positive = line feed (paper moves up at the front).',
        'print': pv,
        'printAngle': round(PRINT_ANGLE, 4),
        'strike': STRIKE,
        'keyPress': 0.12,
        'shiftDrop': 0.02,
        'altDrop': 0.04,
        'platenAxis': [r(AXIS[0]), r(AXIS[1])],
        'platenRadius': PLATEN_R,
        'platenX': [r(PLATEN_X[0]), r(PLATEN_X[1])],
        'bail': [r(AXIS[0] - BAIL_R * math.cos(BAIL_ANGLE)), r(AXIS[1] + BAIL_R * math.sin(BAIL_ANGLE))],
        'bailRoller': 0.018,
        'exitAngle': 0.2,
        'roll': [r(ROLL[0]), r(ROLL[1])],
        'rollRadius': ROLL_R,
        'table': [r(TABLE_LOW[0]), r(TABLE_LOW[1])],
        'tableTop': [r(TABLE_HIGH[0]), r(TABLE_HIGH[1])],
        'paperX': [r(PAPER_X[0]), r(PAPER_X[1])],
        'carriageTravel': r(TRAVEL),
        'carriageStep': [-PITCH, 0, 0],
        'guideLift': r(math.atan2(PRINT[2] - GUIDE_PIVOT[2], PRINT[1] - GUIDE_PIVOT[1]) - GUIDE_REST),
        'tapeLift': r(math.atan2(PRINT[2] - TAPE_PIVOT[2], PRINT[1] - TAPE_PIVOT[1]) - TAPE_REST),
        'bellSwing': 0.5,
        'leverThrow': 0.9,
        'bailLift': 0.35,
        'needleRange': [-0.9, 0.9],
        'keyTravel': 0.012,
        # Every keycap's top at rest, for clicking keys: id -> [x, y, top z, half width, half depth].
        'keys': {kid: [r(k['x']), r(k['y']), r(k['top']), r(k['hx']), 0.03 if kid == 'space' else CAP_R]
                 for kid, k in key_layout().items()},
    }


def write_geometry():
    """Replace typewriter.json's "geometry" block (the last one), leaving the rest as it is."""
    with open(JSON_PATH) as f:
        text = f.read()
    head = text[: text.index('  "geometry": {')]
    g = geometry()
    lines = ',\n'.join(f'    {json.dumps(k)}: {json.dumps(v)}' for k, v in g.items())
    block = '{\n' + lines + '\n  }'
    with open(JSON_PATH, 'w') as f:
        f.write(head + '  "geometry": ' + block + '\n}\n')
    json.loads(open(JSON_PATH).read())


VERIFY = {}

if __name__ == '__main__':
    write_geometry()
    print(json.dumps(geometry(), indent=1))
