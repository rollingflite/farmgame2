// Input, game loop, HUD and dialogs.
import { buildWorld, TILE as T, isSolidAt } from './world.js';
import * as M from './model.js';
import { loadArt } from './art.js';
import { Renderer, DIRS, INTERACT, actionSheet } from './render.js';

const SAVE_KEY = 'farmgame2.save.v1';
const SECONDS_PER_GAME_MINUTE = 0.7;
const SPEED = 92;
const $ = (id) => document.getElementById(id);

const world = buildWorld();
const art = await loadArt(world);
const R = new Renderer($('game'), world, art);

const loaded = load();
const g = {
  state: loaded || M.newGame(),
  anim: { moving: false, walkT: 0, action: null },
  particles: [],
  target: null,
  targetOk: false,
  dialog: null,
  fade: 0,
  near: null,
  dirty: false,
  warnedLate: false,
};
window.__game = g;

const isWater = (x, y) => world.terrain[y]?.[x] === 'water';
const keys = new Set();
const mouse = { x: 0, y: 0, active: false, moved: 0 };
const touch = { x: 0, y: 0 };

// ------------------------------------------------------------ save

function load() {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    return text ? M.deserialize(text) : null;
  } catch {
    return null;
  }
}
function save() {
  try { localStorage.setItem(SAVE_KEY, M.serialize(g.state)); g.dirty = false; } catch { /* storage blocked */ }
}
setInterval(() => { if (g.dirty) save(); }, 15000);
addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// ------------------------------------------------------------ helpers

function feetTile() {
  const p = g.state.player;
  return { x: Math.floor(p.x / T), y: Math.floor((p.y - 4) / T) };
}

function collides(x, y) {
  return isSolidAt(world, x - 6, y - 4) || isSolidAt(world, x + 6, y - 4) || isSolidAt(world, x - 6, y + 2) || isSolidAt(world, x + 6, y + 2);
}

