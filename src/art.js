// Procedural pixel art: terrain, objects, crops and item icons, drawn once at load.
// Everything is painted pixel by pixel into a Uint32 buffer, then copied to a canvas.
import { TILE as T, hash, rng } from './world.js';
import { LOOKS } from './model.js';

export const PAL = {
  outline: '#3a2320',
  grass: ['#3f7a33', '#4f8f3a', '#62a645', '#7bbd52', '#9ad468'],
  path: ['#7d5634', '#a67848', '#b98a55', '#cc9f68', '#dcb67f'],
  farm: ['#6e4627', '#915f38', '#a26e42', '#b58050'],
  water: ['#2c6a9e', '#3479b0', '#3f8fc4', '#5fb0dc', '#9ad6ee', '#d8f4fc'],
  bank: ['#5e3d24', '#7a5232', '#946540'],
  leaf: ['#2a5530', '#376e35', '#4b8c3c', '#68ab48', '#8cc75c'],
  leafY: ['#3d5a28', '#55762e', '#729637', '#93b445', '#b5cf5e'],
  leafD: ['#22472f', '#2d5d38', '#3c7842', '#51954d', '#6db45c'],
  wood: ['#4a2c1c', '#6b4226', '#8c5a33', '#a8703f', '#c48a52'],
  stone: ['#4d4c57', '#6a6a78', '#8a8c9b', '#acaebc', '#cfd1da'],
  roof: ['#5e2224', '#7f2f2c', '#a33f35', '#c4553f', '#de7651'],
};

const colorCache = new Map();
function rgba(hex) {
  let v = colorCache.get(hex);
  if (v === undefined) {
    let h = hex.slice(1);
    if (h.length <= 4) h = [...h].map((ch) => ch + ch).join('');
    if (h.length === 6) h += 'ff';
    const n = parseInt(h, 16);
    const r = (n >>> 24) & 255, g = (n >>> 16) & 255, b = (n >>> 8) & 255, a = n & 255;
    v = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
    colorCache.set(hex, v);
  }
  return v;
}

export class Pix {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint32Array(w * h); }
  set(x, y, c) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.d[y * this.w + x] = rgba(c);
  }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  has(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h && this.d[y * this.w + x] >>> 24 !== 0; }
  get(x, y) { return this.d[y * this.w + x]; }
  outline(c = PAL.outline) {
    const add = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++)
      if (!this.has(x, y) && (this.has(x - 1, y) || this.has(x + 1, y) || this.has(x, y - 1) || this.has(x, y + 1))) add.push([x, y]);
    for (const [x, y] of add) this.set(x, y, c);
    return this;
  }
  canvas() {
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(this.d.buffer.slice(0)), this.w, this.h), 0, 0);
    return c;
  }
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];

function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Shade a union of ellipses lit from the top-left. Later shapes sit in front.
// shapes: [cx, cy, rx, ry?]
function blob(p, shapes, pal, { noise = 0.22, seed = 1, dx = 0, dy = 0, light = [-0.5, -0.85], seams = true } = {}) {
  const owner = new Int16Array(p.w * p.h).fill(-1);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    for (let i = shapes.length - 1; i >= 0; i--) {
      const [cx, cy, rx, ry = rx] = shapes[i];
      const ox = (x + 0.5 - cx - dx) / rx, oy = (y + 0.5 - cy - dy) / ry;
      if (ox * ox + oy * oy > 1) continue;
      owner[y * p.w + x] = i;
      let t = -(ox * light[0] + oy * light[1]) * 0.9 + 0.5 * (1 - (ox * ox + oy * oy)) * 0.35;
      t += (hash(x, y, seed) - 0.5) * noise + (bayer(x, y) - 0.5) * 0.18;
      const idx = Math.max(0, Math.min(pal.length - 1, Math.floor((t * 0.5 + 0.5) * pal.length)));
      p.set(x, y, pal[idx]);
      break;
    }
  }
  if (!seams) return owner;
  // Dark seam where a front lump overlaps the lump behind it.
  for (let y = 1; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const o = owner[y * p.w + x], up = owner[(y - 1) * p.w + x];
    if (o >= 0 && up >= 0 && up > o) p.set(x, y, pal[0]);
  }
  return owner;
}

// ---------------------------------------------------------------- terrain

const LIP_FROM = { grass: PAL.grass };

