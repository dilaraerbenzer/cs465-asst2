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
| `index.html` | page, shaders (Phong, from the book's `shadedSphere4`), UI |
| `Common/` | Angel & Shreiner's `MV.js`, `initShaders.js`, `webgl-utils.js` (unmodified) |
| `js/objLoader.js` | Wavefront OBJ parser (our code, outputs book-style `pointsArray`/`normalsArray`) |
| `js/moth.js` | hierarchy: `figure[]`, `createNode`, `initNodes`, `traverse` (from `figure.js`), get/set pose |
| `js/main.js` | `init()` / `render()`, lighting, mouse camera, rig-check panel |
| `models/moth_tripo.obj` | source model (Tripo, segmented into 13 parts) |
| `models/moth.obj`, `models/moth.rig.json` | the model the app loads, made by `tools/rig_from_tripo.py` |
| `tools/rig_from_tripo.py` | renames/turns the Tripo parts and finds the joints |
| `furkan.html` | Furkan's standalone parts 2–4 prototype, to be merged into this structure |
| `tools/blender_export_rig.py` | Blender script that exports the real model + rig |
| `tools/make_placeholder_moth.py` | generates a primitive placeholder model (for testing) |
| `docs/MODELING.md` | how to build and export the moth in Blender |

Code reused from the book is marked at the top of each file, with what we changed.

## Work split

* Part 1 (model): Blender moth → `models/`, see `docs/MODELING.md`.
* Parts 2–4 (rendering, keyframe animation + save/load, picking/sliders/camera):
  build on `js/main.js`. Use `getPose()` / `setPose(pose)` for keyframes;
  a part's `Id` can be used for colour picking.
