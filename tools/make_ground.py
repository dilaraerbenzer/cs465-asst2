#!/usr/bin/env python3
"""
Generates a seamless (tileable) forest-floor texture for the ground plane:
models/ground.jpg. Dark soil, moss patches, small stones, twigs and a few
dead leaves, in muted swampy colours to match the night sky.

Everything is built on a height map; the relief is shaded with a fixed light
and a little ambient occlusion, so the flat ground still looks bumpy.
All noise and stamps wrap around the edges, so the texture repeats without
seams.

Run:  python3 tools/make_ground.py
"""
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "models", "ground.jpg")
N = 1024
rng = np.random.default_rng(11)

ky = np.fft.fftfreq(N)[:, None]
kx = np.fft.fftfreq(N)[None, :]
K = np.sqrt(kx * kx + ky * ky)


def noise(scale):
    """Tileable smooth noise with features about `scale` pixels wide, in 0..1."""
    f = np.fft.fft2(rng.standard_normal((N, N))) * np.exp(-(K * scale) ** 2 * 2.0)
    n = np.real(np.fft.ifft2(f))
    n -= n.min()
    return n / n.max()


def blur(a, scale):
    return np.real(np.fft.ifft2(np.fft.fft2(a) * np.exp(-(K * scale) ** 2 * 2.0)))


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def window(cx, cy, R):
    """Index arrays (wrapped at the edges) and pixel offsets for the square of
    half-size R around (cx, cy). Stamps are drawn only inside this window."""
    x0, y0 = int(np.floor(cx - R)), int(np.floor(cy - R))
    xs = np.arange(x0, x0 + 2 * R + 2)
    ys = np.arange(y0, y0 + 2 * R + 2)
    dx, dy = np.meshgrid(xs - cx, ys - cy)
    return np.ix_(ys % N, xs % N), dx, dy


def blend(idx, alpha, col, height=None):
    """Mix colour (and optionally raise height) inside a window by alpha."""
    global A, H
    a3 = alpha[..., None]
    A[idx] = A[idx] * (1 - a3) + col * a3
    if height is not None:
        H[idx] = np.maximum(H[idx], H[idx] * (1 - alpha) + height * alpha)


# ---- soil ----
H = 0.35 * noise(60) + 0.25 * noise(14) + 0.12 * noise(4)
soil_dark = np.array([0.085, 0.075, 0.06])
soil_light = np.array([0.19, 0.165, 0.125])
t = noise(40)[..., None]
A = soil_dark * (1 - t) + soil_light * t
A *= (0.8 + 0.4 * noise(2.2))[..., None]                 # fine grain
crumbs = smoothstep(0.62, 0.75, noise(3.5))               # small soil clumps
H += 0.15 * crumbs
A *= (1 + 0.25 * crumbs)[..., None]

# ---- moss patches ----
moss_mask = smoothstep(0.55, 0.66, 0.7 * noise(90) + 0.3 * noise(25))
moss_col = np.array([0.10, 0.135, 0.065]) * (0.7 + 0.6 * noise(4))[..., None]
moss_col += np.array([0.05, 0.055, 0.02]) * smoothstep(0.62, 0.9, noise(2.2))[..., None]   # moss tips
A = A * (1 - moss_mask[..., None]) + moss_col * moss_mask[..., None]
H += 0.22 * moss_mask * (0.6 + 0.4 * noise(2.5))

# ---- pine needles and dry grass (many thin strands) ----
for _ in range(900):
    cx, cy = rng.uniform(0, N, 2)
    length = rng.uniform(14, 45)
    ang = rng.uniform(0, np.pi)
    width = rng.uniform(0.7, 1.3)
    idx, dx, dy = window(cx, cy, int(length / 2) + 2)
    along = dx * np.cos(ang) + dy * np.sin(ang)
    across = -dx * np.sin(ang) + dy * np.cos(ang)
    alpha = np.clip(1.2 - np.abs(across) / width, 0, 1) * (np.abs(along) < length / 2)
    tone = rng.uniform(0.6, 1.1)
    col = np.array([0.20, 0.15, 0.09]) * tone
    blend(idx, alpha * 0.9, col, 0.5)