export function paintTerrain(world) {
  const W = world.w * T, H = world.h * T;
  const p = new Pix(W, H);
  const type = (x, y) => (x < 0 || y < 0 || x >= world.w || y >= world.h ? 'grass' : world.terrain[y][x]);

  // Distance from land for each water tile, to darken the middle of the pond.
  const depth = world.terrain.map((row) => row.map((t) => (t === 'water' ? 99 : 0)));
  for (let pass = 0; pass < 4; pass++)
    for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) if (depth[y][x])
      depth[y][x] = Math.min(depth[y][x], 1 + Math.min(depth[y - 1]?.[x] ?? 0, depth[y + 1]?.[x] ?? 0, depth[y][x - 1] ?? 0, depth[y][x + 1] ?? 0));

  // Bilinear depth between tile centres, so the deep water has no square edges.
  const dep = (x, y) => Math.min(4, depth[y]?.[x] ?? 0);
  const depthAt = (px, py) => {
    const fx = px / T - 0.5, fy = py / T - 0.5, x = Math.floor(fx), y = Math.floor(fy), u = fx - x, v = fy - y;
    return (dep(x, y) * (1 - u) + dep(x + 1, y) * u) * (1 - v) + (dep(x, y + 1) * (1 - u) + dep(x + 1, y + 1) * u) * v;
  };
  const lipDepth = (along, line) => 1 + Math.floor(vnoise(along / 5, line * 1.7, 9) * 4);

  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const tx = (px / T) | 0, ty = (py / T) | 0, lx = px - tx * T, ly = py - ty * T;
    const t = type(tx, ty);
    const n = 0.65 * vnoise(px / 48, py / 48, 1) + 0.35 * vnoise(px / 13, py / 13, 2) + (bayer(px, py) - 0.5) * 0.07;
    let c;
    if (t === 'grass') c = PAL.grass[n < 0.36 ? 1 : n < 0.68 ? 2 : 3];
    else if (t === 'path') c = PAL.path[n < 0.34 ? 1 : n < 0.7 ? 2 : 3];
    else if (t === 'farm') c = PAL.farm[n < 0.34 ? 1 : n < 0.7 ? 2 : 3];
    else {
      // Darker towards the middle of the pond, with a soft noisy edge.
      const d = depthAt(px, py) + vnoise(px / 9, py / 9, 12) * 1.2 - 0.6;
      c = d > 3 ? PAL.water[0] : d > 2 ? PAL.water[1] : PAL.water[n < 0.25 ? 1 : 2];
    }
    if (t !== 'grass') {
      const isLand = (k) => (t === 'water' ? k !== 'water' : k === 'grass');
      const sides = [
        ['top', type(tx, ty - 1), ly, px, ty * 2],
        ['bottom', type(tx, ty + 1), T - 1 - ly, px, ty * 2 + 2],
        ['left', type(tx - 1, ty), lx, py, tx * 2 + 101],
        ['right', type(tx + 1, ty), T - 1 - lx, py, tx * 2 + 103],
      ];
      let best = null;
      for (const [side, nt, d, along, line] of sides) {
        if (!isLand(nt)) continue;
        const L = lipDepth(along, line);
        const lipPal = LIP_FROM[nt] || PAL[nt] || PAL.grass;
        let col = null;
        if (d < L) col = d === L - 1 ? lipPal[1] : lipPal[2];
        else if (t === 'water') {
          if (side === 'top' && d < L + 7) col = d === L ? PAL.outline : d === L + 1 ? PAL.bank[2] : d < L + 6 ? PAL.bank[d < L + 4 ? 1 : 0] : PAL.water[5];
          else if (side !== 'top' && d === L) col = PAL.outline;
          else if (side !== 'top' && d === L + 1) col = PAL.water[4];
        } else if (d === L && (side === 'top' || side === 'left')) col = PAL[t][0];
        if (col && (!best || d < best.d)) best = { d, col };
      }
      // Rounded inner corners where only the diagonal neighbour is land.
      for (const [cx, cy, ox, oy] of [[-1, -1, 0, 0], [1, -1, T, 0], [-1, 1, 0, T], [1, 1, T, T]]) {
        if (!isLand(type(tx + cx, ty + cy)) || isLand(type(tx + cx, ty)) || isLand(type(tx, ty + cy))) continue;
        const r2 = (lx + 0.5 - ox) ** 2 + (ly + 0.5 - oy) ** 2;
        if (r2 < 9) best = { d: 0, col: PAL.grass[2] };
        else if (r2 < 16 && !best) best = { d: 1, col: t === 'water' ? PAL.water[4] : PAL[t][0] };
      }
      if (best) c = best.col;
    }
    p.set(px, py, c);
  }

  // Grass tufts, path pebbles, dirt clods.
  const r = rng(5);
  for (let ty = 0; ty < world.h; ty++) for (let tx = 0; tx < world.w; tx++) {
    const t = type(tx, ty);
    const n = t === 'grass' ? 5 : t === 'path' ? 2 : t === 'farm' ? 3 : 0;
    for (let i = 0; i < n; i++) {
      const x = tx * T + 3 + ((r() * (T - 6)) | 0), y = ty * T + 4 + ((r() * (T - 6)) | 0);
      if (t === 'grass') tuft(p, x, y, r() < 0.5);
      else if (t === 'path') { p.set(x, y, PAL.path[4]); p.set(x + 1, y, PAL.path[3]); p.set(x, y + 1, PAL.path[0]); p.set(x + 1, y + 1, PAL.path[0]); }
      else if (t === 'farm') { p.set(x, y, PAL.farm[3]); p.set(x + 1, y, PAL.farm[3]); p.set(x, y + 1, PAL.farm[0]); p.set(x + 1, y + 1, PAL.farm[0]); }
    }
  }
  for (const f of world.flowers) flower(p, f.x * T + 6 + ((hash(f.x, f.y, 8) * 18) | 0), f.y * T + 8 + ((hash(f.x, f.y, 9) * 16) | 0), f.v);
  return p.canvas();
}

