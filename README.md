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
| `js/main.js` | `init()` / `render()`, render modes, textures, picking, mouse, UI panel |
| `js/animation.js` | keyframes, interpolation, walk/fly presets, save/load |
| `models/moth_tripo.obj` | source model (Tripo, segmented into 13 parts) |
| `models/textures/` | one base-colour texture per Tripo part |
| `models/skybox/` | six cube-map faces of the night-sky background |
| `tools/make_skybox.py` | generates the skybox images (replace them to use your own) |
| `models/moth.obj`, `models/moth.rig.json` | the model the app loads, made by `tools/rig_from_tripo.py` |
| `tools/rig_from_tripo.py` | renames/turns the Tripo parts and finds the joints |
| `furkan.html` | Furkan's original standalone prototype with a primitive bug model (its features were ported into `js/`; open it directly, no server needed) |
| `tools/blender_export_rig.py` | Blender script that exports the real model + rig |
| `tools/make_placeholder_moth.py` | generates a primitive placeholder model (for testing) |
| `docs/MODELING.md` | how to build and export the moth in Blender |

Code reused from the book is marked at the top of each file, with what we changed.

## Features

* **Part 1, model:** segmented Tripo moth, 26 parts (head, antennae, abdomen +
  tip, wings, 6 legs x upper/lower/foot), `figure.js`-style tree.
* **Part 2, rendering:** colour / unlit texture / smooth shading / shaded texture,
  plus a cube-map skybox background (gothic night sky).
* **Part 3, animation:** add/update/delete keyframes, linear interpolation of
  every joint, play/loop, frame time, presets (walk, fly, twerk), save/load JSON.
* **Part 4, posture and camera:** click a part to select it, drag it to rotate
  its joint (Alt+drag: z axis), joint sliders, global position/orientation
  sliders; orbit (drag), pan (right-drag or Shift+drag), zoom (wheel).
* **Joint limits:** each joint has a realistic range of motion (table in
  `js/moth.js`), enforced for sliders, dragging, presets and loaded files;
  a checkbox turns them off.
