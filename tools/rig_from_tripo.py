#!/usr/bin/env python3
"""
Turns the segmented Tripo model (models/moth_tripo.obj, exported from
Blender) into the files the app loads:
    models/moth.obj        parts renamed, moth turned to face +Z, scaled, centred
    models/moth.rig.json   parent, pivot (joint), joint axes, colour and texture
                           of every part

Textures: models/textures/tripo_part_<n>_basecolor.jpg (from the Tripo download).

The model is used in the orientation it was exported in from Blender.

What it does, in order:
  1. Cleans up splits made with a box-select: small loose pieces left in a
     parent part are moved to the child part if they are closer to it.
  2. Finds every joint: a part's pivot is the centre of the vertices where it
     touches its parent (the "contact patch").
  3. Knees and feet get their own joint axes: x = the hinge axis (computed
     from the directions of the two leg segments, so "rotate x" bends the
     joint for every leg), y = along the segment, z = x cross y.

After splitting/renaming parts in Blender, update PARTS below and run:
    python3 tools/rig_from_tripo.py
"""
import json
import os

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "models", "moth_tripo.obj")
OUT_OBJ = os.path.join(ROOT, "models", "moth.obj")
OUT_RIG = os.path.join(ROOT, "models", "moth.rig.json")

BLACK = [0.07, 0.06, 0.08]
PLUM = [0.28, 0.12, 0.30]
BONE = [0.80, 0.76, 0.70]
VELVET = [0.16, 0.08, 0.18]

# (Blender object name(s), our name, parent, colour, texture of tripo part).
# Several object names separated by "|" are alternatives (whichever is in the
# file is used). Parents must come first. Optional parts (lower legs, feet,
# abdomen tip) that are missing from the file are skipped.
# In moth_tripo.obj the head points to -X, up is +Y and the moth's left is +Z.
# Legs: the upper part keeps the leg's name (leg_front_R ...); the lower leg
# is leg_<pos>_lower_<side>, the foot leg_<pos>_foot_<side>.
LEGS = [  # position, side, tripo number, extra names used in the Blender file
    ("front", "L", 9,  [], [], []),
    ("front", "R", 7,  ["front_upper_leg"], ["lower_front_leg", "lower_front_leg_R"], ["lower_front_leg_R.001"]),
    ("mid",   "L", 10, [], [], []),
    ("mid",   "R", 11, [], [], []),
    ("hind",  "L", 0,  [], [], []),
    ("hind",  "R", 8,  [], [], []),
]

PARTS = [
    ("tripo_part_4",  "thorax",      None,      VELVET, 4),
    ("tripo_part_5",  "head",        "thorax",  BLACK,  5),
    ("tripo_part_6",  "antenna_L",   "head",    BONE,   6),
    ("tripo_part_12", "antenna_R",   "head",    BONE,   12),
    ("tripo_part_1",  "abdomen",     "thorax",  PLUM,   1),
    ("tripo_part_1.001|tripo_part_1_tip", "abdomen_tip", "abdomen", PLUM, 1),
    ("tripo_part_3",  "wing_L",      "thorax",  BLACK,  3),
    ("tripo_part_2",  "wing_R",      "thorax",  BLACK,  2),
]
for pos, side, n, up, lo, ft in LEGS:
    leg = f"leg_{pos}_{side}"
    PARTS.append(("|".join([f"tripo_part_{n}"] + up), leg, "thorax", BONE, n))
for pos, side, n, up, lo, ft in LEGS:
    PARTS.append(("|".join([f"tripo_part_{n}_lower", f"tripo_part_{n}.001"] + lo),
                  f"leg_{pos}_lower_{side}", f"leg_{pos}_{side}", BONE, n))
for pos, side, n, up, lo, ft in LEGS:
    PARTS.append(("|".join([f"tripo_part_{n}_foot", f"tripo_part_{n}.002"] + ft),
                  f"leg_{pos}_foot_{side}", f"leg_{pos}_lower_{side}", BONE, n))

OPTIONAL = ("_lower_", "_foot_", "abdomen_tip")

SCALE = 2.5  # the Tripo moth is ~1 unit long; the app's camera expects ~2.5


