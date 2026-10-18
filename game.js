/* Brick Surge: a canvas brick breaker with speed control and power mode. */
(() => {
  'use strict';

  // ---------- Board geometry (logical units; the canvas is scaled to fit) ----------
  const COLS = 7, ROWS = 9, CELL = 100, TOP = 24;
  const W = COLS * CELL;
  const FLOOR = TOP + (ROWS + 1) * CELL; // bottom row is the launcher lane
  const H = FLOOR + 6;
  const R = 11;          // ball radius
  const INSET = 4;       // brick inset inside its cell
  const PICK_R = 24;     // pickup radius
  const SPAD = 22;       // shadow padding around brick sprites
  const WALL = 5;        // thickness of the top bar
  const TAU = Math.PI * 2;

  // ---------- Simulation ----------
  const STEP = 1 / 240;
  const BALL_SPEED = 1450;
  const LAUNCH_GAP = 0.055;
  const HOME_SPEED = 2600;
  const RECALL_SPEED = 3400;
  const MIN_ANGLE = 0.13;
  const SPEEDS = [1, 2, 3];
  const AFTER_LEN = 240;  // how far the aim guide follows past the first bounce
  const MAX_PARTICLES = 700;

  const BLUE = '#5aa8f2', MINT = '#7ef0a8', CORAL = '#ff8f7a', BUTTER = '#ffe58a', ROSE = '#ff6f8a';
  const MINT_EDGE = '#5fd68c', CORAL_EDGE = '#f2735e', BUTTER_EDGE = '#efc95c';
  const INK = '#4a4550', BAR = '#26232b', BRICK_TEXT = '#5b5360';
  const BLUE_RGB = '90,168,242', MINT_RGB = '126,240,168', CORAL_RGB = '255,143,122',
    EMBER_RGB = '255,184,150', BUTTER_RGB = '255,229,138', ROSE_RGB = '255,111,138';
  const UI_FONT = '"Fredoka", "Nunito", system-ui, sans-serif';
  const DISPLAY_FONT = UI_FONT;

  const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } },
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const buzz = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* not allowed */ } };

  // ---------- Sound (synthesised, no assets) ----------
  const Sfx = {
    ac: null, out: null, buf: null, last: {},
    on: store.get('bs.sound', true),
    unlock() {
      if (!this.ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        try {
          this.ac = new AC();
          this.out = this.ac.createGain();
          this.out.gain.value = 0.32;
          this.out.connect(this.ac.destination);
        } catch (e) { this.ac = null; return; }
      }
      if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
    },
    gate(name, ms) {
      const t = performance.now();
      if (t - (this.last[name] || 0) < ms) return false;
      this.last[name] = t;
      return true;
    },
    tone(f0, f1, dur, type, vol, delay = 0) {
      if (!this.on || !this.ac) return;
      const t = this.ac.currentTime + delay;
      const o = this.ac.createOscillator(), g = this.ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.out);
      o.start(t); o.stop(t + dur + 0.02);
    },
    noise(dur, vol, freq, type = 'bandpass') {
      if (!this.on || !this.ac) return;
      if (!this.buf) {
        const len = this.ac.sampleRate;
        this.buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
        const d = this.buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      const t = this.ac.currentTime;
      const s = this.ac.createBufferSource(), f = this.ac.createBiquadFilter(), g = this.ac.createGain();
      s.buffer = this.buf;
      f.type = type; f.frequency.value = freq;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(this.out);
      s.start(t); s.stop(t + dur);
    },
    hit(t) { if (this.gate('hit', 30)) { const f = 950 - Math.min(t, 2) * 260; this.tone(f, f, 0.045, 'triangle', 0.07); } },
    brk() { if (this.gate('brk', 45)) { this.tone(420, 1250, 0.09, 'square', 0.045); this.noise(0.1, 0.1, 3000); } },
    pick() { if (this.gate('pick', 60)) { this.tone(880, 880, 0.07, 'sine', 0.12); this.tone(1320, 1320, 0.09, 'sine', 0.1, 0.06); } },
    zap() { if (this.gate('zap', 70)) this.tone(1600, 180, 0.18, 'sawtooth', 0.06); },
    boom() { if (this.gate('boom', 80)) { this.noise(0.45, 0.35, 700, 'lowpass'); this.tone(140, 40, 0.4, 'sine', 0.3); } },
    power() { this.tone(110, 880, 0.55, 'sawtooth', 0.08); this.tone(220, 1760, 0.55, 'triangle', 0.06); this.noise(0.5, 0.15, 1500); },
    ready() { [660, 880, 1320].forEach((f, i) => this.tone(f, f, 0.12, 'triangle', 0.1, i * 0.08)); },
    launch() { if (this.gate('launch', 55)) this.tone(300, 620, 0.04, 'sine', 0.035); },
    recall() { this.tone(900, 200, 0.2, 'triangle', 0.08); },
    over() { this.tone(440, 110, 0.7, 'sawtooth', 0.1); this.tone(330, 80, 0.8, 'square', 0.05, 0.1); },
    click() { this.tone(700, 700, 0.03, 'square', 0.03); },
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $('game'), ctx = canvas.getContext('2d');
  const stage = $('stage');
  const ui = {
    level: $('level'), best: $('best'),
    power: $('btnPower'), powerSub: $('powerSub'),
    speed: $('btnSpeed'), speedLbl: $('speedLbl'),
    recall: $('btnRecall'), sound: $('btnSound'), pause: $('btnPause'),
    menu: $('menu'), pauseMenu: $('pauseMenu'), overMenu: $('overMenu'),
    play: $('btnPlay'), playLbl: $('playLbl'), fresh: $('btnNew'),
    resume: $('btnResume'), restart: $('btnRestart'), quit: $('btnQuit'), soundToggle: $('btnSoundToggle'),
    again: $('btnAgain'), overMenuBtn: $('btnOverMenu'),
    overLevel: $('overLevel'), overBest: $('overBest'), overNote: $('overNote'),
  };

  // ---------- Game state ----------
  const G = {
    state: 'menu', paused: false, demo: false, time: 0,
    level: 1, best: store.get('bs.best', 0) | 0, ballCount: 1,
    launcherX: W / 2, nextX: null,
    cells: [], grid: new Array(ROWS * COLS).fill(null), dirty: false, danger: false,
    balls: [], toLaunch: 0, launchTimer: 0, dir: null, acc: 0,
    gained: 0, volleyTime: 0, auto: 1,
    power: 0, powerArmed: false, powerActive: false,
    speedIdx: clamp(store.get('bs.speed', 0) | 0, 0, SPEEDS.length - 1),
    aim: null, aiming: false, shake: 0, flash: 0, banner: null, startBest: 0,
    particles: [], floaters: [], beams: [], motes: [],
  };

  for (let i = 0; i < 36; i++) G.motes.push({ x: rand(0, W), y: rand(0, H), v: rand(6, 22), s: rand(1, 2.6), a: rand(0.15, 0.5) });

  let uid = 0;
  function mk(kind, c, r, extra) {
    return Object.assign({ id: ++uid, kind, c, r, dy: -CELL, fade: 0, hit: 0, flash: 0, dead: false, t: rand(0, 6) }, extra);
  }

  function rebuildGrid() {
    G.grid.fill(null);
    G.danger = false;
    for (const o of G.cells) {
      if (o.dead || o.r < 0 || o.r >= ROWS) continue;
      G.grid[o.r * COLS + o.c] = o;
      if (o.kind === 'brick' && o.r === ROWS - 1) G.danger = true;
    }
  }

  // Pastel ramp by health relative to the level: cream peach, apricot, salmon, pink;
  // double-health bricks drift on to orchid and lavender.
  const RAMP = [[0, 255, 224, 196], [0.35, 255, 199, 168], [0.7, 255, 170, 160], [1, 255, 146, 170], [1.5, 240, 156, 208], [2, 198, 170, 250]];
  function brickTone(o) { return Math.round(clamp(Math.max(1, o.hp) / Math.max(1, G.level), 0, 2) * 20); }
  function toneRGB(k) {
    const t = k / 20;
    let i = 0;
    while (i < RAMP.length - 2 && t > RAMP[i + 1][0]) i++;
    const a = RAMP[i], b = RAMP[i + 1], f = clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
    return [1, 2, 3].map((j) => Math.round(a[j] + (b[j] - a[j]) * f));
  }
  const toneCss = (k) => `rgb(${toneRGB(k).join(',')})`;

  // ---------- Rows ----------
  function spawnRow() {
    const L = G.level;
    const slots = [0, 1, 2, 3, 4, 5, 6];
    for (let i = slots.length - 1; i > 0; i--) { const j = randInt(0, i); [slots[i], slots[j]] = [slots[j], slots[i]]; }
    G.cells.push(mk('ball', slots.pop(), 0));
    let n = L === 1 ? randInt(1, 3) : randInt(2, 4) + (L > 10 ? 1 : 0) + (L > 40 && Math.random() < 0.5 ? 1 : 0);
    n = Math.min(n, slots.length);
    for (let i = 0; i < n; i++) {
      let hp = L, armor = false, bomb = false;
      if (L >= 8 && Math.random() < 0.22) { hp = L * 2; armor = true; }
      else if (L >= 5 && Math.random() < 0.08) bomb = true;
      G.cells.push(mk('brick', slots.pop(), 0, { hp, max: hp, armor, bomb }));
    }
    if (slots.length) {
      const roll = Math.random();
      if (L >= 3 && roll < 0.08) G.cells.push(mk('laser', slots.pop(), 0, { dir: 'h' }));
      else if (L >= 3 && roll < 0.15) G.cells.push(mk('laser', slots.pop(), 0, { dir: 'v' }));
      else if (L >= 2 && roll < 0.26) G.cells.push(mk('power', slots.pop(), 0));
    }
  }

  function advance(first) {
    if (!first) G.level++;
    for (const o of G.cells) { o.r++; o.dy -= CELL; }
    spawnRow();
    let over = false;
    for (const o of G.cells) {
      if (o.r < ROWS) continue;
      if (o.kind === 'brick') over = true;
      else {
        o.dead = true;
        if (o.kind === 'ball') { G.ballCount++; floater('+1', o.c * CELL + CELL / 2, FLOOR - 60, MINT); }
      }
    }
    G.cells = G.cells.filter((o) => !o.dead);
    rebuildGrid();
    if (G.level > G.best) {
      if (G.best > 0 && G.startBest === G.best && G.level === G.best + 1) banner('NEW BEST', 'Level ' + G.level, MINT);
      G.best = G.level;
      store.set('bs.best', G.best);
    }
    if (!first && G.level % 50 === 0) banner('LEVEL ' + G.level, 'Keep surging', BLUE);
    if (over) gameOver();
    else { G.state = 'aim'; save(); }
  }

  // ---------- Save / load ----------
  function save() {
    store.set('bs.save', {
      v: 1, level: G.level, ballCount: G.ballCount, launcherX: G.launcherX, power: G.power,
      cells: G.cells.filter((o) => !o.dead).map((o) => ({ k: o.kind, c: o.c, r: o.r, hp: o.hp, max: o.max, b: o.bomb ? 1 : 0, a: o.armor ? 1 : 0, d: o.dir })),
    });
  }

  function load() {
    const s = store.get('bs.save', null);
    if (!s || s.v !== 1 || !Array.isArray(s.cells)) return false;
    G.level = Math.max(1, s.level | 0);
    G.ballCount = Math.max(1, s.ballCount | 0);
    G.launcherX = clamp(+s.launcherX || W / 2, R, W - R);
    G.power = clamp(+s.power || 0, 0, 1);
    G.best = Math.max(G.best, G.level);
    G.cells = [];
    for (const d of s.cells) {
      if (!d || d.c < 0 || d.c >= COLS || d.r < 0 || d.r >= ROWS) continue;
      let o;
      if (d.k === 'brick') o = mk('brick', d.c, d.r, { hp: Math.max(1, d.hp | 0), max: Math.max(1, d.max | 0), bomb: !!d.b, armor: !!d.a });
      else if (d.k === 'laser') o = mk('laser', d.c, d.r, { dir: d.d === 'v' ? 'v' : 'h' });
      else if (d.k === 'ball' || d.k === 'power') o = mk(d.k, d.c, d.r);
      else continue;
      o.dy = 0; o.fade = 1;
      G.cells.push(o);
    }
    rebuildGrid();
    return true;
  }

  function demoBoard() {
    G.demo = true;
    G.cells = [];
    G.level = 6;
    for (let i = 0; i < 5; i++) { for (const o of G.cells) o.r++; spawnRow(); G.level += 3; }
    G.level -= 3;
    for (const o of G.cells) { o.dy = 0; o.fade = 1; }
    G.ballCount = 24;
    G.launcherX = W / 2;
    G.power = 0.6;
    rebuildGrid();
  }

  // ---------- Physics ----------
  const hits = [], hits2 = [];

  function bricksAt(x, y, out) {
    out.length = 0;
    const c0 = Math.max(0, Math.floor((x - R) / CELL)), c1 = Math.min(COLS - 1, Math.floor((x + R) / CELL));
    const r0 = Math.max(0, Math.floor((y - R - TOP) / CELL)), r1 = Math.min(ROWS - 1, Math.floor((y + R - TOP) / CELL));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const o = G.grid[r * COLS + c];
        if (!o || o.kind !== 'brick') continue;
        const bx = c * CELL + INSET, by = TOP + r * CELL + INSET, s = CELL - INSET * 2;
        const dx = x - clamp(x, bx, bx + s), dy = y - clamp(y, by, by + s);
        if (dx * dx + dy * dy < R * R) out.push(o);
      }
    }
    return out;
  }

  function nearest(list, x, y) {
    let best = list[0], bd = Infinity;
    for (const o of list) {
      const dx = x - (o.c * CELL + CELL / 2), dy = y - (TOP + o.r * CELL + CELL / 2);
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // Keep balls from settling into near-horizontal paths that bounce forever.
  function fixAngle(b) {
    const s = Math.hypot(b.vx, b.vy), minVy = s * Math.sin(MIN_ANGLE);
    if (Math.abs(b.vy) < minVy) {
      b.vy = (b.vy < 0 ? -1 : 1) * minVy;
      b.vx = (b.vx < 0 ? -1 : 1) * Math.sqrt(s * s - minVy * minVy);
    }
  }

  function launchBall() {
    G.balls.push({
      x: G.launcherX, y: FLOOR - R, vx: G.dir.x * BALL_SPEED, vy: G.dir.y * BALL_SPEED,
      home: false, recall: false, dead: false, inside: [], lastLaser: null, trail: [],
    });
    Sfx.launch();
  }

  function landBall(b) {
    b.y = FLOOR - R;
    b.vx = b.vy = 0;
    b.home = true;
    b.trail.length = 0;
    if (G.nextX == null) G.nextX = clamp(b.x, R, W - R);
  }

  function stepBall(b, dt) {
    if (b.home) {
      const d = G.nextX - b.x, m = HOME_SPEED * dt;
      if (Math.abs(d) <= m) b.dead = true;
      else b.x += Math.sign(d) * m;
      return;
    }
    if (b.recall) {
      b.y += RECALL_SPEED * dt;
      if (b.y >= FLOOR - R) landBall(b);
      return;
    }
    const pierce = G.powerActive;
    const dmg = pierce ? 2 : 1;

    b.x += b.vx * dt;
    if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx); }
    else if (b.x > W - R) { b.x = W - R; b.vx = -Math.abs(b.vx); }
    if (!pierce && bricksAt(b.x, b.y, hits).length) {
      b.x -= b.vx * dt;
      b.vx = -b.vx;
      damage(nearest(hits, b.x, b.y), dmg, b.x, b.y);
      fixAngle(b);
    }

    b.y += b.vy * dt;
    if (b.y < R + WALL) { b.y = R + WALL; b.vy = Math.abs(b.vy); }
    if (!pierce) {
      if (bricksAt(b.x, b.y, hits).length) {
        b.y -= b.vy * dt;
        b.vy = -b.vy;
        damage(nearest(hits, b.x, b.y), dmg, b.x, b.y);
        fixAngle(b);
      }
    } else {
      bricksAt(b.x, b.y, hits2);
      for (const o of hits2) if (!b.inside.includes(o)) damage(o, dmg, b.x, b.y);
      b.inside.length = 0;
      for (const o of hits2) b.inside.push(o);
    }

    if (b.y >= FLOOR - R && b.vy > 0) { landBall(b); return; }
    checkPickup(b);
  }

  function checkPickup(b) {
    const c = Math.floor(b.x / CELL), r = Math.floor((b.y - TOP) / CELL);
    const o = r >= 0 && r < ROWS ? G.grid[r * COLS + c] : null;
    let touching = null;
    if (o && o.kind !== 'brick') {
      const dx = b.x - (c * CELL + CELL / 2), dy = b.y - (TOP + r * CELL + CELL / 2), rr = PICK_R + R;
      if (dx * dx + dy * dy < rr * rr) touching = o;
    }
    if (touching) {
      if (o.kind === 'ball') collectBall(o);
      else if (o.kind === 'power') collectPower(o);
      else if (o.kind === 'laser' && b.lastLaser !== o) fireLaser(o);
    }
    b.lastLaser = touching && touching.kind === 'laser' ? touching : null;
  }

  function cellCenter(o) { return [o.c * CELL + CELL / 2, TOP + o.r * CELL + CELL / 2]; }

  function damage(o, amt, x, y) {
    if (o.dead) return;
    const tone = brickTone(o);
    o.hp -= amt;
    o.hit = 1;
    if (o.hp <= 0) { destroy(o, tone); return; }
    Sfx.hit(o.hp / G.level);
    if (x != null) sparks(x, y, 'rgba(255,255,255,0.9)', 2);
  }

  function destroy(o, tone) {
    o.dead = true;
    o.hp = 0;
    G.grid[o.r * COLS + o.c] = null;
    G.dirty = true;
    const [cx, cy] = cellCenter(o);
    burst(cx, cy, toneCss(tone), reduceMotion ? 8 : 16);
    ring(cx, cy, 'rgba(255,255,255,0.85)', 20, 78, 0.35, 5);
    G.shake = Math.max(G.shake, 3);
    Sfx.brk();
    if (!G.powerActive) addPower(o.armor ? 0.05 : 0.03);
    if (o.bomb) explode(o, cx, cy);
  }

  function explode(o, cx, cy) {
    ring(cx, cy, CORAL, 30, 200, 0.5, 12);
    ring(cx, cy, '#ffffff', 10, 120, 0.3, 4);
    burst(cx, cy, CORAL, reduceMotion ? 10 : 26);
    G.shake = Math.max(G.shake, 13);
    G.flash = Math.max(G.flash, 0.3);
    Sfx.boom();
    buzz(40);
    const dmg = Math.max(1, Math.ceil(o.max * 0.6));
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = o.r + dr, c = o.c + dc;
        if ((!dr && !dc) || r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
        const n = G.grid[r * COLS + c];
        if (n && n.kind === 'brick') damage(n, dmg, null, null);
      }
    }
  }

  function collectBall(o) {
    o.dead = true;
    G.grid[o.r * COLS + o.c] = null;
    G.dirty = true;
    G.gained++;
    const [cx, cy] = cellCenter(o);
    burst(cx, cy, MINT, 10);
    ring(cx, cy, MINT, 18, 56, 0.3, 4);
    floater('+1', cx, cy - 10, MINT);
    Sfx.pick();
  }

  function collectPower(o) {
    o.dead = true;
    G.grid[o.r * COLS + o.c] = null;
    G.dirty = true;
    const [cx, cy] = cellCenter(o);
    burst(cx, cy, CORAL, 12);
    ring(cx, cy, CORAL, 18, 64, 0.35, 5);
    floater('+20% POWER', cx, cy - 10, CORAL);
    Sfx.pick();
    addPower(0.2);
  }

  function fireLaser(o) {
    o.used = true;
    o.flash = 1;
    const dmg = G.powerActive ? 2 : 1;
    if (o.dir === 'h') {
      for (let c = 0; c < COLS; c++) { const n = G.grid[o.r * COLS + c]; if (n && n.kind === 'brick') damage(n, dmg, null, null); }
    } else {
      for (let r = 0; r < ROWS; r++) { const n = G.grid[r * COLS + o.c]; if (n && n.kind === 'brick') damage(n, dmg, null, null); }
    }
    G.beams.push({ dir: o.dir, at: o.dir === 'h' ? o.r : o.c, t: 1 });
    Sfx.zap();
  }

  function addPower(v) {
    if (G.power >= 1) return;
    G.power = Math.min(1, G.power + v);
    if (G.power >= 1) {
      banner('POWER READY', 'Tap POWER to unleash fireballs', CORAL);
      Sfx.ready();
    }
  }

  // ---------- Turn flow ----------
  function fire(dir) {
    Sfx.unlock();
    G.state = 'fire';
    G.dir = dir;
    G.toLaunch = G.ballCount;
    G.launchTimer = 0;
    G.nextX = null;
    G.gained = 0;
    G.volleyTime = 0;
    G.acc = 0;
    G.auto = 1;
    G.aim = null;
    if (G.powerArmed) activatePower();
  }

  function activatePower() {
    G.powerArmed = false;
    G.powerActive = true;
    G.power = 0;
    for (const b of G.balls) b.inside.length = 0;
    G.flash = Math.max(G.flash, 0.45);
    G.shake = Math.max(G.shake, 10);
    banner('POWER MODE', 'Fireballs pierce bricks · 2× damage', CORAL);
    Sfx.power();
    buzz(60);
  }

  function togglePower() {
    if (G.paused || G.power < 1 || G.powerActive) return;
    Sfx.unlock();
    if (G.state === 'aim') { G.powerArmed = !G.powerArmed; Sfx.click(); }
    else if (G.state === 'fire') activatePower();
  }

  function recall() {
    if (G.state !== 'fire' || G.paused) return;
    G.toLaunch = 0;
    if (G.nextX == null) G.nextX = G.launcherX;
    for (const b of G.balls) if (!b.home) { b.recall = true; b.inside.length = 0; }
    Sfx.recall();
  }

  function cycleSpeed() {
    G.speedIdx = (G.speedIdx + 1) % SPEEDS.length;
    store.set('bs.speed', G.speedIdx);
    Sfx.unlock();
    Sfx.click();
  }

  function simStep(dt) {
    if (G.toLaunch > 0) {
      G.launchTimer -= dt;
      while (G.toLaunch > 0 && G.launchTimer <= 0) {
        launchBall();
        G.toLaunch--;
        G.launchTimer += LAUNCH_GAP;
      }
    }
    let dead = 0;
    for (let i = 0; i < G.balls.length; i++) {
      const b = G.balls[i];
      stepBall(b, dt);
      if (b.dead) dead++;
    }
    if (dead) G.balls = G.balls.filter((b) => !b.dead);
    if (G.toLaunch === 0 && G.balls.length === 0) endVolley();
  }

  function endVolley() {
    G.balls.length = 0;
    if (G.nextX != null) G.launcherX = G.nextX;
    G.nextX = null;
    if (G.gained) G.ballCount += G.gained;
    G.powerActive = false;
    for (const o of G.cells) {
      if (o.kind === 'laser' && o.used && !o.dead) {
        o.dead = true;
        const [cx, cy] = cellCenter(o);
        burst(cx, cy, BUTTER, 8);
      }
    }
    advance(false);
  }

  function gameOver() {
    G.state = 'over';
    G.powerArmed = false;
    store.del('bs.save');
    G.shake = 16;
    G.flash = 0.4;
    Sfx.over();
    buzz(220);
    setTimeout(() => {
      ui.overLevel.textContent = G.level;
      ui.overBest.textContent = G.best;
      ui.overNote.textContent = G.level >= G.best && G.level > G.startBest ? 'New best. Nice run.' : 'A brick reached the launcher lane.';
      showOverlay(ui.overMenu);
    }, 950);
  }

  function newGame() {
    store.del('bs.save');
    Object.assign(G, {
      demo: false, level: 1, ballCount: 1, launcherX: W / 2, nextX: null, cells: [], balls: [],
      power: 0, powerArmed: false, powerActive: false, toLaunch: 0, aim: null, aiming: false,
      particles: [], floaters: [], beams: [], banner: null, paused: false, startBest: G.best,
    });
    rebuildGrid();
    advance(true);
  }

  // ---------- Effects ----------
  function room() { return G.particles.length < MAX_PARTICLES; }

  function burst(x, y, color, n) {
    for (let i = 0; i < n && room(); i++) {
      const a = rand(0, TAU), s = rand(120, 520);
      G.particles.push({ k: 'sq', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 160, age: 0, life: rand(0.45, 0.9), s: rand(6, 14), c: color });
    }
  }

  function sparks(x, y, color, n) {
    for (let i = 0; i < n && room(); i++) {
      const a = rand(0, TAU), s = rand(200, 480);
      G.particles.push({ k: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, age: 0, life: rand(0.15, 0.3), c: color });
    }
  }

  function ring(x, y, color, r0, r1, life, w) {
    if (!room()) return;
    G.particles.push({ k: 'ring', x, y, r0, r1, age: 0, life, w, c: color });
  }

  function ember(x, y) {
    if (!room()) return;
    G.particles.push({ k: 'ember', x: x + rand(-6, 6), y: y + rand(-6, 6), vx: rand(-40, 40), vy: rand(-120, -40), age: 0, life: rand(0.25, 0.5), s: rand(5, 10) });
  }

  function floater(text, x, y, color) {
    G.floaters.push({ text, x, y, color, age: 0, life: 0.9 });
  }

  function banner(title, sub, color) {
    G.banner = { title, sub, color, age: 0, life: 1.7 };
  }

  // ---------- Update ----------
  function update(dt) {
    G.time += dt;
    let mul = 1;
    if (G.state === 'fire' && !G.paused) {
      G.volleyTime += dt;
      G.auto = G.volleyTime > 6 ? Math.min(3, 1 + (G.volleyTime - 6) * 0.22) : 1;
      mul = SPEEDS[G.speedIdx] * G.auto;
      G.acc += dt * mul;
      let n = 0;
      while (G.acc >= STEP && G.state === 'fire') {
        simStep(STEP);
        G.acc -= STEP;
        if (++n > 240) { G.acc = 0; break; }
      }
    }
    if (G.dirty) { G.cells = G.cells.filter((o) => !o.dead); G.dirty = false; }

    const maxTrail = 2 * clamp(Math.round(9 / mul), 3, 9);
    for (const b of G.balls) {
      if (b.home) continue;
      const t = b.trail;
      t.push(b.x, b.y);
      while (t.length > maxTrail) t.splice(0, 2);
      if (G.powerActive && !reduceMotion && Math.random() < 0.35) ember(b.x, b.y);
    }

    const k = 1 - Math.exp(-dt * 14);
    for (const o of G.cells) {
      if (o.dy) { o.dy -= o.dy * k; if (Math.abs(o.dy) < 0.3) o.dy = 0; }
      if (o.fade < 1) o.fade = Math.min(1, o.fade + dt * 4);
      if (o.hit > 0) o.hit = Math.max(0, o.hit - dt * 6);
      if (o.flash > 0) o.flash = Math.max(0, o.flash - dt * 3);
    }

    const ps = G.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
      if (p.k === 'sq') { p.vy += 1100 * dt; p.vx *= 0.985; }
      if (p.k !== 'ring') { p.x += p.vx * dt; p.y += p.vy * dt; }
    }
    for (let i = G.beams.length - 1; i >= 0; i--) { G.beams[i].t -= dt * 3.5; if (G.beams[i].t <= 0) G.beams.splice(i, 1); }
    for (let i = G.floaters.length - 1; i >= 0; i--) {
      const f = G.floaters[i];
      f.age += dt; f.y -= 60 * dt;
      if (f.age >= f.life) G.floaters.splice(i, 1);
    }
    if (G.banner) { G.banner.age += dt; if (G.banner.age >= G.banner.life) G.banner = null; }
    for (const m of G.motes) { m.y -= m.v * dt; if (m.y < -4) { m.y = H + 4; m.x = rand(0, W); } }
    G.shake = Math.max(0, G.shake - dt * 45);
    G.flash = Math.max(0, G.flash - dt * 1.6);
  }

  // ---------- Rendering ----------
  let bgGrad, topGlow, powerVignette;
  const sprites = new Map();

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * K);
    c.height = Math.ceil(h * K);
    const x = c.getContext('2d');
    x.scale(K, K);
    return [c, x];
  }

  function rrect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function brickSprite(tone, armor) {
    const key = tone * 2 + (armor ? 1 : 0);
    let s = sprites.get(key);
    if (s) return s;
    const size = CELL + SPAD * 2;
    const [c, x] = makeCanvas(size, size);
    const b = SPAD + INSET, w = CELL - INSET * 2, rad = 12;
    const [r, g, bl] = toneRGB(tone);
    const shade = (d) => `rgb(${clamp(r + d, 0, 255)},${clamp(g + d, 0, 255)},${clamp(bl + d, 0, 255)})`;
    // Soft drop shadow (shadow offsets and blur are in device pixels).
    x.shadowColor = 'rgba(52,46,60,0.26)';
    x.shadowBlur = 10 * K;
    x.shadowOffsetY = 5 * K;
    const grd = x.createLinearGradient(0, b, 0, b + w);
    grd.addColorStop(0, shade(10));
    grd.addColorStop(1, shade(-14));
    x.fillStyle = grd;
    rrect(x, b, b, w, w, rad);
    x.fill();
    x.shadowColor = 'transparent';
    x.shadowBlur = 0;
    x.shadowOffsetY = 0;
    x.save();
    rrect(x, b, b, w, w, rad);
    x.clip();
    const gl = x.createLinearGradient(0, b, 0, b + w * 0.45);
    gl.addColorStop(0, 'rgba(255,255,255,0.45)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gl;
    x.fillRect(b, b, w, w * 0.45);
    x.fillStyle = 'rgba(90,50,70,0.08)';
    x.fillRect(b, b + w - 8, w, 8);
    x.restore();
    x.lineWidth = 2;
    x.strokeStyle = 'rgba(255,255,255,0.55)';
    rrect(x, b + 1.5, b + 1.5, w - 3, w - 3, rad - 1.5);
    x.stroke();
    if (armor) {
      x.lineWidth = 3;
      x.strokeStyle = 'rgba(255,255,255,0.75)';
      rrect(x, b + 9, b + 9, w - 18, w - 18, 7);
      x.stroke();
      x.fillStyle = 'rgba(74,69,80,0.32)';
      for (const [px, py] of [[16, 16], [w - 16, 16], [16, w - 16], [w - 16, w - 16]]) {
        x.beginPath(); x.arc(b + px, b + py, 2.6, 0, TAU); x.fill();
      }
    }
    sprites.set(key, c);
    return c;
  }

  function buildGradients() {
    bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#97949b');
    bgGrad.addColorStop(1, '#8b8890');
    topGlow = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, 700);
    topGlow.addColorStop(0, 'rgba(255,255,255,0.12)');
    topGlow.addColorStop(1, 'rgba(255,255,255,0)');
    powerVignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.75);
    powerVignette.addColorStop(0, 'rgba(255,160,125,0)');
    powerVignette.addColorStop(1, 'rgba(255,150,120,0.32)');
  }

  function drawBackground() {
    ctx.fillStyle = bgGrad;
    ctx.fillRect(-40, -40, W + 80, H + 80);
    ctx.fillStyle = topGlow;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    for (const m of G.motes) {
      ctx.globalAlpha = m.a * 0.45;
      ctx.fillRect(m.x, m.y, m.s, m.s);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    for (let r = 0; r <= ROWS; r++) for (let c = 1; c < COLS; c++) ctx.fillRect(c * CELL - 1.5, TOP + r * CELL - 1.5, 3, 3);
    if (G.danger && G.state !== 'menu') {
      const a = 0.2 + 0.12 * Math.sin(G.time * 7);
      const g = ctx.createLinearGradient(0, FLOOR - CELL, 0, FLOOR);
      g.addColorStop(0, `rgba(${ROSE_RGB},0)`);
      g.addColorStop(1, `rgba(${ROSE_RGB},${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, FLOOR - CELL, W, CELL);
    }
    ctx.fillStyle = BAR;
    ctx.fillRect(-40, -40, W + 80, WALL + 40);
    ctx.fillRect(-40, FLOOR, W + 80, H - FLOOR + 40);
  }

  let lastFont = '';
  function setFont(f) { if (f !== lastFont) { ctx.font = f; lastFont = f; } }

  function drawCells() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lastFont = '';
    for (const o of G.cells) {
      if (o.dead) continue;
      const cx = o.c * CELL + CELL / 2, cy = TOP + o.r * CELL + CELL / 2 + o.dy;
      ctx.globalAlpha = o.fade;
      if (o.kind === 'brick') drawBrick(o, cx, cy);
      else drawPickup(o, cx, cy);
    }
    ctx.globalAlpha = 1;
  }

  function drawBrick(o, cx, cy) {
    const s = 1 + o.hit * 0.07;
    const size = (CELL + SPAD * 2) * s, h = (CELL / 2 - INSET) * s;
    ctx.drawImage(brickSprite(brickTone(o), o.armor), cx - size / 2, cy - size / 2, size, size);
    if (o.hit > 0) {
      ctx.globalAlpha = o.fade * o.hit * 0.55;
      ctx.fillStyle = '#ffffff';
      rrect(ctx, cx - h, cy - h, h * 2, h * 2, 12 * s);
      ctx.fill();
      ctx.globalAlpha = o.fade;
    }
    if (o.r >= ROWS || (o.r === ROWS - 1 && G.state !== 'menu')) {
      const a = o.r >= ROWS ? 0.7 + 0.3 * Math.sin(G.time * 14) : 0.45 + 0.3 * Math.sin(G.time * 7);
      ctx.lineWidth = 4;
      ctx.strokeStyle = `rgba(${ROSE_RGB},${a})`;
      rrect(ctx, cx - h, cy - h, h * 2, h * 2, 12 * s);
      ctx.stroke();
    }
    if (o.bomb) {
      const bx = cx + h - 17, by = cy - h + 17, p = 0.5 + 0.5 * Math.sin(G.time * 9 + o.t);
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -G.time * 20;
      ctx.strokeStyle = `rgba(74,69,80,${0.35 + p * 0.25})`;
      rrect(ctx, cx - h + 6, cy - h + 6, h * 2 - 12, h * 2 - 12, 8);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.arc(bx, by, 8, 0, TAU); ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(bx + 4, by - 5); ctx.quadraticCurveTo(bx + 9, by - 9, bx + 8, by - 13); ctx.stroke();
      ctx.fillStyle = BUTTER;
      ctx.beginPath(); ctx.arc(bx + 8, by - 14, 2.5 + p * 2.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(bx - 2.5, by - 2.5, 2, 0, TAU); ctx.fill();
    }
    const str = String(o.hp);
    const fs = Math.round((str.length <= 2 ? 42 : str.length === 3 ? 36 : 28) * s);
    setFont(`600 ${fs}px ${UI_FONT}`);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(str, cx, cy + 4);
    ctx.fillStyle = BRICK_TEXT;
    ctx.fillText(str, cx, cy + 2);
  }

  function bolt(x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x + 3 * s, y - 13 * s);
    ctx.lineTo(x - 7 * s, y + 2 * s);
    ctx.lineTo(x - 0.5 * s, y + 2 * s);
    ctx.lineTo(x - 3 * s, y + 13 * s);
    ctx.lineTo(x + 7 * s, y - 2 * s);
    ctx.lineTo(x + 0.5 * s, y - 2 * s);
    ctx.closePath();
  }

  function halo(rgb, cx, cy, r, p) {
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = `rgba(${rgb},${0.5 - p * 0.2})`;
    ctx.beginPath(); ctx.arc(cx, cy, r + 3 + p * 3, 0, TAU); ctx.stroke();
  }

  function drawPickup(o, cx, cy) {
    const p = Math.sin(G.time * 4 + o.t);
    if (o.kind === 'ball') {
      halo(MINT_RGB, cx, cy, 22, p);
      ctx.fillStyle = MINT;
      ctx.beginPath(); ctx.arc(cx, cy, 19, 0, TAU); ctx.fill();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = MINT_EDGE;
      ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath(); ctx.arc(cx, cy, 11, 0, TAU); ctx.stroke();
    } else if (o.kind === 'power') {
      halo(CORAL_RGB, cx, cy, 22, p);
      ctx.fillStyle = CORAL;
      ctx.beginPath(); ctx.arc(cx, cy, 19, 0, TAU); ctx.fill();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = CORAL_EDGE;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      bolt(cx, cy, 0.95);
      ctx.fill();
    } else if (o.kind === 'laser') {
      ctx.save();
      ctx.translate(cx, cy);
      if (o.dir === 'v') ctx.rotate(Math.PI / 2);
      ctx.globalAlpha *= o.used ? 0.5 : 1;
      rrect(ctx, -32, -13, 64, 26, 13);
      ctx.fillStyle = BUTTER;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = BUTTER_EDGE;
      ctx.stroke();
      if (o.flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${o.flash * 0.8})`;
        ctx.fill();
      }
      ctx.strokeStyle = INK;
      ctx.fillStyle = INK;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-13, 0); ctx.lineTo(13, 0); ctx.stroke();
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sgn * 23, 0); ctx.lineTo(sgn * 14, -6.5); ctx.lineTo(sgn * 14, 6.5);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawBeams() {
    for (const bm of G.beams) {
      const t = Math.max(0, bm.t);
      ctx.fillStyle = `rgba(${BUTTER_RGB},${t * 0.6})`;
      if (bm.dir === 'h') {
        const y = TOP + bm.at * CELL + CELL / 2;
        ctx.fillRect(0, y - 16 * t, W, 32 * t);
        ctx.fillStyle = `rgba(255,255,255,${t * 0.9})`;
        ctx.fillRect(0, y - 3 * t, W, 6 * t);
      } else {
        const x = bm.at * CELL + CELL / 2;
        ctx.fillRect(x - 16 * t, WALL, 32 * t, FLOOR - WALL);
        ctx.fillStyle = `rgba(255,255,255,${t * 0.9})`;
        ctx.fillRect(x - 3 * t, WALL, 6 * t, FLOOR - WALL);
      }
    }
  }

  // Walk the ball's path with the same collision rules to draw the aim guide.
  function trace(dx, dy, pierce) {
    const pts = [];
    let x = G.launcherX, y = FLOOR - R, vx = dx, vy = dy, bounced = 0, after = 0, hit = null;
    let since = (G.time * 70) % 28;
    const ds = 5;
    for (let i = 0; i < 700; i++) {
      let b = false;
      x += vx * ds;
      if (x < R) { x = R; vx = -vx; b = true; } else if (x > W - R) { x = W - R; vx = -vx; b = true; }
      if (!pierce && bricksAt(x, y, hits).length) { x -= vx * ds; vx = -vx; b = true; }
      y += vy * ds;
      if (y < R + WALL) { y = R + WALL; vy = -vy; b = true; }
      if (!pierce && bricksAt(x, y, hits).length) { y -= vy * ds; vy = -vy; b = true; }
      if (b) { if (!bounced) hit = { x, y }; bounced++; }
      if (y > FLOOR - R) break;
      if (bounced) { after += ds; if (after > AFTER_LEN) break; }
      since += ds;
      if (since >= 28) { since -= 28; pts.push(x, y, after); }
    }
    return { pts, hit };
  }

  function drawAim() {
    if (G.state !== 'aim' || !G.aim || G.paused) return;
    const { dir, cancel } = G.aim;
    const tr = trace(dir.x, dir.y, G.powerArmed);
    const rgb = cancel ? ROSE_RGB : G.powerArmed ? CORAL_RGB : BLUE_RGB;
    const base = cancel ? 0.4 : 0.95;
    const p = tr.pts;
    for (let i = 0; i < p.length; i += 3) {
      const after = p[i + 2];
      const a = after ? base * 0.75 * (1 - after / AFTER_LEN) : base;
      ctx.fillStyle = `rgba(${rgb},${a})`;
      ctx.beginPath();
      ctx.arc(p[i], p[i + 1], after ? 4.5 : 6, 0, TAU);
      ctx.fill();
    }
    if (tr.hit && !cancel) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(${rgb},0.9)`;
      ctx.beginPath(); ctx.arc(tr.hit.x, tr.hit.y, R, 0, TAU); ctx.stroke();
    }
    if (cancel) {
      setFont(`600 26px ${UI_FONT}`);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('Release to cancel', W / 2, FLOOR - CELL * 0.75);
    }
  }

  function drawBalls() {
    if (!G.balls.length) return;
    const fireMode = G.powerActive;
    const rgb = fireMode ? CORAL_RGB : BLUE_RGB;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const b of G.balls) {
      const t = b.trail;
      if (t.length < 4) continue;
      ctx.moveTo(t[0], t[1]);
      for (let i = 2; i < t.length; i += 2) ctx.lineTo(t[i], t[i + 1]);
      ctx.lineTo(b.x, b.y);
    }
    ctx.strokeStyle = `rgba(${rgb},${fireMode ? 0.4 : 0.3})`;
    ctx.lineWidth = fireMode ? R * 2.5 : R * 1.9;
    ctx.stroke();
    ctx.beginPath();
    for (const b of G.balls) { ctx.moveTo(b.x + R, b.y); ctx.arc(b.x, b.y, R, 0, TAU); }
    ctx.fillStyle = fireMode ? CORAL : BLUE;
    ctx.fill();
    ctx.beginPath();
    for (const b of G.balls) { ctx.moveTo(b.x - 1, b.y - 4); ctx.arc(b.x - 4, b.y - 4, 3.4, 0, TAU); }
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();
  }

  function drawLauncher() {
    if (G.state === 'over') return;
    const firing = G.state === 'fire';
    if (firing && G.nextX != null) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = `rgba(${BLUE_RGB},${0.5 + 0.3 * Math.sin(G.time * 10)})`;
      ctx.beginPath(); ctx.arc(G.nextX, FLOOR - R, R + 6, 0, TAU); ctx.stroke();
    }
    if (firing && G.toLaunch <= 0) return;
    const x = G.launcherX, y = FLOOR - R;
    const hot = G.powerArmed || G.powerActive;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = `rgba(255,255,255,${0.35 + 0.2 * Math.sin(G.time * 5)})`;
    ctx.beginPath(); ctx.arc(x, y, R + 6, 0, TAU); ctx.stroke();
    ctx.fillStyle = hot ? CORAL : BLUE;
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.arc(x - 4, y - 4, 3.4, 0, TAU); ctx.fill();
    const n = firing ? G.toLaunch : G.ballCount;
    setFont(`700 34px ${UI_FONT}`);
    ctx.textBaseline = 'middle';
    const left = x > W - 150;
    ctx.textAlign = left ? 'right' : 'left';
    ctx.fillStyle = hot ? CORAL : BLUE;
    ctx.fillText('x' + n, x + (left ? -24 : 24), y - 8);
  }

  function drawParticles() {
    for (const p of G.particles) {
      const a = 1 - p.age / p.life;
      ctx.globalAlpha = a;
      if (p.k === 'sq') {
        ctx.fillStyle = p.c;
        const s = p.s * (0.4 + 0.6 * a);
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      } else if (p.k === 'ring') {
        const e = 1 - a * a;
        ctx.strokeStyle = p.c;
        ctx.lineWidth = Math.max(0.5, p.w * a);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * e, 0, TAU); ctx.stroke();
      } else if (p.k === 'spark') {
        ctx.strokeStyle = p.c;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); ctx.stroke();
      } else {
        ctx.fillStyle = `rgb(${EMBER_RGB})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.s * 0.5 * a + 1, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawFloaters() {
    if (!G.floaters.length) return;
    setFont(`700 30px ${UI_FONT}`);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of G.floaters) {
      ctx.globalAlpha = 1 - f.age / f.life;
      ctx.fillStyle = 'rgba(42,39,48,0.45)';
      ctx.fillText(f.text, f.x, f.y + 3);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawFx() {
    if (G.powerActive) {
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(G.time * 6);
      ctx.fillStyle = powerVignette;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (G.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${G.flash * 0.55})`;
      ctx.fillRect(-40, -40, W + 80, H + 80);
    }
    if (G.state === 'fire') {
      const mul = SPEEDS[G.speedIdx] * G.auto;
      if (mul > 1.05) {
        setFont(`700 28px ${UI_FONT}`);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`»  ${mul.toFixed(1)}x${G.auto > 1.05 ? '  auto' : ''}`, W - 18, FLOOR - CELL / 2 - 10);
      }
    }
    if (G.state === 'aim' && G.level === 1 && !G.aim && !G.demo) {
      ctx.globalAlpha = 0.6 + 0.35 * Math.sin(G.time * 3);
      setFont(`600 30px ${UI_FONT}`);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('Drag to aim, release to launch', W / 2, FLOOR - CELL * 2.2);
      ctx.globalAlpha = 1;
    }
    const bn = G.banner;
    if (bn) {
      const a = bn.age < 0.15 ? bn.age / 0.15 : bn.age > bn.life - 0.4 ? (bn.life - bn.age) / 0.4 : 1;
      const sc = 1 + 0.15 * Math.max(0, 1 - bn.age / 0.2);
      const y = H * 0.44;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(58,54,64,0.62)';
      rrect(ctx, 40, y - 62, W - 80, 150, 28);
      ctx.fill();
      setFont(`700 ${Math.round(68 * sc)}px ${DISPLAY_FONT}`);
      ctx.fillStyle = 'rgba(30,27,36,0.6)';
      ctx.fillText(bn.title, W / 2, y + 4);
      ctx.fillStyle = bn.color;
      ctx.fillText(bn.title, W / 2, y);
      setFont(`600 26px ${UI_FONT}`);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(bn.sub, W / 2, y + 56);
      ctx.globalAlpha = 1;
    }
  }

  let K = 1;
  function render() {
    ctx.setTransform(K, 0, 0, K, 0, 0);
    if (G.shake > 0.3 && !reduceMotion) ctx.translate(rand(-1, 1) * G.shake, rand(-1, 1) * G.shake);
    drawBackground();
    drawCells();
    drawBeams();
    drawAim();
    drawBalls();
    drawLauncher();
    drawParticles();
    drawFloaters();
    drawFx();
  }

  function resize() {
    const rect = stage.getBoundingClientRect();
    const s = Math.max(0.1, Math.min(rect.width / W, rect.height / H));
    const cssW = Math.floor(W * s), cssH = Math.floor(H * s);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    K = canvas.width / W;
    sprites.clear();
    lastFont = '';
    buildGradients();
  }

  // ---------- HUD ----------
  const hud = {};
  function setHud(key, value, fn) { if (hud[key] !== value) { hud[key] = value; fn(value); } }

  function syncHud() {
    setHud('level', G.demo ? '–' : String(G.level), (v) => { ui.level.textContent = v; });
    setHud('best', String(G.best), (v) => { ui.best.textContent = v; });
    const pState = G.powerActive ? 'active' : G.powerArmed ? 'armed' : G.power >= 1 ? 'ready' : 'charging';
    const pct = Math.floor(G.power * 100);
    setHud('pwr', pState + pct, () => {
      ui.power.style.setProperty('--p', G.powerActive ? 1 : G.power);
      ui.power.dataset.state = pState;
      ui.powerSub.textContent = pState === 'active' ? 'Active' : pState === 'armed' ? 'Armed' : pState === 'ready' ? 'Ready' : pct + '%';
      ui.power.setAttribute('aria-pressed', pState === 'armed' || pState === 'active' ? 'true' : 'false');
    });
    setHud('speed', G.speedIdx, (v) => { ui.speedLbl.textContent = SPEEDS[v] + '×'; ui.speed.dataset.level = v; });
    setHud('recall', G.state === 'fire' && !G.paused, (v) => { ui.recall.disabled = !v; });
    setHud('sound', Sfx.on, (v) => {
      ui.sound.dataset.on = v ? '1' : '0';
      ui.sound.setAttribute('aria-label', v ? 'Mute sound' : 'Turn sound on');
      ui.soundToggle.textContent = v ? 'Sound: on' : 'Sound: off';
    });
  }

  // ---------- Overlays ----------
  function showOverlay(el) {
    for (const o of [ui.menu, ui.pauseMenu, ui.overMenu]) o.hidden = o !== el;
    const btn = el && el.querySelector('button:not([hidden])');
    if (btn) btn.focus({ preventScroll: true });
  }

  function openMenu() {
    G.paused = false;
    G.balls.length = 0;
    G.particles.length = 0;
    G.beams.length = 0;
    G.floaters.length = 0;
    G.banner = null;
    G.powerActive = false;
    G.powerArmed = false;
    G.aim = null;
    if (load()) {
      G.demo = false;
      ui.playLbl.textContent = 'Continue · Level ' + G.level;
      ui.fresh.hidden = false;
    } else {
      demoBoard();
      ui.playLbl.textContent = 'Play';
      ui.fresh.hidden = true;
    }
    G.state = 'menu';
    showOverlay(ui.menu);
  }

  function startFromMenu() {
    Sfx.unlock();
    if (!G.demo && store.get('bs.save', null)) { G.state = 'aim'; G.startBest = G.best; }
    else newGame();
    showOverlay(null);
  }

  function pause() {
    if (G.state !== 'aim' && G.state !== 'fire') return;
    G.paused = true;
    G.aim = null;
    G.aiming = false;
    showOverlay(ui.pauseMenu);
  }

  function resume() {
    G.paused = false;
    showOverlay(null);
  }

  function toggleSound() {
    Sfx.on = !Sfx.on;
    store.set('bs.sound', Sfx.on);
    Sfx.unlock();
    Sfx.click();
  }

  // ---------- Input ----------
  function toLogical(e) {
    const rc = canvas.getBoundingClientRect();
    return { x: ((e.clientX - rc.left) / rc.width) * W, y: ((e.clientY - rc.top) / rc.height) * H };
  }

  function setAim(p) {
    const dx = p.x - G.launcherX, dy = p.y - (FLOOR - R);
    let ang = dy > -1 ? (dx < 0 ? Math.PI : 0) : Math.atan2(-dy, dx);
    ang = clamp(ang, MIN_ANGLE, Math.PI - MIN_ANGLE);
    G.aim = { dir: { x: Math.cos(ang), y: -Math.sin(ang) }, cancel: p.y > FLOOR + 4 };
  }

  const canAim = () => G.state === 'aim' && !G.paused;

  stage.addEventListener('pointerdown', (e) => {
    if (!canAim() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    Sfx.unlock();
    G.aiming = true;
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* capture unsupported */ }
    setAim(toLogical(e));
    e.preventDefault();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!canAim()) return;
    if (G.aiming || e.pointerType === 'mouse') setAim(toLogical(e));
  });
  stage.addEventListener('pointerup', (e) => {
    if (!G.aiming) return;
    G.aiming = false;
    if (!canAim()) return;
    setAim(toLogical(e));
    if (!G.aim.cancel) fire(G.aim.dir);
    else if (e.pointerType !== 'mouse') G.aim = null;
  });
  stage.addEventListener('pointercancel', () => { G.aiming = false; G.aim = null; });
  stage.addEventListener('pointerleave', (e) => { if (!G.aiming && e.pointerType === 'mouse') G.aim = null; });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  ui.power.addEventListener('click', togglePower);
  ui.speed.addEventListener('click', cycleSpeed);
  ui.recall.addEventListener('click', recall);
  ui.sound.addEventListener('click', toggleSound);
  ui.soundToggle.addEventListener('click', toggleSound);
  ui.pause.addEventListener('click', () => { if (G.paused) resume(); else pause(); });
  ui.play.addEventListener('click', startFromMenu);
  ui.fresh.addEventListener('click', () => { Sfx.unlock(); newGame(); showOverlay(null); });
  ui.resume.addEventListener('click', resume);
  ui.restart.addEventListener('click', () => { newGame(); showOverlay(null); });
  ui.quit.addEventListener('click', openMenu);
  ui.again.addEventListener('click', () => { Sfx.unlock(); newGame(); showOverlay(null); });
  ui.overMenuBtn.addEventListener('click', openMenu);

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'escape' || k === 'p') { if (G.paused) resume(); else pause(); }
    else if (G.paused || G.state === 'menu' || G.state === 'over') return;
    else if (k === ' ' || k === 'e') { togglePower(); e.preventDefault(); }
    else if (k === 'f') cycleSpeed();
    else if (k === 'r') recall();
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'fire') pause(); });

  // ---------- Boot ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    update(G.paused ? 0 : dt);
    render();
    syncHud();
    requestAnimationFrame(frame);
  }

  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
  window.addEventListener('resize', resize);
  resize();
  openMenu();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { sprites.clear(); lastFont = ''; });
  requestAnimationFrame(frame);
})();