function dirFrom(vx, vy) {
  const names = ['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'];
  const a = Math.atan2(vy, vx);
  return names[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}

function canAct(x, y) {
  const s = g.state, tile = M.tileAt(s, x, y), item = s.inventory[s.selected];
  if (tile?.crop && M.isRipe(tile.crop)) return true;
  if (!item) return false;
  if (item.id === 'hoe') return M.isFarmland(x, y) && !tile;
  if (item.id === 'can') return isWater(x, y) ? s.water < M.CAN_MAX : !!tile && !tile.watered && s.water > 0;
  if (item.id.startsWith('seed:')) return !!tile && !tile.crop;
  return false;
}

function pickTarget() {
  const f = feetTile();
  if (mouse.active && mouse.moved > 0) {
    const w = R.screenToWorld(mouse.x, mouse.y);
    const tx = Math.floor(w.x / T), ty = Math.floor(w.y / T);
    if (Math.abs(tx - f.x) <= 1 && Math.abs(ty - f.y) <= 1) return { x: tx, y: ty };
  }
  const [dx, dy] = DIRS[g.state.player.dir];
  return { x: f.x + dx, y: f.y + dy };
}

function nearSpot() {
  const p = g.state.player;
  for (const [name, r] of Object.entries(INTERACT))
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return name;
  return null;
}

function burst(x, y, colors, n, { up = 60, spread = 50, size = 2, life = 0.5, gravity = 220 } = {}) {
  for (let i = 0; i < n; i++) {
    g.particles.push({
      x, y, vx: (Math.random() - 0.5) * spread, vy: -Math.random() * up - 10,
      color: colors[(Math.random() * colors.length) | 0], size, life: life * (0.6 + Math.random() * 0.6), gravity,
    });
  }
}
function floatText(x, y, text, color = '#fff6d8') {
  g.particles.push({ x, y, vx: 0, vy: -18, text, color, life: 1.2, gravity: 0 });
}

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ------------------------------------------------------------ actions

function useTool() {
  if (g.anim.action || g.dialog || g.fade > 0) return;
  const s = g.state;
  const tgt = pickTarget();
  const item = s.inventory[s.selected];
  const f = feetTile();
  const face = () => { if (tgt.x !== f.x || tgt.y !== f.y) s.player.dir = dirFrom(tgt.x - f.x, tgt.y - f.y); };
  const crop = M.tileAt(s, tgt.x, tgt.y)?.crop;
  const sheet = actionSheet(item?.id);
  const drawn = sheet === 'seed' && art.chars[s.look]?.seed;
  if ((item?.id === 'hoe' || item?.id === 'can' || drawn) && !(crop && M.isRipe(crop))) {
    // Tools change the tile when the swing lands, not when the key is pressed.
    if (sheet === 'seed' && !canAct(tgt.x, tgt.y)) return; // nothing to sow here: don't crouch for nothing
    face();
    const anim = art.chars[s.look]?.[sheet]?.meta;
    const dur = anim ? anim.frames / anim.fps : 0.34;
    g.anim.action = { item: item.id, t: 0, dur, hitAt: anim ? (anim.hit / anim.frames) * dur : dur * 0.55, tx: tgt.x, ty: tgt.y, hit: false, deferred: true };
    return;
  }
  const res = M.useOn(s, tgt.x, tgt.y, isWater);
  if (res.msg) toast(res.msg);
  if (res.ok) g.dirty = true;
  const shown = res.fx === 'harvest' ? res.item : item?.id;
  if (res.ok || item?.id === 'hoe' || item?.id === 'can') {
    const dur = res.fx === 'harvest' || res.fx === 'plant' ? 0.24 : 0.34;
    g.anim.action = { item: shown, t: 0, dur, hitAt: dur * 0.55, fx: res.ok ? res.fx : null, tx: tgt.x, ty: tgt.y, hit: false, res };
    face();
  }
}

function playHit(a) {
  if (a.deferred) {
    const res = M.useOn(g.state, a.tx, a.ty, isWater);
    if (res.msg) toast(res.msg);
    if (res.ok) g.dirty = true;
    a.fx = res.ok ? res.fx : null;
    a.res = res;
  }
  const cx = a.tx * T + 16, cy = a.ty * T + 18;
  if (a.fx === 'till') burst(cx, cy, ['#5a341c', '#87542f', '#a26e42'], 12, { up: 70 });
  else if (a.fx === 'water') burst(cx, cy - 4, ['#8fd3ef', '#d8f4fc', '#4aa3c9'], 14, { up: 40, spread: 40, life: 0.45 });
  else if (a.fx === 'refill') burst(cx, cy, ['#d8f4fc', '#9ad6ee'], 18, { up: 90, spread: 60 });
  else if (a.fx === 'plant') burst(cx, cy, ['#68ab48', '#8cc75c', '#e8d8a8'], 6, { up: 30 });
  else if (a.fx === 'harvest') {
    burst(cx, cy - 6, ['#68ab48', '#8cc75c', '#4b8c3c'], 10, { up: 80 });
    floatText(cx, cy - 18, '+1 ' + M.itemName(a.res.item));
  }
}

function interact() {
  if (g.dialog || g.fade > 0) return;
  const spot = nearSpot();
  if (spot === 'door') confirmSleep();
  else if (spot === 'bin') {
    const n = M.shipAll(g.state);
    if (n) {
      g.dirty = true;
      const value = g.state.shipped.reduce((a, x) => a + M.CROPS[x.id.slice(5)].sell * x.n, 0);
      toast(`수확물 ${n}개를 판매함에 넣었어요. 내일 아침 ${value}G로 정산돼요.`);
      burst(INTERACT.bin.x + 46, INTERACT.bin.y + 14, ['#f6c94a', '#fff2b0'], 12, { up: 70 });
    } else toast('판매함에 넣을 수확물이 없어요.');
  } else if (spot === 'stall') openShop();
}

function doSleep(passedOut) {
  if (g.fade > 0) return;
  closeDialog();
  g.fade = 0.001;
  g.anim.action = null;
  const start = performance.now();
  const step = (now) => {
    const k = (now - start) / 700;
    if (k < 1) { g.fade = k; requestAnimationFrame(step); return; }
    const report = M.sleep(g.state, { passedOut, seed: (Date.now() & 0xffff) + g.state.day * 7919 });
    g.warnedLate = false;
    save();
    showReport(report);
    const t0 = performance.now();
    const back = (n) => {
      const j = (n - t0) / 600;
      g.fade = Math.max(0, 1 - j);
      if (g.fade > 0) requestAnimationFrame(back);
    };
    requestAnimationFrame(back);
  };
  requestAnimationFrame(step);
}

// ------------------------------------------------------------ dialogs

function closeDialog() {
  g.dialog = null;
  $('dialog').hidden = true;
}

function openDialog(kind, title, bodyHtml, buttons = [{ label: '닫기', primary: true }]) {
  g.dialog = kind;
  keys.clear();
  const el = $('dialog');
  el.querySelector('.title').textContent = title;
  el.querySelector('.body').innerHTML = bodyHtml;
  const row = el.querySelector('.buttons');
  row.innerHTML = '';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.textContent = b.label;
    if (b.primary) btn.className = 'primary';
    btn.onclick = () => { if (b.action) b.action(); else closeDialog(); };
    row.appendChild(btn);
  }
  el.hidden = false;
  row.querySelector('.primary')?.focus();
}