# ---- small stones, half sunk into the soil ----
for _ in range(130):
    cx, cy = rng.uniform(0, N, 2)
    r = rng.uniform(3, 11) if rng.random() < 0.85 else rng.uniform(14, 26)
    sx, sy = rng.uniform(0.7, 1.3), rng.uniform(0.7, 1.3)
    ang = rng.uniform(0, np.pi)
    idx, dx, dy = window(cx, cy, int(r * 1.4) + 2)
    u = (dx * np.cos(ang) + dy * np.sin(ang)) / (r * sx)
    v = (-dx * np.sin(ang) + dy * np.cos(ang)) / (r * sy)
    dome = np.sqrt(np.clip(1 - (u * u + v * v), 0, 1))
    alpha = smoothstep(0.0, 0.35, dome)                 # soft edge: sunk into soil
    grey = rng.uniform(0.11, 0.22)
    col = np.array([grey, grey * 0.97, grey * 0.88])[None, None, :] * (0.75 + 0.2 * dome[..., None])
    blend(idx, alpha, col, 0.45 + 0.3 * r / 26 * dome)

# ---- twigs ----
for _ in range(16):
    cx, cy = rng.uniform(0, N, 2)
    length = rng.uniform(80, 240)
    ang = rng.uniform(0, np.pi)
    width = rng.uniform(2.5, 5)
    idx, dx, dy = window(cx, cy, int(length / 2) + 10)
    along = dx * np.cos(ang) + dy * np.sin(ang)
    across = -dx * np.sin(ang) + dy * np.cos(ang) - 6 * np.sin(along / length * 3)   # crooked
    prof = np.sqrt(np.clip(1 - (across / width) ** 2, 0, 1))
    alpha = smoothstep(0.0, 0.3, prof) * (np.abs(along) < length / 2)
    col = np.array([0.16, 0.12, 0.08]) * rng.uniform(0.7, 1.1) * (0.6 + 0.4 * prof[..., None])
    blend(idx, alpha, col, 0.55 + 0.25 * prof)

# ---- dead leaves: dark, decayed, with holes and darker edges ----
leaf_cols = [np.array([0.20, 0.12, 0.06]), np.array([0.22, 0.17, 0.08]),
             np.array([0.14, 0.10, 0.06]), np.array([0.20, 0.08, 0.05])]
holes = noise(6)
for _ in range(10):
    cx, cy = rng.uniform(0, N, 2)
    L = rng.uniform(55, 110)
    W = L * rng.uniform(0.35, 0.5)
    ang = rng.uniform(0, 2 * np.pi)
    idx, dx, dy = window(cx, cy, int(L) + 4)
    u = (dx * np.cos(ang) + dy * np.sin(ang)) / L
    v = (-dx * np.sin(ang) + dy * np.cos(ang)) / W
    halfw = np.sqrt(np.clip(1 - u * u, 0, 1)) * (1 - 0.35 * u)
    rel = np.abs(v) / np.maximum(halfw, 1e-6)
    alpha = (np.abs(u) < 1) * smoothstep(1.0, 0.85, rel) * smoothstep(0.22, 0.32, holes[idx])
    vein = np.exp(-(v / 0.06) ** 2) + 0.5 * np.exp(-((np.abs(v) - 0.6 * np.abs(np.sin(u * 9))) / 0.05) ** 2)
    col = leaf_cols[rng.integers(len(leaf_cols))] * (0.75 + 0.4 * holes[idx][..., None])
    col = col * (1 - 0.3 * np.clip(vein, 0, 1)[..., None]) * (1 - 0.45 * smoothstep(0.55, 1.0, rel)[..., None])
    blend(idx, alpha, col, 0.6 + 0.12 * v * v)

# ---- shading: relief lit from the upper left + ambient occlusion ----
gx = (np.roll(H, -1, 1) - np.roll(H, 1, 1)) * 0.5
gy = (np.roll(H, -1, 0) - np.roll(H, 1, 0)) * 0.5
normal = np.stack([-gx * 18, -gy * 18, np.ones_like(H)], -1)
normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
light = np.array([-0.5, -0.6, 0.62]); light /= np.linalg.norm(light)
lambert = np.clip(normal @ light, 0, 1)
ao = np.clip(1 - 2.2 * np.clip(blur(H, 12) - H, 0, None), 0.45, 1)
shade = (0.55 + 0.65 * lambert) * ao
img = np.clip(A * shade[..., None], 0, 1) ** (1 / 1.05)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
Image.fromarray((img * 255).astype(np.uint8)).save(OUT, quality=90)
print("wrote", OUT)
