"""The robot teleprinter: a chunky toy take on an office telex that prints what comes down the
line on endless paper.

A rounded cabinet on four short sprung feet with a screen face on its front, three lamps on
its left and a rotary dial on its right. On its deck a rubber platen between two towers, a
paper roll in a cradle behind it, and in front a print head that runs along a rail: a block
with a typewheel on a rocker that pecks at the paper, and an inking roller under the wheel.
The paper comes off the roll, round the platen, past the print point and up through a tear
bar, and on up into the air until it curls back over the machine. A bell with a lit dome on
the deck, and an antenna with a lit ball at the back.

Frame: Z up, faces -Y (the reader stands at -Y, their right is +X), floor z = 0, metres.
Every joint turns about its bone's own local X (as typewriter.py's do), so the page poses
everything with one rule. The paper's grid is read from src/teleprinter/teleprinter.json,
which also receives this file's "geometry" block. Built and exported by blender/build.sh.
"""

import json
import math
import os

import kit
import looks
from mathutils import Vector

from parts import FACING, ball, bolt, box, puck
from typewriter import cuboids, rig

PI = math.pi
FACE = 'typewriter'  # the same wide screen face
PALETTE = 'teleprinter'

JSON_PATH = os.path.join(os.path.dirname(__file__), '..', 'src', 'teleprinter', 'teleprinter.json')
with open(JSON_PATH) as f:
    SPEC = json.load(f)
TYPE = SPEC['type']
COLS, PITCH, LINE, PAPER_W = TYPE['columns'], TYPE['pitch'], TYPE['line'], TYPE['paperWidth']

# ---------------------------------------------------------------- dimensions

HW = 0.66  # the cabinet's half width
FRONT, BACK = -0.42, 0.42
BODY_Z0 = 0.07  # its underside (the feet are 0.07 high)
DECK = 0.40  # its top

# The platen: its axis (y, z), and the print point a little above its front.
PLATEN_R = 0.065
AXIS = (0.08, 0.52)
PRINT_ANGLE = math.radians(-5)  # below the front equator; negative is above it
PRINT = (0.0, AXIS[0] - PLATEN_R * math.cos(PRINT_ANGLE), AXIS[1] - PLATEN_R * math.sin(PRINT_ANGLE))
PLATEN_LEN = PAPER_W + 0.06
TOWER_X = PLATEN_LEN / 2 + 0.03
# The paper leaves the platen this far above its front and runs straight up, leaning back by
# as much, through the tear bar.
LEAVE = math.radians(12)
LEAVE_AT = (AXIS[0] - PLATEN_R * math.cos(LEAVE), AXIS[1] + PLATEN_R * math.sin(LEAVE))
BAR_Z = 0.80
BAIL = (LEAVE_AT[0] + math.sin(LEAVE) * (BAR_Z - LEAVE_AT[1]) / math.cos(LEAVE), BAR_Z)
# The roll behind the platen, and where its paper runs under to the platen's back.
ROLL = (0.30, 0.50)
ROLL_R = 0.075
TABLE_TOP = (0.27, ROLL[1] - ROLL_R + 0.004)
TABLE = (0.17, 0.445)

# The print head: a block on a rail in front of the platen, a rocker on it carrying the
# typewheel, whose rim meets the paper at the print point from in front and below.
TEXT_X0 = -COLS * PITCH / 2  # column 0's left edge
HEAD_X = TEXT_X0 + PITCH / 2  # the head rests at column 0
RAIL = (-0.075, 0.43)
WHEEL_R = 0.035
_reach = WHEEL_R + 0.003
WHEEL = (PRINT[1] - math.cos(math.radians(35)) * _reach, PRINT[2] - math.sin(math.radians(35)) * _reach)
PECK_BACK = 0.14  # how far the rocker leans back off the paper between strikes (rad)

