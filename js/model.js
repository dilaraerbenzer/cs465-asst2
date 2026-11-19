// Hierarchical moth model: builds a tree of parts from
//   models/moth.obj       (geometry, one "o <name>" block per part, world space)
//   models/moth.rig.json  (for each part: parent, pivot = joint position, colour)
// and draws it by tree traversal with a matrix stack (as in figure.js, ch. 09).
//
// Each part's vertices are stored RELATIVE TO ITS OWN PIVOT, so rotating the
// part's local matrix rotates it around its joint.
//
// Local transform of a part:
//   L = T(pivot - parentPivot) * T(translation) * Rz * Ry * Rx
// World transform:  W(part) = W(parent) * L(part)
"use strict";

class MothPart {
  constructor(index, def) {
    this.index = index;          // unique id, handy for colour picking
    this.name = def.name;
    this.parentName = def.parent;
    this.pivot = def.pivot;
    this.color = def.color || [0.5, 0.5, 0.5];
    this.parent = null;
    this.children = [];
    this.offset = [0, 0, 0];     // pivot relative to parent's pivot (rest pose)
    // Joint parameters — the values that sliders / keyframes change.
    this.rotation = [0, 0, 0];   // degrees about local X, Y, Z
    this.translation = [0, 0, 0];
    this.vertexCount = 0;
    this.buffers = null;
  }

  localMatrix() {
    let m = Mat4.translation(
      this.offset[0] + this.translation[0],
      this.offset[1] + this.translation[1],
      this.offset[2] + this.translation[2]);
    m = Mat4.multiply(m, Mat4.rotationZ(this.rotation[2]));
    m = Mat4.multiply(m, Mat4.rotationY(this.rotation[1]));
    m = Mat4.multiply(m, Mat4.rotationX(this.rotation[0]));
    return m;
  }
}

class MothModel {
  constructor(gl) {
    this.gl = gl;
    this.parts = [];           // in rig order (parents before children)
    this.byName = new Map();
    this.root = null;
    this.stack = new MatrixStack();
  }

  static async load(gl, objUrl, rigUrl) {
    const [objText, rig] = await Promise.all([
      fetch(objUrl).then((r) => { if (!r.ok) throw new Error(objUrl + ": " + r.status); return r.text(); }),
      fetch(rigUrl).then((r) => { if (!r.ok) throw new Error(rigUrl + ": " + r.status); return r.json(); }),
    ]);
    const model = new MothModel(gl);
    model.build(ObjLoader.parse(objText), rig);
    return model;
  }

  build(meshes, rig) {
    rig.parts.forEach((def, i) => {
      const p = new MothPart(i, def);
      this.parts.push(p);
      this.byName.set(p.name, p);
    });

    for (const p of this.parts) {
      if (p.parentName) {
        p.parent = this.byName.get(p.parentName);
        if (!p.parent) throw new Error(`Part "${p.name}" has unknown parent "${p.parentName}"`);
        p.parent.children.push(p);
        p.offset = p.pivot.map((v, k) => v - p.parent.pivot[k]);
      } else {
        if (this.root) throw new Error(`Two root parts: "${this.root.name}" and "${p.name}"`);
        this.root = p;
        p.offset = p.pivot.slice();
      }
    }
    if (!this.root) throw new Error("Rig has no root part");

    // Match OBJ objects to rig parts. Older Blender exporters name objects
    // "<object>_<mesh>", so also accept a "<partName>_" prefix.
    const used = new Set();
    for (const p of this.parts) {
      let mesh = meshes.get(p.name), key = p.name;
      if (!mesh) {
        for (const [name, m] of meshes) {
          if (name.startsWith(p.name + "_") && !used.has(name) && !this.byName.has(name)) { mesh = m; key = name; break; }
        }
      }
      if (!mesh) { console.warn(`No geometry for part "${p.name}"`); continue; }
      used.add(key);
      this.upload(p, mesh);
    }
    for (const name of meshes.keys()) {
      if (!used.has(name)) console.warn(`OBJ object "${name}" is not in the rig, ignored`);
    }
  }

  upload(part, mesh) {
    const gl = this.gl;
    const pos = new Float32Array(mesh.positions);
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] -= part.pivot[0]; pos[i + 1] -= part.pivot[1]; pos[i + 2] -= part.pivot[2];
    }
    const mk = (data) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return b;
    };
    part.buffers = {
      position: mk(pos),
      normal: mk(new Float32Array(mesh.normals)),
      uv: mk(new Float32Array(mesh.uvs)),
    };
    part.vertexCount = pos.length / 3;
  }

  /** Recursive traversal with an explicit matrix stack. drawPart(part, worldMatrix) does the GL call. */
  traverse(part, modelMatrix, drawPart) {
    this.stack.push(modelMatrix);
    modelMatrix = Mat4.multiply(modelMatrix, part.localMatrix());
    if (part.vertexCount) drawPart(part, modelMatrix);
    for (const child of part.children) this.traverse(child, modelMatrix, drawPart);
    modelMatrix = this.stack.pop();
  }

  draw(baseMatrix, drawPart) {
    this.traverse(this.root, baseMatrix, drawPart);
  }

  // ---- Pose = all joint parameters. Use this for keyframes and save/load. ----
  getPose() {
    const pose = {};
    for (const p of this.parts) pose[p.name] = { rotation: p.rotation.slice(), translation: p.translation.slice() };
    return pose;
  }

  setPose(pose) {
    for (const [name, v] of Object.entries(pose)) {
      const p = this.byName.get(name);
      if (!p) continue;
      if (v.rotation) p.rotation = v.rotation.slice();
      if (v.translation) p.translation = v.translation.slice();
    }
  }

  resetPose() {
    for (const p of this.parts) { p.rotation = [0, 0, 0]; p.translation = [0, 0, 0]; }
  }
}
