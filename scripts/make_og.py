#!/usr/bin/env python3
"""Regenerate public/og.png (1200x630 share image) with correct CJK rendering.

Why this script exists:
  The og image subtitle contains Chinese text. Generating it with a Latin-only
  font makes Pillow render every CJK glyph as the font's .notdef placeholder
  (hollow "tofu" boxes). This script keeps the icon / title / background of the
  current og.png untouched and only redraws the subtitle line with a
  CJK-capable font.

Usage:
  python3 scripts/make_og.py            # regenerate public/og.png in place
  python3 scripts/make_og.py --out /tmp/og-preview.png

Environment:
  - Python 3.8+ with Pillow.
  - A CJK font (TTF/TTC). Defaults to macOS Hiragino Sans GB; override with
    --font /path/to/font.ttc (Pillow loads .ttc face index 2 = W6 by default,
    use --face to change).
"""

import argparse
from PIL import Image, ImageDraw, ImageFont

DEFAULT_FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"
FONT_FACE = 2  # Hiragino Sans GB W6
SIZE = 26

# Subtitle layout (measured from the original design):
#   left edge x=405, cap top y=336; "DSH" in full white, Chinese at ~56% white.
SUB_LEFT, SUB_TOP = 405, 336
SUB_ZH = "插件目录 · 先看证据再决定安装"
ALPHA_ZH = 143  # 56% white over the dark background


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None, help="output path (default: public/og.png)")
    ap.add_argument("--font", default=DEFAULT_FONT)
    ap.add_argument("--face", type=int, default=FONT_FACE)
    ap.add_argument("--size", type=int, default=SIZE)
    args = ap.parse_args()

    src = "public/og.png"
    out = args.out or src
    im = Image.open(src).convert("RGB")
    pix = im.load()

    # 1) Inpaint the old subtitle band: per-row horizontal interpolation of the
    #    background across [X0, X1] from clean columns just outside the band.
    X0, X1, Y0, Y1 = 396, 862, 326, 372
    for y in range(Y0, Y1 + 1):
        left = [pix[x, y] for x in (388, 390, 392)]
        right = [pix[x, y] for x in (866, 868, 870)]
        lc = tuple(sum(c[i] for c in left) // 3 for i in range(3))
        rc = tuple(sum(c[i] for c in right) // 3 for i in range(3))
        for x in range(X0, X1 + 1):
            t = (x - X0) / (X1 - X0)
            pix[x, y] = tuple(round(lc[i] * (1 - t) + rc[i] * t) for i in range(3))

    # 2) Draw the new subtitle.
    overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    font = ImageFont.truetype(args.font, args.size, index=args.face)
    x = SUB_LEFT
    od.text((x, SUB_TOP), "DSH", font=font, fill=(255, 255, 255, 255))
    x += od.textlength("DSH", font=font) + od.textlength(" ", font=font)
    od.text((x, SUB_TOP), SUB_ZH, font=font, fill=(255, 255, 255, ALPHA_ZH))
    im = Image.alpha_composite(im.convert("RGBA"), overlay).convert("RGB")
    im.save(out)
    print("wrote", out, im.size)


if __name__ == "__main__":
    main()