LAMPS = [(-0.44, 0.30), (-0.44, 0.24), (-0.44, 0.18)]  # (x, z) on the front
DIAL = (0.44, FRONT - 0.004, 0.235)
DIAL_R = 0.085
BELL = (0.50, -0.27, DECK)
CLAP_PIVOT = (BELL[0], BELL[1] - 0.095, DECK - 0.015)
CLAP_TIP = (BELL[0], BELL[1] - 0.058, DECK + 0.04)
ANTENNA = (-0.56, 0.33, DECK)


# ---------------------------------------------------------------- build


def bone_table():
    head = (HEAD_X, RAIL[0], RAIL[1])
    return [
        ('root', (0, 0, 0), (0, 0, 0.06), None, (1, 0, 0)),
        ('body', (0, 0, BODY_Z0), (0, 0, 0.2), 'root', (1, 0, 0)),
        # the head slides along +X, a column at a time
        ('head', head, (HEAD_X + 0.1, RAIL[0], RAIL[1]), 'body', (0, 1, 0)),
        # the rocker turns about the rail: positive leans the wheel back off the paper
        ('peck', head, (HEAD_X, WHEEL[0], WHEEL[1]), 'head', (1, 0, 0)),
        ('wheel', (HEAD_X, WHEEL[0], WHEEL[1]), (HEAD_X, WHEEL[0], WHEEL[1] + 0.05), 'peck', (1, 0, 0)),
        ('platen', (0, AXIS[0], AXIS[1]), (0, AXIS[0], AXIS[1] + 0.1), 'body', (-1, 0, 0)),
        ('roll', (0, ROLL[0], ROLL[1]), (0, ROLL[0], ROLL[1] + 0.1), 'body', (1, 0, 0)),
        # the dial turns about its face's normal
        ('dial', DIAL, (DIAL[0], DIAL[1], DIAL[2] + 0.05), 'body', (0, 1, 0)),
        ('bell', CLAP_PIVOT, CLAP_TIP, 'body', (-1, 0, 0)),
        ('antenna', ANTENNA, (ANTENNA[0], ANTENNA[1], ANTENNA[2] + 0.1), 'body', (1, 0, 0)),
    ]


