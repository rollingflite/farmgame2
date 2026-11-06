// Game state and rules. No DOM, so it runs under `node --test`.
import { TILE, FARM, START, rng } from './world.js';

export const SAVE_VERSION = 1;
export const DAY_START = 6 * 60;
export const PASS_OUT = 26 * 60; // 02:00 the next morning
export const SLOTS = 9;
export const LOOKS = ['farmer', 'girl'];

export const CROPS = {
  turnip: { name: '순무', days: 3, seed: 20, sell: 60 },
  carrot: { name: '당근', days: 4, seed: 30, sell: 95 },
  cabbage: { name: '양배추', days: 6, seed: 55, sell: 190 },
};

export const COST = { hoe: 2, can: 1 };
export const CAN_MAX = 20;

export function itemName(id) {
  if (id === 'hoe') return '괭이';
  if (id === 'can') return '물뿌리개';
  const [kind, crop] = id.split(':');
  if (kind === 'seed') return CROPS[crop].name + ' 씨앗';
  if (kind === 'crop') return CROPS[crop].name;
  return id;
}

export function newGame() {
  const inv = Array(SLOTS).fill(null);
  inv[0] = { id: 'hoe', n: 1 };
  inv[1] = { id: 'can', n: 1 };
  inv[2] = { id: 'seed:turnip', n: 12 };
  return {
    version: SAVE_VERSION,
    day: 1,
    minutes: DAY_START,
    money: 150,
    energy: 100,
    maxEnergy: 100,
    water: CAN_MAX,
    weather: 'sun',
    player: { x: START.x, y: START.y, dir: 'south' },
    look: 'farmer',
    inventory: inv,
    selected: 0,
    tiles: {},
    shipped: [],
    report: null,
    stats: { harvested: 0, earned: 0 },
  };
}

const key = (x, y) => x + ',' + y;
export const tileAt = (s, x, y) => s.tiles[key(x, y)];
export const isFarmland = (x, y) => x >= FARM.x && y >= FARM.y && x < FARM.x + FARM.w && y < FARM.y + FARM.h;

export function cropStage(crop) {
  const days = CROPS[crop.kind].days;
  if (crop.age >= days) return 3;
  if (crop.age === 0) return 0;
  return crop.age * 2 < days ? 1 : 2;
}
export const isRipe = (crop) => crop.age >= CROPS[crop.kind].days;

export function count(s, id) {
  return s.inventory.reduce((n, it) => n + (it && it.id === id ? it.n : 0), 0);
}

export function addItem(s, id, n = 1) {
  const slot = s.inventory.find((it) => it && it.id === id);
  if (slot) { slot.n += n; return true; }
  const i = s.inventory.indexOf(null);
  if (i < 0) return false;
  s.inventory[i] = { id, n };
  return true;
}

export function removeItem(s, id, n = 1) {
  if (count(s, id) < n) return false;
  for (let i = 0; i < s.inventory.length && n > 0; i++) {
    const it = s.inventory[i];
    if (!it || it.id !== id) continue;
    const take = Math.min(n, it.n);
    it.n -= take; n -= take;
    if (it.n === 0) s.inventory[i] = null;
  }
  return true;
}

// Act on tile (x, y) with the selected item. `isWater(x, y)` comes from the world.
// Returns { ok, msg?, fx? } where fx names the effect the renderer should play.
export function useOn(s, x, y, isWater) {
  const tile = tileAt(s, x, y);
  if (tile && tile.crop && isRipe(tile.crop)) {
    const id = 'crop:' + tile.crop.kind;
    if (!addItem(s, id)) return { ok: false, msg: '가방이 꽉 찼어요.' };
    tile.crop = null;
    s.stats.harvested++;
    return { ok: true, fx: 'harvest', item: id };
  }
  const item = s.inventory[s.selected];
  if (!item) return { ok: false };
  if (item.id === 'can' && isWater(x, y)) {
    if (s.water === CAN_MAX) return { ok: false, msg: '물뿌리개가 이미 가득 찼어요.' };
    s.water = CAN_MAX;
    return { ok: true, fx: 'refill', msg: '물을 가득 채웠어요.' };
  }
  if (item.id === 'hoe' || item.id === 'can') {
    if (s.energy < COST[item.id]) return { ok: false, msg: '너무 지쳤어요. 집에 가서 쉬세요.' };
  }
  if (item.id === 'hoe') {
    if (!isFarmland(x, y)) return { ok: false, msg: '밭에서만 땅을 갈 수 있어요.' };
    if (tile && tile.crop) return { ok: false };
    if (tile) return { ok: false };
    s.tiles[key(x, y)] = { watered: s.weather === 'rain', crop: null };
    s.energy -= COST.hoe;
    return { ok: true, fx: 'till' };
  }
  if (item.id === 'can') {
    if (!tile) return { ok: false };
    if (s.water <= 0) return { ok: false, msg: '물이 없어요. 연못에서 채우세요.' };
    if (tile.watered) return { ok: false };
    tile.watered = true;
    s.water--;
    s.energy -= COST.can;
    return { ok: true, fx: 'water' };
  }
  if (item.id.startsWith('seed:')) {
    if (!tile || tile.crop) return { ok: false };
    const kind = item.id.slice(5);
    removeItem(s, item.id);
    tile.crop = { kind, age: 0 };
    return { ok: true, fx: 'plant' };
  }
  return { ok: false };
}