function tuft(p, x, y, tall) {
  const g = PAL.grass;
  p.set(x, y, g[1]); p.set(x + 1, y, g[1]); p.set(x + 2, y, g[1]); p.set(x + 3, y, g[1]);
  p.set(x, y - 1, g[3]); p.set(x + 2, y - 1, g[3]); p.set(x + 3, y - 1, g[4]);
  if (tall) { p.set(x + 1, y - 2, g[4]); p.set(x + 1, y - 1, g[3]); p.set(x + 3, y - 2, g[4]); }
}

const PETALS = [['#f4f1e6', '#d9d2c0'], ['#f6c94a', '#d9a530'], ['#ef8fb1', '#cf6a93'], ['#8db5f0', '#6a8fd0']];
function flower(p, x, y, v) {
  const [a, b] = PETALS[v % PETALS.length];
  p.set(x, y + 2, PAL.grass[0]); p.set(x, y + 3, PAL.grass[1]);
  p.set(x - 1, y, a); p.set(x + 1, y, b); p.set(x, y - 1, a); p.set(x, y + 1, b);
  p.set(x, y, '#f7d65a');
}

// Water shimmer frames are drawn live in render.js; these are the colours it uses.
export const SHIMMER = [PAL.water[3], PAL.water[4]];

// ---------------------------------------------------------------- objects

function tree(v) {
  const p = new Pix(72, 96);
  const pal = [PAL.leaf, PAL.leafY, PAL.leafD][v % 3];
  // trunk with a root flare
  for (let y = 58; y < 92; y++) {
    const flare = y > 84 ? (y - 84) : 0;
    for (let x = 30 - flare; x < 42 + flare; x++) {
      const k = (x - (30 - flare)) / (12 + 2 * flare);
      p.set(x, y, k < 0.25 ? PAL.wood[3] : k < 0.7 ? PAL.wood[2] : PAL.wood[1]);
    }
  }
  for (const [x, y0, y1] of [[34, 64, 72], [38, 74, 82], [33, 80, 88]]) for (let y = y0; y < y1; y++) p.set(x, y, PAL.wood[1]);
  const canopy = [
    [36, 22, 18, 16], [19, 32, 14, 13], [53, 32, 14, 13],
    [24, 47, 15, 12], [48, 47, 15, 12], [36, 40, 17, 15], [36, 55, 13, 9],
  ];
  blob(p, canopy, pal, { seed: 11 + v });
  if (v === 2) for (const [x, y] of [[24, 30], [46, 26], [40, 44], [28, 50], [52, 46], [34, 22]]) {
    p.rect(x, y, 3, 3, '#d8443a'); p.set(x, y, '#f08a6e'); p.set(x + 2, y + 2, '#8e2a26');
  }
  return p.outline();
}