def build(look='ink', flame=None):
    m = looks.materials(look, flame, face=FACE, palette=PALETTE)
    parts, skin = [], []

    def add(obj, mat, bone='body'):
        if mat is not None:
            kit.assign(obj, mat)
        parts.append(obj)
        skin.append((obj, bone))
        return obj

    shell, joint = m['shell'], m['joint']
    knob = m['role']('Knob', 'joint')

    # ---- the cabinet, and a lip round its deck
    add(box('Cabinet', (HW, (BACK - FRONT) / 2, (DECK - BODY_Z0) / 2), (0, (BACK + FRONT) / 2, (DECK + BODY_Z0) / 2), 0.16,
            seg=(40, 20)), shell)
    add(box('DeckPlate', (HW - 0.05, (BACK - FRONT) / 2 - 0.05, 0.006), (0, (BACK + FRONT) / 2, DECK - 0.002), 0.3,
            seg=(32, 6)), m['role']('Plate', 'bezel'))
    # a band of vents along each side, and slots across the back
    vents = []
    for sx in (-1, 1):
        for k in range(5):
            vents.append(((sx * (HW - 0.002), 0.12, 0.13 + k * 0.035), (0.004, 0.16, 0.008)))
    add(cuboids('Vents', vents), joint)
    add(cuboids('BackVents', [((0.0, BACK - 0.002, 0.14 + k * 0.03), (0.24, 0.004, 0.007)) for k in range(5)]), joint)
    for sx in (-1, 1):
        for z in (0.33, 0.13):
            bolt(add, m, (sx * 0.6, FRONT + 0.002, z), 0.012, 'front')
        for y in (-0.36, 0.36):
            bolt(add, m, (sx * (HW - 0.06), y, DECK + 0.004), 0.012, 'top')

    # ---- the face: a wide screen in the front, lamps on its left, the dial on its right
    glass, bezel = kit.screen('Teleprinter', (0.2, 0.014, 0.075), (0, FRONT - 0.002, 0.24), 0.012, e=0.3, seg=(40, 20))
    add(glass, m['face'])
    add(bezel, m['bezel'])
    for i, (x, z) in enumerate(LAMPS):
        add(ball('Lamp', 0.016, (x, FRONT - 0.004, z), seg=(12, 8)), m['dot'](i))
        add(kit.torus('LampRim', 0.022, 0.005, seg=(18, 6), location=(x, FRONT - 0.002, z), rotation=FACING['front']), joint)
    dx, dy, dz = DIAL
    add(puck('DialPlate', DIAL_R + 0.012, 0.008, (dx, FRONT - 0.002, dz), 0.5, seg=(32, 8)), m['bezel'])
    add(kit.torus('DialRim', DIAL_R + 0.012, 0.006, seg=(32, 6), location=(dx, FRONT - 0.006, dz), rotation=FACING['front']),
        joint)
    # the finger wheel turns; the number ring under it and the finger stop don't
    add(puck('FingerWheel', DIAL_R, 0.008, (dx, dy - 0.006, dz), 0.45, seg=(32, 8)), m['role']('Dial', 'joint'), 'dial')
    for k in range(10):
        a = math.radians(60 + k * 27)
        hx, hz = dx + 0.06 * math.cos(a), dz + 0.06 * math.sin(a)
        add(kit.torus('FingerHole', 0.0145, 0.0035, seg=(14, 5), location=(hx, dy - 0.015, hz), rotation=FACING['front']),
            knob, 'dial')
        add(puck('HoleFloor', 0.012, 0.002, (hx, dy - 0.004, hz), 0.5, seg=(12, 4)), m['glow'], 'dial')
    add(puck('DialHub', 0.026, 0.008, (dx, dy - 0.016, dz), 0.5, seg=(20, 6)), m['glow'], 'dial')
    add(cuboids('DialMark', [((dx, dy - 0.025, dz + 0.012), (0.003, 0.002, 0.01))]), m['bezel'], 'dial')
    stop = math.radians(-40)
    add(kit.tube('FingerStop', [(dx + 0.07 * math.cos(stop), dy - 0.012, dz + 0.07 * math.sin(stop)),
                                (dx + 0.1 * math.cos(stop), dy - 0.022, dz + 0.1 * math.sin(stop))], 0.005, ring=6)[0], knob)

    # ---- feet: sprung, as the typewriter's
    for sx in (-1, 1):
        for y in (-0.3, 0.3):
            x = sx * 0.5
            add(box('Hip', (0.05, 0.05, 0.014), (x, y, BODY_Z0 - 0.006), 0.4, seg=(14, 6)), joint)
            add(kit.tube('Sleeve', [(x, y, BODY_Z0 - 0.004), (x, y, 0.115)], 0.03, ring=12)[0], m['role']('Leg'))
            add(kit.tube('Rod', [(x, y, 0.12), (x, y, 0.04)], 0.014, ring=8)[0], joint, 'root')
            for k in range(2):
                add(kit.torus('Coil', 0.022, 0.0042, seg=(12, 5), location=(x, y, 0.06 + k * 0.022),
                              rotation=(0.12 * (-1) ** k, 0, 0)), knob, 'root')
            add(kit.superellipsoid('Foot', (0.055, 0.055, 0.022), 0.5, 0.6, seg=(14, 7), location=(x, y, 0.024)),
                m['role']('Leg'), 'root')

    # ---- the platen between two towers, knurled knobs outside them
    ay, az = AXIS
    for sx in (-1, 1):
        x = sx * TOWER_X
        add(box('Tower', (0.016, 0.12, 0.12), (x, ay, DECK + 0.1), 0.25, seg=(10, 14)), shell)
        add(kit.torus('Axle', 0.028, 0.006, seg=(16, 5), location=(x + sx * 0.017, ay, az), rotation=(0, PI / 2, 0)), joint)
        for yy, zz in ((ay - 0.08, DECK + 0.04), (ay + 0.08, DECK + 0.04), (ay + 0.08, DECK + 0.16)):
            bolt(add, m, (x + sx * 0.016, yy, zz), 0.009, 'left' if sx > 0 else 'right')
    x0 = -PLATEN_LEN / 2
    add(kit.lathe('Platen', [(0, 0.0), (PLATEN_R - 0.008, 0.0), (PLATEN_R, 0.008), (PLATEN_R, PLATEN_LEN - 0.008),
                             (PLATEN_R - 0.008, PLATEN_LEN), (0, PLATEN_LEN)], seg=28, location=(x0, ay, az),
                  rotation=(0, PI / 2, 0)), m['role']('Platen'), 'platen')
    for sx in (-1, 1):
        xe = sx * PLATEN_LEN / 2
        add(kit.tube('Spindle', [(xe, ay, az), (sx * (TOWER_X + 0.03), ay, az)], 0.013, ring=8)[0], joint, 'platen')
        xk = sx * (TOWER_X + 0.04)
        add(kit.lathe('Knob', [(0, 0.024), (0.04, 0.022), (0.045, 0.01), (0.045, 0.0), (0, 0.0)], seg=24,
                      location=(xk, ay, az), rotation=(0, sx * PI / 2, 0)), knob, 'platen')
        for k in range(12):
            t = 2 * PI * k / 12
            add(box('Knurl', (0.013, 0.0045, 0.0045), (xk + sx * 0.011, ay + 0.047 * math.cos(t), az + 0.047 * math.sin(t)),
                    0.3, seg=(4, 4), rotation=(t, 0, 0)), knob, 'platen')
        add(ball('KnobCap', 0.012, (xk + sx * 0.028, ay, az), seg=(10, 6)), joint, 'platen')

    # ---- the tear bar: two posts up from the towers and a toothed bar across, the paper
    # rising behind it
    by, bz = BAIL
    for sx in (-1, 1):
        x = sx * (TOWER_X - 0.004)
        add(kit.tube('BarPost', [(x, ay - 0.02, DECK + 0.21), (x, by - 0.01, bz)], 0.009, ring=8)[0], joint)
        add(ball('BarEnd', 0.016, (x, by - 0.012, bz), seg=(10, 6)), knob)
    add(kit.tube('TearBar', [(-(TOWER_X - 0.004), by - 0.012, bz), (TOWER_X - 0.004, by - 0.012, bz)], 0.006, ring=8)[0], joint)
    n = int(PAPER_W / 0.02)
    add(cuboids('Teeth', [((-PAPER_W / 2 + (k + 0.5) * PAPER_W / n, by - 0.008, bz + 0.009), (0.004, 0.002, 0.004),
                           (Vector((0.7071, 0, 0.7071)), Vector((0, 1, 0)), Vector((-0.7071, 0, 0.7071))))
                          for k in range(n)]), m['glow'])

    # ---- the paper roll in a cradle behind the platen
    ry, rz = ROLL
    rx0 = -PAPER_W / 2
    add(kit.lathe('PaperRoll', [(0, 0.0), (ROLL_R, 0.0), (ROLL_R, PAPER_W), (0, PAPER_W)], seg=24, location=(rx0, ry, rz),
                  rotation=(0, PI / 2, 0)), m['role']('Paper', 'glow'), 'roll')
    add(kit.lathe('PaperCore', [(0, -0.016), (0.022, -0.016), (0.022, PAPER_W + 0.016), (0, PAPER_W + 0.016)], seg=12,
                  location=(rx0, ry, rz), rotation=(0, PI / 2, 0)), joint, 'roll')
    for sx in (-1, 1):
        xf = sx * (PAPER_W / 2 + 0.014)
        add(kit.lathe('RollFlange', [(0.088, 0.008), (0.088, -0.008), (0, -0.008)], seg=20, location=(xf, ry, rz),
                      rotation=(0, PI / 2, 0)), knob, 'roll')
        xc = sx * (PAPER_W / 2 + 0.05)
        add(box('Cradle', (0.014, 0.05, (rz - DECK) / 2 + 0.01), (xc, ry, (rz + DECK) / 2), 0.3, seg=(8, 10)), shell)
        add(kit.tube('RollSpindle', [(xc, ry, rz), (xf, ry, rz)], 0.012, ring=8)[0], joint)
        add(ball('SpindleCap', 0.02, (xc + sx * 0.014, ry, rz), seg=(10, 6)), knob)

    # ---- the rail and the print head on it
    add(kit.tube('Rail', [(-(TOWER_X - 0.02), RAIL[0], RAIL[1]), (TOWER_X - 0.02, RAIL[0], RAIL[1])], 0.009, ring=10)[0], joint)
    add(kit.tube('Rail2', [(-(TOWER_X - 0.02), RAIL[0] - 0.035, RAIL[1] - 0.012),
                           (TOWER_X - 0.02, RAIL[0] - 0.035, RAIL[1] - 0.012)], 0.006, ring=8)[0], joint)
    for sx in (-1, 1):
        add(box('RailFoot', (0.016, 0.03, (RAIL[1] - DECK) / 2 + 0.006), (sx * (TOWER_X - 0.02), RAIL[0] - 0.015,
                                                                         (RAIL[1] + DECK) / 2), 0.4, seg=(8, 8)), joint)
    hx = HEAD_X
    add(box('HeadBlock', (0.042, 0.034, 0.024), (hx, RAIL[0] - 0.012, RAIL[1]), 0.35, seg=(12, 8)), shell, 'head')
    add(puck('HeadLamp', 0.008, 0.004, (hx - 0.024, RAIL[0] - 0.047, RAIL[1] + 0.004), 0.5, seg=(10, 4)), m['beacon'], 'head')
    # the rocker: two cheeks from the rail up to the wheel's axle
    wy, wz = WHEEL
    for sx in (-1, 1):
        add(kit.tube('Cheek', [(hx + sx * 0.016, RAIL[0], RAIL[1]), (hx + sx * 0.016, wy, wz)], 0.0055, ring=6)[0], joint, 'peck')
    add(kit.tube('Axle', [(hx - 0.02, wy, wz), (hx + 0.02, wy, wz)], 0.005, ring=8)[0], joint, 'peck')
    # the inking roller under the wheel's front, in the ribbon's colour
    iy, iz = wy - 0.026, wz - 0.03
    add(kit.lathe('Inker', [(0, 0.008), (0.011, 0.008), (0.011, -0.008), (0, -0.008)], seg=12, location=(hx, iy, iz),
                  rotation=(0, PI / 2, 0)), m['role']('Ribbon', 'bezel'), 'peck')
    add(kit.tube('InkerArm', [(hx + 0.012, iy, iz), (hx + 0.016, RAIL[0] + 0.004, RAIL[1] + 0.01)], 0.003, ring=6)[0], joint, 'peck')
    # the typewheel: a disc with type slugs round its rim
    add(kit.lathe('Wheel', [(0, 0.006), (WHEEL_R - 0.004, 0.006), (WHEEL_R, 0.003), (WHEEL_R, -0.003),
                            (WHEEL_R - 0.004, -0.006), (0, -0.006)], seg=32, location=(hx, wy, wz), rotation=(0, PI / 2, 0)),
        m['role']('Wheel', 'joint'), 'wheel')
    slugs = []
    for k in range(24):
        a = 2 * PI * k / 24
        radial = Vector((0, math.cos(a), math.sin(a)))
        tang = Vector((0, -math.sin(a), math.cos(a)))
        c = Vector((hx, wy, wz)) + radial * (WHEEL_R + 0.002)
        slugs.append((tuple(c), (0.005, 0.003, 0.0025), (Vector((1, 0, 0)), tang, radial)))
    add(cuboids('Slugs', slugs), m['glow'], 'wheel')
    add(puck('WheelHub', 0.012, 0.009, (hx, wy, wz), 0.5, seg=(14, 6)), knob, 'wheel')
    parts[-1].rotation_euler = (0, PI / 2, 0)

    # ---- the bell: a lit dome and a clapper
    bx0, by0, bz0 = BELL
    add(kit.superellipsoid('BellBase', (0.072, 0.072, 0.008), 0.4, 1.0, seg=(20, 6), location=(bx0, by0, bz0 + 0.002)), joint)
    add(kit.lathe('BellDome', [(0, 0.062), (0.028, 0.058), (0.05, 0.042), (0.062, 0.019), (0.065, 0.006), (0, 0.006)], seg=24,
                  location=(bx0, by0, bz0 + 0.004)), m['dot'](3))
    add(ball('BellKnob', 0.01, (bx0, by0, bz0 + 0.068), seg=(8, 6)), joint)
    add(box('ClapperMount', (0.016, 0.02, 0.01), (CLAP_PIVOT[0], CLAP_PIVOT[1] - 0.004, CLAP_PIVOT[2] - 0.006), 0.4, seg=(8, 6)), joint)
    add(kit.tube('ClapperStem', [CLAP_PIVOT, CLAP_TIP], 0.0065, ring=6)[0], joint, 'bell')
    add(ball('Clapper', 0.016, CLAP_TIP, seg=(10, 6)), knob, 'bell')

    # ---- the antenna: a coiled foot, a whip, a lit ball
    ax, ay2, az2 = ANTENNA
    add(puck('AntennaFoot', 0.032, 0.01, (ax, ay2, az2 + 0.01), 0.5, seg=(16, 6)), joint)
    parts[-1].rotation_euler = (0, 0, 0)
    for k in range(4):
        add(kit.torus('AntennaCoil', 0.014, 0.0035, seg=(12, 5), location=(ax, ay2, az2 + 0.03 + k * 0.012),
                      rotation=(0.15 * (-1) ** k, 0, 0)), knob, 'antenna')
    add(kit.tube('AntennaWhip', [(ax, ay2, az2 + 0.02), (ax, ay2, az2 + 0.56)], [0.006, 0.003], ring=6)[0], joint, 'antenna')
    add(ball('AntennaBall', 0.02, (ax, ay2, az2 + 0.575), seg=(12, 8)), m['beacon'], 'antenna')

    armature = rig('TeleprinterRig', bone_table())
    return looks.finish(armature, parts, skin, m)