export function shipAll(s) {
  let n = 0;
  for (let i = 0; i < s.inventory.length; i++) {
    const it = s.inventory[i];
    if (!it || !it.id.startsWith('crop:')) continue;
    const prev = s.shipped.find((x) => x.id === it.id);
    if (prev) prev.n += it.n; else s.shipped.push({ id: it.id, n: it.n });
    n += it.n;
    s.inventory[i] = null;
  }
  return n;
}

export function buy(s, crop, n = 1) {
  const price = CROPS[crop].seed * n;
  if (s.money < price) return { ok: false, msg: '돈이 부족해요.' };
  if (!addItem(s, 'seed:' + crop, n)) return { ok: false, msg: '가방이 꽉 찼어요.' };
  s.money -= price;
  return { ok: true };
}

export function advance(s, minutes) {
  s.minutes = Math.min(PASS_OUT, s.minutes + minutes);
  return s.minutes >= PASS_OUT;
}

// End the day: sell shipped goods, grow watered crops, roll tomorrow's weather.
export function sleep(s, { passedOut = false, seed = s.day * 7919 } = {}) {
  const r = rng(seed);
  const sales = s.shipped.map((x) => ({ ...x, gold: CROPS[x.id.slice(5)].sell * x.n }));
  const income = sales.reduce((a, x) => a + x.gold, 0);
  s.money += income;
  s.stats.earned += income;
  s.shipped = [];
  let grown = 0;
  for (const [k, tile] of Object.entries(s.tiles)) {
    if (tile.crop && tile.watered && !isRipe(tile.crop)) { tile.crop.age++; grown++; }
    // Bare soil left unwatered slowly turns back to plain dirt.
    if (!tile.crop && !tile.watered && r() < 0.25) { delete s.tiles[k]; continue; }
    tile.watered = false;
  }
  s.day++;
  s.minutes = DAY_START;
  s.weather = r() < 0.2 ? 'rain' : 'sun';
  if (s.weather === 'rain') for (const tile of Object.values(s.tiles)) tile.watered = true;
  s.energy = passedOut ? Math.round(s.maxEnergy * 0.6) : s.maxEnergy;
  s.player = { x: START.x, y: START.y, dir: 'south' };
  s.report = { day: s.day - 1, sales, income, grown, passedOut, weather: s.weather };
  return s.report;
}

export function clock(minutes) {
  const m = Math.floor(minutes / 10) * 10;
  const h = Math.floor(m / 60) % 24;
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')}`;
}

export function serialize(s) {
  return JSON.stringify(s);
}

export function deserialize(text) {
  const d = JSON.parse(text);
  if (!d || d.version !== SAVE_VERSION) throw new Error('save version mismatch');
  const base = newGame();
  const s = { ...base, ...d, player: { ...base.player, ...d.player }, stats: { ...base.stats, ...d.stats } };
  if (!Array.isArray(s.inventory) || s.inventory.length !== SLOTS) throw new Error('bad inventory');
  s.inventory = s.inventory.map((it) => (it && typeof it.id === 'string' && it.n > 0 ? { id: it.id, n: it.n | 0 } : null));
  for (const [k, t] of Object.entries(s.tiles)) {
    const [x, y] = k.split(',').map(Number);
    if (!isFarmland(x, y) || (t.crop && !CROPS[t.crop.kind])) delete s.tiles[k];
  }
  if (!LOOKS.includes(s.look)) s.look = 'farmer';
  s.selected = Math.max(0, Math.min(SLOTS - 1, s.selected | 0));
  return s;
}

export { TILE };