def to_app(p):
    """Tripo axes (head -X, left +Z, up +Y) -> app axes (head +Z, left +X, up +Y):
    a 90 degree turn about Y: x' = z, z' = -x."""
    return np.stack([p[..., 2], p[..., 1], -p[..., 0]], axis=-1)


def read_obj(path):
    V, VT, VN, objects = [], [], [], {}
    cur = None
    with open(path) as f:
        for line in f:
            if line.startswith("v "):
                V.append(line.split()[1:4])
            elif line.startswith("vt "):
                VT.append(line.split()[1:3])
            elif line.startswith("vn "):
                VN.append(line.split()[1:4])
            elif line.startswith("o "):
                cur = line.split()[1]
                objects[cur] = []
            elif line.startswith("f "):
                objects[cur].append(line.split()[1:])
    return (np.array(V, dtype=np.float64), np.array(VT, dtype=np.float64),
            np.array(VN, dtype=np.float64), objects)


def part_vertex_ids(faces):
    ids = set()
    for face in faces:
        for c in face:
            ids.add(int(c.split("/")[0]) - 1)
    return np.array(sorted(ids))


def connected_pieces(faces):
    """Groups face indices into pieces connected through shared vertices."""
    parent = {}
    def find(a):
        while parent.setdefault(a, a) != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    vids = [[int(c.split("/")[0]) for c in face] for face in faces]
    for f in vids:
        for v in f[1:]:
            parent[find(v)] = find(f[0])
    pieces = {}
    for i, f in enumerate(vids):
        pieces.setdefault(find(f[0]), []).append(i)
    return sorted(pieces.values(), key=len, reverse=True)


def min_dist(a, b, rng, k=3000):
    if len(b) > k:
        b = b[rng.choice(len(b), k, replace=False)]
    return np.sqrt(((a[:, None, :] - b[None, :, :]) ** 2).sum(-1)).min()


def fix_split(V, objects, upper, lower, rng):
    """A box-select split can leave small loose pieces of the child (e.g. its
    back side, without X-ray) in the parent object; they would not follow
    the joint. Move every loose piece of the parent that is closer to the
    child than to the parent's main piece."""
    pieces = connected_pieces(objects[upper])
    if len(pieces) <= 1:
        return
    main = V[part_vertex_ids([objects[upper][i] for i in pieces[0]])]
    child = V[part_vertex_ids(objects[lower])]
    move = set()
    for piece in pieces[1:]:
        pts = V[part_vertex_ids([objects[upper][i] for i in piece])]
        c = pts.mean(0, keepdims=True)
        if min_dist(c, child, rng) < min_dist(c, main, rng):
            move.update(piece)
    if move:
        objects[lower] = objects[lower] + [f for i, f in enumerate(objects[upper]) if i in move]
        objects[upper] = [f for i, f in enumerate(objects[upper]) if i not in move]
        print(f"fixed split: moved {len(move)} loose faces from {upper} to {lower}")


def contact_pivot(child, parent, rng):
    """Centre of the child's vertices that lie closest to the parent mesh."""
    par = parent if len(parent) <= 6000 else parent[rng.choice(len(parent), 6000, replace=False)]
    d = np.empty(len(child))
    for s in range(0, len(child), 4000):
        chunk = child[s:s + 4000]
        d[s:s + 4000] = np.sqrt(((chunk[:, None, :] - par[None, :, :]) ** 2).sum(-1)).min(1)
    threshold = d.min() + 0.02 * SCALE      # everything within ~2 cm of the closest point
    return child[d <= threshold].mean(0), d.min()


def hinge_axes(u, l):
    """Joint frame for a hinge between segment directions u (parent) and l
    (child): x = normalize(l x u), so a negative x rotation folds the joint;
    y = along the child segment; z = x cross y. Columns of the 3x3 result."""
    x = np.cross(l, u)
    if np.linalg.norm(x) < 1e-6 * np.linalg.norm(l) * np.linalg.norm(u):
        return None
    x /= np.linalg.norm(x)
    y = l / np.linalg.norm(l)
    y = y - x * (x @ y)
    y /= np.linalg.norm(y)
    z = np.cross(x, y)
    return np.stack([x, y, z], axis=1)


