"""Shrink the 256px 8-way farmer walk sheet from sprite_a into a 32x48 game sheet.

Nearest-neighbour sampling won the comparison: box/lanczos averaging blurred the eyes
and palette snapping washed out the hat. All frames share one crop box so the feet stay
planted on the same row (y=47) and the walk cycle does not jitter.

Run: python3 tools/build_farmer.py [path/to/farmer-8way-sheet.png]
"""
from pathlib import Path
import json
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / 'sprite_a/output/farmer-8way/farmer-8way-sheet.png'
ORDER = ['south', 'southwest', 'west', 'northwest', 'north', 'northeast', 'east', 'southeast']
CELL, FW, FH = 256, 32, 48


def alpha_box(img):
    return img.getchannel('A').point(lambda a: 255 if a > 32 else 0).getbbox()


def main():
    sheet = Image.open(SRC).convert('RGBA')
    assert sheet.size == (CELL * 8, CELL * 8), sheet.size
    cells = [[sheet.crop((c * CELL, r * CELL, (c + 1) * CELL, (r + 1) * CELL)) for c in range(8)] for r in range(8)]
    boxes = [alpha_box(cell) for row in cells for cell in row]
    union = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    scale = FH / (union[3] - union[1])
    w = round((union[2] - union[0]) * scale)
    assert w <= FW, w
    out = Image.new('RGBA', (FW * 8, FH * 8))
    idle = {}
    for r, name in enumerate(ORDER):
        widths = []
        for c in range(8):
            small = cells[r][c].crop(union).resize((w, FH), Image.Resampling.NEAREST)
            small.putalpha(small.getchannel('A').point(lambda a: 255 if a >= 128 else 0))
            out.paste(small, (c * FW + (FW - w) // 2, r * FH))
            legs = alpha_box(small.crop((0, FH - 12, w, FH)))
            widths.append(legs[2] - legs[0])
        # The frame whose legs are closest together reads as standing still.
        idle[name] = min(range(8), key=lambda i: (widths[i], i))
    out.save(ROOT / 'assets/farmer.png')
    meta = {'frameWidth': FW, 'frameHeight': FH, 'frames': 8, 'fps': 10, 'rows': ORDER,
            'idle': idle, 'anchor': [FW // 2, FH - 2], 'source': str(SRC.name)}
    (ROOT / 'assets/farmer.json').write_text(json.dumps(meta, indent=2) + '\n')
    print('wrote assets/farmer.png', out.size, 'idle', idle)


if __name__ == '__main__':
    main()