# ---------------------------------------------------------------- the geometry block


def geometry():
    """The measurements the runtime needs, rounded; written into teleprinter.json."""
    r = lambda v: round(v, 4)
    return {
        '_': 'Owned by teleprinter.py: rewritten from the model whenever it changes (blender/build.sh). '
             'Metres in Blender frame (Z up, machine faces -Y, reader right = +X); [y, z] pairs lie in the plane x = 0. '
             'The head rests at column 0 and slides +X one pitch per character; the platen turns about its local X, '
             'positive = line feed (paper moves up at the front).',
        'print': [r(v) for v in PRINT],
        'printAngle': round(PRINT_ANGLE, 4),
        'platenAxis': [r(AXIS[0]), r(AXIS[1])],
        'platenRadius': PLATEN_R,
        'bail': [r(BAIL[0]), r(BAIL[1])],
        'exitAngle': round(LEAVE, 4),
        'roll': [r(ROLL[0]), r(ROLL[1])],
        'rollRadius': ROLL_R,
        'table': [r(TABLE[0]), r(TABLE[1])],
        'tableTop': [r(TABLE_TOP[0]), r(TABLE_TOP[1])],
        'paperX': [r(-PAPER_W / 2), r(PAPER_W / 2)],
        'textX0': r(TEXT_X0),
        'peckBack': PECK_BACK,
        'bellSwing': 0.5,
        # the finger wheel's turn for each digit dialled (rad), from 1 (one hole) to 0 (ten)
        'dialStep': round(math.radians(27), 4),
    }


def write_geometry():
    """Replace teleprinter.json's "geometry" block, leaving the rest as it is."""
    with open(JSON_PATH) as f:
        spec = json.load(f)
    spec['geometry'] = geometry()
    with open(JSON_PATH, 'w') as f:
        f.write('{\n' + ',\n'.join(f'  {json.dumps(k)}: ' + (
            '{\n' + ',\n'.join(f'    {json.dumps(a)}: {json.dumps(b)}' for a, b in v.items()) + '\n  }')
            for k, v in spec.items()) + '\n}\n')


if __name__ == '__main__':
    write_geometry()
    print(json.dumps(geometry(), indent=1))