function bush(v) {
  const p = new Pix(36, 30);
  blob(p, [[11, 18, 9, 8], [25, 18, 9, 8], [18, 12, 11, 9], [18, 20, 10, 7]], v === 1 ? PAL.leafD : PAL.leaf, { seed: 30 + v });
  if (v !== 1) {
    const berry = v === 0 ? ['#d8443a', '#f08a6e'] : ['#f4f1e6', '#f7d65a'];
    for (const [x, y] of [[9, 15], [20, 9], [26, 17], [15, 21], [23, 23]]) { p.set(x, y, berry[0]); p.set(x + 1, y, berry[0]); p.set(x, y - 1, berry[1]); }
  }
  return p.outline();
}

function rock(v) {
  const p = new Pix(30, 24);
  blob(p, v === 1 ? [[11, 15, 9, 7], [20, 14, 8, 8]] : [[15, 14, 12, 8], [12, 11, 7, 6]], PAL.stone, { seed: 50 + v, noise: 0.3 });
  for (const [x, y] of [[9, 14], [10, 15], [19, 11]]) p.set(x, y, PAL.stone[1]);
  if (v === 2) for (const [x, y] of [[8, 18], [9, 18], [14, 19], [21, 17], [20, 18]]) p.set(x, y, PAL.leaf[3]);
  return p.outline();
}

function stump() {
  const p = new Pix(32, 26);
  for (let y = 9; y < 23; y++) for (let x = 5; x < 27; x++) {
    const k = (x - 5) / 22;
    p.set(x, y, k < 0.2 ? PAL.wood[3] : k < 0.75 ? PAL.wood[2] : PAL.wood[1]);
  }
  for (let y = 0; y < 26; y++) for (let x = 0; x < 32; x++) {
    const ex = (x + 0.5 - 16) / 11, ey = (y + 0.5 - 9) / 5.5;
    const r2 = ex * ex + ey * ey;
    if (r2 <= 1) p.set(x, y, r2 > 0.75 ? PAL.wood[2] : (Math.floor(Math.sqrt(r2) * 4) % 2 ? '#d9a66a' : '#e8bd84'));
    const bx = (x + 0.5 - 16) / 11, by = (y + 0.5 - 22) / 3.5;
    if (y >= 22 && bx * bx + by * by <= 1) p.set(x, y, PAL.wood[1]);
  }
  return p.outline();
}

// connections: { l, r, u }
export function fence({ l, r, u }) {
  const p = new Pix(32, 44);
  const W = PAL.wood;
  const rail = (x0, x1, y) => { for (let x = x0; x < x1; x++) { p.set(x, y, W[3]); p.set(x, y + 1, W[2]); p.set(x, y + 2, W[1]); } };
  if (l) { rail(0, 14, 22); rail(0, 14, 31); }
  if (r) { rail(18, 32, 22); rail(18, 32, 31); }
  if (u) for (let y = 0; y < 18; y++) { p.set(14, y, W[3]); p.set(15, y, W[2]); p.set(16, y, W[2]); p.set(17, y, W[1]); }
  for (let y = 15; y < 41; y++) for (let x = 12; x < 20; x++) p.set(x, y, x < 14 ? W[4] : x < 18 ? W[3] : W[2]);
  p.rect(12, 15, 8, 2, W[4]);
  p.set(12, 15, '#0000'); p.set(19, 15, '#0000');
  p.set(15, 26, W[1]); p.set(16, 27, W[1]);
  p.outline();
  return p;
}

