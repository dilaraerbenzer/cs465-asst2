# Goth Moth

CS465 Programming Assignment 2: a hierarchical moth model in plain WebGL

## Running it

Browsers block `fetch` from `file://`, so serve the folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Files

| Path | What |
|---|---|
| `index.html` | page, shaders (Phong, from the book's `shadedSphere4`), UI |
| `Common/` | Angel & Shreiner's `MV.js`, `initShaders.js`, `webgl-utils.js` (unmodified) |
| `js/objLoader.js` | Wavefront OBJ parser (our code, outputs book-style `pointsArray`/`normalsArray`) |
| `js/moth.js` | hierarchy: `figure[]`, `createNode`, `initNodes`, `traverse` (from `figure.js`), joint limits, get/set pose |
| `js/main.js` | `init()` / `render()`, render modes, textures, skybox, ground, picking, mouse, UI panel |
| `js/animation.js` | keyframes, interpolation, walk/fly/twerk presets, save/load |
| `models/moth.obj` | the moth's geometry, one `o <name>` block per part |
| `models/moth.rig.json` | each part's parent, pivot (joint position), joint axes, colour and texture |
| `models/textures/` | base-colour texture for each part |
| `models/skybox/` | six cube-map faces of the night-sky background |
| `models/ground.jpg` | tileable forest-floor texture for the ground |

Code reused from the book is marked at the top of each file, with what we changed.

## Features

* **Part 1, model:** a moth model segmented in Blender
  into 26 parts (head, antennae, abdomen + tip, wings, 6 legs x
  upper/lower/foot), arranged in a `figure.js`-style tree.
* **Part 2, rendering:** colour / unlit texture / smooth shading / shaded
  texture, plus a cube-map skybox background (gothic night sky) and a textured
  forest-floor ground with a soft shadow under the moth, fading into the sky
  with distance.
* **Part 3, animation:** add/update/delete keyframes, linear interpolation of
  every joint, play/loop, frame time, presets (walk, fly, twerk), save/load JSON.
* **Part 4, posture and camera:** click a part to select it, drag it to rotate
  its joint (Alt+drag: z axis), joint sliders, global position/orientation
  sliders; orbit (drag), pan (right-drag or Shift+drag), zoom (wheel);
  W/A/S/D walk the moth around the ground relative to the camera (it turns
  to face where it is going and the camera follows); hold Space to fly up,
  let go to glide back down.
* **Joint limits:** each joint has a realistic range of motion (table in
  `js/moth.js`), enforced for sliders, dragging, presets and loaded files;
  a checkbox turns them off.

## How the hierarchy works

```
thorax
├── head ── antenna_L, antenna_R
├── abdomen ── abdomen_tip
├── wing_L, wing_R
└── leg_{front,mid,hind}_{L,R}
    └── leg_<pos>_lower_<side>
        └── leg_<pos>_foot_<side>
```

It follows `figure.js` (Angel & Shreiner, Chapter 9), in `js/moth.js`:

* Every part is a node `createNode(transform, render, sibling, child)` in
  `figure[]`. The tree is stored left-child / right-sibling, built from the
  parent names in `moth.rig.json`.
* `initNodes(Id)` rebuilds a node's transform from its joint angles
  `theta[Id]` (x, y, z in degrees):
  `translate(pivot - parentPivot + position) * rotateZ * rotateY * rotateX`.
  Move to the joint, then rotate, as in `figure.js`. Knees and feet rotate in
  their own joint frame so that "rotate X" always bends them.
* `traverse(Id)` is the book's function: push `modelViewMatrix`, multiply by
  the node's transform, render, traverse the child, pop, traverse the sibling.
* The OBJ is in model space. At load time each part's vertices are shifted by
  `-pivot`, so the joint is at the part's local origin. That is why the render
  function needs no extra `instanceMatrix` (figure.js scales a unit cube).
* `getPose()` / `setPose()` read and write every `theta` / `position`. That is
  the data a keyframe stores.