function confirmSleep() {
  const late = g.state.minutes >= 24 * 60;
  openDialog('sleep', '하루 마치기', `<p>${late ? '많이 늦었어요.' : '오늘은 이만 잘까요?'} 자고 나면 판매함 수익이 정산되고, 물 준 작물이 자라요.</p>`, [
    { label: '잘래요', primary: true, action: () => doSleep(false) },
    { label: '아직이요' },
  ]);
}

function iconImg(id, size = 32) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  c.getContext('2d').drawImage(art.icons[id], 0, 0);
  return `<img class="icon" width="${size}" height="${size}" src="${c.toDataURL()}" alt="">`;
}

function openShop() {
  const s = g.state;
  const rows = Object.entries(M.CROPS).map(([k, c]) => `
    <div class="shop-row">
      ${iconImg('seed:' + k)}
      <div class="shop-info"><b>${c.name} 씨앗</b><span>${c.days}일 · 판매가 ${c.sell}G</span></div>
      <button data-buy="${k}" data-n="1">1개 ${c.seed}G</button>
      <button data-buy="${k}" data-n="5">5개 ${c.seed * 5}G</button>
    </div>`).join('');
  openDialog('shop', '씨앗 가게', `<p class="shop-money">가진 돈 <b id="shop-money">${s.money}G</b></p>${rows}`);
  for (const b of $('dialog').querySelectorAll('[data-buy]')) {
    b.onclick = () => {
      const r = M.buy(s, b.dataset.buy, Number(b.dataset.n));
      if (!r.ok) toast(r.msg);
      else { g.dirty = true; toast(`${M.CROPS[b.dataset.buy].name} 씨앗 ${b.dataset.n}개를 샀어요.`); }
      $('shop-money').textContent = s.money + 'G';
    };
  }
}

function showReport(r) {
  const sales = r.sales.length
    ? r.sales.map((x) => `<li>${iconImg(x.id, 24)} ${M.itemName(x.id)} × ${x.n}<span>${x.gold}G</span></li>`).join('')
    : '<li class="muted">판매한 수확물이 없어요.</li>';
  const notes = [];
  if (r.passedOut) notes.push('밭에서 쓰러져 잠들었어요. 기력이 조금만 회복됐어요.');
  if (r.grown) notes.push(`물 준 작물 ${r.grown}개가 자랐어요.`);
  notes.push(r.weather === 'rain' ? '오늘은 비가 와요. 밭에 물을 주지 않아도 돼요.' : '오늘은 맑아요.');
  openDialog('report', `${r.day}일차 정산`, `<ul class="sales">${sales}</ul><p class="total">수입 <b>${r.income}G</b></p>${notes.map((n) => `<p>${n}</p>`).join('')}`,
    [{ label: `${r.day + 1}일차 시작`, primary: true }]);
}

function portrait(look) {
  const { img, meta } = art.chars[look];
  const c = document.createElement('canvas');
  c.width = meta.frameWidth; c.height = meta.frameHeight;
  c.getContext('2d').drawImage(img, meta.idle.south * meta.frameWidth, 0, meta.frameWidth, meta.frameHeight, 0, 0, meta.frameWidth, meta.frameHeight);
  return c.toDataURL();
}

const LOOK_NAMES = { farmer: '농부', maple: '메이플' };
function chooseLook(then) {
  const cards = M.LOOKS.map((k) => `
    <button class="look${g.state.look === k ? ' sel' : ''}" data-look="${k}">
      <img src="${portrait(k)}" width="96" height="144" alt=""><span>${LOOK_NAMES[k]}</span>
    </button>`).join('');
  openDialog('look', '캐릭터 고르기', `<div class="looks">${cards}</div>`, [{ label: '결정', primary: true, action: then || closeDialog }]);
  for (const b of $('dialog').querySelectorAll('[data-look]')) {
    b.onclick = () => {
      g.state.look = b.dataset.look;
      g.dirty = true;
      for (const o of $('dialog').querySelectorAll('[data-look]')) o.classList.toggle('sel', o === b);
    };
  }
}