function house(lit) {
  const W = 200, H = 204;
  const p = new Pix(W, H);
  const wd = PAL.wood;
  // facade planks
  for (let y = 100; y < 196; y++) for (let x = 8; x < 192; x++) {
    const row = (y - 100) % 8;
    const seam = (x + ((y - 100) >> 3) * 23) % 46 === 0;
    p.set(x, y, row === 7 || seam ? '#9a6236' : row === 0 ? '#e0a865' : (hash(x >> 2, y >> 3, 4) < 0.5 ? '#cf9356' : '#c88b4f'));
  }
  // corner posts
  for (const x0 of [8, 184]) for (let y = 96; y < 196; y++) for (let x = x0; x < x0 + 8; x++) p.set(x, y, x - x0 < 2 ? wd[4] : x - x0 < 6 ? wd[3] : wd[2]);
  // stone foundation
  for (let y = 190; y < 200; y++) for (let x = 6; x < 194; x++) {
    const brick = ((x + (y > 194 ? 6 : 0)) % 12 === 0) || y === 194 || y === 199;
    p.set(x, y, brick ? PAL.stone[1] : y < 192 ? PAL.stone[4] : PAL.stone[3]);
  }
  // roof face with shingles
  for (let y = 18; y < 104; y++) {
    const inset = Math.max(0, Math.round((40 - y) * 0.55));
    for (let x = inset; x < W - inset; x++) {
      const row = (y - 18) % 10, col = (x + (((y - 18) / 10) | 0) % 2 * 7) % 14;
      let c = row < 2 ? PAL.roof[4] : row > 7 ? PAL.roof[1] : PAL.roof[3];
      if (col === 0 && row < 8) c = PAL.roof[1];
      if (row === 9) c = PAL.roof[0];
      if (y > 96) c = y > 100 ? PAL.roof[0] : PAL.roof[1];
      if (hash(x >> 1, y, 6) < 0.05 && row > 1 && row < 8) c = PAL.roof[2];
      p.set(x, y, c);
    }
  }
  // ridge cap
  for (let x = 22; x < W - 22; x++) { p.set(x, 18, PAL.roof[4]); p.set(x, 19, '#f19773'); p.set(x, 20, PAL.roof[4]); }
  // chimney
  for (let y = 0; y < 34; y++) for (let x = 140; x < 160; x++) {
    const brick = y % 6 === 5 || (x + ((y / 6) | 0) % 2 * 5) % 10 === 0;
    p.set(x, y, y < 4 ? PAL.stone[1] : brick ? PAL.stone[1] : x < 145 ? PAL.stone[4] : PAL.stone[3]);
  }
  // eave shadow on the facade
  for (let x = 8; x < 192; x++) { p.set(x, 104, '#7a4a28'); p.set(x, 105, '#8f5a31'); }
  // door
  const dx = 104;
  for (let y = 146; y < 192; y++) for (let x = dx; x < dx + 26; x++) {
    const frame = x < dx + 3 || x >= dx + 23 || y < 149;
    p.set(x, y, frame ? wd[1] : (x - dx) % 7 === 3 ? wd[1] : y < 152 ? wd[3] : wd[2]);
  }
  p.rect(dx + 18, 170, 3, 3, '#f2c94c'); p.set(dx + 18, 170, '#fff2b0');
  for (let x = dx - 2; x < dx + 28; x++) p.set(x, 145, wd[0]);
  // windows with flower boxes
  for (const wx of [32, 144]) {
    for (let y = 124; y < 154; y++) for (let x = wx; x < wx + 30; x++) {
      const frame = x < wx + 3 || x >= wx + 27 || y < 127 || y >= 151 || x === wx + 14 || x === wx + 15 || y === 138;
      let glass = lit ? (y < 139 ? '#ffe9a0' : '#ffd36e') : ((x - wx) + (y - 124) < 18 && (x - wx) + (y - 124) > 12 ? '#d7f1fb' : y < 139 ? '#9fd4ec' : '#7cbcdc');
      p.set(x, y, frame ? '#f3e6c8' : glass);
    }
    for (let x = wx - 2; x < wx + 32; x++) { p.set(x, 123, PAL.outline); p.set(x, 154, PAL.outline); }
    for (let y = 155; y < 163; y++) for (let x = wx - 2; x < wx + 32; x++) p.set(x, y, y === 155 ? wd[4] : y > 160 ? wd[1] : wd[2]);
    for (let i = 0; i < 6; i++) {
      const fx = wx + 1 + i * 5, c = ['#e0453a', '#f6c94a', '#f4f1e6'][i % 3];
      p.set(fx, 153, PAL.leaf[3]); p.set(fx + 2, 153, PAL.leaf[2]); p.set(fx + 1, 152, c); p.set(fx, 151, c); p.set(fx + 2, 151, c); p.set(fx + 1, 150, c); p.set(fx + 1, 151, '#fff3b0');
    }
  }
  // doormat
  for (let y = 196; y < 202; y++) for (let x = dx - 2; x < dx + 28; x++) p.set(x, y, (x + y) % 4 < 2 ? '#b8664a' : '#9c5038');
  return p.outline();
}

