#!/usr/bin/env python3
"""Process generated artwork into web assets: alpha-matte tokens (flood-fill
white background from the edges), inset-crop tiles, resize everything, and
write named files into public/art/."""

import sys
from collections import deque
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "generated_imgs"
OUT = REPO / "public" / "art"

# generated-file fragment -> (output name, kind)
ASSETS = {
    "n9srup": ("token-wood", "token"),
    "ka3m7e": ("token-clay", "token"),
    "btrb0p": ("token-reed", "token"),
    "m3e3wz": ("token-stone", "token"),
    "v8zvgg": ("token-grain", "token"),
    "5wv3tx": ("token-vegetable", "token"),
    "zxp98z": ("token-food", "token"),
    "0cjm3t": ("token-sheep", "token"),
    "6beo66": ("token-boar", "token"),
    "o6akfq": ("token-cattle", "token"),
    "t8a7az": ("token-stable", "token"),
    "k9o676": ("tile-field", "tile"),
    "i3q92z": ("tile-room-clay", "tile"),
    "0518i3": ("tile-room-wood", "tile"),
    "qfsrio": ("tile-room-stone", "tile"),
    "jovem7": ("tile-grass", "tile"),
    "08cin2": ("texture-table", "texture"),
    "1v1mav": ("texture-parchment", "texture"),
}

TOKEN_SIZE = 200
TILE_SIZE = 384
TEXTURE_SIZE = 768
WHITE_TOLERANCE = 40


def matte_token(img: Image.Image) -> Image.Image:
    """Flood-fill near-white from the borders to transparent, then trim."""
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    seen = [[False] * w for _ in range(h)]
    queue: deque[tuple[int, int]] = deque()
    for x in range(w):
        queue.append((x, 0))
        queue.append((x, h - 1))
    for y in range(h):
        queue.append((0, y))
        queue.append((w - 1, y))
    while queue:
        x, y = queue.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or seen[y][x]:
            continue
        seen[y][x] = True
        r, g, b, a = px[x, y]
        dist = max(255 - r, 255 - g, 255 - b)
        if dist > WHITE_TOLERANCE:
            continue
        # Fade alpha near the silhouette edge for soft anti-aliasing.
        alpha = 0 if dist < WHITE_TOLERANCE // 2 else int(255 * dist / 255)
        px[x, y] = (r, g, b, min(a, alpha))
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    img.thumbnail((TOKEN_SIZE, TOKEN_SIZE), Image.LANCZOS)
    return img


def crop_tile(img: Image.Image, size: int) -> Image.Image:
    img = img.convert("RGB")
    w, h = img.size
    inset = int(min(w, h) * 0.05)
    img = img.crop((inset, inset, w - inset, h - inset))
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    files = list(SRC.glob("*.png"))
    done = 0
    for fragment, (name, kind) in ASSETS.items():
        matches = [f for f in files if fragment in f.name]
        if not matches:
            print(f"MISSING source for {name} ({fragment})", file=sys.stderr)
            continue
        img = Image.open(matches[0])
        if kind == "token":
            out = matte_token(img)
        elif kind == "tile":
            out = crop_tile(img, TILE_SIZE)
        else:
            out = crop_tile(img, TEXTURE_SIZE)
        path = OUT / f"{name}.png"
        out.save(path, optimize=True)
        print(f"{path.name}: {out.size[0]}x{out.size[1]}")
        done += 1
    if done != len(ASSETS):
        sys.exit(1)


if __name__ == "__main__":
    main()
