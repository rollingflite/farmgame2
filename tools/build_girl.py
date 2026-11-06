"""Derive an 8-way girl from the 32x48 farmer sheet: two braids with ribbons,
a ribbon band on the straw hat and a pink shirt. Same frames, same walk cycle.

East-side rows are edited by hand-placed braid specs; the west-side rows are
mirrors, exactly as in the source sheet.

Run: python3 tools/build_girl.py   (after tools/build_farmer.py)
"""
from pathlib import Path
import colorsys
import json
import math
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
FW, FH = 32, 48
ORDER = ['south', 'southwest', 'west', 'northwest', 'north', 'northeast', 'east', 'southeast']
MIRROR = {'southwest': 'southeast', 'west': 'east', 'northwest': 'northeast'}

OUTLINE = (40, 23, 19, 255)
HAIR = [(50, 29, 21, 255), (72, 42, 28, 255), (96, 57, 36, 255), (124, 77, 47, 255)]
RIBBON = [(150, 40, 70, 255), (214, 74, 110, 255), (246, 140, 168, 255)]

# Braids in frame-0 coordinates: (x of the 3px core, top y, length, layer)
# layer 'front' draws over the body, 'back' only fills empty pixels.
BRAIDS = {
    'south': [(7, 16, 12, 'front'), (22, 16, 12, 'front')],
    'southeast': [(8, 16, 12, 'back'), (21, 16, 11, 'front')],
    'east': [(10, 17, 13, 'front')],
    'northeast': [(9, 17, 13, 'front'), (17, 17, 13, 'front')],
    'north': [(9, 18, 13, 'front'), (20, 18, 13, 'front')],
}


def hsv(p):
    h, s, v = colorsys.rgb_to_hsv(p[0] / 255, p[1] / 255, p[2] / 255)
    return h * 360, s, v


def is_hat(p):
    h, s, v = hsv(p)
    return p[3] and 25 < h < 55 and s > 0.45 and v > 0.55


def is_shirt(p):
    h, s, v = hsv(p)
    return p[3] and (h < 16 or h > 335) and s > 0.4 and v > 0.22


def recolor_shirt(p):
    h, s, v = hsv(p)
    r, g, b = colorsys.hsv_to_rgb(338 / 360, min(1, s * 0.72), min(1, v * 1.22 + 0.08))
    return (round(r * 255), round(g * 255), round(b * 255), p[3])


def hat_box(fr):
    pts = [(x, y) for y in range(FH // 2) for x in range(FW) if is_hat(fr.getpixel((x, y)))]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def ribbon_band(fr):
    """Paint a ribbon around the hat crown, just above where the brim widens."""
    spans = []
    for y in range(FH // 2):
        xs = [x for x in range(FW) if is_hat(fr.getpixel((x, y)))]
        spans.append((min(xs), max(xs)) if xs else None)
    top = next(i for i, s in enumerate(spans) if s)
    crown = spans[top + 2]
    brim = next((y for y in range(top + 3, len(spans)) if spans[y] and spans[y][1] - spans[y][0] > crown[1] - crown[0] + 5), None)
    if brim is None:
        return
    for y, shade in ((brim - 2, 1), (brim - 1, 0)):
        for x in range(crown[0], crown[1] + 1):
            if is_hat(fr.getpixel((x, y))):
                fr.putpixel((x, y), RIBBON[shade + (1 if x == crown[0] + 1 else 0)])


def braid(fr, x0, y0, length, layer, sway):
    px = {}
    for i in range(length):
        k = i / max(1, length - 1)
        x = x0 + round(sway * k * k)
        y = y0 + i
        tie = length - 4 <= i < length - 2
        tuft = i >= length - 2
        cols = [x, x + 1, x + 2] if not tuft else ([x + 1] if i == length - 1 else [x, x + 1, x + 2])
        for j, cx in enumerate(cols):
            if tie:
                c = RIBBON[2 - j] if j < 2 else RIBBON[0]
            else:
                seg = (i + j) % 3
                c = HAIR[3] if (j == 0 and seg != 2) else HAIR[2] if seg == 0 else HAIR[1] if seg == 1 else HAIR[0]
            px[(cx, y)] = c
        if tie and i == length - 4:  # little bow loops
            px[(x - 1, y)] = RIBBON[1]
            px[(x + 3, y)] = RIBBON[1]
    edge = set()
    for (x, y) in px:
        for dx, dy in ((1, 0), (-1, 0), (0, 1)):
            if (x + dx, y + dy) not in px:
                edge.add((x + dx, y + dy))
    for (x, y), c in list(px.items()) + [(e, OUTLINE) for e in edge]:
        if not (0 <= x < FW and 0 <= y < FH):
            continue
        empty = fr.getpixel((x, y))[3] == 0
        if layer == 'front' or empty:
            if c is OUTLINE and not empty and layer == 'front' and (x, y) not in px:
                fr.putpixel((x, y), OUTLINE)
            elif (x, y) in px or empty:
                fr.putpixel((x, y), c)


def main():
    src = Image.open(ROOT / 'assets/farmer.png').convert('RGBA')
    meta = json.loads((ROOT / 'assets/farmer.json').read_text())
    out = Image.new('RGBA', src.size)
    rows = {}
    for name, specs in BRAIDS.items():
        r = ORDER.index(name)
        ref = hat_box(src.crop((0, r * FH, FW, (r + 1) * FH)))
        frames = []
        for f in range(8):
            fr = src.crop((f * FW, r * FH, (f + 1) * FW, (r + 1) * FH))
            hb = hat_box(fr)
            dx, dy = round((hb[0] + hb[2] - ref[0] - ref[2]) / 2), hb[1] - ref[1]
            for y in range(FH):
                for x in range(FW):
                    p = fr.getpixel((x, y))
                    if y > 12 and is_shirt(p):
                        fr.putpixel((x, y), recolor_shirt(p))
            ribbon_band(fr)
            sway = round(math.sin(f / 8 * 2 * math.pi) * 1.4)
            for x0, y0, length, layer in specs:
                braid(fr, x0 + dx, y0 + dy, length, layer, sway)
            frames.append(fr)
        rows[name] = frames
    for left, right in MIRROR.items():
        rows[left] = [ImageOps.mirror(f) for f in rows[right]]
    for r, name in enumerate(ORDER):
        for f, fr in enumerate(rows[name]):
            out.paste(fr, (f * FW, r * FH))
    out.save(ROOT / 'assets/girl.png')
    (ROOT / 'assets/girl.json').write_text(json.dumps({**meta, 'source': 'farmer.png + tools/build_girl.py'}, indent=2) + '\n')
    print('wrote assets/girl.png', out.size)


if __name__ == '__main__':
    main()