function bin() {
  const p = new Pix(64, 44);
  const wd = PAL.wood;
  for (let y = 16; y < 42; y++) for (let x = 2; x < 62; x++) {
    const plank = (y - 16) % 9 === 8;
    p.set(x, y, plank ? wd[1] : x < 5 ? wd[3] : x > 58 ? wd[1] : wd[2]);
  }
  for (let y = 6; y < 17; y++) for (let x = 0; x < 64; x++) p.set(x, y, y < 8 ? wd[4] : y > 14 ? wd[1] : wd[3]);
  for (const x0 of [8, 52]) for (let y = 6; y < 42; y++) { p.set(x0, y, PAL.stone[2]); p.set(x0 + 1, y, PAL.stone[3]); p.set(x0 + 2, y, PAL.stone[1]); }
  // produce peeking out under the lid
  for (const [x, c] of [[16, '#f08a3a'], [24, '#e9e2f0'], [32, '#7fc65a'], [40, '#f08a3a']]) { p.rect(x, 3, 6, 4, c); p.set(x, 3, '#fff3d8'); }
  // little coin sign
  for (let y = 22; y < 34; y++) for (let x = 26; x < 38; x++) if ((x - 31.5) ** 2 + (y - 27.5) ** 2 < 30) p.set(x, y, (x - 31.5) ** 2 + (y - 27.5) ** 2 < 14 ? '#f6c94a' : '#c98f22');
  p.rect(31, 25, 1, 6, '#a0701a');
  return p.outline();
}

function stall() {
  const p = new Pix(100, 88);
  const wd = PAL.wood;
  for (const x0 of [6, 88]) for (let y = 14; y < 84; y++) for (let x = x0; x < x0 + 6; x++) p.set(x, y, x - x0 < 2 ? wd[3] : wd[2]);
  // counter
  for (let y = 50; y < 84; y++) for (let x = 2; x < 98; x++) {
    p.set(x, y, y < 54 ? wd[4] : (y - 54) % 10 === 9 ? wd[1] : x % 24 === 0 ? wd[1] : wd[2]);
  }
  // crates of produce on the counter
  const goods = [['#f08a3a', '#c45f1e'], ['#e9e2f0', '#a782c8'], ['#8fd06a', '#5a9a40']];
  for (let i = 0; i < 3; i++) {
    const cx = 12 + i * 28;
    for (let y = 40; y < 52; y++) for (let x = cx; x < cx + 22; x++) p.set(x, y, y === 40 ? wd[4] : wd[2]);
    for (let k = 0; k < 7; k++) {
      const gx = cx + 2 + (k % 4) * 5, gy = 35 + (k > 3 ? 3 : 0);
      p.rect(gx, gy, 5, 5, goods[i][0]); p.set(gx + 4, gy + 4, goods[i][1]); p.set(gx + 1, gy + 1, '#fff8e8');
    }
  }
  // seed packets on the front
  for (let i = 0; i < 4; i++) {
    const sx = 16 + i * 20;
    p.rect(sx, 60, 12, 15, '#f3e6c8');
    p.rect(sx + 2, 63, 8, 7, ['#f08a3a', '#a782c8', '#8fd06a', '#f6c94a'][i]);
  }
  // striped awning with a scalloped edge
  for (let y = 0; y < 30; y++) for (let x = 0; x < 100; x++) {
    const stripe = ((x / 10) | 0) % 2 === 0;
    const scallop = y > 24 && ((x % 10) - 4.5) ** 2 + (y - 24) ** 2 > 30;
    if (scallop) continue;
    const shade = y < 3 ? 2 : y > 21 ? 0 : 1;
    p.set(x, y, stripe ? ['#a8322c', '#d0483c', '#e66a55'][shade] : ['#d8c8a8', '#f3e6c8', '#fff8e6'][shade]);
  }
  return p.outline();
}

// ---------------------------------------------------------------- crops

function leaf(p, x, y, len, dir, pal) {
  // a small tapered leaf going up and to `dir` (-1 left, 1 right, 0 up)
  for (let i = 0; i < len; i++) {
    const lx = x + Math.round(dir * i * 0.7), ly = y - i;
    const wdt = i < 1 || i >= len - 1 ? 1 : 2;
    for (let k = 0; k < wdt; k++) p.set(lx + k * (dir || 1), ly, i < len / 2 ? pal[2] : pal[3]);
  }
}

const CROP_LEAF = { turnip: PAL.leaf, carrot: PAL.leafY, cabbage: ['#3d7a45', '#4f9450', '#6db562', '#93d07e', '#bde6a0'] };

