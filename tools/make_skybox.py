#!/usr/bin/env python3
"""
Generates a gothic night-sky skybox: six cube-map faces in models/skybox/
(px, nx, py, ny, pz, nz .jpg). Every pixel's colour is computed from its 3D
view direction, so the faces join without seams.

Contents: twilight purple gradient, stars, a full moon with a halo, violet mist
at the horizon, and a black horizon silhouette (hills, cathedral spires,
bare dead trees).

To use your own skybox instead, replace the six images (same names, square,
power-of-two size).

Run:  python3 tools/make_skybox.py
"""
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "models", "skybox")
SIZE = 2048
SUPERSAMPLE = 2       # 2x2 samples per pixel for smooth silhouette edges

rng = np.random.default_rng(7)


def face_directions(face, n, rows, ox=0.5, oy=0.5):
    """Direction for pixels of a cube-map face (the given rows), using the
    WebGL/OpenGL cube-map convention (image row 0 = top, no Y flip).
    ox, oy = sample position inside the pixel."""
    sc, tc = np.meshgrid((np.arange(n) + ox) / n * 2 - 1, (rows + oy) / n * 2 - 1)
    one = np.ones_like(sc)
    d = {
        "px": (one, -tc, -sc),
        "nx": (-one, -tc, sc),
        "py": (sc, one, tc),
        "ny": (sc, -one, -tc),
        "pz": (sc, -tc, one),
        "nz": (-sc, -tc, -one),
    }[face]
    d = np.stack(d, -1)
    return d / np.linalg.norm(d, axis=-1, keepdims=True)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ---- horizon silhouette, as a height (elevation in radians) per azimuth ----
AZ = np.linspace(-np.pi, np.pi, 8192, endpoint=False)
height = 0.035 + 0.025 * np.sin(3 * AZ + 1.0) + 0.015 * np.sin(7 * AZ + 2.0) + 0.008 * np.sin(17 * AZ)

def add_spire(az0, width, top, base=0.06):
    """Gothic spire: a tower of the given width with a pointed top."""
    d = np.abs((AZ - az0 + np.pi) % (2 * np.pi) - np.pi)
    tower = np.where(d < width, base + 0.6 * (top - base), 0)
    roof = np.where(d < width, base + 0.6 * (top - base) + (top - base) * 0.4 * (1 - d / width), 0)
    return np.maximum(tower, roof)

# a cathedral: two tall spires and a lower nave, left of the moth at the start
for az0, w, top in [(-1.07, 0.012, 0.30), (-0.97, 0.012, 0.30), (-1.02, 0.05, 0.15), (-0.85, 0.008, 0.20)]:
    height = np.maximum(height, add_spire(az0, w, top))

# bare dead trees: thin trunks with a few angled branches (drawn per pixel below)
trees = []
for az0 in rng.uniform(-np.pi, np.pi, 26):
    trees.append((az0, rng.uniform(0.07, 0.17), rng.uniform(0.0015, 0.003)))


def silhouette(az, el):
    """True where the direction is behind the black horizon shapes."""
    idx = ((az + np.pi) / (2 * np.pi) * len(AZ)).astype(int) % len(AZ)
    mask = el < height[idx]
    for az0, h, w in trees:
        da = (az - az0 + np.pi) % (2 * np.pi) - np.pi
        trunk = (np.abs(da) < w * (1.4 - el / h)) & (el < h)
        mask |= trunk
        for k, (frac, ang) in enumerate([(0.55, 0.9), (0.7, -0.8), (0.82, 0.7), (0.62, -1.1)]):
            y0 = h * frac
            along = el - y0                         # branch goes up and sideways
            side = da - along * np.tan(ang) * 0.6
            length = h * 0.35 * (1 - 0.15 * k)
            mask |= (np.abs(side) < w * 0.6) & (along > 0) & (along < length)
    return mask


def direction(az, el):
    """az measured from -Z toward +X (the default camera looks along az ~ -0.6)."""
    return np.array([np.cos(el) * np.sin(az), np.sin(el), -np.cos(el) * np.cos(az)])

