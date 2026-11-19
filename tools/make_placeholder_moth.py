#!/usr/bin/env python3
"""
Generates a PLACEHOLDER moth (models/moth.obj + models/moth.rig.json) out of
simple primitives, so the WebGL app can be developed and tested before the
real Blender model is ready.

The real model exported from Blender (see tools/blender_export_rig.py) must
use the SAME part names and the SAME parent/child structure, so it can replace
these two files without any code changes.

Coordinate system (same as Blender's OBJ export with "Y up, -Z forward"):
  +Y is up, the moth's head points toward +Z, its left side is +X.

Run:  python3 tools/make_placeholder_moth.py
"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_OBJ = os.path.join(ROOT, "models", "moth.obj")
OUT_RIG = os.path.join(ROOT, "models", "moth.rig.json")


def sub(a, b): return [a[i] - b[i] for i in range(3)]
def add(a, b): return [a[i] + b[i] for i in range(3)]
def mul(a, s): return [a[i] * s for i in range(3)]
def dot(a, b): return sum(a[i] * b[i] for i in range(3))
def cross(a, b): return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
def norm(a):
    l = math.sqrt(dot(a, a)) or 1.0
    return [x / l for x in a]


class Mesh:
    """Accumulates positions/uvs/normals/faces for one OBJ object."""
    def __init__(self):
        self.v, self.vt, self.vn, self.f = [], [], [], []

    def vert(self, p, uv, n):
        self.v.append(p); self.vt.append(uv); self.vn.append(norm(n))
        return len(self.v) - 1

    def tri(self, a, b, c):
        self.f.append((a, b, c))


def ellipsoid(m, c, r, seg=24, rings=16):
    base = len(m.v)
    for i in range(rings + 1):
        th = math.pi * i / rings
        for j in range(seg + 1):
            ph = 2 * math.pi * j / seg
            d = [math.sin(th) * math.cos(ph), math.cos(th), math.sin(th) * math.sin(ph)]
            p = [c[k] + r[k] * d[k] for k in range(3)]
            n = [d[k] / r[k] for k in range(3)]
            m.vert(p, [j / seg, 1 - i / rings], n)
    for i in range(rings):
        for j in range(seg):
            a = base + i * (seg + 1) + j
            b = a + seg + 1
            m.tri(a, a + 1, b); m.tri(a + 1, b + 1, b)


def cylinder(m, a, b, r1, r2, seg=12):
    """Tapered cylinder from point a (radius r1) to point b (radius r2), with caps."""
    axis = norm(sub(b, a))
    helper = [0, 1, 0] if abs(axis[1]) < 0.9 else [1, 0, 0]
    u = norm(cross(axis, helper)); w = cross(axis, u)
    base = len(m.v)
    for j in range(seg + 1):
        t = 2 * math.pi * j / seg
        d = add(mul(u, math.cos(t)), mul(w, math.sin(t)))
        m.vert(add(a, mul(d, r1)), [j / seg, 0], d)
        m.vert(add(b, mul(d, r2)), [j / seg, 1], d)
    for j in range(seg):
        i0 = base + 2 * j
        m.tri(i0, i0 + 2, i0 + 1); m.tri(i0 + 1, i0 + 2, i0 + 3)
    for center, r, n in ((a, r1, mul(axis, -1)), (b, r2, axis)):
        cidx = m.vert(center, [0.5, 0.5], n)
        ring = []
        for j in range(seg + 1):
            t = 2 * math.pi * j / seg
            d = add(mul(u, math.cos(t)), mul(w, math.sin(t)))
            ring.append(m.vert(add(center, mul(d, r)), [0.5 + 0.5*math.cos(t), 0.5 + 0.5*math.sin(t)], n))
        for j in range(seg):
            m.tri(cidx, ring[j], ring[j + 1])


def wing(m, pivot, outline, thickness=0.006):
    """Flat wing in the XZ plane: outline is a list of (x, z) offsets from the pivot,
    fan-triangulated from the pivot. Two faces (top and bottom)."""
    xs = [p[0] for p in outline]; zs = [p[1] for p in outline]
    minx, maxx, minz, maxz = min(xs + [0]), max(xs + [0]), min(zs + [0]), max(zs + [0])
    def uv(x, z): return [(x - minx) / (maxx - minx or 1), (z - minz) / (maxz - minz or 1)]
    for sign in (1, -1):
        n = [0, sign, 0]
        y = pivot[1] + sign * thickness
        c = m.vert([pivot[0], y, pivot[2]], uv(0, 0), n)
        ring = [m.vert([pivot[0] + x, y, pivot[2] + z], uv(x, z), n) for x, z in outline]
        for j in range(len(ring) - 1):
            if sign > 0: m.tri(c, ring[j], ring[j + 1])
            else:        m.tri(c, ring[j + 1], ring[j])


# ---------------------------------------------------------------------------
# Build the moth. Each entry: name -> (parent, pivot, color, mesh)
# ---------------------------------------------------------------------------
BLACK  = [0.08, 0.07, 0.09]
PLUM   = [0.25, 0.10, 0.28]
BONE   = [0.85, 0.82, 0.76]
VELVET = [0.14, 0.06, 0.16]

parts = []  # list of dicts (order: parents before children)

def part(name, parent, pivot, color):
    m = Mesh()
    parts.append({"name": name, "parent": parent, "pivot": pivot, "color": color, "mesh": m})
    return m

thorax = part("thorax", None, [0, 0, 0], VELVET)
ellipsoid(thorax, [0, 0, 0], [0.22, 0.2, 0.3])

head = part("head", "thorax", [0, 0.02, 0.28], BLACK)
ellipsoid(head, [0, 0.02, 0.42], [0.16, 0.15, 0.15])
ellipsoid(head, [0.12, 0.05, 0.48], [0.07, 0.08, 0.07])   # eyes
ellipsoid(head, [-0.12, 0.05, 0.48], [0.07, 0.08, 0.07])

for side, s in (("L", 1), ("R", -1)):
    ant = part(f"antenna_{side}", "head", [s * 0.06, 0.14, 0.5], BONE)
    tip = [s * 0.32, 0.5, 0.95]
    cylinder(ant, [s * 0.06, 0.14, 0.5], tip, 0.02, 0.008)
    for k in range(1, 7):  # little "feather" barbs, moth-style
        t = k / 7
        p = add([s * 0.06, 0.14, 0.5], mul(sub(tip, [s * 0.06, 0.14, 0.5]), t))
        cylinder(ant, p, add(p, [s * 0.07 * (1 - t * 0.5), 0.0, -0.05]), 0.006, 0.003, seg=6)

abdomen = part("abdomen", "thorax", [0, 0, -0.25], PLUM)
ellipsoid(abdomen, [0, -0.03, -0.75], [0.2, 0.18, 0.5])

for side, s in (("L", 1), ("R", -1)):
    fw = part(f"forewing_{side}", "thorax", [s * 0.16, 0.14, 0.08], BLACK)
    wing(fw, [s * 0.16, 0.14, 0.08],
         [(s * x, z) for x, z in [(0.0, 0.12), (0.5, 0.25), (1.1, 0.25), (1.35, 0.1),
                                  (1.3, -0.15), (0.9, -0.4), (0.4, -0.38), (0.0, -0.12)]])
    hw = part(f"hindwing_{side}", "thorax", [s * 0.16, 0.12, -0.12], PLUM)
    wing(hw, [s * 0.16, 0.12, -0.12],
         [(s * x, z) for x, z in [(0.0, 0.02), (0.45, -0.05), (0.85, -0.2), (0.95, -0.45),
                                  (0.7, -0.7), (0.35, -0.72), (0.08, -0.45), (0.0, -0.15)]])

for side, s in (("L", 1), ("R", -1)):
    for leg, z, dz in (("front", 0.15, 0.25), ("mid", 0.0, 0.0), ("hind", -0.15, -0.25)):
        hip = [s * 0.14, -0.12, z]
        knee = [s * 0.45, 0.0, z + dz]
        foot = [s * 0.65, -0.45, z + dz * 1.4]
        up = part(f"leg_{leg}_upper_{side}", "thorax", hip, BLACK)
        cylinder(up, hip, knee, 0.035, 0.03)
        lo = part(f"leg_{leg}_lower_{side}", f"leg_{leg}_upper_{side}", knee, BONE)
        cylinder(lo, knee, foot, 0.028, 0.012)


# ---------------------------------------------------------------------------
# Write OBJ (world-space vertices, one "o" block per part) and rig JSON.
# ---------------------------------------------------------------------------
os.makedirs(os.path.dirname(OUT_OBJ), exist_ok=True)
with open(OUT_OBJ, "w") as f:
    f.write("# Placeholder moth generated by tools/make_placeholder_moth.py\n")
    off = 0
    for p in parts:
        m = p["mesh"]
        f.write(f"o {p['name']}\n")
        for v in m.v:  f.write("v %.5f %.5f %.5f\n" % tuple(v))
        for t in m.vt: f.write("vt %.5f %.5f\n" % tuple(t))
        for n in m.vn: f.write("vn %.5f %.5f %.5f\n" % tuple(n))
        for a, b, c in m.f:
            a, b, c = a + off + 1, b + off + 1, c + off + 1
            f.write(f"f {a}/{a}/{a} {b}/{b}/{b} {c}/{c}/{c}\n")
        off += len(m.v)

rig = {"parts": [{k: p[k] for k in ("name", "parent", "pivot", "color")} for p in parts]}
with open(OUT_RIG, "w") as f:
    json.dump(rig, f, indent=2)

print(f"wrote {OUT_OBJ} ({sum(len(p['mesh'].f) for p in parts)} triangles, {len(parts)} parts)")
print(f"wrote {OUT_RIG}")