def main():
    V, VT, VN, objects = read_obj(SRC)

    # resolve "a|b" alternatives to the object name that is in the file
    parts = []
    for srcs, name, parent, color, tex in PARTS:
        found = [x for x in srcs.split("|") if x in objects]
        if not found:
            if any(o in name for o in OPTIONAL):
                continue                               # not split (yet)
            raise SystemExit(f"error: none of {srcs} is in {SRC}")
        parts.append((found[0], name, parent, color, tex))
    used = {p[0] for p in parts}
    for src in objects:
        if src not in used:
            print(f"warning: Blender object {src} is not in PARTS, skipped")

    V = to_app(V)
    VN = to_app(VN)
    rng = np.random.default_rng(0)

    src_by_name = {name: src for src, name, *_ in parts}
    for src, name, parent, *_ in parts:
        if any(o in name for o in OPTIONAL):
            fix_split(V, objects, src_by_name[parent], src, rng)

    ids = {src: part_vertex_ids(objects[src]) for src, *_ in parts}
    thorax_src = parts[0][0]
    centre = (V[ids[thorax_src]].min(0) + V[ids[thorax_src]].max(0)) / 2
    V = (V - centre) * SCALE

    pivots = {}
    rig = {"parts": []}
    for src, name, parent, color, tex in parts:
        pts = V[ids[src]]
        if parent is None:
            pivot = (pts.min(0) + pts.max(0)) / 2
        else:
            pivot, gap = contact_pivot(pts, V[ids[src_by_name[parent]]], rng)
            if gap > 0.05 * SCALE:
                print(f"warning: {name} does not touch {parent} (gap {gap:.3f}); check its pivot")
        pivots[name] = pivot
        entry = {"name": name, "parent": parent,
                 "pivot": [round(float(x), 5) for x in pivot], "color": color, "source": src}
        texture = f"textures/tripo_part_{tex}_basecolor.jpg"     # relative to models/
        if os.path.exists(os.path.join(ROOT, "models", texture)):
            entry["texture"] = texture
        else:
            print(f"note: no texture {texture}")
        rig["parts"].append(entry)

    # joint axes for knees and feet (hinge = x)
    entries = {e["name"]: e for e in rig["parts"]}
    for e in rig["parts"]:
        name = e["name"]
        if "_lower_" not in name and "_foot_" not in name:
            continue
        parent = e["parent"]
        u = pivots[name] - pivots[parent]                   # parent segment
        child = [c for c in entries.values() if c["parent"] == name]
        if child:                                           # towards the next joint
            l = pivots[child[0]["name"]] - pivots[name]
        else:                                               # towards the tip
            pts = V[ids[e["source"]]]
            l = pts[np.argmax(np.linalg.norm(pts - pivots[name], axis=1))] - pivots[name]
        A = hinge_axes(u, l)
        if A is not None:
            e["axes"] = [[round(float(v), 5) for v in row] for row in A.T]   # list of x, y, z
        bend = np.degrees(np.arccos(np.clip(u @ l / np.linalg.norm(u) / np.linalg.norm(l), -1, 1)))
        print(f"{name:20s} hinge x = {np.round(A[:, 0], 2) if A is not None else None}, rest bend {bend:.0f} deg")

    for e in rig["parts"]:
        print(f"{e['name']:20s} <- {e['source']:22s} parent {str(e['parent']):18s} pivot {np.round(e['pivot'], 3)}")

    with open(OUT_RIG, "w") as f:
        json.dump(rig, f, indent=2)

    name_of = {src: name for src, name, *_ in parts}
    with open(OUT_OBJ, "w") as f:
        f.write("# Generated from models/moth_tripo.obj by tools/rig_from_tripo.py\n")
        f.write("mtllib moth_tripo.mtl\n")
        for v in V:
            f.write("v %.5f %.5f %.5f\n" % tuple(v))
        for t in VT:
            f.write("vt %.5f %.5f\n" % tuple(t))
        for n in VN:
            f.write("vn %.4f %.4f %.4f\n" % tuple(n))
        for src in objects:
            if src not in name_of:
                continue
            f.write(f"o {name_of[src]}\n")
            for face in objects[src]:
                f.write("f " + " ".join(face) + "\n")
    print("wrote", OUT_OBJ, "and", OUT_RIG, f"({len(parts)} parts)")


if __name__ == "__main__":
    main()
