// Canvas renderer: terrain, y-sorted objects, the farmer, effects and lighting.
import { TILE as T, HOUSE, BIN, STALL, hash } from './world.js';
import { cropStage, tileAt } from './model.js';
import { SHIMMER } from './art.js';

export const DIRS = {
  south: [0, 1], southwest: [-1, 1], west: [-1, 0], northwest: [-1, -1],
  north: [0, -1], northeast: [1, -1], east: [1, 0], southeast: [1, 1],
};

export class Renderer {
  constructor(canvas, world, art) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.art = art;
    this.scale = 2;
    this.cam = { x: 0, y: 0 };
    this.fenceMask = new Map();
    const fenceAt = new Set(world.objects.filter((o) => o.type === 'fence').map((o) => o.x + ',' + o.y));
    for (const k of fenceAt) {
      const [x, y] = k.split(',').map(Number);
      this.fenceMask.set(k, (fenceAt.has(x - 1 + ',' + y) ? 1 : 0) | (fenceAt.has(x + 1 + ',' + y) ? 2 : 0) | (fenceAt.has(x + ',' + (y - 1)) ? 4 : 0));
    }
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    // Integer-ish zoom so pixels stay square: about 20 tiles across on a desktop.
    this.scale = Math.max(1, Math.floor(Math.min(w / 560, h / 340) * 2) / 2);
    this.canvas.width = Math.ceil(w / this.scale);
    this.canvas.height = Math.ceil(h / this.scale);
    this.canvas.style.width = this.canvas.width * this.scale + 'px';
    this.canvas.style.height = this.canvas.height * this.scale + 'px';
    this.ctx.imageSmoothingEnabled = false;
  }

  screenToWorld(sx, sy) {
    return { x: sx / this.scale + this.cam.x, y: sy / this.scale + this.cam.y };
  }

  follow(px, py) {
    const vw = this.canvas.width, vh = this.canvas.height, mw = this.world.w * T, mh = this.world.h * T;
    const clamp = (v, view, max) => (view >= max ? (max - view) / 2 : Math.max(0, Math.min(max - view, v)));
    this.cam.x = Math.round(clamp(px - vw / 2, vw, mw));
    this.cam.y = Math.round(clamp(py - 24 - vh / 2, vh, mh));
  }

  draw(g, t) {
    const { ctx, art, world } = this;
    const s = g.state;
    const vw = this.canvas.width, vh = this.canvas.height;
    this.follow(s.player.x, s.player.y);
    const cx = this.cam.x, cy = this.cam.y;
    ctx.fillStyle = '#2a5530';
    ctx.fillRect(0, 0, vw, vh);
    ctx.save();
    ctx.translate(-cx, -cy);
    const x0 = Math.max(0, Math.floor(cx / T) - 2), y0 = Math.max(0, Math.floor(cy / T) - 2);
    const x1 = Math.min(world.w, Math.ceil((cx + vw) / T) + 2), y1 = Math.min(world.h, Math.ceil((cy + vh) / T) + 4);
    ctx.drawImage(art.terrain, Math.max(0, cx), Math.max(0, cy), vw, vh, Math.max(0, cx), Math.max(0, cy), vw, vh);

    // Water shimmer.
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (world.terrain[y][x] !== 'water') continue;
      for (let k = 0; k < 2; k++) {
        const ph = t * 0.9 + hash(x, y, k + 40) * 6.28;
        const v = Math.sin(ph);
        if (v < 0.35) continue;
        const sx = x * T + 6 + ((hash(x, y, k + 42) * 16) | 0) + Math.round(Math.sin(t * 0.6 + k) * 2);
        const sy = y * T + 14 + ((hash(x, y, k + 44) * 12) | 0);
        ctx.fillStyle = v > 0.8 ? SHIMMER[1] : SHIMMER[0];
        ctx.fillRect(sx, sy, v > 0.8 ? 5 : 3, 1);
      }
    }

    // Tilled soil.
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const tile = tileAt(s, x, y);
      if (!tile) continue;
      const m = (tileAt(s, x, y - 1) ? 1 : 0) | (tileAt(s, x + 1, y) ? 2 : 0) | (tileAt(s, x, y + 1) ? 4 : 0) | (tileAt(s, x - 1, y) ? 8 : 0);
      ctx.drawImage((tile.watered ? art.soils.wet : art.soils.dry)[m], x * T, y * T);
    }

    // Target tile.
    if (g.target && !g.dialog) {
      const { x, y } = g.target;
      const a = 0.55 + 0.25 * Math.sin(t * 6);
      ctx.strokeStyle = g.targetOk ? `rgba(255,250,220,${a})` : `rgba(255,140,120,${a * 0.7})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(x * T + 1.5, y * T + 1.5, T - 3, T - 3);
      ctx.fillStyle = g.targetOk ? 'rgba(255,250,220,0.12)' : 'rgba(255,120,100,0.06)';
      ctx.fillRect(x * T + 2, y * T + 2, T - 4, T - 4);
    }

    // Y-sorted drawables.
    const list = [];
    const inView = (px, py, pad = 128) => px > cx - pad && px < cx + vw + pad && py > cy - pad && py < cy + vh + pad + 96;
    for (const o of world.objects) {
      const bx = o.x * T, by = o.y * T;
      if (o.type !== 'house' && o.type !== 'stall' && !inView(bx, by)) continue;
      list.push({ key: this.objectKey(o), o });
    }
    for (const [k, tile] of Object.entries(s.tiles)) {
      if (!tile.crop) continue;
      const [x, y] = k.split(',').map(Number);
      if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
      list.push({ key: y * T + 20, crop: tile.crop, x, y });
    }
    list.push({ key: s.player.y, player: true });
    list.sort((a, b) => a.key - b.key);
    for (const d of list) {
      if (d.player) this.drawPlayer(g, t);
      else if (d.crop) {
        const stage = cropStage(d.crop);
        const sway = stage === 3 ? Math.round(Math.sin(t * 2 + d.x * 1.3 + d.y) * 0.6) : 0;
        ctx.drawImage(art.crops[d.crop.kind][stage], d.x * T + sway, d.y * T - 7);
      } else this.drawObject(d.o, s);
    }

    // Particles and floating text.
    for (const p of g.particles) {
      if (p.text) {
        ctx.globalAlpha = Math.min(1, p.life * 2);
        ctx.font = '10px "Jua", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#3a2320';
        ctx.fillText(p.text, Math.round(p.x) + 1, Math.round(p.y) + 1);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, Math.round(p.x), Math.round(p.y));
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      }
    }
    ctx.restore();

    this.drawLighting(g, t, cx, cy);
  }

  objectKey(o) {
    if (o.type === 'house') return (o.y + o.h) * T;
    if (o.type === 'bin') return (o.y + 1) * T - 2;
    if (o.type === 'stall') return (o.y + o.h) * T - 2;
    return o.y * T + 26;
  }

  shadow(x, y, w, h, a = 0.22) {
    const { ctx } = this;
    ctx.fillStyle = `rgba(30,40,20,${a})`;
    ctx.beginPath();
    ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawObject(o, s) {
    const { ctx, art } = this;
    const bx = o.x * T, by = o.y * T;
    switch (o.type) {
      case 'tree':
        this.shadow(bx + 16, by + 28, 50, 14);
        ctx.drawImage(art.trees[o.v], bx + 16 - 36, by + 31 - 92);
        break;
      case 'bush':
        this.shadow(bx + 16, by + 27, 30, 8);
        ctx.drawImage(art.bushes[o.v], bx - 2, by + 29 - 29);
        break;
      case 'rock':
        this.shadow(bx + 16, by + 25, 24, 7);
        ctx.drawImage(art.rocks[o.v], bx + 1, by + 27 - 23);
        break;
      case 'stump':
        this.shadow(bx + 16, by + 25, 26, 7);
        ctx.drawImage(art.stump, bx, by + 27 - 25);
        break;
      case 'fence':
        ctx.drawImage(art.fences[this.fenceMask.get(o.x + ',' + o.y)], bx, by - 12);
        break;
      case 'house': {
        const lit = s.minutes >= 18 * 60 + 30 || s.weather === 'rain';
        this.shadow(bx + o.w * T / 2, by + o.h * T - 4, o.w * T + 10, 16, 0.25);
        ctx.drawImage(lit ? art.houseLit : art.house, bx - 4, (o.y + o.h) * T + 6 - 200);
        break;
      }
      case 'bin':
        this.shadow(bx + 32, by + 30, 62, 8);
        ctx.drawImage(art.bin, bx, (o.y + 1) * T - 42);
        break;
      case 'stall':
        this.shadow(bx + 48, by + o.h * T - 2, 100, 10);
        ctx.drawImage(art.stall, bx - 2, (o.y + o.h) * T + 2 - 88);
        break;
    }
  }

  drawPlayer(g, t) {
    const { ctx, art } = this;
    const s = g.state, a = g.anim;
    const ch = art.chars[s.look] || art.chars.farmer;
    const meta = ch.meta;
    const row = meta.rows.indexOf(s.player.dir);
    const frame = a.moving ? Math.floor(a.walkT * meta.fps) % meta.frames : meta.idle[s.player.dir];
    const px = Math.round(s.player.x), py = Math.round(s.player.y);
    this.shadow(px, py, 20, 7, 0.28);
    const act = a.action && (a.action.item === 'hoe' || a.action.item === 'can') && ch[a.action.item];
    if (act) {
      // Drawn tool animation: four directions, diagonals use the side view.
      const hm = act.meta, d = s.player.dir;
      const r = hm.rows.indexOf(d.includes('east') ? 'east' : d.includes('west') ? 'west' : d);
      const f = Math.min(hm.frames - 1, Math.floor(a.action.t / a.action.dur * hm.frames));
      ctx.drawImage(act.img, f * hm.frameWidth, r * hm.frameHeight, hm.frameWidth, hm.frameHeight,
        px - hm.anchor[0], py - hm.anchor[1], hm.frameWidth, hm.frameHeight);
      return;
    }
    const [dx, dy] = DIRS[s.player.dir];
    const tool = a.action && art.icons[a.action.item];
    const toolBehind = tool && dy < 0;
    if (toolBehind) this.drawTool(a, px, py, dx, dy, tool);
    const bob = a.action ? (a.action.t / a.action.dur < 0.5 ? -1 : 1) : 0;
    ctx.drawImage(ch.img, frame * meta.frameWidth, row * meta.frameHeight, meta.frameWidth, meta.frameHeight,
      px - meta.anchor[0], py - meta.anchor[1] + bob, meta.frameWidth, meta.frameHeight);
    if (tool && !toolBehind) this.drawTool(a, px, py, dx, dy, tool);
  }

  drawTool(a, px, py, dx, dy, icon) {
    const { ctx } = this;
    const k = Math.min(1, a.action.t / a.action.dur);
    const side = dx === 0 ? 1 : Math.sign(dx);
    ctx.save();
    ctx.translate(px + side * 9 + dx * 4, py - 22 + dy * 4);
    if (a.action.item === 'hoe') ctx.rotate(side * (-1.6 + 2.4 * Math.min(1, k * 1.6)));
    else if (a.action.item === 'can') ctx.rotate(side * (0.2 + 0.7 * Math.min(1, k * 2)));
    else ctx.translate(0, -6 * Math.sin(k * Math.PI));
    if (side < 0) ctx.scale(-1, 1);
    ctx.drawImage(icon, -8, -12);
    ctx.restore();
  }

  drawLighting(g, t, cx, cy) {
    const { ctx } = this;
    const s = g.state;
    const vw = this.canvas.width, vh = this.canvas.height;
    const m = s.minutes;
    const ramp = (a, b) => Math.max(0, Math.min(1, (m - a) / (b - a)));
    const dusk = ramp(17 * 60, 19 * 60), night = ramp(19 * 60, 21 * 60 + 30);
    let alpha = 0;
    if (dusk > 0) { ctx.fillStyle = `rgba(255,140,60,${0.14 * dusk * (1 - night)})`; ctx.fillRect(0, 0, vw, vh); }
    if (night > 0) { alpha = 0.5 * night; ctx.fillStyle = `rgba(16,20,64,${alpha})`; ctx.fillRect(0, 0, vw, vh); }
    if (s.weather === 'rain') {
      ctx.fillStyle = 'rgba(40,50,70,0.18)';
      ctx.fillRect(0, 0, vw, vh);
      ctx.strokeStyle = 'rgba(200,220,255,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 90; i++) {
        const sp = 260 + hash(i, 1, 60) * 120;
        const x = ((hash(i, 2, 61) * (vw + 60) + t * 40) % (vw + 60)) - 30;
        const y = ((hash(i, 3, 62) * (vh + 40) + t * sp) % (vh + 40)) - 20;
        ctx.moveTo(Math.round(x), Math.round(y));
        ctx.lineTo(Math.round(x - 2), Math.round(y + 7));
      }
      ctx.stroke();
    }
    // Warm window light once it gets dark.
    if (alpha > 0.05 || s.weather === 'rain') {
      const glow = s.weather === 'rain' ? Math.max(0.35, night) : night;
      ctx.globalCompositeOperation = 'lighter';
      for (const wx of [32 + 15, 144 + 15]) {
        const x = HOUSE.x * T - 4 + wx - cx, y = (HOUSE.y + HOUSE.h) * T + 6 - 200 + 139 - cy;
        const grd = ctx.createRadialGradient(x, y + 10, 2, x, y + 10, 46);
        grd.addColorStop(0, `rgba(255,200,110,${0.35 * glow})`);
        grd.addColorStop(1, 'rgba(255,200,110,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(x - 50, y - 40, 100, 100);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    if (g.fade > 0) { ctx.fillStyle = `rgba(10,8,20,${g.fade})`; ctx.fillRect(0, 0, vw, vh); }
  }
}

export const INTERACT = {
  door: { x: HOUSE.door.x * T - 8, y: (HOUSE.door.y + 1) * T - 6, w: T + 16, h: 30 },
  bin: { x: BIN.x * T - 14, y: BIN.y * T - 10, w: BIN.w * T + 28, h: T + 30 },
  stall: { x: STALL.x * T - 10, y: (STALL.y + STALL.h) * T - 6, w: STALL.w * T + 20, h: 30 },
};
