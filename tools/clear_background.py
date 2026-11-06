"""Make a generated sheet's flat light background transparent.

Codex sometimes returns a sheet on (semi-transparent) white instead of a clear
background. Flood-fill from every cell border through light, unsaturated
pixels; the dark outline around the character stops the fill.

Run: python3 tools/clear_background.py art-src/maple/seed-east.png
"""
import sys
from collections import deque
from PIL import Image


def is_bg(p):
    r, g, b, a = p
    return a < 40 or (min(r, g, b) > 200 and max(r, g, b) - min(r, g, b) < 28)


def main(path):
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q = deque()
    cw, ch = w // 4, h // 2
    for x in range(w):
        for y in (0, h - 1, ch - 1, ch):
            q.append((x, y))
    for y in range(h):
        for x in [i * cw for i in range(4)] + [i * cw - 1 for i in range(1, 5)]:
            q.append((x, y))
    while q:
        x, y = q.popleft()
        if not (0 <= x < w and 0 <= y < h) or seen[y * w + x] or not is_bg(px[x, y]):
            continue
        seen[y * w + x] = 1
        px[x, y] = (0, 0, 0, 0)
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    # Peel the anti-aliased light fringe left between the fill and the outline.
    for _ in range(3):
        peel = [(x, y) for y in range(1, h - 1) for x in range(1, w - 1)
                if px[x, y][3] and min(px[x, y][:3]) > 150 and max(px[x, y][:3]) - min(px[x, y][:3]) < 40
                and any(px[x + dx, y + dy][3] == 0 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
        for x, y in peel:
            px[x, y] = (0, 0, 0, 0)
    im.save(path)
    print('cleared', sum(seen), 'px of', w * h)


if __name__ == '__main__':
    main(sys.argv[1])