function showHelp() {
  openDialog('help', '작은 농장', `
    <p>밭을 갈고 씨앗을 심어 물을 주세요. 물 준 날 밤에만 작물이 자라요.</p>
    <ul class="help">
      <li><kbd>WASD</kbd> / 방향키 이동</li>
      <li><kbd>Space</kbd> / 클릭 도구 사용·수확</li>
      <li><kbd>E</kbd> / 우클릭 문·판매함·가게</li>
      <li><kbd>1</kbd>–<kbd>9</kbd> / 휠 도구 고르기</li>
      <li><kbd>H</kbd> 도움말</li>
    </ul>
    <p>물뿌리개는 연못에서 채워요. 수확물은 판매함에 넣으면 다음 날 아침 돈이 돼요.</p>`,
  [{ label: '시작하기', primary: true }]);
}

// ------------------------------------------------------------ HUD

const hotbar = $('hotbar');
const slotEls = [];
for (let i = 0; i < M.SLOTS; i++) {
  const b = document.createElement('button');
  b.className = 'slot';
  b.innerHTML = `<canvas width="48" height="48"></canvas><span class="n"></span><span class="k">${i + 1}</span><span class="bar"><i></i></span>`;
  b.onclick = () => { g.state.selected = i; };
  hotbar.appendChild(b);
  slotEls.push(b);
}
let hudSig = '';
function updateHud() {
  const s = g.state;
  const sig = JSON.stringify([s.inventory, s.selected, s.water, s.money, Math.floor(s.minutes / 10), s.day, s.energy, s.weather, g.near]);
  if (sig === hudSig) return;
  hudSig = sig;
  $('day').textContent = `${s.day}일차 · ${s.weather === 'rain' ? '비' : '맑음'}`;
  $('clock').textContent = M.clock(s.minutes);
  $('clock').classList.toggle('late', s.minutes >= 22 * 60);
  $('money').textContent = s.money.toLocaleString() + 'G';
  $('energy-fill').style.height = (100 * s.energy / s.maxEnergy) + '%';
  $('energy').classList.toggle('low', s.energy < 20);
  slotEls.forEach((b, i) => {
    const it = s.inventory[i];
    const c = b.querySelector('canvas').getContext('2d');
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, 48, 48);
    if (it) c.drawImage(art.icons[it.id], 0, 0, 48, 48);
    b.querySelector('.n').textContent = it && it.id !== 'hoe' && it.id !== 'can' ? it.n : '';
    b.classList.toggle('sel', i === s.selected);
    b.title = it ? M.itemName(it.id) : '';
    const bar = b.querySelector('.bar');
    bar.hidden = it?.id !== 'can';
    if (it?.id === 'can') bar.firstChild.style.width = (100 * s.water / M.CAN_MAX) + '%';
  });
  const item = s.inventory[s.selected];
  $('item-name').textContent = item ? M.itemName(item.id) + (item.id === 'can' ? ` (${s.water}/${M.CAN_MAX})` : '') : '';
  const label = { door: '잠자기', bin: '판매함에 넣기', stall: '씨앗 가게' }[g.near];
  $('prompt').hidden = !label;
  if (label) $('prompt').innerHTML = `<kbd>E</kbd> ${label}`;
}

// ------------------------------------------------------------ input

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (g.dialog) {
    if (k === 'escape' || (g.dialog !== 'shop' && (k === 'e' || k === 'h'))) { closeDialog(); e.preventDefault(); }
    if (g.dialog === 'shop' && k === 'e') { closeDialog(); e.preventDefault(); }
    return;
  }
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  if (e.repeat && (k === ' ' || k === 'e')) { if (k === ' ') keys.add('use'); return; }
  keys.add(k);
  if (k === ' ' || k === 'j') { keys.add('use'); useTool(); }
  else if (k === 'e' || k === 'k') interact();
  else if (k === 'h') showHelp();
  else if (k >= '1' && k <= '9') g.state.selected = Number(k) - 1;
  else if (k === 'q') g.state.selected = (g.state.selected + M.SLOTS - 1) % M.SLOTS;
});
addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  keys.delete(k);
  if (k === ' ' || k === 'j') keys.delete('use');
});
addEventListener('blur', () => keys.clear());

const canvas = $('game');
canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; mouse.moved = 2.5; });
canvas.addEventListener('mouseleave', () => { mouse.active = false; });
canvas.addEventListener('mousedown', (e) => {
  mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; mouse.moved = 2.5;
  if (e.button === 0) useTool();
  else if (e.button === 2) interact();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  g.state.selected = (g.state.selected + (e.deltaY > 0 ? 1 : M.SLOTS - 1)) % M.SLOTS;
}, { passive: false });
addEventListener('resize', () => R.resize());