export function cropSprite(kind, stage) {
  const p = new Pix(32, 40);
  const pal = CROP_LEAF[kind];
  const bx = 16, by = 33; // base point (soil line)
  if (stage === 0) {
    for (let x = -3; x <= 3; x++) { p.set(bx + x, by, '#5a341c'); if (Math.abs(x) < 3) p.set(bx + x, by - 1, '#7a4b2a'); }
    p.set(bx - 1, by - 1, '#e8d8a8'); p.set(bx + 1, by, '#e8d8a8');
    return p;
  }
  if (stage === 1) {
    p.set(bx, by, pal[1]); p.set(bx, by - 1, pal[2]); p.set(bx, by - 2, pal[2]);
    leaf(p, bx - 1, by - 3, 3, -1, pal); leaf(p, bx + 1, by - 3, 3, 1, pal);
    return p.outline();
  }
  if (kind === 'turnip') {
    if (stage === 3) {
      blob(p, [[bx, by - 3, 6, 5]], ['#8a5ab0', '#b88ad8', '#ece4f2', '#ffffff'], { light: [-0.4, 0.9], seams: false, noise: 0.1 });
      for (let x = -5; x <= 5; x++) if (p.has(bx + x, by - 6)) p.set(bx + x, by - 6, '#a56fc8');
    }
    const h = stage === 3 ? 10 : 7, top = by - (stage === 3 ? 7 : 1);
    leaf(p, bx - 1, top, h, -1, pal); leaf(p, bx + 1, top, h, 1, pal); leaf(p, bx, top, h + 2, 0, pal);
    if (stage === 3) { leaf(p, bx - 3, top, h - 3, -1, pal); leaf(p, bx + 3, top, h - 3, 1, pal); }
  } else if (kind === 'carrot') {
    if (stage === 3) {
      for (let y = 0; y < 4; y++) for (let x = -3 + (y > 2 ? 1 : 0); x <= 3 - (y > 2 ? 1 : 0); x++)
        p.set(bx + x, by - 1 - 3 + y, x < -1 ? '#ffb26a' : x > 1 ? '#c45f1e' : '#f08a3a');
    }
    const h = stage === 3 ? 13 : 8, top = by - (stage === 3 ? 4 : 1);
    for (const [dx, d, k] of [[-2, -1, 0], [0, -0.3, 2], [2, 1, 0], [-1, -0.6, 3], [1, 0.6, 3]]) {
      for (let i = 0; i < h - k; i++) {
        const x = bx + dx + Math.round(d * i * 0.6), y = top - i;
        p.set(x, y, i % 3 === 2 ? pal[4] : pal[2]);
        if (i % 3 === 1) { p.set(x - 1, y, pal[3]); p.set(x + 1, y, pal[3]); }
      }
    }
  } else if (kind === 'cabbage') {
    if (stage === 2) blob(p, [[bx - 4, by - 4, 5, 4], [bx + 4, by - 4, 5, 4], [bx, by - 6, 5, 5]], pal, { seed: 71 });
    else blob(p, [[bx - 7, by - 5, 6, 5], [bx + 7, by - 5, 6, 5], [bx, by - 7, 10, 8], [bx, by - 6, 6, 5]], pal, { seed: 72 });
    if (stage === 3) for (let i = 0; i < 5; i++) p.set(bx, by - 11 + i, pal[1]);
  }
  return p.outline();
}

// Tilled soil. mask bits: 1 up, 2 right, 4 down, 8 left = neighbour also tilled.
export function soil(mask, watered) {
  const p = new Pix(32, 32);
  const c = watered ? ['#3a2213', '#4e2f1b', '#5e3a22', '#704829'] : ['#5a341c', '#734527', '#87542f', '#9c6539'];
  const t = mask & 1 ? 0 : 2, r = mask & 2 ? 32 : 30, b = mask & 4 ? 32 : 30, l = mask & 8 ? 0 : 2;
  for (let y = t; y < b; y++) for (let x = l; x < r; x++) {
    const corner = (x === l && y === t && !(mask & 9)) || (x === r - 1 && y === t && !(mask & 3)) ||
      (x === l && y === b - 1 && !(mask & 12)) || (x === r - 1 && y === b - 1 && !(mask & 6));
    if (corner) continue;
    const row = y % 8;
    let col = row === 0 ? c[3] : row === 6 ? c[0] : row === 7 ? c[1] : c[2];
    if (hash(x, y, watered ? 21 : 20) < 0.08) col = c[row === 0 ? 2 : 3];
    if (y === b - 1 && !(mask & 4)) col = c[0];
    p.set(x, y, col);
  }
  if (watered) for (const [x, y] of [[7, 3], [20, 11], [12, 19], [25, 27]]) { p.set(x, y, '#8a6a52'); p.set(x + 1, y, '#6e5240'); }
  return p.canvas();
}

// ---------------------------------------------------------------- icons (16x16)

function icon(draw) {
  const p = new Pix(16, 16);
  draw(p);
  return p.outline().canvas();
}

