// Static map: terrain grid, solid tiles and placed objects. Pure data, no DOM.

export const TILE = 32;
export const MAP_W = 50;
export const MAP_H = 36;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const HOUSE = { x: 8, y: 5, w: 6, h: 4, door: { x: 11, y: 8 } };
export const BIN = { x: 14, y: 8, w: 2, h: 1 };
export const STALL = { x: 38, y: 7, w: 3, h: 2 };
export const FARM = { x: 18, y: 14, w: 16, h: 12 };
export const POND = { cx: 9.5, cy: 25, rx: 5.2, ry: 3.6 };
export const START = { x: 11 * TILE + 16, y: 10 * TILE + 8 };

export function buildWorld(seed = 7) {
  const r = rng(seed);
  const terrain = Array.from({ length: MAP_H }, () => Array(MAP_W).fill('grass'));
  const solid = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(false));
  const objects = [];
  const reserved = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(false));
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) terrain[y][x] = t; };
  const reserve = (x0, y0, w, h, pad = 0) => {
    for (let y = y0 - pad; y < y0 + h + pad; y++) for (let x = x0 - pad; x < x0 + w + pad; x++)
      if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) reserved[y][x] = true;
  };
  const block = (x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) solid[y][x] = true;
  };

  // Farm field and its fence ring, with gaps at the top and on the left.
  for (let y = FARM.y; y < FARM.y + FARM.h; y++) for (let x = FARM.x; x < FARM.x + FARM.w; x++) set(x, y, 'farm');
  const fx0 = FARM.x - 1, fx1 = FARM.x + FARM.w, fy0 = FARM.y - 1, fy1 = FARM.y + FARM.h;
  const gaps = new Set(['25,' + fy0, '26,' + fy0, fx0 + ',19', fx0 + ',20']);
  for (let x = fx0; x <= fx1; x++) for (const y of [fy0, fy1]) if (!gaps.has(x + ',' + y)) objects.push({ type: 'fence', x, y });
  for (let y = fy0 + 1; y < fy1; y++) for (const x of [fx0, fx1]) if (!gaps.has(x + ',' + y)) objects.push({ type: 'fence', x, y });
  reserve(fx0, fy0, fx1 - fx0 + 1, fy1 - fy0 + 1, 1);

  // Pond: a wobbly ellipse.
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const dx = (x + 0.5 - POND.cx) / POND.rx, dy = (y + 0.5 - POND.cy) / POND.ry;
    const wobble = 0.12 * Math.sin(Math.atan2(dy, dx) * 3 + 1.3);
    if (dx * dx + dy * dy < 1 + wobble) { set(x, y, 'water'); solid[y][x] = true; }
  }
  reserve(Math.floor(POND.cx - POND.rx) - 1, Math.floor(POND.cy - POND.ry) - 1, Math.ceil(POND.rx * 2) + 3, Math.ceil(POND.ry * 2) + 3);

  // Paths.
  const path = (x0, y0, x1, y1, wdt = 2) => {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
        for (let k = 0; k < wdt; k++) set(y0 === y1 ? x : x + k, y0 === y1 ? y + k : y, 'path');
  };
  path(10, 9, 10, 12);
  path(10, 11, 41, 11);
  path(25, 11, 25, 13);
  path(38, 9, 38, 11);
  path(6, 19, 16, 19);
  path(10, 11, 10, 19);
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (terrain[y][x] === 'path') reserved[y][x] = true;

  objects.push({ type: 'house', ...HOUSE });
  block(HOUSE.x, HOUSE.y, HOUSE.w, HOUSE.h);
  reserve(HOUSE.x, HOUSE.y - 3, HOUSE.w, HOUSE.h + 3, 1);
  objects.push({ type: 'bin', ...BIN });
  block(BIN.x, BIN.y, BIN.w, BIN.h);
  reserve(BIN.x, BIN.y, BIN.w, BIN.h, 1);
  objects.push({ type: 'stall', ...STALL });
  block(STALL.x, STALL.y, STALL.w, STALL.h);
  reserve(STALL.x, STALL.y - 2, STALL.w, STALL.h + 2, 1);
  reserve(START.x / TILE | 0, START.y / TILE | 0, 1, 1, 1);

  const place = (type, x, y, extra = {}) => {
    objects.push({ type, x, y, ...extra });
    solid[y][x] = true;
    reserved[y][x] = true;
  };
  // Dense tree border.
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const edge = Math.min(x, y, MAP_W - 1 - x, MAP_H - 1 - y);
    if (edge === 0) solid[y][x] = true;
    if (edge <= 1 && (x + y) % 2 === (edge === 0 ? 0 : 1) && !reserved[y][x]) place('tree', x, y, { v: (r() * 3) | 0 });
  }
  const free = (x, y, pad) => {
    for (let yy = y - pad; yy <= y + pad; yy++) for (let xx = x - pad; xx <= x + pad; xx++) {
      if (xx < 2 || yy < 2 || xx >= MAP_W - 2 || yy >= MAP_H - 2) return false;
      if (reserved[yy][xx] || terrain[yy][xx] !== 'grass') return false;
    }
    return true;
  };
  const scatter = (type, n, pad, tries = 800) => {
    for (let i = 0, t = 0; i < n && t < tries; t++) {
      const x = 2 + ((r() * (MAP_W - 4)) | 0), y = 3 + ((r() * (MAP_H - 5)) | 0);
      if (!free(x, y, pad)) continue;
      place(type, x, y, { v: (r() * 3) | 0 });
      i++;
    }
  };
  scatter('tree', 26, 1);
  scatter('bush', 16, 0);
  scatter('rock', 12, 0);
  scatter('stump', 4, 0);
  for (const o of objects) if (o.type === 'fence') solid[o.y][o.x] = true;

  // Decorative flowers (walkable).
  const flowers = [];
  for (let y = 2; y < MAP_H - 2; y++) for (let x = 2; x < MAP_W - 2; x++)
    if (terrain[y][x] === 'grass' && !solid[y][x] && hash(x, y, 3) < 0.07) flowers.push({ x, y, v: (hash(x, y, 4) * 4) | 0 });

  return { w: MAP_W, h: MAP_H, terrain, solid, objects, flowers };
}

export function isSolidAt(world, px, py) {
  const x = Math.floor(px / TILE), y = Math.floor(py / TILE);
  if (x < 0 || y < 0 || x >= world.w || y >= world.h) return true;
  return world.solid[y][x];
}
