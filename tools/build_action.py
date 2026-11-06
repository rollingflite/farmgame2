"""Shrink generated 4x2 action sheets (e.g. hoe-east.png) to game size.

The character must keep exactly the walk sheet's pixel size, so the scale comes
from the walk sheet of the same direction (same two nearest steps as
build_character.py), not from the action frames, which are taller with the
tool raised. Frames go into a larger cell anchored at the feet.

Run: python3 tools/build_action.py art-src/maple maple hoe 5
     (the last number is the 0-based impact frame)
"""
from pathlib import Path
import json
import statistics
import sys
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
FW, FH = 32, 48
DIRS = ['south', 'north', 'east']


def cells(path):
    sheet = Image.open(path).convert('RGBA')
    cw, ch = sheet.width // 4, sheet.height // 2
    return [sheet.crop((i % 4 * cw, i // 4 * ch, (i % 4 + 1) * cw, (i // 4 + 1) * ch)) for i in range(8)]


def box(img):
    return img.getchannel('A').point(lambda a: 255 if a >= 128 else 0).getbbox()


def walk_scale(path):
    bs = [box(c) for c in cells(path)]
    w = max(b[2] for b in bs) - min(b[0] for b in bs)
    h = max(b[3] for b in bs) - min(b[1] for b in bs)
    s1 = min(200 / h, 216 / w)
    mw, mh = round(w * s1), round(h * s1)
    return s1, min(FH / mh, FW / mw)


def shrink(img, s1, s2):
    mid = img.resize((max(1, round(img.width * s1)), max(1, round(img.height * s1))), Image.Resampling.NEAREST)
    out = mid.resize((max(1, round(mid.width * s2)), max(1, round(mid.height * s2))), Image.Resampling.NEAREST)
    out.putalpha(out.getchannel('A').point(lambda a: 255 if a >= 128 else 0))
    return out


def build_dir(src, action, d):
    s1, s2 = walk_scale(src / f'{d}.png')
    frames = cells(src / f'{action}-{d}.png')
    bs = [box(f) for f in frames]
    assert all(bs), f'{action}-{d}: empty cell'
    # Feet line: most frames (tool raised) bottom out at the feet.
    feet = round(statistics.median(b[3] for b in bs))
    # Body centre: middle of the opaque pixels just above the feet, in frames that end at the feet.
    xs = []
    for f, b in zip(frames, bs):
        if abs(b[3] - feet) > 3:
            continue
        band = f.crop((0, feet - (feet - b[1]) // 8, f.width, feet))
        bb = box(band)
        if bb:
            xs.append((bb[0] + bb[2]) / 2)
    cx = statistics.median(xs)
    union = (min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs))
    small = [shrink(f.crop(union), s1, s2) for f in frames]
    k = s1 * s2
    # feet/centre position inside each shrunken frame
    return small, ((cx - union[0]) * k, (feet - union[1]) * k)


def main():
    src, name, action, hit = Path(sys.argv[1]), sys.argv[2], sys.argv[3], int(sys.argv[4])
    rows = {d: build_dir(src, action, d) for d in DIRS}
    fr, (ax, ay) = rows['east']
    rows['west'] = ([ImageOps.mirror(f) for f in fr], (fr[0].width - ax, ay))
    order = ['south', 'north', 'east', 'west']
    left = max(a[0] for _, a in rows.values())
    right = max(f[0].width - a[0] for f, a in rows.values())
    up = max(a[1] for _, a in rows.values())
    down = max(f[0].height - a[1] for f, a in rows.values())
    cw, chh = int(left + right) + 2, int(up + down) + 2
    cw += cw % 2
    anchor = (round(left) + 1, round(up) + 1)
    sheet = Image.new('RGBA', (cw * 8, chh * 4))
    for r, d in enumerate(order):
        frames, (fx, fy) = rows[d]
        for i, f in enumerate(frames):
            sheet.paste(f, (i * cw + anchor[0] - round(fx), r * chh + anchor[1] - round(fy)))
    sheet.save(ROOT / f'assets/{name}-{action}.png')
    meta = {'frameWidth': cw, 'frameHeight': chh, 'frames': 8, 'fps': 14, 'rows': order,
            'anchor': [anchor[0], anchor[1] - 2], 'hit': hit}
    (ROOT / f'assets/{name}-{action}.json').write_text(json.dumps(meta, indent=2) + '\n')
    print(f'wrote assets/{name}-{action}.png', sheet.size, meta)


if __name__ == '__main__':
    main()
