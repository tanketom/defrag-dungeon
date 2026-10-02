// Defrag Grenade - an artillery game where every blast sorts the landscape.
(() => {
  'use strict';

  // ---- Tuning ----
  const W = 640;
  const H = 360;
  const CELL = 10;
  const GRID_X = 60;                     // terrain starts right of the PC tower
  const COLS = (W - GRID_X) / CELL;      // 58 columns
  const MIN_H = 6;
  const MAX_H = 22;
  const BLAST = 4;                       // columns either side of impact (9 wide)
  const GRENADES = 12;
  const WIN_PCT = 90;
  const GRAVITY = 320;                   // px/s^2
  const MIN_SPEED = 120;
  const MAX_SPEED = 460;
  const WIND_ACCEL = 14;                 // px/s^2 per wind step
  const BLAST_MS = 550;
  const CANNON = { x: 30, y: 104 };

  const COLORS = ['#000080', '#a80000', '#00a8a8', '#fcfc54'];
  const LIGHTS = ['#4040c0', '#e04040', '#60e0e0', '#ffffc0'];
  const SHADES = ['#000040', '#580000', '#005858', '#a8a800'];

  // ---- DOM ----
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  const el = (id) => document.getElementById(id);
  const ui = {
    dialog: el('dialog'),
    dialogTitle: el('dialog-title'),
    dialogIcon: el('dialog-icon'),
    dialogText: el('dialog-text'),
    dialogOk: el('dialog-ok'),
    pct: el('pct-label'),
    fill: el('progress-fill'),
    fire: el('fire-btn'),
    stop: el('stop-btn'),
    grenades: el('st-grenades'),
    wind: el('st-wind'),
    aim: el('st-aim'),
    time: el('st-time'),
    clock: el('clock')
  };

  // ---- State ----
  let columns = [];         // columns[c] = array of color indexes, bottom -> top
  let state = 'waiting';    // waiting | aim | flying | blast | over
  let angle = Math.PI / 4;
  let power = 0.6;
  let wind = 0;
  let grenadesLeft = GRENADES;
  let shell = null;
  let blast = null;
  let particles = [];
  let startTime = 0;
  let ended = false;
  let lastFrame = performance.now();

  // ---- Terrain ----
  function isSorted(col) {
    for (let i = 1; i < col.length; i++) {
      if (col[i] < col[i - 1]) return false;
    }
    return true;
  }

  function randomColumn(height) {
    let col;
    do {
      col = Array.from({ length: height }, () => Math.floor(Math.random() * COLORS.length));
    } while (isSorted(col));
    return col;
  }

  function generateTerrain() {
    const p1 = Math.random() * Math.PI * 2;
    const p2 = Math.random() * Math.PI * 2;
    columns = [];
    for (let c = 0; c < COLS; c++) {
      const h = 14 + 5 * Math.sin(c * 0.16 + p1) + 3 * Math.sin(c * 0.43 + p2) + (Math.random() - 0.5) * 2;
      const height = Math.max(MIN_H, Math.min(MAX_H, Math.round(h)));
      columns.push(randomColumn(height));
    }
  }

  function defragPercent() {
    const sorted = columns.filter(isSorted).length;
    return Math.floor((sorted / COLS) * 100);
  }

  // Sort a slab: pool its blocks, level the ground, and stack the pool in
  // horizontal strata (row by row from the bottom) so every column ends up sorted.
  function defragSlab(c0, c1) {
    const pool = [];
    for (let c = c0; c <= c1; c++) pool.push(...columns[c]);
    pool.sort((a, b) => a - b);

    const width = c1 - c0 + 1;
    const base = Math.floor(pool.length / width);
    let extra = pool.length % width;
    // Hand leftover blocks to the middle of the slab so it forms a gentle mound
    const order = [];
    for (let c = c0; c <= c1; c++) order.push(c);
    const mid = (c0 + c1) / 2;
    order.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
    const heights = {};
    for (const c of order) heights[c] = base + (extra-- > 0 ? 1 : 0);

    for (let c = c0; c <= c1; c++) columns[c] = [];
    let i = 0;
    for (let row = 0; i < pool.length; row++) {
      for (let c = c0; c <= c1; c++) {
        if (row < heights[c]) columns[c].push(pool[i++]);
      }
    }
  }

  // ---- Flow ----
  function newWind() {
    wind = Math.floor(Math.random() * 7) - 3;
  }

  function startGame() {
    if (state !== 'waiting') return;
    hideDialog();
    state = 'aim';
    startTime = performance.now();
    ui.fire.disabled = false;
    ui.stop.disabled = false;
    canvas.focus();
    updateHud();
  }

  function fire() {
    if (state !== 'aim' || grenadesLeft <= 0) return;
    grenadesLeft--;
    const speed = MIN_SPEED + power * (MAX_SPEED - MIN_SPEED);
    const tip = barrelTip();
    shell = {
      x: tip.x,
      y: tip.y,
      vx: Math.cos(angle) * speed,
      vy: -Math.sin(angle) * speed,
      trail: [],
      spin: 0
    };
    state = 'flying';
    ui.fire.disabled = true;
    sfx.fire();
    updateHud();
  }

  function explode(col, x, y) {
    const c0 = Math.max(0, col - BLAST);
    const c1 = Math.min(COLS - 1, col + BLAST);
    defragSlab(c0, c1);
    blast = { c0, c1, x, y, t: 0 };
    state = 'blast';
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * 160;
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 80,
        life: 0.6 + Math.random() * 0.5,
        color: COLORS[Math.floor(Math.random() * COLORS.length)]
      });
    }
    sfx.boom();
    updateHud();
  }

  function shellLost() {
    shell = null;
    afterShot();
  }

  function afterShot() {
    const pct = defragPercent();
    if (pct >= WIN_PCT) {
      const secs = Math.round(elapsed());
      const used = GRENADES - grenadesLeft;
      finish(true, `Defragmented ${pct}% of drive C: with ${used} grenade${used === 1 ? '' : 's'} in ${secs}s`);
      return;
    }
    if (grenadesLeft <= 0) {
      finish(false, `Out of grenades - drive C: only ${pct}% defragmented`);
      return;
    }
    newWind();
    state = 'aim';
    ui.fire.disabled = false;
    updateHud();
  }

  function finish(success, result) {
    if (ended) return;
    ended = true;
    state = 'over';
    shell = null;
    ui.fire.disabled = true;
    ui.stop.disabled = true;
    updateHud();
    if (success) {
      sfx.tada();
      showDialog('Disk Defragmenter', 'success', '&#10003;',
        `<p><b>Defragmentation of drive C: is complete.</b></p><p>${result}.</p>`);
    } else {
      sfx.error();
      showDialog('Disk Defragmenter', 'error', '&times;',
        `<p><b>Windows could not finish defragmenting drive C:.</b></p><p>${result}.</p>`);
    }
    window.parent.postMessage({ type: 'defrag:complete', success, result }, '*');
  }

  function elapsed() {
    return state === 'waiting' ? 0 : (performance.now() - startTime) / 1000;
  }

  // ---- Simulation ----
  function barrelTip() {
    return { x: CANNON.x + Math.cos(angle) * 22, y: CANNON.y - Math.sin(angle) * 22 };
  }

  function terrainHitAt(x, y) {
    if (x < GRID_X || x >= W) return -1;
    const c = Math.floor((x - GRID_X) / CELL);
    const row = Math.floor((H - y) / CELL);
    return row < columns[c].length ? c : -1;
  }

  function update(dt) {
    if (shell) {
      const steps = 4;
      const h = dt / steps;
      for (let i = 0; i < steps && shell; i++) {
        shell.vx += wind * WIND_ACCEL * h;
        shell.vy += GRAVITY * h;
        shell.x += shell.vx * h;
        shell.y += shell.vy * h;

        const hit = terrainHitAt(shell.x, shell.y);
        if (hit >= 0) {
          const { x, y } = shell;
          shell = null;
          explode(hit, x, y);
        } else if (shell.x < -20 || shell.x > W + 20 || shell.y > H + 10) {
          shellLost();
        } else if (shell.x < GRID_X && shell.y > CANNON.y + 14 && shell.vy > 0) {
          shellLost(); // landed back on the PC tower
        }
      }
      if (shell) {
        shell.spin += dt * 12;
        shell.trail.push({ x: shell.x, y: shell.y });
        if (shell.trail.length > 18) shell.trail.shift();
      }
    }

    if (blast) {
      blast.t += dt * 1000;
      if (blast.t >= BLAST_MS) {
        blast = null;
        afterShot();
      }
    }

    for (const p of particles) {
      p.vy += GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
  }

  // ---- Rendering ----
  function drawBlock(x, y, color) {
    ctx.fillStyle = COLORS[color];
    ctx.fillRect(x, y, CELL - 1, CELL - 1);
    ctx.fillStyle = LIGHTS[color];
    ctx.fillRect(x, y, CELL - 1, 1);
    ctx.fillRect(x, y, 1, CELL - 1);
    ctx.fillStyle = SHADES[color];
    ctx.fillRect(x, y + CELL - 2, CELL - 1, 1);
    ctx.fillRect(x + CELL - 2, y, 1, CELL - 1);
  }

  function drawTerrain() {
    // Sweep line for the blast animation: rows above it still "writing"
    let sweepRow = Infinity;
    if (blast) sweepRow = Math.floor((blast.t / BLAST_MS) * (MAX_H + 4));

    for (let c = 0; c < COLS; c++) {
      const col = columns[c];
      const x = GRID_X + c * CELL;
      const inBlast = blast && c >= blast.c0 && c <= blast.c1;
      for (let r = 0; r < col.length; r++) {
        const y = H - (r + 1) * CELL;
        if (inBlast && r >= sweepRow) {
          // Win95 defrag "reading/writing" flicker
          ctx.fillStyle = (r + c + Math.floor(blast.t / 60)) % 2 ? '#00a800' : '#ff5555';
          ctx.fillRect(x, y, CELL - 1, CELL - 1);
        } else {
          drawBlock(x, y, col[r]);
        }
      }
      // Tick above finished columns
      if (isSorted(col)) {
        ctx.fillStyle = '#00a800';
        ctx.fillRect(x + 3, H - col.length * CELL - 4, 3, 2);
      }
    }
  }

  function drawTower() {
    // Beige PC tower
    const tx = 10, ty = CANNON.y + 12, tw = 40, th = H - ty;
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(tx, ty, tw, th);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tx, ty, tw, 2);
    ctx.fillRect(tx, ty, 2, th);
    ctx.fillStyle = '#808080';
    ctx.fillRect(tx + tw - 2, ty, 2, th);
    // Drive bays
    for (let i = 0; i < 3; i++) {
      const by = ty + 10 + i * 16;
      ctx.fillStyle = '#a0a0a0';
      ctx.fillRect(tx + 6, by, tw - 12, 10);
      ctx.fillStyle = '#404040';
      ctx.fillRect(tx + 9, by + 4, tw - 18, 2);
    }
    // Power LED
    ctx.fillStyle = state === 'over' ? '#808080' : '#00ff00';
    ctx.fillRect(tx + 8, ty + th - 22, 4, 3);
    ctx.fillStyle = '#ffaa00';
    if (state === 'flying' || state === 'blast') ctx.fillRect(tx + 16, ty + th - 22, 4, 3);

    // Mortar barrel
    ctx.save();
    ctx.translate(CANNON.x, CANNON.y);
    ctx.rotate(-angle);
    ctx.fillStyle = '#404040';
    ctx.fillRect(0, -4, 24, 8);
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, -4, 24, 2);
    ctx.fillStyle = '#000080';
    ctx.fillRect(20, -5, 4, 10);
    ctx.restore();

    // Turret dome
    ctx.fillStyle = '#c0c0c0';
    ctx.beginPath();
    ctx.arc(CANNON.x, CANNON.y + 12, 12, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawAim() {
    if (state !== 'aim') return;
    const speed = MIN_SPEED + power * (MAX_SPEED - MIN_SPEED);
    const tip = barrelTip();
    let x = tip.x, y = tip.y;
    let vx = Math.cos(angle) * speed, vy = -Math.sin(angle) * speed;
    ctx.fillStyle = '#000';
    const dt = 1 / 60;
    for (let i = 0; i < 40; i++) {
      vy += GRAVITY * dt;
      x += vx * dt;
      y += vy * dt;
      if (i % 4 === 0) ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
    }
  }

  function drawShell() {
    if (!shell) return;
    ctx.fillStyle = '#808080';
    shell.trail.forEach((p, i) => {
      if (i % 2 === 0) ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    });
    const x = Math.round(shell.x), y = Math.round(shell.y);
    ctx.fillStyle = '#000080';
    ctx.fillRect(x - 3, y - 3, 7, 7);
    ctx.fillStyle = '#4040c0';
    ctx.fillRect(x - 3, y - 3, 7, 2);
    // Fuse spark
    ctx.fillStyle = Math.floor(shell.spin) % 2 ? '#ff0000' : '#fcfc54';
    ctx.fillRect(x - 1, y - 6, 2, 2);
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 3, 3);
    }
    if (blast && blast.t < 160) {
      const r = 8 + blast.t / 6;
      ctx.strokeStyle = '#000';
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(blast.x - r, blast.y - r, r * 2, r * 2);
      ctx.setLineDash([]);
    }
  }

  function drawWindSock() {
    const x = W - 70, y = 14;
    ctx.fillStyle = '#000';
    ctx.font = '10px Tahoma, sans-serif';
    ctx.fillText('WIND', x, y + 4);
    const len = Math.abs(wind) * 8;
    if (len === 0) {
      ctx.fillText('calm', x + 32, y + 4);
      return;
    }
    const dir = Math.sign(wind);
    const sx = x + 50 - (dir > 0 ? len / 2 : -len / 2);
    ctx.fillStyle = '#a80000';
    ctx.fillRect(Math.min(sx, sx + dir * len), y, len, 3);
    ctx.beginPath();
    ctx.moveTo(sx + dir * (len + 5), y + 1.5);
    ctx.lineTo(sx + dir * len, y - 3);
    ctx.lineTo(sx + dir * len, y + 6);
    ctx.fill();
  }

  function render() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // Faint cluster grid, like the defrag map
    ctx.fillStyle = '#ececec';
    for (let x = GRID_X; x < W; x += CELL) {
      for (let y = H - CELL * (MAX_H + 6); y < H; y += CELL) ctx.fillRect(x, y, 1, 1);
    }

    drawTerrain();
    drawTower();
    drawAim();
    drawShell();
    drawParticles();
    drawWindSock();
  }

  // ---- HUD ----
  function updateHud() {
    const pct = defragPercent();
    ui.pct.textContent = `${pct}% defragmented`;
    ui.fill.style.width = `${pct}%`;
    ui.grenades.textContent = `Grenades: ${grenadesLeft}`;
    ui.wind.textContent = wind === 0 ? 'Wind: calm' : `Wind: ${wind < 0 ? '←' : '→'} ${Math.abs(wind)}`;
    const deg = Math.round((angle * 180) / Math.PI);
    ui.aim.textContent = `Angle ${deg}° · Power ${Math.round(power * 100)}%`;
  }

  function updateClock() {
    const secs = Math.floor(elapsed());
    ui.time.textContent = `${secs}s`;
    const now = new Date();
    let h = now.getHours();
    const m = String(now.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    ui.clock.textContent = `${h}:${m} ${ampm}`;
  }

  function showDialog(title, kind, icon, html, okLabel) {
    ui.dialogTitle.textContent = title;
    ui.dialogIcon.className = `dialog-icon ${kind}`;
    ui.dialogIcon.innerHTML = icon;
    ui.dialogText.innerHTML = html;
    ui.dialogOk.hidden = !okLabel;
    if (okLabel) ui.dialogOk.textContent = okLabel;
    ui.dialog.hidden = false;
  }

  function hideDialog() {
    ui.dialog.hidden = true;
  }

  // ---- Input ----
  function setAimFromPointer(e) {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    const dx = x - CANNON.x;
    const dy = CANNON.y - y;
    angle = Math.max(-0.2, Math.min(Math.PI / 2 - 0.02, Math.atan2(dy, dx)));
    power = Math.max(0.05, Math.min(1, Math.hypot(dx, dy) / 320));
    updateHud();
  }

  canvas.addEventListener('pointermove', (e) => {
    if (state === 'aim') setAimFromPointer(e);
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'aim') return;
    setAimFromPointer(e);
    fire();
  });

  window.addEventListener('keydown', (e) => {
    if (state !== 'aim') return;
    const step = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowLeft') angle = Math.min(Math.PI / 2 - 0.02, angle + (step * Math.PI) / 180);
    else if (e.key === 'ArrowRight') angle = Math.max(-0.2, angle - (step * Math.PI) / 180);
    else if (e.key === 'ArrowUp') power = Math.min(1, power + step / 100);
    else if (e.key === 'ArrowDown') power = Math.max(0.05, power - step / 100);
    else if (e.key === ' ' || e.key === 'Enter') fire();
    else return;
    e.preventDefault();
    updateHud();
  });

  ui.fire.addEventListener('click', fire);

  ui.stop.addEventListener('click', () => {
    if (state === 'waiting' || state === 'over') return;
    finish(false, `Defragmentation stopped by user at ${defragPercent()}%`);
  });

  ui.dialogOk.addEventListener('click', startGame);

  // ---- Host protocol ----
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'defrag:start') startGame();
    if (data.type === 'defrag:timeout' && !ended) {
      finish(false, `Time expired - drive C: ${defragPercent()}% defragmented`);
    }
  });

  // ---- Sound (tiny WebAudio bleeps, fail silently) ----
  const sfx = (() => {
    let ac = null;
    function audio() {
      if (!ac) {
        try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
      }
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      return ac;
    }
    function tone(freq, start, dur, type = 'square', vol = 0.06, endFreq) {
      const a = audio();
      if (!a) return;
      const t = a.currentTime + start;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + dur);
    }
    function noise(dur, vol) {
      const a = audio();
      if (!a) return;
      const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = a.createBufferSource();
      const g = a.createGain();
      g.gain.value = vol;
      src.buffer = buf;
      src.connect(g).connect(a.destination);
      src.start();
    }
    return {
      fire: () => tone(180, 0, 0.15, 'square', 0.05, 60),
      boom: () => { noise(0.35, 0.18); tone(90, 0, 0.3, 'sine', 0.15, 40); },
      tada: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.4, 'triangle', 0.08)),
      error: () => { tone(440, 0, 0.18, 'square', 0.05); tone(330, 0.16, 0.3, 'square', 0.05); }
    };
  })();

  // ---- Main loop ----
  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (state !== 'waiting') update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---- Boot ----
  generateTerrain();
  newWind();
  updateHud();
  updateClock();
  setInterval(updateClock, 250);

  const standalone = window.parent === window;
  showDialog('Disk Defragmenter', 'info', 'i',
    `<p><b>Drive C: is badly fragmented.</b></p>
     <p>Lob defrag grenades onto the landscape. Each blast levels and sorts the blocks it hits.
     Get <b>${WIN_PCT}%</b> of columns sorted using ${GRENADES} grenades.</p>
     <p>Aim with the mouse and click to fire, or use the arrow keys and Space.</p>
     <p>${standalone ? 'Click OK to begin.' : 'Click <b>Start Room</b> to begin.'}</p>`,
    standalone ? 'OK' : null);

  requestAnimationFrame(frame);
})();
