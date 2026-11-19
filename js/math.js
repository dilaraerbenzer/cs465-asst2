// Minimal 4x4 matrix library, written from scratch for this assignment.
// Matrices are Float32Array(16) in COLUMN-MAJOR order (what WebGL expects):
//   element (row r, col c) is m[c * 4 + r].
"use strict";

const Mat4 = {
  identity() {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },

  // returns a * b
  multiply(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        out[c * 4 + r] = s;
      }
    }
    return out;
  },

  translation(x, y, z) {
    const m = Mat4.identity();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
  },

  scaling(x, y, z) {
    const m = Mat4.identity();
    m[0] = x; m[5] = y; m[10] = z;
    return m;
  },

  rotationX(deg) {
    const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    const m = Mat4.identity();
    m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
    return m;
  },

  rotationY(deg) {
    const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    const m = Mat4.identity();
    m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
    return m;
  },

  rotationZ(deg) {
    const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    const m = Mat4.identity();
    m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
    return m;
  },

  perspective(fovyDeg, aspect, near, far) {
    const f = 1 / Math.tan((fovyDeg * Math.PI) / 360);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) / (near - far);
    m[11] = -1;
    m[14] = (2 * far * near) / (near - far);
    return m;
  },

  lookAt(eye, at, up) {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const z = nrm(sub(eye, at));
    const x = nrm(crs(up, z));
    const y = crs(z, x);
    const m = Mat4.identity();
    m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
    m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
    m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
    m[12] = -dot(x, eye); m[13] = -dot(y, eye); m[14] = -dot(z, eye);
    return m;
  },

  // Inverse-transpose of the upper-left 3x3 (for transforming normals).
  normalMatrix(m) {
    const a = m[0], b = m[4], c = m[8];
    const d = m[1], e = m[5], f = m[9];
    const g = m[2], h = m[6], i = m[10];
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C || 1e-12;
    const inv = 1 / det;
    // transpose(inverse) laid out column-major
    return new Float32Array([
      A * inv, (c * h - b * i) * inv, (b * f - c * e) * inv,
      B * inv, (a * i - c * g) * inv, (c * d - a * f) * inv,
      C * inv, (b * g - a * h) * inv, (a * e - b * d) * inv,
    ]);
  },
};

// Matrix stack used for hierarchical traversal (push/pop like in class).
class MatrixStack {
  constructor() { this.stack = []; }
  push(m) { this.stack.push(new Float32Array(m)); }
  pop() {
    if (!this.stack.length) throw new Error("MatrixStack underflow");
    return this.stack.pop();
  }
}
