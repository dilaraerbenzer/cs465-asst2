#!/usr/bin/env python3
"""
Turns the segmented Tripo model (models/moth_tripo.obj) into the files the
app loads:
    models/moth.obj        parts renamed, moth turned to face +Z, scaled, centred
    models/moth.rig.json   parent, pivot (joint), colour and texture of every part

Textures: models/textures/<tripo part>_basecolor.jpg (from the Tripo download).

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

# (Blender object name(s), our name, parent, colour, texture of tripo part).
# Several object names separated by "|" are alternatives (whichever is in the
# file is used). Parents must come first. Parts missing from the file are
# skipped, so legs can be split one at a time.
# Identified from the part positions: in moth_tripo.obj the head points to -X,
# up is +Y and the moth's left side is +Z.
# Split legs: the upper part keeps the leg's name (leg_front_R ...), the
# lower part is leg_<pos>_lower_<side> with the upper part as its parent.
PARTS = [
    ("tripo_part_4",  "thorax",      None,     VELVET, 4),
    ("tripo_part_5",  "head",        "thorax", BLACK,  5),
    ("tripo_part_6",  "antenna_L",   "head",   BONE,   6),
    ("tripo_part_12", "antenna_R",   "head",   BONE,   12),
    ("tripo_part_1",  "abdomen",     "thorax", PLUM,   1),
    ("tripo_part_3",  "wing_L",      "thorax", BLACK,  3),
    ("tripo_part_2",  "wing_R",      "thorax", BLACK,  2),
    ("tripo_part_9",  "leg_front_L", "thorax", BONE,   9),
    ("tripo_part_7|front_upper_leg", "leg_front_R", "thorax", BONE, 7),
    ("tripo_part_10", "leg_mid_L",   "thorax", BONE,   10),
    ("tripo_part_11", "leg_mid_R",   "thorax", BONE,   11),
    ("tripo_part_0",  "leg_hind_L",  "thorax", BONE,   0),
    ("tripo_part_8",  "leg_hind_R",  "thorax", BONE,   8),
    ("tripo_part_9_lower",  "leg_front_lower_L", "leg_front_L", BONE, 9),
    ("tripo_part_7_lower|lower_front_leg", "leg_front_lower_R", "leg_front_R", BONE, 7),
    ("tripo_part_10_lower", "leg_mid_lower_L",   "leg_mid_L",   BONE, 10),
    ("tripo_part_11_lower", "leg_mid_lower_R",   "leg_mid_R",   BONE, 11),
    ("tripo_part_0_lower",  "leg_hind_lower_L",  "leg_hind_L",  BONE, 0),
    ("tripo_part_8_lower",  "leg_hind_lower_R",  "leg_hind_R",  BONE, 8),
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


def fix_split(objects, upper, lower):
    """When a leg is split in Blender with a box-select, bits of the lower leg
    that were missed (e.g. its back side without X-ray) stay in the upper
    object as small loose pieces, and then do not follow the knee. Keep only
    the upper leg's main connected piece and move the loose pieces to the
    lower leg."""
    pieces = connected_pieces(objects[upper])
    if len(pieces) <= 1:
        return
    keep = set(pieces[0])
    stray = [f for i, f in enumerate(objects[upper]) if i not in keep]
    objects[upper] = [f for i, f in enumerate(objects[upper]) if i in keep]
    objects[lower] = objects[lower] + stray
    print(f"fixed split: moved {len(stray)} faces in {len(pieces) - 1} loose pieces "
          f"from {upper} to {lower}")


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

    # resolve "a|b" alternatives to the object name that is in the file
    parts = []
    for srcs, name, parent, color, tex in PARTS:
        found = [x for x in srcs.split("|") if x in objects]
        if not found:
            if "_lower" not in name:
                raise SystemExit(f"error: none of {srcs} is in {SRC}")
            continue                                   # leg not split (yet)
        parts.append((found[0], name, parent, color, tex))

    src_by_name = {name: src for src, name, *_ in parts}
    for src, name, parent, *_ in parts:
        if "_lower" in name:
            fix_split(objects, src_by_name[parent], src)

    ids = {src: part_vertex_ids(objects[src]) for src, *_ in parts}
    thorax_src = parts[0][0]
    centre = (V[ids[thorax_src]].min(0) + V[ids[thorax_src]].max(0)) / 2
    V = (V - centre) * SCALE

    rng = np.random.default_rng(0)
    name_of = {src: name for src, name, *_ in parts}
    src_of = {name: src for src, name, *_ in parts}
    rig = {"parts": []}
    for src, name, parent, color, tex in parts:
        pts = V[ids[src]]
        if parent is None:
            pivot = (pts.min(0) + pts.max(0)) / 2
        else:
            pivot, gap = contact_pivot(pts, V[ids[src_of[parent]]], rng)
            if gap > 0.05 * SCALE:
                print(f"warning: {name} does not touch {parent} (gap {gap:.3f}); check its pivot")
        entry = {"name": name, "parent": parent,
                 "pivot": [round(float(x), 5) for x in pivot], "color": color, "source": src}
        texture = f"textures/tripo_part_{tex}_basecolor.jpg"     # relative to models/
        if os.path.exists(os.path.join(ROOT, "models", texture)):
            entry["texture"] = texture
        else:
            print(f"note: no texture {texture}")
        rig["parts"].append(entry)
        print(f"{name:18s} <- {src:16s} pivot {np.round(pivot, 3)}")

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
