// App entry: WebGL setup, a basic smooth-shaded renderer, a simple mouse
// camera and a "rig check" panel for testing the model's joints.
// Rendering options, keyframe animation, picking and the final camera/UI
// (parts 2-4 of the assignment) build on top of this.
"use strict";

const VERT_SRC = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUV;
uniform mat4 uModel, uView, uProj;
uniform mat3 uNormalMat;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec2 vUV;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorldPos = world.xyz;
  vNormal = uNormalMat * aNormal;
  vUV = aUV;
  gl_Position = uProj * uView * world;
}`;

const FRAG_SRC = `
precision mediump float;
uniform vec3 uColor;
uniform vec3 uLightDir;
uniform vec3 uEye;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec2 vUV;
void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;                 // thin wings: light both sides
  vec3 l = normalize(uLightDir);
  vec3 v = normalize(uEye - vWorldPos);
  vec3 h = normalize(l + v);
  float diff = max(dot(n, l), 0.0);
  float spec = pow(max(dot(n, h), 0.0), 32.0) * 0.35;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.25;
  vec3 c = uColor * (0.25 + 0.75 * diff) + vec3(spec) + vec3(0.45, 0.3, 0.55) * rim;
  gl_FragColor = vec4(c, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function makeProgram(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

async function main() {
  const canvas = document.getElementById("gl");
  const gl = canvas.getContext("webgl");
  if (!gl) { alert("WebGL not supported"); return; }

  const prog = makeProgram(gl, VERT_SRC, FRAG_SRC);
  gl.useProgram(prog);
  const loc = {
    aPosition: gl.getAttribLocation(prog, "aPosition"),
    aNormal: gl.getAttribLocation(prog, "aNormal"),
    aUV: gl.getAttribLocation(prog, "aUV"),
  };
  for (const u of ["uModel", "uView", "uProj", "uNormalMat", "uColor", "uLightDir", "uEye"]) {
    loc[u] = gl.getUniformLocation(prog, u);
  }

  let model;
  try {
    model = await MothModel.load(gl, "models/moth.obj", "models/moth.rig.json");
  } catch (e) {
    document.getElementById("status").textContent =
      "Could not load the model (" + e.message + "). Serve the folder over HTTP, e.g. `python3 -m http.server`.";
    throw e;
  }
  window.moth = model; // handy in the browser console

  // ---- simple camera: drag = orbit, shift+drag = pan, wheel = zoom ----
  const cam = { yaw: 35, pitch: 25, dist: 4, target: [0, 0, -0.2] };
  let drag = null;
  canvas.addEventListener("mousedown", (e) => { drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey }; });
  window.addEventListener("mouseup", () => { drag = null; });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) {
      const s = cam.dist * 0.002, y = (cam.yaw * Math.PI) / 180;
      cam.target[0] -= Math.cos(y) * dx * s;
      cam.target[2] += Math.sin(y) * dx * s;
      cam.target[1] += dy * s;
    } else {
      cam.yaw += dx * 0.4;
      cam.pitch = Math.max(-89, Math.min(89, cam.pitch + dy * 0.4));
    }
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    cam.dist = Math.max(0.5, Math.min(30, cam.dist * Math.exp(e.deltaY * 0.001)));
  }, { passive: false });

  setupRigPanel(model);

  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0.11, 0.1, 0.13, 1);

  const drawPart = (part, M) => {
    gl.uniformMatrix4fv(loc.uModel, false, M);
    gl.uniformMatrix3fv(loc.uNormalMat, false, Mat4.normalMatrix(M));
    gl.uniform3fv(loc.uColor, part.color);
    const bind = (buf, attr, size) => {
      if (attr < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(attr);
      gl.vertexAttribPointer(attr, size, gl.FLOAT, false, 0, 0);
    };
    bind(part.buffers.position, loc.aPosition, 3);
    bind(part.buffers.normal, loc.aNormal, 3);
    bind(part.buffers.uv, loc.aUV, 2);
    gl.drawArrays(gl.TRIANGLES, 0, part.vertexCount);
  };

  const t0 = performance.now();
  function frame(now) {
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (document.getElementById("wiggle").checked) wiggle(model, (now - t0) / 1000);

    const yaw = (cam.yaw * Math.PI) / 180, pitch = (cam.pitch * Math.PI) / 180;
    const eye = [
      cam.target[0] + cam.dist * Math.cos(pitch) * Math.sin(yaw),
      cam.target[1] + cam.dist * Math.sin(pitch),
      cam.target[2] + cam.dist * Math.cos(pitch) * Math.cos(yaw),
    ];
    gl.uniformMatrix4fv(loc.uProj, false, Mat4.perspective(45, canvas.width / canvas.height, 0.05, 100));
    gl.uniformMatrix4fv(loc.uView, false, Mat4.lookAt(eye, cam.target, [0, 1, 0]));
    gl.uniform3fv(loc.uLightDir, [0.4, 1.0, 0.6]);
    gl.uniform3fv(loc.uEye, eye);

    model.draw(Mat4.identity(), drawPart);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Procedural test motion so every joint can be checked at once.
function wiggle(model, t) {
  const s = Math.sin(t * 6);
  for (const p of model.parts) {
    const side = p.name.endsWith("_R") ? -1 : 1;
    if (p.name.startsWith("forewing") || p.name.startsWith("hindwing")) p.rotation = [0, 0, side * 35 * s];
    else if (p.name.startsWith("leg_") && p.name.includes("upper")) p.rotation = [15 * Math.sin(t * 3 + p.index), 0, 0];
    else if (p.name.startsWith("leg_")) p.rotation = [0, 0, side * 15 * Math.sin(t * 3 + p.index)];
    else if (p.name.startsWith("antenna")) p.rotation = [10 * Math.sin(t * 2), 0, 0];
    else if (p.name === "head") p.rotation = [0, 10 * Math.sin(t), 0];
    else if (p.name === "abdomen") p.rotation = [8 * Math.sin(t * 1.5), 0, 0];
  }
}

// Debug panel: pick a part and rotate it with sliders. (The proper slider UI
// and mouse picking are part 4; this exists to verify the rig's pivots.)
function setupRigPanel(model) {
  const select = document.getElementById("part");
  for (const p of model.parts) {
    const o = document.createElement("option");
    o.value = p.name; o.textContent = (p.parent ? "\u00a0\u00a0".repeat(depth(p)) : "") + p.name;
    select.appendChild(o);
  }
  select.value = model.root.name;
  const sliders = ["rx", "ry", "rz"].map((id) => document.getElementById(id));
  const refresh = () => {
    const p = model.byName.get(select.value);
    sliders.forEach((s, k) => { s.value = p.rotation[k]; s.nextElementSibling.textContent = Math.round(p.rotation[k]); });
  };
  sliders.forEach((s, k) => s.addEventListener("input", () => {
    document.getElementById("wiggle").checked = false;
    model.byName.get(select.value).rotation[k] = +s.value;
    s.nextElementSibling.textContent = s.value;
  }));
  select.addEventListener("change", refresh);
  document.getElementById("reset").addEventListener("click", () => {
    document.getElementById("wiggle").checked = false;
    model.resetPose(); refresh();
  });
  document.getElementById("status").textContent =
    `${model.parts.length} parts loaded, root = ${model.root.name}`;
  refresh();
}

function depth(p) { let d = 0; while (p.parent) { d++; p = p.parent; } return d; }

main();