// Touch: a floating joystick on the left half, buttons on the right.
const stick = $('stick');
let stickId = null, stickOrigin = null;
$('touch-move').addEventListener('pointerdown', (e) => {
  stickId = e.pointerId; stickOrigin = { x: e.clientX, y: e.clientY };
  stick.style.left = e.clientX + 'px'; stick.style.top = e.clientY + 'px'; stick.hidden = false;
  e.currentTarget.setPointerCapture(e.pointerId);
});
$('touch-move').addEventListener('pointermove', (e) => {
  if (e.pointerId !== stickId) return;
  const dx = e.clientX - stickOrigin.x, dy = e.clientY - stickOrigin.y, len = Math.hypot(dx, dy);
  const k = len > 8 ? Math.min(1, len / 40) / len : 0;
  touch.x = dx * k; touch.y = dy * k;
  stick.firstElementChild.style.transform = `translate(${touch.x * 28}px, ${touch.y * 28}px)`;
});
const endStick = (e) => { if (e.pointerId === stickId) { stickId = null; touch.x = touch.y = 0; stick.hidden = true; } };
$('touch-move').addEventListener('pointerup', endStick);
$('touch-move').addEventListener('pointercancel', endStick);
$('btn-use').addEventListener('pointerdown', (e) => { e.preventDefault(); mouse.active = false; useTool(); });
$('btn-act').addEventListener('pointerdown', (e) => { e.preventDefault(); interact(); });
$('btn-help').onclick = showHelp;
function confirmReset() {
  openDialog('reset', '처음부터 다시', '<p>지금까지의 밭·돈·가방·날짜가 모두 지워지고 1일차부터 다시 시작해요. 되돌릴 수 없어요.</p>', [
    { label: '초기화', primary: true, action: resetGame },
    { label: '취소' },
  ]);
  const [ok, cancel] = $('dialog').querySelectorAll('.buttons button');
  ok.classList.add('danger');
  cancel.focus(); // Enter should not wipe the farm by accident
}
function resetGame() {
  const look = g.state.look;
  g.state = M.newGame();
  g.state.look = look;
  g.anim.action = null;
  g.particles = [];
  g.warnedLate = false;
  save();
  closeDialog();
  toast('처음부터 다시 시작해요.');
  chooseLook(showHelp);
}

$('btn-reset').onclick = () => { if (!g.dialog) confirmReset(); };
$('btn-look').onclick = () => { if (!g.dialog) chooseLook(); };
$('btn-save').onclick = () => { save(); toast('저장했어요.'); };

// ------------------------------------------------------------ loop

function update(dt) {
  const s = g.state, a = g.anim;
  for (const p of g.particles) { p.life -= dt; p.vy += p.gravity * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  g.particles = g.particles.filter((p) => p.life > 0);
  mouse.moved = Math.max(0, mouse.moved - dt);
  if (g.dialog || g.fade > 0) { a.moving = false; return; }

  if (M.advance(s, dt / SECONDS_PER_GAME_MINUTE)) { doSleep(true); return; }
  if (s.minutes >= 24 * 60 && !g.warnedLate) { g.warnedLate = true; toast('자정이 지났어요. 새벽 2시 전에 집에 가서 자야 해요.'); }

  if (a.action) {
    a.action.t += dt;
    if (!a.action.hit && a.action.t >= a.action.hitAt) { a.action.hit = true; playHit(a.action); }
    if (a.action.t >= a.action.dur) { a.action = null; if (keys.has('use')) useTool(); }
    a.moving = false;
  } else {
    let vx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0) + touch.x;
    let vy = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0) + touch.y;
    const len = Math.hypot(vx, vy);
    if (len > 0.1) {
      const sp = SPEED * Math.min(1, len) / len;
      vx *= sp; vy *= sp;
      s.player.dir = dirFrom(vx, vy);
      const nx = s.player.x + vx * dt, ny = s.player.y + vy * dt;
      if (!collides(nx, s.player.y)) s.player.x = nx;
      if (!collides(s.player.x, ny)) s.player.y = ny;
      a.moving = true;
      a.walkT += dt;
      if (Math.random() < dt * 6) burst(s.player.x, s.player.y, ['#d8c39a', '#c2a878'], 1, { up: 10, spread: 14, size: 1, life: 0.35, gravity: 30 });
    } else { a.moving = false; a.walkT = 0; }
  }
  g.target = pickTarget();
  g.targetOk = canAct(g.target.x, g.target.y);
  g.near = nearSpot();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  R.draw(g, now / 1000);
  updateHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.body.classList.add('ready');
if (!loaded) chooseLook(showHelp);
else if (g.state.report && g.state.minutes === M.DAY_START) showReport(g.state.report);
