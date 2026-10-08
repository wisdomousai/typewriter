"""Small shapes the typewriter is put together from."""

import math

import kit

PI = math.pi

# Rotations that turn a part's +Z to face out of each side of the machine.
FACING = {'front': (PI / 2, 0, 0), 'back': (-PI / 2, 0, 0), 'left': (0, PI / 2, 0), 'right': (0, -PI / 2, 0),
          'top': (0, 0, 0)}


def ball(name, r, at, seg=(24, 14)):
    return kit.superellipsoid(name, (r, r, r), seg=seg, location=at)


def flat(obj):
    """Flat shading, for parts with hard edges."""
    obj.data.polygons.foreach_set('use_smooth', [False] * len(obj.data.polygons))
    obj.data.update()
    return obj


def bolt(add, m, at, r=0.008, face='front', bone='root'):
    """A hex bolt head, facing out."""
    add(kit.lathe('Bolt', [(0, r * 0.4), (r * 0.9, r * 0.4), (r, 0), (0, -r * 0.1)], seg=6, location=at,
                  rotation=FACING[face]), m['joint'], bone)


def puck(name, r, d, at, e=0.5, seg=(28, 14)):
    """A round disc facing front (-Y): radius r, half-thickness d."""
    return kit.superellipsoid(name, (r, r, d), e, 1.0, seg=seg, location=at, rotation=(PI / 2, 0, 0))


def box(name, half, at, e=0.28, seg=(24, 12), rotation=(0, 0, 0)):
    """A rounded box: half sizes, centre, and how square its corners are (e)."""
    return kit.superellipsoid(name, half, e, e, seg=seg, location=at, rotation=rotation)
