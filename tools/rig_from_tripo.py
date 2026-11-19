#!/usr/bin/env python3
"""
Turns the segmented Tripo model (models/moth_tripo.obj) into the files the
app loads:
    models/moth.obj        parts renamed, moth turned to face +Z, scaled, centred
    models/moth.rig.json   parent, pivot (joint) and colour of every part

The joints are found automatically: a part's pivot is the centre of the
vertices that touch its parent part (the "contact patch").

If you re-segment the model (e.g. split the legs into upper/lower parts in
Blender), update PARTS below and run it again:
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

# tripo object -> (our name, parent, colour). Parents must come first.
# Identified from the part positions: in moth_tripo.obj the head points to -X,
# up is +Y and the moth's left side is +Z.
PARTS = [
    ("tripo_part_4",  "thorax",        None,     VELVET),
    ("tripo_part_5",  "head",          "thorax", BLACK),
    ("tripo_part_6",  "antenna_L",     "head",   BONE),
    ("tripo_part_12", "antenna_R",     "head",   BONE),
    ("tripo_part_1",  "abdomen",       "thorax", PLUM),
    ("tripo_part_3",  "wing_L",        "thorax", BLACK),
    ("tripo_part_2",  "wing_R",        "thorax", BLACK),
    ("tripo_part_9",  "leg_front_L",   "thorax", BONE),
    ("tripo_part_7",  "leg_front_R",   "thorax", BONE),
    ("tripo_part_10", "leg_mid_L",     "thorax", BONE),
    ("tripo_part_11", "leg_mid_R",     "thorax", BONE),
    ("tripo_part_0",  "leg_hind_L",    "thorax", BONE),
    ("tripo_part_8",  "leg_hind_R",    "thorax", BONE),
]

SCALE = 2.5  # the Tripo moth is ~1 unit long; the app's camera expects ~2.5


def to_app(p):
    """Tripo axes (head -X, left +Z, up +Y) -> app axes (head +Z, left +X, up +Y):
    a 90 degree turn about Y: x' = z, z' = -x."""
    return np.stack([p[..., 2], p[..., 1], -p[..., 0]], axis=-1)


def read_obj(path):
    V, VT, VN, objects, order = [], [], [], {}, []
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
                order.append(cur)
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


def contact_pivot(child, parent, rng):
    """Centre of the child's vertices that lie closest to the parent mesh."""
    par = parent if len(parent) <= 6000 else parent[rng.choice(len(parent), 6000, replace=False)]
    d = np.empty(len(child))
    for s in range(0, len(child), 4000):
        chunk = child[s:s + 4000]
        d[s:s + 4000] = np.sqrt(((chunk[:, None, :] - par[None, :, :]) ** 2).sum(-1)).min(1)
    threshold = d.min() + 0.02 * SCALE      # everything within ~2 cm of the closest point
    return child[d <= threshold].mean(0), d.min()


def main():
    V, VT, VN, objects = read_obj(SRC)
    V = to_app(V)
    VN = to_app(VN)

    ids = {src: part_vertex_ids(objects[src]) for src, *_ in PARTS}
    thorax_src = PARTS[0][0]
    centre = (V[ids[thorax_src]].min(0) + V[ids[thorax_src]].max(0)) / 2
    V = (V - centre) * SCALE

    rng = np.random.default_rng(0)
    name_of = {src: name for src, name, *_ in PARTS}
    src_of = {name: src for src, name, *_ in PARTS}
    rig = {"parts": []}
    for src, name, parent, color in PARTS:
        pts = V[ids[src]]
        if parent is None:
            pivot = (pts.min(0) + pts.max(0)) / 2
        else:
            pivot, gap = contact_pivot(pts, V[ids[src_of[parent]]], rng)
            if gap > 0.05 * SCALE:
                print(f"warning: {name} does not touch {parent} (gap {gap:.3f}); check its pivot")
        rig["parts"].append({"name": name, "parent": parent,
                             "pivot": [round(float(x), 5) for x in pivot], "color": color,
                             "source": src})
        print(f"{name:12s} <- {src:14s} pivot {np.round(pivot, 3)}")

    with open(OUT_RIG, "w") as f:
        json.dump(rig, f, indent=2)

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
                print(f"warning: {src} is not in PARTS, skipped")
                continue
            f.write(f"o {name_of[src]}\n")
            for face in objects[src]:
                f.write("f " + " ".join(face) + "\n")
    print("wrote", OUT_OBJ, "and", OUT_RIG)


if __name__ == "__main__":
    main()
