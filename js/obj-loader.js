// Wavefront OBJ parser, written from scratch for this assignment.
// Supports: v, vt, vn, f (triangles, quads and n-gons via fan triangulation,
// negative indices, "v", "v/vt", "v//vn", "v/vt/vn"), and o / g blocks.
// Every "o" (or "g") block becomes a separate mesh, because each block is one
// movable part of the hierarchical model.
// Lines we don't need (mtllib, usemtl, s, l, ...) are ignored.
"use strict";

const ObjLoader = {
  /**
   * @param {string} text  contents of an .obj file
   * @returns {Map<string, {positions:number[], normals:number[], uvs:number[]}>}
   *          name -> flat, non-indexed triangle arrays (3 floats per vertex
   *          for positions/normals, 2 for uvs).
   */
  parse(text) {
    const V = [], VT = [], VN = [];
    const meshes = new Map();
    let current = null;
    const needsNormals = new Set();
    let sawObject = false;

    const begin = (name) => {
      if (!meshes.has(name)) meshes.set(name, { positions: [], normals: [], uvs: [] });
      current = meshes.get(name);
    };

    const resolve = (idx, len) => {
      const i = parseInt(idx, 10);
      return i < 0 ? len + i : i - 1;
    };

    const lines = text.split("\n");
    for (let raw of lines) {
      const line = raw.trim();
      if (!line || line[0] === "#") continue;
      const parts = line.split(/\s+/);
      const tag = parts[0];

      if (tag === "v") {
        V.push([+parts[1], +parts[2], +parts[3]]);
      } else if (tag === "vt") {
        VT.push([+parts[1], +(parts[2] || 0)]);
      } else if (tag === "vn") {
        VN.push([+parts[1], +parts[2], +parts[3]]);
      } else if (tag === "o" || tag === "g") {
        // Use "o" blocks as parts. "g" is only used for files that have no
        // "o" lines at all (otherwise a "g" inside an "o" would split a part).
        if (tag === "o") sawObject = true;
        if (tag === "o" || !sawObject) begin(parts.slice(1).join("_") || "default");
      } else if (tag === "f") {
        if (!current) begin("default");
        const corners = parts.slice(1).map((c) => {
          const [vi, ti, ni] = c.split("/");
          return {
            v: resolve(vi, V.length),
            t: ti ? resolve(ti, VT.length) : -1,
            n: ni ? resolve(ni, VN.length) : -1,
          };
        });
        for (let k = 1; k + 1 < corners.length; k++) {
          for (const c of [corners[0], corners[k], corners[k + 1]]) {
            current.positions.push(...V[c.v]);
            current.uvs.push(...(c.t >= 0 ? VT[c.t] : [0, 0]));
            if (c.n >= 0) current.normals.push(...VN[c.n]);
            else { current.normals.push(0, 0, 0); needsNormals.add(current); }
          }
        }
      }
    }

    // Faces without normals get flat face normals.
    for (const mesh of needsNormals) ObjLoader.computeFlatNormals(mesh);
    for (const [name, mesh] of meshes) if (mesh.positions.length === 0) meshes.delete(name);
    return meshes;
  },

  computeFlatNormals(mesh) {
    const p = mesh.positions, n = mesh.normals;
    for (let i = 0; i < p.length; i += 9) {
      if (n[i] || n[i + 1] || n[i + 2]) continue;
      const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
      const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 3; k++) { n[i + 3 * k] = nx; n[i + 3 * k + 1] = ny; n[i + 3 * k + 2] = nz; }
    }
  },
};