MOON = direction(-0.22, 0.17)
# moon "seas": soft dark blotches in the moon's own 2D coordinates
MOON_U = np.cross(MOON, [0, 1, 0]); MOON_U /= np.linalg.norm(MOON_U)
MOON_V = np.cross(MOON_U, MOON)
MARIA = [(rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6), rng.uniform(0.15, 0.35), rng.uniform(0.08, 0.2)) for _ in range(9)]


def sky_color(d):
    x, y, z = d[..., 0], d[..., 1], d[..., 2]
    el = np.arcsin(np.clip(y, -1, 1))
    az = np.arctan2(x, -z)

    # twilight: light enough that the dark moth stands out against it
    zenith = np.array([0.16, 0.12, 0.30])
    upper = np.array([0.38, 0.28, 0.52])
    horizon = np.array([0.72, 0.56, 0.70])
    t = smoothstep(0.0, 0.9, el)[..., None]
    col = horizon * (1 - smoothstep(0.0, 0.35, el)[..., None]) + upper * smoothstep(0.0, 0.35, el)[..., None]
    col = col * (1 - t) + zenith * t

    # stars: hash of the direction on a fine grid (same on every face)
    K = 420.0
    cell = np.floor(d * K)
    h = np.sin(cell[..., 0] * 12.9898 + cell[..., 1] * 78.233 + cell[..., 2] * 37.719) * 43758.5453
    h = h - np.floor(h)
    centre = (cell + 0.5) / K
    dist = np.linalg.norm(d - centre / np.linalg.norm(centre, axis=-1, keepdims=True), axis=-1) * K
    star = (h > 0.9965) * np.clip(1.2 - dist * 1.6, 0, 1) * (0.5 + 0.5 * (h - 0.9965) / 0.0035)
    star *= smoothstep(0.03, 0.25, el)
    col += star[..., None] * np.array([0.9, 0.88, 1.0])

    # moon with halo
    cosang = np.clip((d * MOON).sum(-1), -1, 1)
    ang = np.arccos(cosang)
    R = 0.035
    disk = 1 - smoothstep(R * 0.97, R, ang)
    mu = (d @ MOON_U) / R; mv = (d @ MOON_V) / R      # -1..1 across the disk
    mare = np.zeros_like(mu)
    for cx, cy, r, depth in MARIA:
        mare += depth * np.exp(-((mu - cx) ** 2 + (mv - cy) ** 2) / (r * r))
    moon_col = np.array([0.93, 0.90, 0.84])[None, None, :] * (0.9 - mare[..., None])
    halo = np.exp(-ang / 0.09)[..., None] * np.array([0.35, 0.28, 0.42])
    col = col + halo
    col = col * (1 - disk[..., None]) + moon_col * disk[..., None]

    # violet mist low on the horizon
    mist = np.exp(-np.abs(el - 0.03) / 0.06)[..., None] * np.array([0.12, 0.08, 0.12])
    col += mist

    # black silhouette and dark ground
    ground = el < 0
    # misty lavender-grey ground, lighter towards the horizon
    gt = np.exp(el[ground] / 0.25)[..., None]
    col[ground] = np.array([0.30, 0.26, 0.34]) * (1 - gt) + np.array([0.55, 0.47, 0.58]) * gt
    sil = silhouette(az, el) & ~ground
    col[sil] = np.array([0.08, 0.05, 0.10])
    return np.clip(col, 0, 1)


def main():
    os.makedirs(OUT, exist_ok=True)
    offsets = [((i + 0.5) / SUPERSAMPLE, (j + 0.5) / SUPERSAMPLE)
               for i in range(SUPERSAMPLE) for j in range(SUPERSAMPLE)]
    for face in ["px", "nx", "py", "ny", "pz", "nz"]:
        img = np.zeros((SIZE, SIZE, 3))
        for r0 in range(0, SIZE, 256):                    # in chunks to save memory
            rows = np.arange(r0, min(r0 + 256, SIZE))
            for ox, oy in offsets:
                img[rows] += sky_color(face_directions(face, SIZE, rows, ox, oy))
        img = (np.clip(img / len(offsets), 0, 1) ** (1 / 1.1) * 255).astype(np.uint8)
        Image.fromarray(img).save(os.path.join(OUT, face + ".jpg"), quality=88)
        print("wrote", face)


if __name__ == "__main__":
    main()
