"""Turn five generated 4x2 walk sheets into a 32x48 8-way game sheet.

Input: <src>/{east,south,southeast,northeast,north}.png, each a 4 columns x 2 rows
grid of an 8-frame walk cycle on a transparent background (what Codex image_gen makes).
West-side directions are mirrors of the east side.

Same two nearest-neighbour steps the farmer went through (cell -> 200px tall ->
48px tall), so every character has the same pixel density.

Run: python3 tools/build_character.py art-src/maple maple
"""
from pathlib import Path
import json
import sys
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
ORDER = ['south', 'southwest', 'west', 'northwest', 'north', 'northeast', 'east', 'southeast']
MIRROR = {'west': 'east', 'northwest': 'northeast', 'southwest': 'southeast'}
FW, FH = 32, 48


def opaque_box(img, cut=128):
    return img.getchannel('A').point(lambda a: 255 if a >= cut else 0).getbbox()


def split(path):
    sheet = Image.open(path).convert('RGBA')
    cw, ch = sheet.width // 4, sheet.height // 2
    frames = [sheet.crop((i % 4 * cw, i // 4 * ch, (i % 4 + 1) * cw, (i // 4 + 1) * ch)) for i in range(8)]
    boxes = [opaque_box(f) for f in frames]
    assert all(boxes), f'{path}: empty cell'
    union = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    # Step 1: like build_eight_way.py, fit the union into 200px height.
    s = min(200 / (union[3] - union[1]), 216 / (union[2] - union[0]))
    mid = [f.crop(union).resize((round((union[2] - union[0]) * s), round((union[3] - union[1]) * s)), Image.Resampling.NEAREST) for f in frames]
    # Step 2: down to 48px tall, feet on the bottom row.
    s2 = min(FH / mid[0].height, FW / mid[0].width)
    size = (round(mid[0].width * s2), round(mid[0].height * s2))
    out = []
    for m in mid:
        small = m.resize(size, Image.Resampling.NEAREST)
        small.putalpha(small.getchannel('A').point(lambda a: 255 if a >= 128 else 0))
        cell = Image.new('RGBA', (FW, FH))
        cell.paste(small, ((FW - size[0]) // 2, FH - size[1]))
        out.append(cell)
    return out


def idle_frame(frames):
    def legs(f):
        b = opaque_box(f.crop((0, FH - 12, FW, FH)))
        return b[2] - b[0] if b else 99
    def grounded(f):  # opaque pixels on the bottom three rows: both feet down scores high
        a = f.crop((0, FH - 3, FW, FH)).getchannel('A')
        return sum(1 for v in a.getdata() if v)
    g = [grounded(f) for f in frames]
    planted = [i for i in range(8) if g[i] >= 0.85 * max(g)]
    return min(planted, key=lambda i: (legs(frames[i]), i))


def main():
    src, name = Path(sys.argv[1]), sys.argv[2]
    rows = {d: split(src / f'{d}.png') for d in ['east', 'south', 'southeast', 'northeast', 'north']}
    for left, right in MIRROR.items():
        rows[left] = [ImageOps.mirror(f) for f in rows[right]]
    sheet = Image.new('RGBA', (FW * 8, FH * 8))
    for r, d in enumerate(ORDER):
        for i, f in enumerate(rows[d]):
            sheet.paste(f, (i * FW, r * FH))
    sheet.save(ROOT / f'assets/{name}.png')
    meta = {'frameWidth': FW, 'frameHeight': FH, 'frames': 8, 'fps': 10, 'rows': ORDER,
            'idle': {d: idle_frame(rows[d]) for d in ORDER}, 'anchor': [FW // 2, FH - 2], 'source': str(src)}
    (ROOT / f'assets/{name}.json').write_text(json.dumps(meta, indent=2) + '\n')
    print(f'wrote assets/{name}.png', meta['idle'])


if __name__ == '__main__':
    main()