const ICON_DRAW = {
  hoe: (p) => {
    for (let i = 0; i < 11; i++) { p.set(3 + i, 14 - i, PAL.wood[3]); p.set(4 + i, 14 - i, PAL.wood[2]); }
    p.rect(9, 2, 6, 3, PAL.stone[3]); p.rect(9, 4, 6, 1, PAL.stone[1]); p.rect(9, 2, 6, 1, PAL.stone[4]);
  },
  can: (p) => {
    for (let y = 6; y < 14; y++) for (let x = 3; x < 11; x++) p.set(x, y, x < 5 ? '#8fd3ef' : x > 8 ? '#2f7fae' : '#4aa3c9');
    for (let x = 4; x < 10; x++) p.set(x, 5, '#2f7fae');
    for (let i = 0; i < 4; i++) { p.set(11 + i, 9 - i, '#3d8cc2'); p.set(11 + i, 10 - i, '#2f7fae'); }
    p.set(15, 5, '#8fd3ef');
    for (let x = 4; x < 10; x++) p.set(x, 3, PAL.stone[2]); p.set(3, 4, PAL.stone[2]); p.set(10, 4, PAL.stone[2]);
  },
};
const SEED_TINT = { turnip: '#a782c8', carrot: '#f08a3a', cabbage: '#7fc65a' };
for (const kind of Object.keys(SEED_TINT)) {
  ICON_DRAW['seed:' + kind] = (p) => {
    for (let y = 4; y < 15; y++) for (let x = 3; x < 13; x++) p.set(x, y, x < 5 ? '#efdcae' : x > 10 ? '#b9996a' : '#d8bf8a');
    for (let x = 4; x < 12; x++) p.set(x, 3, '#b9996a');
    p.set(6, 2, '#b9996a'); p.set(9, 2, '#b9996a');
    p.rect(5, 7, 6, 5, SEED_TINT[kind]); p.set(6, 8, '#fff3d8');
  };
  ICON_DRAW['crop:' + kind] = (p) => {
    const s = cropSprite(kind, 3);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (s.has(x + 8, y + 20)) p.d[y * 16 + x] = s.get(x + 8, y + 20);
    // strip the old outline so icon() can redraw a clean one
    for (let i = 0; i < p.d.length; i++) if (p.d[i] === rgba(PAL.outline)) p.d[i] = 0;
  };
}

// ---------------------------------------------------------------- loading

export async function loadArt(world) {
  const chars = {};
  await Promise.all(LOOKS.map(async (name) => {
    const img = new Image();
    img.src = new URL(`../assets/${name}.png`, import.meta.url).href;
    const meta = await fetch(new URL(`../assets/${name}.json`, import.meta.url)).then((r) => r.json());
    await img.decode();
    chars[name] = { img, meta };
    // Optional tool animation sheet, e.g. assets/maple-hoe.png
    try {
      const r = await fetch(new URL(`../assets/${name}-hoe.json`, import.meta.url));
      if (r.ok) {
        const hoe = new Image();
        hoe.src = new URL(`../assets/${name}-hoe.png`, import.meta.url).href;
        const hm = await r.json();
        await hoe.decode();
        chars[name].hoe = { img: hoe, meta: hm };
      }
    } catch { /* no hoe animation: the icon swing is used */ }
  }));
  const crops = {};
  for (const kind of ['turnip', 'carrot', 'cabbage']) crops[kind] = [0, 1, 2, 3].map((s) => cropSprite(kind, s).canvas());
  const fences = {};
  for (let m = 0; m < 8; m++) fences[m] = fence({ l: m & 1, r: m & 2, u: m & 4 }).canvas();
  const soils = { dry: [], wet: [] };
  for (let m = 0; m < 16; m++) { soils.dry[m] = soil(m, false); soils.wet[m] = soil(m, true); }
  const icons = {};
  for (const [id, draw] of Object.entries(ICON_DRAW)) icons[id] = icon(draw);
  return {
    chars,
    terrain: paintTerrain(world),
    trees: [0, 1, 2].map((v) => tree(v).canvas()),
    bushes: [0, 1, 2].map((v) => bush(v).canvas()),
    rocks: [0, 1, 2].map((v) => rock(v).canvas()),
    stump: stump().canvas(),
    fences,
    house: house(false).canvas(),
    houseLit: house(true).canvas(),
    bin: bin().canvas(),
    stall: stall().canvas(),
    crops,
    soils,
    icons,
  };
}
