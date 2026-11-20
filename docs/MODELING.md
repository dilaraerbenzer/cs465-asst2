# Modeling the goth moth (Part 1)

## Current model: Tripo, segmented

`models/moth_tripo.obj` is the source model (generated with Tripo and
segmented into 13 parts). `tools/rig_from_tripo.py` converts it into the files
the app loads (`models/moth.obj` + `models/moth.rig.json`):

* renames the parts (`tripo_part_4` -> `thorax`, ...; the table is `PARTS`
  at the top of the script),
* turns the moth to face +Z, centres it on the thorax and scales it,
* finds every joint automatically: the pivot of a part is the centre of the
  vertices where it touches its parent.

Hierarchy (26 parts):

```
thorax
├── head ── antenna_L, antenna_R
├── abdomen ── abdomen_tip
├── wing_L, wing_R
└── leg_{front,mid,hind}_{L,R}
    └── leg_<pos>_lower_<side>
        └── leg_<pos>_foot_<side>
```

Each wing still has its fore- and hindwing fused. To split off another part,
do it in Blender (Edit mode, X-ray, box-select, P -> Selection), export again
as `models/moth_tripo.obj`, add the new part to `PARTS` and re-run:

```bash
python3 tools/rig_from_tripo.py
```

The rest of this file is the older from-scratch Blender workflow
(`tools/blender_export_rig.py`). It uses its own part names (`forewing_L`,
`leg_front_upper_L`, ...), so the animation presets would need updating if
you went back to it.

The app loads two files:

| File | What it holds |
|---|---|
| `models/moth.obj` | the geometry, one `o <name>` block per movable part |
| `models/moth.rig.json` | each part's parent, pivot (joint position) and colour |

`tools/make_placeholder_moth.py` writes a primitive placeholder moth in the
same format, which is handy for testing the app without a real model.

## Rules for the .blend file

1. **One mesh object per joint/part.** Something that moves on its own must be
   its own object. Things that never move separately (eyes on the head, fur
   tufts on the thorax) can be joined into their parent part (Ctrl+J).
2. **Name objects exactly like the part names** (keep the same names so the
   animation and UI code keeps working):

   ```
   thorax                       (root)
   ├── head
   │   ├── antenna_L
   │   └── antenna_R
   ├── abdomen
   ├── forewing_L   forewing_R
   ├── hindwing_L   hindwing_R
   └── leg_{front,mid,hind}_upper_{L,R}
       └── leg_{front,mid,hind}_lower_{L,R}
   ```

   No spaces or dots in names (Blender's `.001` suffixes too). You may add
   *more* parts (e.g. `leg_front_tarsus_L`, `abdomen_tip`, a split wing). Just
   parent them correctly. More joints = better model-complexity grade.
3. **Put each object's origin at its joint.** Wing origin at the wing root,
   upper-leg origin at the hip, lower-leg origin at the knee, head origin at
   the neck. Object mode → select object → place 3D cursor at the joint
   (Shift+S → Cursor to Selected, on a vertex in Edit mode) → Object → Set
   Origin → Origin to 3D Cursor.
4. **Parent like the tree above.** Select child, then shift-select parent,
   Ctrl+P → *Object (Keep Transform)*.
5. **Rest pose.** Model with the wings spread flat and the legs in a neutral
   pose. Apply rotation & scale (Ctrl+A → Rotation & Scale) on every object
   but **not location** (that would reset the origins).
6. **Orientation.** In Blender, the head points toward Blender **−Y** (the
   front view, numpad 1, looks at the face), up is +Z, the moth's left side is
   +X. After export this becomes head → +Z, up → +Y, which the app expects.
   Keep the thorax roughly at the world origin and the whole moth about
   2–3 units long.
7. **Keep it light.** WebGL loads the OBJ in the browser. Aim for under
   ~50k triangles total. Don't apply a Subdivision modifier above level 1–2.
   Use *Shade Smooth* (or *Shade Auto Smooth*) so the normals export smooth.
8. **Materials.** Give each part a material. The export script reads the
   Principled BSDF *Base Color* as the part's colour. If you UV-unwrap and paint
   textures, those UVs are exported too (useful for the textured rendering in Part 2).

## Exporting

1. Save the .blend inside the repo (e.g. `blender/moth.blend`). The script
   writes to `models/` next to it, so set `EXPORT_DIR` in the script to
   `"//../models"` in that case.
2. Scripting workspace → open `tools/blender_export_rig.py` → Run Script.
3. Start a local server from the repo root and open the page:

   ```bash
   python3 -m http.server 8000
   ```

   then go to http://localhost:8000. Pick parts in the part list and
   drag the joint sliders. Every part should rotate
   around its own joint and carry its children with it. If a part swings
   around the wrong point, its origin is wrong in Blender (rule 3). If it
   doesn't follow its parent, its parenting is wrong (rule 4).

## For the demo: how the hierarchy works

It is the scheme of `figure.js` (Angel & Shreiner, Chapter 9), in `js/moth.js`:

* Every part is a node `createNode(transform, render, sibling, child)` in
  `figure[]`. The tree is stored left-child / right-sibling, built from the
  parent names in `moth.rig.json`.
* `initNodes(Id)` rebuilds a node's transform from its joint angles
  `theta[Id]` (x, y, z in degrees):
  `translate(pivot - parentPivot + position) * rotateZ * rotateY * rotateX`.
  Move to the joint, then rotate, like `figure.js`.
* `traverse(Id)` is the book's function: push `modelViewMatrix`, multiply by
  the node's transform, render, traverse the child, pop, traverse the sibling.
* The OBJ is in world space. At load time each part's vertices are shifted by
  `-pivot`, so the joint is at the part's local origin. That is why the render
  function needs no extra `instanceMatrix` scaling (figure.js scales a cube).
* `getPose()` / `setPose()` read and write every `theta` / `position`. That is
  the data a keyframe stores, for the animation part.
