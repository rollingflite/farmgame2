import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/model.js';
import { buildWorld, FARM, TILE, isSolidAt, START } from '../src/world.js';

const noWater = () => false;
const fx = FARM.x + 2, fy = FARM.y + 2;

test('till, plant, water, grow, harvest, ship, sell', () => {
  const s = M.newGame();
  s.selected = 0;
  assert.equal(M.useOn(s, fx, fy, noWater).fx, 'till');
  assert.equal(s.energy, 98);
  s.selected = 2;
  assert.equal(M.useOn(s, fx, fy, noWater).fx, 'plant');
  assert.equal(M.count(s, 'seed:turnip'), 11);
  for (let d = 0; d < 3; d++) {
    s.weather = 'sun';
    s.selected = 1;
    const tile = M.tileAt(s, fx, fy);
    if (!tile.watered) assert.equal(M.useOn(s, fx, fy, noWater).fx, 'water');
    M.sleep(s, { seed: 1 });
  }
  assert.ok(M.isRipe(M.tileAt(s, fx, fy).crop));
  assert.equal(M.useOn(s, fx, fy, noWater).fx, 'harvest');
  assert.equal(M.count(s, 'crop:turnip'), 1);
  assert.equal(M.shipAll(s), 1);
  const before = s.money;
  const rep = M.sleep(s);
  assert.equal(rep.income, 60);
  assert.equal(s.money, before + 60);
});

test('crops only grow on watered days', () => {
  const s = M.newGame();
  s.tiles[fx + ',' + fy] = { watered: false, crop: { kind: 'turnip', age: 0 } };
  M.sleep(s, { seed: 3 });
  const t = M.tileAt(s, fx, fy);
  assert.equal(t.crop.age, 0);
});

test('hoe only works on farmland and costs energy', () => {
  const s = M.newGame();
  assert.equal(M.useOn(s, 1, 1, noWater).ok, false);
  s.energy = 1;
  assert.equal(M.useOn(s, fx, fy, noWater).ok, false);
});

test('watering can refills at water and runs dry', () => {
  const s = M.newGame();
  s.selected = 1;
  s.water = 0;
  s.tiles[fx + ',' + fy] = { watered: false, crop: null };
  assert.match(M.useOn(s, fx, fy, noWater).msg, /물이 없어요/);
  assert.equal(M.useOn(s, 0, 0, () => true).fx, 'refill');
  assert.equal(s.water, M.CAN_MAX);
});

test('buying seeds spends money and needs enough', () => {
  const s = M.newGame();
  assert.ok(M.buy(s, 'carrot', 5).ok);
  assert.equal(s.money, 150 - 150);
  assert.equal(M.buy(s, 'turnip', 1).ok, false);
  assert.equal(M.count(s, 'seed:carrot'), 5);
});

test('passing out restores only part of the energy', () => {
  const s = M.newGame();
  s.energy = 3;
  assert.equal(M.advance(s, 10000), true);
  M.sleep(s, { passedOut: true });
  assert.equal(s.energy, 60);
  assert.equal(s.minutes, M.DAY_START);
});

test('save round trip keeps the farm and drops junk', () => {
  const s = M.newGame();
  s.tiles[fx + ',' + fy] = { watered: true, crop: { kind: 'carrot', age: 2 } };
  s.tiles['0,0'] = { watered: true, crop: null };
  const back = M.deserialize(M.serialize(s));
  assert.deepEqual(back.tiles[fx + ',' + fy], s.tiles[fx + ',' + fy]);
  assert.equal(back.tiles['0,0'], undefined);
  assert.throws(() => M.deserialize('{"version":99}'));
});

test('world: start is walkable, farm is open, house is solid', () => {
  const w = buildWorld();
  assert.equal(isSolidAt(w, START.x, START.y), false);
  for (let y = FARM.y; y < FARM.y + FARM.h; y++) for (let x = FARM.x; x < FARM.x + FARM.w; x++) {
    assert.equal(w.solid[y][x], false, `farm ${x},${y}`);
    assert.equal(w.terrain[y][x], 'farm');
  }
  assert.equal(w.solid[6][10], true);
  assert.ok(w.terrain.flat().filter((t) => t === 'water').length > 30);
});

test('world: every key spot is reachable from the start', () => {
  const w = buildWorld();
  const seen = new Set();
  const q = [[START.x / TILE | 0, START.y / TILE | 0]];
  while (q.length) {
    const [x, y] = q.pop();
    const k = x + ',' + y;
    if (seen.has(k) || w.solid[y][x]) continue;
    seen.add(k);
    q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  for (const spot of ['11,9', '14,9', '39,9', `${FARM.x},${FARM.y}`, `${FARM.x + FARM.w - 1},${FARM.y + FARM.h - 1}`])
    assert.ok(seen.has(spot), spot);
});

test('character look is saved and unknown looks fall back to the farmer', () => {
  const s = M.newGame();
  s.look = 'maple';
  assert.equal(M.deserialize(M.serialize(s)).look, 'maple');
  s.look = 'girl';
  assert.equal(M.deserialize(M.serialize(s)).look, 'maple');
  s.look = 'dragon';
  assert.equal(M.deserialize(M.serialize(s)).look, 'farmer');
});
