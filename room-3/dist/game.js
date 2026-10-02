// The Crow's Due - a storm-dark forest, a wisp of light, and a crow that tells fortunes.
(() => {
  'use strict';

  const NEEDED = 3;
  const LUCK = 3;              // fae tricks you can survive

  const canvas = document.getElementById('forest');
  const ctx = canvas.getContext('2d');
  const speechEl = document.getElementById('speech');
  const leaveBtn = document.getElementById('leave-btn');
  const SERIF = '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';

  let W = 0, H = 0, DPR = 1, M = 1;
  let staticLayer = null;      // pre-rendered sky + trees + ground
  let darkLayer = null;        // darkness with holes cut for lights

  // ---- Seeded randomness so the forest is stable across resizes ----
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const SEED = Math.floor(Math.random() * 1e9);

  // ---- Geometry that depends on size ----
  const crow = { x: 0, y: 0, s: 1, tilt: 0, tiltT: 0, beak: 0, hop: 0, blinkT: 2, blink: 0, ruffle: 0 };
  let branch = null;
  const moon = { x: 0, y: 0, r: 0 };
  let mushrooms = [];
  let trinkets = [];
  let faeGlints = [];

  function layout() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    M = Math.min(W, H);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    branch = { x0: W * 0.93, y0: H * 0.47, x1: W * 0.56, y1: H * 0.405 };
    crow.s = Math.max(0.7, Math.min(1.6, M / 560));
    crow.x = W * 0.73;
    crow.y = branchY(crow.x);
    moon.r = M * 0.1;
    moon.x = crow.x - crow.s * 8;
    moon.y = crow.y - crow.s * 52;

    buildStatic();
    darkLayer = document.createElement('canvas');
    darkLayer.width = canvas.width;
    darkLayer.height = canvas.height;
  }

  function branchY(x) {
    const t = (x - branch.x0) / (branch.x1 - branch.x0);
    return branch.y0 + (branch.y1 - branch.y0) * t + Math.sin(t * Math.PI) * H * 0.02;
  }

  // ---- Static scenery ----
  function drawBranch(g, r, x, y, len, ang, w, depth) {
    const bend = (r() - 0.5) * 0.5;
    const ex = x + Math.cos(ang) * len;
    const ey = y + Math.sin(ang) * len;
    const cx = x + Math.cos(ang + bend) * len * 0.55;
    const cy = y + Math.sin(ang + bend) * len * 0.55;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(cx, cy, ex, ey);
    g.stroke();
    if (depth <= 0 || w < 0.6) return;
    const kids = 2 + (r() < 0.35 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      const spread = 0.35 + r() * 0.55;
      const a = ang + (k === 0 ? -spread : k === 1 ? spread : (r() - 0.5) * 0.4);
      drawBranch(g, r, ex, ey, len * (0.62 + r() * 0.18), a, w * 0.62, depth - 1);
    }
  }

  function drawTree(g, r, x, baseY, height, width, color) {
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineCap = 'round';
    // Trunk with a lean and flared roots
    const lean = (r() - 0.5) * 0.25;
    const topX = x + lean * height;
    const topY = baseY - height * 0.55;
    g.beginPath();
    g.moveTo(x - width * 1.6, baseY);
    g.quadraticCurveTo(x - width * 0.5, baseY - height * 0.08, x - width * 0.45, baseY - height * 0.2);
    g.lineTo(topX - width * 0.2, topY);
    g.lineTo(topX + width * 0.2, topY);
    g.lineTo(x + width * 0.45, baseY - height * 0.2);
    g.quadraticCurveTo(x + width * 0.5, baseY - height * 0.08, x + width * 1.6, baseY);
    g.closePath();
    g.fill();
    const arms = 3 + Math.floor(r() * 3);
    for (let k = 0; k < arms; k++) {
      const t = 0.3 + (k / arms) * 0.7;
      const bx = x + (topX - x) * t;
      const by = baseY - height * 0.2 - (height * 0.35) * t;
      const side = k % 2 ? 1 : -1;
      drawBranch(g, r, bx, by, height * (0.22 + r() * 0.12), -Math.PI / 2 + side * (0.5 + r() * 0.6), width * 0.35, 4);
    }
    drawBranch(g, r, topX, topY, height * 0.3, -Math.PI / 2 + lean, width * 0.4, 5);
  }

  function ground(g, r, baseY, amp, color) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, H);
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * W;
      g.lineTo(x, baseY + Math.sin(i * 0.9 + r() * 0.6) * amp + r() * amp * 0.5);
    }
    g.lineTo(W, H);
    g.closePath();
    g.fill();
  }

  function buildStatic() {
    const r = rng(SEED);
    staticLayer = document.createElement('canvas');
    staticLayer.width = canvas.width;
    staticLayer.height = canvas.height;
    const g = staticLayer.getContext('2d');
    g.setTransform(DPR, 0, 0, DPR, 0, 0);

    // Bruised storm sky
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0d121b');
    sky.addColorStop(0.45, '#1b2433');
    sky.addColorStop(0.75, '#141a22');
    sky.addColorStop(1, '#07090c');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // Cloud banks
    for (let i = 0; i < 9; i++) {
      const cx = r() * W, cy = r() * H * 0.35, rad = M * (0.25 + r() * 0.35);
      const cg = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
      cg.addColorStop(0, 'rgba(60,72,92,0.35)');
      cg.addColorStop(1, 'rgba(60,72,92,0)');
      g.fillStyle = cg;
      g.fillRect(0, 0, W, H);
    }

    // Moon behind the crow, streaked with cloud
    const mx = moon.x, my = moon.y, mr = moon.r;
    const halo = g.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 3.2);
    halo.addColorStop(0, 'rgba(190,200,210,0.28)');
    halo.addColorStop(1, 'rgba(190,200,210,0)');
    g.fillStyle = halo;
    g.fillRect(mx - mr * 3.2, my - mr * 3.2, mr * 6.4, mr * 6.4);
    g.fillStyle = '#cfd4cb';
    g.beginPath();
    g.arc(mx, my, mr, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(150,158,150,0.45)';
    for (const [dx, dy, rr] of [[-0.3, -0.2, 0.22], [0.25, 0.15, 0.3], [-0.1, 0.4, 0.15]]) {
      g.beginPath();
      g.arc(mx + dx * mr, my + dy * mr, rr * mr, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(20,26,36,0.75)';
    for (let k = 0; k < 3; k++) {
      const yy = my - mr * 0.5 + k * mr * 0.55 + r() * mr * 0.2;
      g.beginPath();
      g.ellipse(mx + (r() - 0.5) * mr, yy, mr * (1.4 + r()), mr * 0.09, -0.05, 0, Math.PI * 2);
      g.fill();
    }

    // Far trees
    for (let i = 0; i < 9; i++) {
      drawTree(g, r, r() * W, H * 0.8, H * (0.45 + r() * 0.2), M * 0.012, '#1c2530');
    }
    ground(g, r, H * 0.8, H * 0.015, '#151c25');
    // Mid trees
    for (let i = 0; i < 6; i++) {
      drawTree(g, r, r() * W * 0.85, H * 0.86, H * (0.6 + r() * 0.25), M * 0.02, '#10161d');
    }
    ground(g, r, H * 0.86, H * 0.02, '#0d1218');

    // The crow's tree (right) and a big tree on the left
    drawTree(g, r, W * 0.95, H * 1.02, H * 1.15, M * 0.06, '#07090c');
    drawTree(g, r, W * 0.04, H * 1.02, H * 1.05, M * 0.05, '#07090c');

    // The crow's branch
    g.fillStyle = '#07090c';
    g.strokeStyle = '#07090c';
    g.beginPath();
    const steps = 20;
    const thick = (t) => M * (0.028 * (1 - t) + 0.006);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = branch.x0 + (branch.x1 - branch.x0) * t;
      g.lineTo(x, branchY(x) + thick(t) * 0.35);
    }
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const x = branch.x0 + (branch.x1 - branch.x0) * t;
      g.lineTo(x, branchY(x) + thick(t) * 1.3);
    }
    g.closePath();
    g.fill();
    // twigs off the branch
    for (let k = 0; k < 4; k++) {
      const x = branch.x0 + (branch.x1 - branch.x0) * (0.25 + k * 0.2);
      drawBranch(g, r, x, branchY(x) + 2, M * 0.08, -Math.PI / 2 + (r() - 0.6) * 0.9, M * 0.006, 2);
    }

    // Near ground with roots
    ground(g, r, H * 0.92, H * 0.02, '#06080b');
    g.strokeStyle = '#06080b';
    for (let k = 0; k < 7; k++) {
      const x = r() * W;
      drawBranch(g, r, x, H * 0.93, M * (0.08 + r() * 0.08), (r() < 0.5 ? 0.15 : Math.PI - 0.15) - 0.2, M * 0.012, 2);
    }

    // Mushrooms (caps drawn here; their glow is animated)
    mushrooms = [];
    for (let k = 0; k < 11; k++) {
      const x = W * (0.06 + r() * 0.88);
      const y = H * (0.84 + r() * 0.12);
      const s = M * (0.008 + r() * 0.01);
      mushrooms.push({ x, y, s, p: r() * 6 });
      g.fillStyle = '#2a3a38';
      g.fillRect(x - s * 0.25, y - s * 1.2, s * 0.5, s * 1.2);
      g.fillStyle = '#5c8c86';
      g.beginPath();
      g.ellipse(x, y - s * 1.2, s, s * 0.55, 0, Math.PI, 0);
      g.fill();
    }

    placeTreasure(r);
  }

  // ---- Trinkets & fae lights ----
  const KINDS = ['ring', 'key', 'coin', 'button', 'thimble'];

  function placeTreasure(r) {
    if (trinkets.length && trinkets.some((t) => t.taken)) {
      // keep progress on resize: just re-place untaken ones proportionally
      for (const t of trinkets) { t.x = t.fx * W; t.y = t.fy * H; }
      return;
    }
    trinkets = [];
    const spots = [];
    let guard = 0;
    while (spots.length < KINDS.length && guard++ < 500) {
      const fx = 0.08 + r() * 0.84;
      const fy = 0.6 + r() * 0.34;
      const x = fx * W, y = fy * H;
      if (Math.hypot(x - crow.x, y - crow.y) < M * 0.2) continue;
      if (Math.hypot(x - moon.x, y - moon.y) < moon.r * 3) continue;
      if (mushrooms.some((m) => Math.hypot(m.x - x, m.y - y) < m.s * 9)) continue;
      if (spots.some((s) => Math.hypot(s.x - x, s.y - y) < M * 0.18)) continue;
      spots.push({ x, y, fx, fy });
    }
    spots.forEach((s, i) => {
      trinkets.push({ kind: KINDS[i], x: s.x, y: s.y, fx: s.fx, fy: s.fy, taken: false, tw: r() * 4, rot: r() * Math.PI });
    });
    faeGlints = Array.from({ length: 5 }, () => ({
      ax: 0.1 + r() * 0.8, ay: 0.55 + r() * 0.38,
      rx: 0.04 + r() * 0.06, ry: 0.02 + r() * 0.03,
      sp: 0.15 + r() * 0.2, ph: r() * 6, tw: r() * 3,
      x: 0, y: 0
    }));
  }

  function drawTrinket(g, t, scale = 1) {
    const s = M * 0.016 * scale;
    g.save();
    g.translate(t.x, t.y);
    g.rotate(t.rot);
    g.lineWidth = Math.max(1.5, s * 0.3);
    const silver = '#d7dde3', gold = '#d9b45a';
    switch (t.kind) {
      case 'ring':
        g.strokeStyle = gold;
        g.beginPath(); g.ellipse(0, 0, s, s * 0.7, 0, 0, Math.PI * 2); g.stroke();
        g.fillStyle = '#9fd0ff'; g.beginPath(); g.arc(0, -s * 0.7, s * 0.3, 0, Math.PI * 2); g.fill();
        break;
      case 'key':
        g.strokeStyle = silver;
        g.beginPath(); g.arc(-s * 0.9, 0, s * 0.45, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.moveTo(-s * 0.45, 0); g.lineTo(s * 1.3, 0);
        g.moveTo(s * 0.9, 0); g.lineTo(s * 0.9, s * 0.5);
        g.moveTo(s * 1.25, 0); g.lineTo(s * 1.25, s * 0.4); g.stroke();
        break;
      case 'coin':
        g.fillStyle = gold;
        g.beginPath(); g.arc(0, 0, s * 0.85, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#8a6a22'; g.lineWidth = 1;
        g.beginPath(); g.arc(0, 0, s * 0.55, 0, Math.PI * 2); g.stroke();
        break;
      case 'button':
        g.fillStyle = '#c9ced4';
        g.beginPath(); g.arc(0, 0, s * 0.75, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#2a2f36';
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          g.beginPath(); g.arc(dx * s * 0.22, dy * s * 0.22, s * 0.1, 0, Math.PI * 2); g.fill();
        }
        break;
      case 'thimble':
        g.fillStyle = silver;
        g.beginPath();
        g.moveTo(-s * 0.6, s * 0.7); g.lineTo(-s * 0.45, -s * 0.5);
        g.quadraticCurveTo(0, -s * 0.95, s * 0.45, -s * 0.5); g.lineTo(s * 0.6, s * 0.7);
        g.closePath(); g.fill();
        g.fillStyle = '#8b939c';
        for (let k = 0; k < 5; k++) g.fillRect(-s * 0.35 + k * s * 0.17, -s * 0.2, 1.5, 1.5);
        break;
    }
    g.restore();
  }

  function sparkle(x, y, size, alpha, color) {
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(x - size, y); ctx.lineTo(x + size, y);
    ctx.moveTo(x, y - size); ctx.lineTo(x, y + size);
    ctx.moveTo(x - size * 0.4, y - size * 0.4); ctx.lineTo(x + size * 0.4, y + size * 0.4);
    ctx.moveTo(x + size * 0.4, y - size * 0.4); ctx.lineTo(x - size * 0.4, y + size * 0.4);
    ctx.stroke();
    ctx.restore();
  }

  // Short, sharp peaks every few seconds
  function twinkle(t, phase, period) {
    const p = ((t + phase) % period) / period;
    return p < 0.08 ? Math.sin((p / 0.08) * Math.PI) : 0;
  }

  // ---- The crow ----
  function drawCrow() {
    const s = crow.s;
    const hop = Math.sin(Math.min(1, crow.hop) * Math.PI) * 14 * s;
    ctx.save();
    ctx.translate(crow.x, crow.y - hop);
    ctx.fillStyle = '#030405';
    ctx.strokeStyle = '#030405';

    // legs
    ctx.lineWidth = 2.2 * s;
    ctx.beginPath();
    ctx.moveTo(-4 * s, -14 * s); ctx.lineTo(-6 * s, 0);
    ctx.moveTo(5 * s, -14 * s); ctx.lineTo(4 * s, 0);
    ctx.stroke();

    // tail
    ctx.beginPath();
    ctx.moveTo(18 * s, -26 * s);
    ctx.lineTo(48 * s, -6 * s);
    ctx.lineTo(44 * s, 0);
    ctx.lineTo(12 * s, -16 * s);
    ctx.closePath();
    ctx.fill();

    // body (ruffles in the wind)
    const ruf = Math.sin(crow.ruffle) * 2 * s;
    ctx.beginPath();
    ctx.ellipse(2 * s, -30 * s, 24 * s + ruf, 17 * s, -0.35, 0, Math.PI * 2);
    ctx.fill();
    // wing edge
    ctx.fillStyle = '#0b0e12';
    ctx.beginPath();
    ctx.moveTo(-10 * s, -36 * s);
    ctx.quadraticCurveTo(14 * s, -40 * s, 30 * s, -18 * s);
    ctx.quadraticCurveTo(8 * s, -24 * s, -10 * s, -36 * s);
    ctx.fill();
    // ragged feathers
    ctx.fillStyle = '#030405';
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo((-6 + k * 9) * s, (-20 + k * 2) * s);
      ctx.lineTo((-2 + k * 9) * s + ruf, (-10 + k * 2.5) * s);
      ctx.lineTo((2 + k * 9) * s, (-19 + k * 2) * s);
      ctx.fill();
    }

    // head
    ctx.save();
    ctx.translate(-18 * s, -46 * s);
    ctx.rotate(crow.tilt);
    ctx.beginPath();
    ctx.arc(0, 0, 11 * s, 0, Math.PI * 2);
    ctx.fill();
    // beak (opens when speaking)
    const open = crow.beak * 0.35;
    ctx.fillStyle = '#16191d';
    ctx.beginPath();
    ctx.moveTo(-8 * s, -3 * s);
    ctx.lineTo(-28 * s, 1 * s - open * 10 * s);
    ctx.lineTo(-9 * s, 3 * s);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-8 * s, 3 * s);
    ctx.lineTo(-24 * s, 4 * s + open * 12 * s);
    ctx.lineTo(-8 * s, 6 * s);
    ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  // Eye drawn after darkness so it always glints
  function drawCrowEye() {
    const s = crow.s;
    const hop = Math.sin(Math.min(1, crow.hop) * Math.PI) * 14 * s;
    const hx = crow.x - 18 * s, hy = crow.y - hop - 46 * s;
    const ex = hx + Math.cos(crow.tilt) * -4 * s - Math.sin(crow.tilt) * -3 * s;
    const ey = hy + Math.sin(crow.tilt) * -4 * s + Math.cos(crow.tilt) * -3 * s;
    if (crow.blink > 0) return;
    ctx.save();
    ctx.fillStyle = '#e8b04a';
    ctx.shadowColor = '#ffcc66';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(ex, ey, 2.4 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(ex - 0.4 * s, ey, 1.1 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- Weather ----
  let rain = [];
  function initRain() {
    const n = Math.round((W * H) / 3500);
    rain = Array.from({ length: n }, () => ({ x: Math.random() * W * 1.2, y: Math.random() * H, l: 10 + Math.random() * 18, v: 700 + Math.random() * 500 }));
  }

  let fog = Array.from({ length: 5 }, (_, i) => ({ x: Math.random(), y: 0.55 + Math.random() * 0.4, r: 0.35 + Math.random() * 0.3, v: 0.006 + Math.random() * 0.01, a: 0.05 + i * 0.01 }));

  let flash = 0;               // 0..1 lightning brightness
  let flashQueue = [];         // pending flickers [delay, strength]
  let nextStrike = 3;
  let bolt = null;

  function strike() {
    const x = W * (0.1 + Math.random() * 0.8);
    const pts = [[x, 0]];
    let cx = x, cy = 0;
    const end = H * (0.35 + Math.random() * 0.3);
    while (cy < end) {
      cx += (Math.random() - 0.5) * M * 0.08;
      cy += M * (0.03 + Math.random() * 0.04);
      pts.push([cx, cy]);
    }
    bolt = { pts, life: 0.35 };
    flash = 1;
    flashQueue = [[0.09, 0.0], [0.14, 0.85], [0.3, 0.35]];
    sfx.thunder(0.35 + Math.random() * 0.9);
    nextStrike = state === 'fortune' ? 99 : 4 + Math.random() * 4.5;
  }

  // ---- Wisp (the cursor light) ----
  const wisp = { x: 0, y: 0, tx: 0, ty: 0, seen: false, motes: [] };

  // ---- Speech ----
  let speech = null;           // { text, t, dur }
  let fortuneLines = [];       // { text, t }

  function say(text, dur = 4.5) {
    speech = { text, t: 0, dur };
    crow.beak = 1;
    speechEl.textContent = text;
    sfx.caw();
  }

  function wrapLines(text, maxW, font) {
    ctx.font = font;
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawSpeech() {
    if (!speech) return;
    const { text, t, dur } = speech;
    const a = Math.min(1, t / 0.6) * Math.min(1, Math.max(0, (dur - t) / 0.8));
    if (a <= 0) return;
    const size = Math.max(16, Math.min(22, M / 30));
    const font = `italic ${size}px ${SERIF}`;
    const maxW = Math.min(360, W * 0.42);
    const lines = wrapLines(text, maxW, font);
    // Shown to the left of the crow, leaning toward the reader
    const x = Math.max(16 + maxW / 2, crow.x - crow.s * 60 - maxW / 2);
    const y = crow.y - crow.s * 110 - lines.length * size * 0.7;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.95)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#e4dccb';
    lines.forEach((l, i) => ctx.fillText(l, x, Math.max(size, y) + i * size * 1.35));
    ctx.restore();
  }

  // ---- HUD: offerings and luck ----
  function drawHud() {
    if (state === 'waiting') return;
    const slot = Math.max(22, M * 0.045);
    const taken = trinkets.filter((t) => t.taken);
    for (let k = 0; k < NEEDED; k++) {
      const x = 24 + slot / 2 + k * (slot + 10), y = 24 + slot / 2;
      ctx.strokeStyle = 'rgba(217,211,196,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, slot / 2, 0, Math.PI * 2);
      ctx.stroke();
      if (taken[k]) drawTrinket(ctx, { ...taken[k], x, y, rot: 0 }, 0.9);
    }
    // three candle flames = luck
    for (let k = 0; k < LUCK; k++) {
      const x = 24 + 8 + k * 18, y = 24 + slot + 26;
      ctx.fillStyle = 'rgba(217,211,196,0.25)';
      ctx.fillRect(x - 2, y, 4, 10);
      if (k < LUCK - mistakes) {
        const fl = 1 + Math.sin(time * 13 + k) * 0.15;
        ctx.save();
        ctx.fillStyle = '#ffcf7a';
        ctx.shadowColor = '#ffb347';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.ellipse(x, y - 5, 2.6, 5 * fl, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // ---- Game state ----
  let state = 'waiting';       // waiting | seek | fortune | over
  let time = 0;
  let mistakes = 0;
  let flying = [];             // trinkets flying to the crow
  let lastProgress = 0;
  let ended = false;
  let fortuneResult = '';
  let fortuneDone = 0;
  let introT = 0;              // title fade
  const standalone = window.parent === window;

  const PICKUP_LINES = {
    ring: 'A ring. Someone wept when they lost it.',
    key: 'A key. It still remembers its lock.',
    coin: 'A coin from a drowned pocket. Good.',
    button: 'A button, torn off in a hurry. I like it.',
    thimble: 'A thimble. For mending what can be mended.'
  };
  const FORTUNES = {
    ring: 'A promise you made in spring will come asking before the first frost.',
    key: 'A door you closed has learned your name. It is patient.',
    coin: 'You will pay twice for one thing. Only the second price is true.',
    button: 'Someone keeps a small piece of you in a drawer. Let them.',
    thimble: 'The small hurts, mended carefully, will be what holds you together.'
  };
  const TRICKED = [
    'That is fae-light, fool. It wants you to follow.',
    'Hear them laughing under the roots? Careful now.'
  ];

  function startGame() {
    if (state !== 'waiting') return;
    state = 'seek';
    lastProgress = time;
    leaveBtn.hidden = false;
    sfx.startRain();
    setTimeout(() => {
      if (state === 'seek') say('Kraa. Bring me three bright things from the mud, and I will tell you what waits for you.', 6);
    }, 900);
    nextStrike = Math.min(nextStrike, 2.5);
  }

  function collect(t) {
    t.taken = true;
    sfx.chime();
    flying.push({ t, x0: t.x, y0: t.y, p: 0 });
    lastProgress = time;
  }

  function trinketArrived(t) {
    crow.hop = 0.001;
    const count = trinkets.filter((x) => x.taken).length;
    if (count >= NEEDED) {
      beginFortune();
    } else {
      say(PICKUP_LINES[t.kind]);
    }
  }

  function trickedByFae() {
    mistakes++;
    sfx.giggle();
    if (mistakes >= LUCK) {
      say('Gone. The little folk have you now.', 6);
      finish(false, 'Led astray by the fae before the crow would speak');
    } else {
      say(TRICKED[(mistakes - 1) % TRICKED.length]);
    }
  }

  function beginFortune() {
    state = 'fortune';
    leaveBtn.hidden = true;
    speech = null;
    nextStrike = 99;
    sfx.softenRain();
    const kinds = trinkets.filter((x) => x.taken).map((x) => x.kind).slice(0, NEEDED);
    const lines = ['Listen.', ...kinds.map((k) => FORTUNES[k]), 'Now go. And never thank a crow.'];
    fortuneResult = `The crow foretold: "${FORTUNES[kinds[0]]}"`;
    fortuneLines = lines.map((text, i) => ({ text, at: time + 1 + i * 2.6 }));
    fortuneDone = time + 1 + lines.length * 2.6 + 1.5;
    speechEl.textContent = lines.join(' ');
    crow.beak = 1;
    sfx.caw();
  }

  function finish(success, result) {
    if (ended) return;
    ended = true;
    state = 'over';
    leaveBtn.hidden = true;
    window.parent.postMessage({ type: 'defrag:complete', success, result }, '*');
  }

  // ---- Input ----
  canvas.addEventListener('pointermove', (e) => {
    wisp.tx = e.clientX;
    wisp.ty = e.clientY;
    if (!wisp.seen) { wisp.x = wisp.tx; wisp.y = wisp.ty; wisp.seen = true; }
  });

  canvas.addEventListener('pointerdown', (e) => {
    sfx.unlock();
    wisp.tx = e.clientX; wisp.ty = e.clientY;
    if (!wisp.seen) { wisp.x = wisp.tx; wisp.y = wisp.ty; wisp.seen = true; }
    if (state === 'waiting' && standalone) { startGame(); return; }
    if (state !== 'seek') return;
    const x = e.clientX, y = e.clientY;
    const hitR = Math.max(20, M * 0.035);
    const t = trinkets.find((t) => !t.taken && Math.hypot(t.x - x, t.y - y) < hitR);
    if (t) { collect(t); return; }
    const f = faeGlints.find((g) => Math.hypot(g.x - x, g.y - y) < hitR * 0.9);
    if (f) {
      // the fae light darts away
      f.ph += 2 + Math.random() * 2;
      trickedByFae();
    }
  });

  leaveBtn.addEventListener('click', () => {
    if (state === 'seek') {
      say('Go, then. The storm keeps what you leave.', 4);
      finish(false, 'Left the forest without a fortune');
    }
  });

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'defrag:start') startGame();
    if (data.type === 'defrag:timeout' && !ended) {
      if (state === 'fortune') finish(true, fortuneResult);
      else finish(false, 'The storm swallowed you before the crow would speak');
    }
  });

  // ---- Sound: rain bed, thunder, caws ----
  const sfx = (() => {
    let ac = null, rainGain = null, rainFilter = null;
    function audio() {
      if (!ac) {
        try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
      }
      return ac;
    }
    function noiseBuffer(a, secs, brown) {
      const buf = a.createBuffer(1, a.sampleRate * secs, a.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
      }
      return buf;
    }
    function tone(freq, start, dur, type, vol, endFreq) {
      const a = audio();
      if (!a) return;
      const t = a.currentTime + start;
      const o = a.createOscillator(), g = a.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(a.destination);
      o.start(t); o.stop(t + dur + 0.05);
    }
    return {
      unlock() { const a = audio(); if (a && a.state === 'suspended') a.resume().catch(() => {}); },
      startRain() {
        const a = audio();
        if (!a || rainGain) return;
        const src = a.createBufferSource();
        src.buffer = noiseBuffer(a, 3, false);
        src.loop = true;
        rainFilter = a.createBiquadFilter();
        rainFilter.type = 'lowpass';
        rainFilter.frequency.value = 1400;
        rainGain = a.createGain();
        rainGain.gain.value = 0.045;
        src.connect(rainFilter).connect(rainGain).connect(a.destination);
        src.start();
      },
      softenRain() {
        if (!rainGain || !ac) return;
        rainGain.gain.linearRampToValueAtTime(0.015, ac.currentTime + 4);
        rainFilter.frequency.linearRampToValueAtTime(700, ac.currentTime + 4);
      },
      thunder(delay) {
        const a = audio();
        if (!a || a.state !== 'running') return;
        const t = a.currentTime + delay;
        const src = a.createBufferSource();
        src.buffer = noiseBuffer(a, 3.5, true);
        const f = a.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 260;
        const g = a.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.9, t + 0.08);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
        src.connect(f).connect(g).connect(a.destination);
        src.start(t);
      },
      caw() {
        const a = audio();
        if (!a || a.state !== 'running') return;
        for (let k = 0; k < 2; k++) {
          const t = a.currentTime + k * 0.32;
          const o = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(520, t);
          o.frequency.exponentialRampToValueAtTime(330, t + 0.22);
          f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 2.5;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
          o.connect(f).connect(g).connect(a.destination);
          o.start(t); o.stop(t + 0.3);
        }
      },
      chime() { tone(1318, 0, 1.2, 'sine', 0.06); tone(1976, 0.06, 1.0, 'sine', 0.035); },
      giggle() { [1568, 1760, 1568, 2093, 1760].forEach((f, i) => tone(f, i * 0.06, 0.12, 'triangle', 0.03)); }
    };
  })();

  // ---- Main loop ----
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  function update(dt) {
    // wisp drifts after the pointer, bobbing
    wisp.x += (wisp.tx - wisp.x) * Math.min(1, dt * 6);
    wisp.y += (wisp.ty - wisp.y) * Math.min(1, dt * 6);
    if (wisp.seen && Math.random() < dt * 30) {
      wisp.motes.push({ x: wisp.x, y: wisp.y, vx: (Math.random() - 0.5) * 20, vy: -10 - Math.random() * 20, life: 1 });
    }
    for (const m of wisp.motes) { m.x += m.vx * dt; m.y += m.vy * dt; m.life -= dt * 0.9; }
    wisp.motes = wisp.motes.filter((m) => m.life > 0);

    // lightning
    nextStrike -= dt;
    if (nextStrike <= 0) strike();
    flash = Math.max(0, flash - dt * 3.2);
    for (const q of flashQueue) {
      q[0] -= dt;
      if (q[0] <= 0 && q[1] !== null) { flash = Math.max(flash, q[1]); q[1] = null; }
    }
    if (bolt) { bolt.life -= dt; if (bolt.life <= 0) bolt = null; }

    // rain
    const wind = 0.28;
    const calm = state === 'fortune' || state === 'over' ? 0.35 : 1;
    for (const d of rain) {
      d.y += d.v * dt * calm;
      d.x -= d.v * wind * dt * calm;
      if (d.y > H) { d.y = -d.l; d.x = Math.random() * W * 1.3; }
    }
    for (const f of fog) { f.x += f.v * dt; if (f.x > 1.4) f.x = -0.4; }

    // fae lights wander
    for (const g of faeGlints) {
      g.x = (g.ax + Math.sin(time * g.sp + g.ph) * g.rx) * W;
      g.y = (g.ay + Math.sin(time * g.sp * 1.7 + g.ph * 2) * g.ry) * H;
    }

    // crow idle
    crow.tiltT -= dt;
    if (crow.tiltT <= 0) { crow.tiltT = 1.5 + Math.random() * 3; crow.targetTilt = (Math.random() - 0.5) * 0.7; }
    crow.tilt += ((crow.targetTilt || 0) - crow.tilt) * Math.min(1, dt * 5);
    crow.beak = Math.max(0, crow.beak - dt * 1.6);
    crow.ruffle += dt * (3 + flash * 8);
    crow.blinkT -= dt;
    if (crow.blinkT <= 0) { crow.blinkT = 2 + Math.random() * 4; crow.blink = 0.12; }
    crow.blink = Math.max(0, crow.blink - dt);
    if (crow.hop > 0) { crow.hop += dt * 2.5; if (crow.hop >= 1) crow.hop = 0; }

    // offerings flying to the crow
    for (const f of flying) {
      f.p += dt * 1.25;
      const p = Math.min(1, f.p);
      const tx = crow.x - crow.s * 30, ty = crow.y - crow.s * 44;
      f.t.x = f.x0 + (tx - f.x0) * p;
      f.t.y = f.y0 + (ty - f.y0) * p - Math.sin(p * Math.PI) * M * 0.2;
      if (f.p >= 1 && !f.done) { f.done = true; trinketArrived(f.t); }
    }
    flying = flying.filter((f) => !f.done);

    if (speech) { speech.t += dt; if (speech.t > speech.dur) speech = null; }

    // nudge if stuck
    if (state === 'seek' && time - lastProgress > 18 && !speech) {
      lastProgress = time;
      say('Watch when the sky splits open. Bright things glint.', 4.5);
    }

    if (state === 'fortune' && time >= fortuneDone) finish(true, fortuneResult);
    if (state !== 'waiting') introT = Math.min(1, introT + dt * 0.8);
  }

  function render() {
    ctx.drawImage(staticLayer, 0, 0, W, H);

    // mushroom glow
    for (const m of mushrooms) {
      const a = 0.18 + 0.1 * Math.sin(time * 1.3 + m.p);
      const g = ctx.createRadialGradient(m.x, m.y - m.s, 0, m.x, m.y - m.s, m.s * 6);
      g.addColorStop(0, `rgba(120,220,200,${a})`);
      g.addColorStop(1, 'rgba(120,220,200,0)');
      ctx.fillStyle = g;
      ctx.fillRect(m.x - m.s * 6, m.y - m.s * 7, m.s * 12, m.s * 12);
    }

    for (const t of trinkets) if (!t.taken) drawTrinket(ctx, t);
    drawCrow();

    // ---- darkness with light holes ----
    const dctx = darkLayer.getContext('2d');
    dctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    dctx.globalCompositeOperation = 'source-over';
    dctx.clearRect(0, 0, W, H);
    const base = state === 'fortune' || state === 'over' ? 0.72 : 0.95;
    dctx.fillStyle = `rgba(2,3,7,${base * (1 - flash)})`;
    dctx.fillRect(0, 0, W, H);
    dctx.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, strength) => {
      const g = dctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${strength})`);
      g.addColorStop(0.55, `rgba(0,0,0,${strength * 0.6})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      dctx.fillStyle = g;
      dctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    if (wisp.seen && state !== 'waiting') {
      const r = Math.max(90, Math.min(160, M * 0.17)) * (1 + Math.sin(time * 3) * 0.04);
      hole(wisp.x, wisp.y, r, 0.95);
    }
    for (const m of mushrooms) hole(m.x, m.y - m.s, m.s * 7, 0.45);
    hole(moon.x, moon.y, moon.r * 2.6, 0.75);
    if (state === 'fortune' || state === 'over') hole(crow.x, crow.y - crow.s * 40, M * 0.3, 0.7);
    else hole(crow.x - crow.s * 18, crow.y - crow.s * 46, crow.s * 40, 0.35);
    ctx.drawImage(darkLayer, 0, 0, W, H);

    // cold flash tint
    if (flash > 0) {
      ctx.fillStyle = `rgba(170,190,255,${flash * 0.18})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (bolt) {
      ctx.save();
      ctx.strokeStyle = `rgba(235,240,255,${Math.min(1, bolt.life * 4)})`;
      ctx.shadowColor = '#b8c8ff';
      ctx.shadowBlur = 18;
      ctx.lineWidth = 2;
      ctx.beginPath();
      bolt.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.restore();
    }

    // things that glow in the dark
    for (const t of trinkets) {
      if (t.taken) continue;
      sparkle(t.x, t.y - 2, M * 0.018, twinkle(time, t.tw, 4.2) * 0.9, '#eef4ff');
    }
    for (const f of faeGlints) {
      sparkle(f.x, f.y, M * 0.018, 0.15 + twinkle(time, f.tw, 2.6) * 0.75, '#e6f5b8');
    }
    for (const fl of flying) drawTrinket(ctx, fl.t);
    drawCrowEye();

    // rain
    ctx.strokeStyle = `rgba(180,195,215,${0.16 + flash * 0.35})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of rain) {
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.l * 0.28, d.y + d.l);
    }
    ctx.stroke();

    // drifting fog
    for (const f of fog) {
      const x = f.x * W, y = f.y * H, r = f.r * M;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(150,165,185,${f.a})`);
      g.addColorStop(1, 'rgba(150,165,185,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // wisp
    if (wisp.seen && state !== 'waiting') {
      for (const m of wisp.motes) {
        ctx.fillStyle = `rgba(200,230,255,${m.life * 0.5})`;
        ctx.fillRect(m.x, m.y, 2, 2);
      }
      const g = ctx.createRadialGradient(wisp.x, wisp.y, 0, wisp.x, wisp.y, 14);
      g.addColorStop(0, 'rgba(240,250,255,0.95)');
      g.addColorStop(0.4, 'rgba(170,215,255,0.5)');
      g.addColorStop(1, 'rgba(170,215,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(wisp.x, wisp.y, 14, 0, Math.PI * 2);
      ctx.fill();
    }

    drawSpeech();
    drawFortune();
    drawHud();
    drawTitle();
  }

  function drawFortune() {
    if (!fortuneLines.length) return;
    const size = Math.max(18, Math.min(30, M / 24));
    const font = `italic ${size}px ${SERIF}`;
    const maxW = Math.min(680, W * 0.82);
    let y = H * 0.16;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,1)';
    ctx.shadowBlur = 16;
    for (const fl of fortuneLines) {
      const a = Math.max(0, Math.min(1, (time - fl.at) / 1.4));
      const lines = wrapLines(fl.text, maxW, font);
      ctx.font = font;
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ece4d2';
      for (const l of lines) {
        ctx.fillText(l, W / 2, y + (1 - a) * 8);
        y += size * 1.35;
      }
      y += size * 0.5;
    }
    ctx.restore();
  }

  function drawTitle() {
    const a = 1 - introT;
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,1)';
    ctx.shadowBlur = 20;
    const big = Math.max(32, Math.min(76, M / 8.5));
    ctx.font = `${big}px ${SERIF}`;
    ctx.fillStyle = '#e8e0cd';
    ctx.fillText("The Crow’s Due", W / 2, H * 0.13);
    ctx.font = `italic ${big * 0.32}px ${SERIF}`;
    ctx.fillStyle = 'rgba(232,224,205,0.8)';
    ctx.fillText('bring three bright things, and hear what waits for you', W / 2, H * 0.13 + big * 0.85);
    ctx.font = `${big * 0.24}px ${SERIF}`;
    const pulse = 0.45 + 0.35 * Math.sin(time * 2);
    ctx.fillStyle = `rgba(232,224,205,${pulse})`;
    ctx.fillText(standalone ? 'click to enter the forest' : 'press Start Room to enter the forest', W / 2, H * 0.13 + big * 1.6);
    ctx.restore();
  }

  window.addEventListener('resize', () => { layout(); initRain(); });
  layout();
  initRain();
  requestAnimationFrame(frame);
})();
