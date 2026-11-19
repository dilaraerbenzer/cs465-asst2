# cs465-asst2: Goth Moth

CS465/575 Assignment 2, a hierarchical moth model in plain WebGL (no three.js).

## Run

Browsers block `fetch` from `file://`, so serve the folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Layout

| Path | What |
|---|---|
| `index.html` | page and UI |
| `js/math.js` | 4×4 matrix functions and the matrix stack (from scratch) |
| `js/obj-loader.js` | Wavefront OBJ parser (from scratch) |
| `js/model.js` | hierarchical model: rig tree, matrix-stack traversal, get/set pose |
| `js/main.js` | WebGL setup, shading, camera, rig-check panel |
| `models/moth.obj`, `models/moth.rig.json` | the model (currently a placeholder) |
| `tools/blender_export_rig.py` | Blender script that exports the real model + rig |
| `tools/make_placeholder_moth.py` | generates the placeholder model |
| `docs/MODELING.md` | how to build and export the moth in Blender |

## Work split

* Part 1 (model): Blender moth → `models/`, see `docs/MODELING.md`.
* Parts 2–4 (rendering, keyframe animation + save/load, picking/sliders/camera):
  build on `js/main.js`. Use `moth.getPose()` / `moth.setPose(pose)` for
  keyframes and `part.index` for colour picking.
