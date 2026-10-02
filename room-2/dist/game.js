// Super Stretchy 64 - grab a low-poly face and stretch it, start-screen style.
// Tiny flat-shaded software renderer on Canvas 2D; no external libraries.
(() => {
  'use strict';

  // ---- Tuning ----
  const STARS_TO_WIN = 6;
  const SIGMA = 0.3;          // stretch falloff radius (model units)
  const MAX_PULL = 2.4;       // max displacement of a grabbed point
  const SPRING_K = 120;       // snap-back stiffness
  const SPRING_C = 6.5;       // snap-back damping (low = more wobble)
  const HOLD_TIME = 0.35;     // seconds a feature must sit inside the star
  const HEAD_Y = 0.32;        // lift the model so the face sits above centre

  // ---- Canvas ----
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const quitBtn = document.getElementById('quit-btn');
  let W = 0, H = 0, F = 1;
  let camZ = 4.4;

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    F = Math.min(W, H) * 0.95;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- Mesh ----
  const rest = [];            // x,y,z per vertex
  const tris = [];
  const lines = [];
  const eyeVerts = [];        // { i, cy } for blinking

  function V(x, y, z) {
    rest.push(x, y, z);
    return rest.length / 3 - 1;
  }

  // ref: a point "inside" the surface; triangles get wound so their normal points away from it
  function T(a, b, c, color, opts = {}) {
    const t = {
      a, b, c, color,
      bias: opts.bias || 0,
      cull: opts.cull !== false,
      alpha: opts.alpha || 1,
      ref: opts.ref || null,
      front: !!opts.front
    };
    tris.push(t);
    return t;
  }

  function L(a, b, width, color, bias = -0.3) {
    lines.push({ a, b, width, color, bias });
  }

  const P = (i) => [rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  function gauss(d, c, s) {
    const n = norm(c);
    const dd = (d[0] - n[0]) ** 2 + (d[1] - n[1]) ** 2 + (d[2] - n[2]) ** 2;
    return Math.exp(-dd / (2 * s * s));
  }

  // Unit direction -> head surface point
  function headShape(d) {
    let x = d[0] * 0.8, y = d[1] * 1.04, z = d[2] * 0.88;
    if (d[1] < -0.2) {
      const t = (-0.2 - d[1]) / 0.8;
      x *= 1 - 0.2 * t;
      z *= 1 - 0.04 * t;
    }
    const chin = gauss(d, [0, -0.72, 0.69], 0.3);
    z += 0.09 * chin;
    y -= 0.05 * chin;
    for (const s of [-1, 1]) {
      const cheek = gauss(d, [0.5 * s, -0.25, 0.83], 0.28);
      x += 0.05 * s * cheek;
      z += 0.07 * cheek;
      const socket = gauss(d, [0.36 * s, 0.06, 0.93], 0.16);
      z -= 0.05 * socket;
    }
    return [x, y, z];
  }

  // -- Head (staggered lat/long sphere for a faceted look) --
  const HEAD_R = 14, HEAD_C = 18;
  const headTriStart = tris.length;
  const topV = V(...headShape([0, 1, 0]));
  const rings = [];
  for (let i = 1; i < HEAD_R; i++) {
    const phi = (i * Math.PI) / HEAD_R;
    const ring = [];
    for (let j = 0; j < HEAD_C; j++) {
      const th = ((j + (i % 2) * 0.5) * 2 * Math.PI) / HEAD_C;
      ring.push(V(...headShape([Math.sin(phi) * Math.sin(th), Math.cos(phi), Math.sin(phi) * Math.cos(th)])));
    }
    rings.push(ring);
  }
  const bottomV = V(...headShape([0, -1, 0]));
  const O = [0, 0, 0];
  for (let j = 0; j < HEAD_C; j++) {
    T(topV, rings[0][j], rings[0][(j + 1) % HEAD_C], null, { ref: O });
    const last = rings[rings.length - 1];
    T(bottomV, last[j], last[(j + 1) % HEAD_C], null, { ref: O });
  }
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i], b = rings[i + 1];
    for (let j = 0; j < HEAD_C; j++) {
      const j1 = (j + 1) % HEAD_C;
      if (i % 2 === 0) {
        // ring b is offset +half a step
        T(a[j], a[j1], b[j], null, { ref: O });
        T(b[j], b[j1], a[j1], null, { ref: O });
      } else {
        // ring a is offset +half a step
        T(b[j], b[j1], a[j], null, { ref: O });
        T(a[j], a[j1], b[j1], null, { ref: O });
      }
    }
  }
  const headTriEnd = tris.length;

  // Make winding consistent so normals point outward (needed by surfaceZ below)
  function orient(t) {
    const A = P(t.a), B = P(t.b), C = P(t.c);
    const n = cross(sub(B, A), sub(C, A));
    const g = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
    const out = t.front ? [0, 0, 1] : sub(g, t.ref || g);
    if (dot(n, out) < 0) { const tmp = t.b; t.b = t.c; t.c = tmp; }
  }
  for (let k = headTriStart; k < headTriEnd; k++) orient(tris[k]);

  // Front surface depth at (x, y): ray along -z against the head mesh
  function surfaceZ(x, y) {
    let best = -Infinity;
    for (let k = headTriStart; k < headTriEnd; k++) {
      const t = tris[k];
      const A = P(t.a), B = P(t.b), C = P(t.c);
      const n = cross(sub(B, A), sub(C, A));
      if (n[2] <= 0) continue;
      const d = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((B[1] - C[1]) * (x - C[0]) + (C[0] - B[0]) * (y - C[1])) / d;
      const v = ((C[1] - A[1]) * (x - C[0]) + (A[0] - C[0]) * (y - C[1])) / d;
      const w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      best = Math.max(best, u * A[2] + v * B[2] + w * C[2]);
    }
    return best === -Infinity ? 0 : best;
  }

  const SKIN = [236, 178, 150];
  const SKIN_DARK = [214, 150, 128];
  const STUBBLE = [196, 174, 158];
  const BROW = [150, 132, 118];

  function headColor(t) {
    const A = P(t.a), B = P(t.b), C = P(t.c);
    const g = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
    const jitter = ((t.a * 37 + t.b * 17) % 11) - 5;
    let col = SKIN;
    const lowerFace = g[2] > -0.15 && (g[1] < -0.27 || (g[1] < -0.08 && Math.abs(g[0]) > 0.5));
    if (lowerFace) col = STUBBLE;
    else if (g[1] > 0.55) col = [246, 196, 172]; // shiny dome
    return col.map((v) => Math.max(0, Math.min(255, v + jitter)));
  }
  for (let k = headTriStart; k < headTriEnd; k++) tris[k].color = headColor(tris[k]);

  // -- Features (placed on the surface, drawn with a depth bias) --
  const featureOpts = (bias = -0.2) => ({ front: true, bias });

  // Mouth: big open grin with top teeth
  {
    const K = 8, mw = 0.27, my = -0.42;
    const top = [], mid = [], bot = [], lip = [];
    for (let k = 0; k <= K; k++) {
      const x = -mw + (2 * mw * k) / K;
      const t = x / mw;
      const yT = my + 0.06 * t * t;
      const yB = my - 0.15 * (1 - t * t) + 0.06 * t * t;
      const yM = yT + (yB - yT) * 0.38;
      top.push(V(x, yT, surfaceZ(x, yT) + 0.015));
      mid.push(V(x, yM, surfaceZ(x, yM) + 0.015));
      bot.push(V(x, yB, surfaceZ(x, yB) + 0.015));
      const yL = yB - 0.035 * (1 - t * t);
      lip.push(V(x, yL, surfaceZ(x, yL) + 0.012));
    }
    for (let k = 0; k < K; k++) {
      T(top[k], top[k + 1], mid[k + 1], [248, 244, 230], featureOpts());
      T(top[k], mid[k + 1], mid[k], [248, 244, 230], featureOpts());
      T(mid[k], mid[k + 1], bot[k + 1], [96, 26, 32], featureOpts());
      T(mid[k], bot[k + 1], bot[k], [96, 26, 32], featureOpts());
      T(bot[k], bot[k + 1], lip[k + 1], [206, 122, 112], featureOpts(-0.18));
      T(bot[k], lip[k + 1], lip[k], [206, 122, 112], featureOpts(-0.18));
    }
  }

  // Eyes: smiling squint, white + iris
  const eyeCenters = [];
  for (const s of [-1, 1]) {
    const cx = 0.3 * s, cy = 0.06;
    const z0 = surfaceZ(cx, cy) + 0.03;
    eyeCenters.push([cx, cy]);
    const c = V(cx, cy, z0);
    eyeVerts.push({ i: c, cy });
    const ring = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const i = V(cx + Math.cos(a) * 0.085, cy + Math.sin(a) * 0.045, z0);
      eyeVerts.push({ i, cy });
      ring.push(i);
    }
    for (let k = 0; k < 8; k++) T(c, ring[k], ring[(k + 1) % 8], [250, 250, 244], featureOpts(-0.22));
    const ic = V(cx + 0.008 * s, cy, z0 + 0.01);
    eyeVerts.push({ i: ic, cy });
    const iring = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const i = V(cx + 0.008 * s + Math.cos(a) * 0.038, cy + Math.sin(a) * 0.036, z0 + 0.01);
      eyeVerts.push({ i, cy });
      iring.push(i);
    }
    for (let k = 0; k < 6; k++) T(ic, iring[k], iring[(k + 1) % 6], [58, 44, 36], featureOpts(-0.24));
    const g1 = V(cx - 0.012, cy + 0.018, z0 + 0.02), g2 = V(cx + 0.006, cy + 0.02, z0 + 0.02), g3 = V(cx - 0.004, cy + 0.004, z0 + 0.02);
    for (const i of [g1, g2, g3]) eyeVerts.push({ i, cy });
    T(g1, g2, g3, [255, 255, 255], featureOpts(-0.26));

    // Eyebrow: light grey arch
    const pts = [];
    for (let k = 0; k <= 4; k++) {
      const x = s * (0.15 + k * 0.075);
      const y = 0.205 + 0.035 * Math.sin((k / 4) * Math.PI) - 0.01 * k;
      pts.push([V(x, y + 0.02, surfaceZ(x, y) + 0.02), V(x, y - 0.018, surfaceZ(x, y) + 0.02)]);
    }
    for (let k = 0; k < 4; k++) {
      T(pts[k][0], pts[k + 1][0], pts[k + 1][1], BROW, featureOpts());
      T(pts[k][0], pts[k + 1][1], pts[k][1], BROW, featureOpts());
    }
  }

  // Nose: chunky wedge
  let noseTip;
  {
    const z = (x, y) => surfaceZ(x, y);
    const n0 = V(0, 0.14, z(0, 0.14) + 0.01);
    const n1 = V(0, -0.17, z(0, -0.17) + 0.21);
    const n2 = V(-0.13, -0.23, z(-0.13, -0.23) + 0.02);
    const n3 = V(0.13, -0.23, z(0.13, -0.23) + 0.02);
    const n4 = V(0, -0.27, z(0, -0.27) + 0.07);
    const n5 = V(-0.07, -0.02, z(-0.07, -0.02) + 0.06);
    const n6 = V(0.07, -0.02, z(0.07, -0.02) + 0.06);
    const ref = [0, -0.1, z(0, -0.1) - 0.1];
    const o = (bias) => ({ ref, bias });
    T(n0, n5, n1, SKIN, o(-0.12));
    T(n0, n1, n6, SKIN, o(-0.12));
    T(n5, n2, n1, SKIN, o(-0.12));
    T(n6, n1, n3, SKIN, o(-0.12));
    T(n2, n4, n1, SKIN_DARK, o(-0.12));
    T(n1, n4, n3, SKIN_DARK, o(-0.12));
    noseTip = n1;
  }

  // Ears
  const earTips = [];
  for (const s of [-1, 1]) {
    const e0 = V(0.76 * s, 0.13, 0.05);
    const e1 = V(0.78 * s, -0.24, 0.02);
    const e2 = V(0.93 * s, 0.16, -0.09);
    const e3 = V(0.98 * s, -0.02, -0.13);
    const e4 = V(0.89 * s, -0.27, -0.08);
    const e5 = V(0.74 * s, -0.02, -0.18);
    const inner = V(0.86 * s, -0.04, -0.05);
    const opts = { ref: [0, 0, 0], cull: false, bias: -0.02 };
    T(e0, e2, inner, SKIN, opts);
    T(e2, e3, inner, SKIN, opts);
    T(e3, e4, inner, SKIN, opts);
    T(e4, e1, inner, SKIN_DARK, opts);
    T(e1, e0, inner, [205, 135, 118], opts);
    T(e2, e5, e3, SKIN_DARK, opts);
    T(e3, e5, e4, SKIN_DARK, opts);
    earTips.push(e3);
  }

  // Glasses: browline frames (thick dark top, thin lower rim)
  {
    const zF = Math.max(surfaceZ(-0.3, 0.05), surfaceZ(0.3, 0.05)) + 0.1;
    const lens = [];
    for (const s of [-1, 1]) {
      const cx = 0.3 * s, cy = 0.05, hw = 0.17, hh = 0.11;
      const pts = [];
      const N = 16;
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2;
        const c = Math.cos(a), sn = Math.sin(a);
        pts.push({
          i: V(cx + hw * Math.sign(c) * Math.abs(c) ** 0.45, cy + hh * Math.sign(sn) * Math.abs(sn) ** 0.45, zF),
          topEdge: sn > 0.25
        });
      }
      for (let k = 0; k < N; k++) {
        const p = pts[k], q = pts[(k + 1) % N];
        const top = p.topEdge && q.topEdge;
        L(p.i, q.i, top ? 0.045 : 0.016, top ? '#1a1414' : '#5c5c66');
      }
      // Lens tint
      const lc = V(cx, cy, zF - 0.005);
      for (let k = 0; k < N; k++) {
        T(lc, pts[k].i, pts[(k + 1) % N].i, [200, 225, 255], { front: true, bias: -0.28, alpha: 0.13, cull: false });
      }
      lens.push({ s, cx });
      // Temple arm back to the ear
      const t0 = V(0.47 * s, 0.11, zF - 0.02);
      const t1 = V(0.8 * s, 0.11, -0.02);
      const t2 = V(0.84 * s, 0.05, -0.3);
      L(t0, t1, 0.03, '#1a1414', -0.05);
      L(t1, t2, 0.025, '#1a1414', 0.05);
    }
    const b0 = V(-0.135, 0.12, zF), b1 = V(0, 0.135, zF + 0.01), b2 = V(0.135, 0.12, zF);
    L(b0, b1, 0.035, '#1a1414');
    L(b1, b2, 0.035, '#1a1414');
  }

  // Neck + burgundy shirt with a collar
  function frustum(y0, rx0, rz0, y1, rx1, rz1, segs, zOff, colorFn) {
    const r0 = [], r1 = [];
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      r0.push(V(Math.sin(a) * rx0, y0, zOff + Math.cos(a) * rz0));
      r1.push(V(Math.sin(a) * rx1, y1, zOff + Math.cos(a) * rz1));
    }
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      const ref = [0, (y0 + y1) / 2, zOff];
      T(r0[j], r0[j1], r1[j], colorFn(j), { ref });
      T(r1[j], r0[j1], r1[j1], colorFn(j), { ref });
    }
  }
  frustum(-0.62, 0.36, 0.32, -1.45, 0.4, 0.36, 10, -0.08, (j) => (j % 2 ? SKIN : SKIN_DARK));
  frustum(-1.22, 0.5, 0.42, -3.4, 2.0, 0.8, 14, -0.05, (j) => (j % 2 ? [84, 28, 38] : [98, 34, 46]));
  for (const s of [-1, 1]) {
    const c0 = V(0.04 * s, -1.32, 0.46);
    const c1 = V(0.46 * s, -1.12, 0.28);
    const c2 = V(0.34 * s, -1.6, 0.5);
    T(c0, c1, c2, [110, 40, 52], { front: true, bias: -0.1, cull: false });
  }

  for (const t of tris) orient(t);

  const VCOUNT = rest.length / 3;
  const restArr = Float32Array.from(rest);
  const pos = new Float32Array(VCOUNT * 3);
  const cam = new Float32Array(VCOUNT * 3);
  const scr = new Float32Array(VCOUNT * 2);
  const depth = new Float32Array(VCOUNT);

  function nearestVertex(target, maxIndex = VCOUNT) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < maxIndex; i++) {
      const d = (restArr[i * 3] - target[0]) ** 2 + (restArr[i * 3 + 1] - target[1]) ** 2 + (restArr[i * 3 + 2] - target[2]) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  const FEATURES = [
    { name: 'NOSE', v: noseTip },
    { name: 'CHIN', v: nearestVertex([0, -0.98, 0.45], bottomV + 1) },
    { name: 'LEFT EAR', v: earTips[0] },
    { name: 'RIGHT EAR', v: earTips[1] },
    { name: 'BALD HEAD', v: topV },
    { name: 'LEFT CHEEK', v: nearestVertex([-0.6, -0.22, 0.62], bottomV + 1) },
    { name: 'RIGHT CHEEK', v: nearestVertex([0.6, -0.22, 0.62], bottomV + 1) }
  ];

  // ---- Stretch handles ----
  const handles = [];

  function makeHandle(vi) {
    const ax = restArr[vi * 3], ay = restArr[vi * 3 + 1], az = restArr[vi * 3 + 2];
    const w = new Float32Array(VCOUNT);
    const inv = 1 / (2 * SIGMA * SIGMA);
    for (let i = 0; i < VCOUNT; i++) {
      const d = (restArr[i * 3] - ax) ** 2 + (restArr[i * 3 + 1] - ay) ** 2 + (restArr[i * 3 + 2] - az) ** 2;
      w[i] = Math.exp(-d * inv);
    }
    return { vi, w, d: [0, 0, 0], v: [0, 0, 0], target: [0, 0, 0], held: true, sx: 0, sy: 0, depth: 1 };
  }

  // ---- View state ----
  let yaw = 0, pitch = 0, manualYaw = 0, manualPitch = 0;
  let pointer = { x: W / 2, y: H / 2, inside: false };
  let grab = null;            // active handle
  let rotating = null;        // { x, y } while dragging background
  let blinkT = 2.5, blink = 1;
  let time = 0;

  function computePositions() {
    for (let i = 0; i < VCOUNT * 3; i++) pos[i] = restArr[i];
    if (blink < 1) {
      for (const e of eyeVerts) pos[e.i * 3 + 1] = e.cy + (restArr[e.i * 3 + 1] - e.cy) * blink;
    }
    for (const h of handles) {
      const [dx, dy, dz] = h.d;
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 1e-5) continue;
      const w = h.w;
      for (let i = 0; i < VCOUNT; i++) {
        const k = w[i];
        if (k < 0.002) continue;
        pos[i * 3] += dx * k;
        pos[i * 3 + 1] += dy * k;
        pos[i * 3 + 2] += dz * k;
      }
    }
  }

  function project() {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const bob = Math.sin(time * 1.6) * 0.03;
    const cx0 = W / 2, cy0 = H / 2;
    for (let i = 0; i < VCOUNT; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      const y2 = y * cp - z1 * sp + HEAD_Y + bob;
      const z2 = y * sp + z1 * cp;
      cam[i * 3] = x1; cam[i * 3 + 1] = y2; cam[i * 3 + 2] = z2;
      const d = Math.max(0.2, camZ - z2);
      depth[i] = d;
      scr[i * 2] = cx0 + (F * x1) / d;
      scr[i * 2 + 1] = cy0 - (F * y2) / d;
    }
  }

  // Screen-space drag -> model-space displacement
  function screenDeltaToModel(dxs, dys, d) {
    const dx = (dxs * d) / F;
    const dy = (-dys * d) / F;
    const len = Math.hypot(dx, dy);
    const dz = Math.min(0.6, len * 0.22);          // pull slightly toward the camera
    const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
    const y = dy * cp + dz * sp;
    const z1 = -dy * sp + dz * cp;
    const x = dx * cy - z1 * sy;
    const z = dx * sy + z1 * cy;
    const l = Math.hypot(x, y, z);
    const s = l > MAX_PULL ? MAX_PULL / l : 1;
    return [x * s, y * s, z * s];
  }

  // ---- Rendering ----
  const LIGHT = norm([-0.35, 0.55, 0.8]);
  let drawList = [];

  function buildDrawList() {
    const items = [];
    for (const t of tris) {
      const a = t.a, b = t.b, c = t.c;
      const ax = scr[a * 2], ay = scr[a * 2 + 1], bx = scr[b * 2], by = scr[b * 2 + 1], cx = scr[c * 2], cy = scr[c * 2 + 1];
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (t.cull && area >= 0) continue;
      const A = [cam[a * 3], cam[a * 3 + 1], cam[a * 3 + 2]];
      const n = norm(cross(sub([cam[b * 3], cam[b * 3 + 1], cam[b * 3 + 2]], A), sub([cam[c * 3], cam[c * 3 + 1], cam[c * 3 + 2]], A)));
      let lit = Math.abs(dot(n, LIGHT));
      if (t.cull) lit = Math.max(0, dot(n, LIGHT));
      const k = 0.45 + 0.62 * lit;
      items.push({
        kind: 0, t,
        z: (depth[a] + depth[b] + depth[c]) / 3 + t.bias,
        fill: `rgba(${Math.min(255, t.color[0] * k) | 0},${Math.min(255, t.color[1] * k) | 0},${Math.min(255, t.color[2] * k) | 0},${t.alpha})`
      });
    }
    for (const l of lines) {
      items.push({ kind: 1, l, z: (depth[l.a] + depth[l.b]) / 2 + l.bias });
    }
    items.sort((p, q) => q.z - p.z);
    return items;
  }

  function drawModel() {
    drawList = buildDrawList();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const it of drawList) {
      if (it.kind === 0) {
        const t = it.t;
        ctx.beginPath();
        ctx.moveTo(scr[t.a * 2], scr[t.a * 2 + 1]);
        ctx.lineTo(scr[t.b * 2], scr[t.b * 2 + 1]);
        ctx.lineTo(scr[t.c * 2], scr[t.c * 2 + 1]);
        ctx.closePath();
        ctx.fillStyle = it.fill;
        ctx.fill();
        if (t.alpha === 1) {
          ctx.strokeStyle = it.fill;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      } else {
        const l = it.l;
        ctx.strokeStyle = l.color;
        ctx.lineWidth = Math.max(1, (l.width * F) / ((depth[l.a] + depth[l.b]) / 2));
        ctx.beginPath();
        ctx.moveTo(scr[l.a * 2], scr[l.a * 2 + 1]);
        ctx.lineTo(scr[l.b * 2], scr[l.b * 2 + 1]);
        ctx.stroke();
      }
    }
  }

  function pickVertex(x, y) {
    for (let k = drawList.length - 1; k >= 0; k--) {
      const it = drawList[k];
      if (it.kind !== 0 || it.t.alpha < 1) continue;
      const t = it.t;
      const ax = scr[t.a * 2], ay = scr[t.a * 2 + 1], bx = scr[t.b * 2], by = scr[t.b * 2 + 1], cx = scr[t.c * 2], cy = scr[t.c * 2 + 1];
      const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
      const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
      const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
      const neg = d1 < 0 || d2 < 0 || d3 < 0, pos2 = d1 > 0 || d2 > 0 || d3 > 0;
      if (neg && pos2) continue;
      let best = t.a, bd = Infinity;
      for (const v of [t.a, t.b, t.c]) {
        const d = (scr[v * 2] - x) ** 2 + (scr[v * 2 + 1] - y) ** 2;
        if (d < bd) { bd = d; best = v; }
      }
      return best;
    }
    return -1;
  }

  // Background: deep blue vignette with twinkling specks
  const specks = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), p: Math.random() * 6 }));
  function drawBackground() {
    const g = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.max(W, H) * 0.75);
    g.addColorStop(0, '#3346c8');
    g.addColorStop(0.55, '#16206e');
    g.addColorStop(1, '#03031a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    for (const s of specks) {
      const a = 0.25 + 0.25 * Math.sin(time * 2 + s.p);
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fillRect(s.x * W, s.y * H, 2, 2);
    }
  }

  function drawStar(x, y, r, rot, alpha = 1, eyes = true) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const rr = k % 2 ? r * 0.45 : r;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, '#fff6a0');
    g.addColorStop(0.5, '#fcd116');
    g.addColorStop(1, '#f08c00');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.08);
    ctx.strokeStyle = '#7a3c00';
    ctx.stroke();
    if (eyes) {
      ctx.fillStyle = '#111';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * r * 0.15, -r * 0.05, r * 0.06, r * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawGlove(x, y, closed) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.35);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#1b1b2a';
    ctx.fillStyle = '#ffffff';
    const blob = (cx, cy, rx, ry, rot = 0) => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    if (closed) {
      blob(0, 4, 15, 13);
      for (let k = 0; k < 4; k++) blob(-9 + k * 6, -6, 4.5, 5);
      blob(-14, 6, 5, 8, 0.6);
    } else {
      for (let k = 0; k < 4; k++) blob(-9 + k * 6, -10 + Math.abs(k - 1.5) * 2, 3.6, 10);
      blob(-17, 4, 4, 9, 0.9);
      blob(-1, 6, 13, 11);
    }
    // cuff
    ctx.beginPath();
    ctx.ellipse(0, 20, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function outlinedText(text, x, y, size, fill, align = 'center') {
    ctx.font = `900 ${size}px "Arial Black", Impact, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, size * 0.18);
    ctx.strokeStyle = '#0b0b3a';
    ctx.strokeText(text, x, y + size * 0.06);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }

  function drawLogo(alpha, yOff) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    const size = Math.min(W / 13, H / 14, 56);
    const words = ['SUPER', 'STRETCHY', '64'];
    const palette = ['#e52521', '#43b047', '#fcd116', '#049cd8'];
    ctx.font = `900 ${size}px "Arial Black", Impact, sans-serif`;
    const lineH = size * 1.05;
    const top = size * 0.9 + yOff;
    let colorIdx = 0;
    words.forEach((word, wi) => {
      const s = wi === 1 ? size : size * 0.8;
      ctx.font = `900 ${s}px "Arial Black", Impact, sans-serif`;
      const widths = [...word].map((ch) => ctx.measureText(ch).width);
      const total = widths.reduce((a, b) => a + b, 0);
      let x = W / 2 - total / 2;
      const y = top + wi * lineH * 0.85;
      [...word].forEach((ch, i) => {
        const wob = Math.sin(time * 3 + colorIdx * 0.7) * 3;
        outlinedText(ch, x + widths[i] / 2, y + wob, s, palette[colorIdx % palette.length]);
        x += widths[i];
        colorIdx++;
      });
    });
    ctx.restore();
  }

  // ---- Game state ----
  let state = 'waiting';      // waiting | play | over
  let startTime = 0;
  let logoT = 0;              // 0..1 logo fade-out after start
  let queue = [];
  let current = null;         // { feature, x, y, r, hold }
  let collected = 0;
  let pops = [];              // floating texts
  let sparks = [];
  let ended = false;
  let endText = null;
  const standalone = window.parent === window;

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startGame() {
    if (state !== 'waiting') return;
    state = 'play';
    startTime = performance.now();
    queue = shuffle(FEATURES.slice()).slice(0, STARS_TO_WIN);
    quitBtn.hidden = false;
    sfx.hello();
    pops.push({ text: "LET'S-A STRETCH!", x: W / 2, y: H * 0.78, t: 0, color: '#fcd116' });
    nextTarget();
  }

  function nextTarget() {
    const feature = queue.shift();
    if (!feature) return;
    const fx = scr[feature.v * 2], fy = scr[feature.v * 2 + 1];
    const hx = W / 2, hy = H / 2 - (F * HEAD_Y) / camZ;
    let dx = fx - hx, dy = fy - hy;
    let len = Math.hypot(dx, dy);
    if (len < 30) {
      const a = [0.5, 2.6, -0.4, 3.5][Math.floor(Math.random() * 4)];
      dx = Math.cos(a); dy = Math.sin(a); len = 1;
    }
    dx /= len; dy /= len;
    // Wiggle the direction a bit so it's not always straight out
    const wig = (Math.random() - 0.5) * 0.8;
    const ca = Math.cos(wig), sa = Math.sin(wig);
    [dx, dy] = [dx * ca - dy * sa, dx * sa + dy * ca];
    const m = Math.min(W, H);
    const dist = m * (0.2 + Math.random() * 0.08);
    const r = Math.max(30, m * 0.065);
    const margin = r + 12;
    current = {
      feature,
      x: Math.max(margin, Math.min(W - margin, fx + dx * dist)),
      y: Math.max(margin + 70, Math.min(H - margin - 40, fy + dy * dist)),
      r,
      hold: 0,
      born: time
    };
  }

  function collect() {
    collected++;
    sfx.coin();
    for (let k = 0; k < 24; k++) {
      const a = Math.random() * Math.PI * 2, s = 80 + Math.random() * 220;
      sparks.push({ x: current.x, y: current.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.8 });
    }
    const cheers = ['WAHOO!', 'YAHOO!', 'BOING!', 'STRETCHY!', 'HOO-HOO!', 'PERFECTO!'];
    pops.push({ text: cheers[(collected - 1) % cheers.length], x: current.x, y: current.y - current.r - 10, t: 0, color: '#ffffff' });
    current = null;
    if (collected >= STARS_TO_WIN) {
      const secs = Math.round((performance.now() - startTime) / 1000);
      finish(true, `Stretched ${collected} features into power stars in ${secs}s`);
    } else {
      nextTarget();
    }
  }

  function finish(success, result) {
    if (ended) return;
    ended = true;
    state = 'over';
    current = null;
    quitBtn.hidden = true;
    releaseGrab();
    endText = success ? 'COURSE CLEAR!' : 'TOO BAD!';
    if (success) sfx.fanfare(); else sfx.fail();
    window.parent.postMessage({ type: 'defrag:complete', success, result }, '*');
  }

  // ---- Input ----
  function releaseGrab() {
    if (grab) {
      grab.held = false;
      sfx.boing(Math.hypot(...grab.d));
      grab = null;
    }
    rotating = null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    pointer = { x: e.clientX, y: e.clientY, inside: true };
    if (state === 'waiting' && standalone) { startGame(); return; }
    if (state !== 'play') return;
    canvas.setPointerCapture(e.pointerId);
    const vi = pickVertex(e.clientX, e.clientY);
    if (vi >= 0) {
      const h = makeHandle(vi);
      h.sx = e.clientX;
      h.sy = e.clientY;
      h.depth = depth[vi];
      handles.push(h);
      if (handles.length > 10) handles.shift();
      grab = h;
      sfx.grab();
    } else {
      rotating = { x: e.clientX, y: e.clientY };
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const px = e.clientX, py = e.clientY;
    if (rotating) {
      manualYaw = Math.max(-1.3, Math.min(1.3, manualYaw + (px - rotating.x) * 0.008));
      manualPitch = Math.max(-0.6, Math.min(0.6, manualPitch + (py - rotating.y) * 0.006));
      rotating = { x: px, y: py };
    }
    pointer = { x: px, y: py, inside: true };
  });

  canvas.addEventListener('pointerup', releaseGrab);
  canvas.addEventListener('pointercancel', releaseGrab);
  canvas.addEventListener('pointerleave', () => { pointer.inside = false; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camZ = Math.max(3.2, Math.min(6.5, camZ + e.deltaY * 0.003));
  }, { passive: false });

  quitBtn.addEventListener('click', () => {
    if (state === 'play') finish(false, `Gave up after ${collected}/${STARS_TO_WIN} stars`);
  });

  // ---- Host protocol ----
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'defrag:start') startGame();
    if (data.type === 'defrag:timeout' && !ended) {
      finish(false, `Time's up! Collected ${collected}/${STARS_TO_WIN} power stars`);
    }
  });

  // ---- Sound ----
  const sfx = (() => {
    let ac = null;
    function audio() {
      if (!ac) {
        try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
      }
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      return ac;
    }
    function tone(freq, start, dur, type = 'square', vol = 0.05, endFreq, vibrato = 0) {
      const a = audio();
      if (!a) return;
      const t = a.currentTime + start;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
      if (vibrato) {
        const lfo = a.createOscillator();
        const lg = a.createGain();
        lfo.frequency.value = 18;
        lg.gain.value = vibrato;
        lfo.connect(lg).connect(o.frequency);
        lfo.start(t);
        lfo.stop(t + dur);
      }
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + dur);
    }
    return {
      grab: () => tone(300, 0, 0.08, 'sine', 0.08, 600),
      boing: (amt) => { if (amt > 0.15) tone(160 + amt * 60, 0, 0.45, 'sine', 0.1, 90, 40); },
      coin: () => { tone(988, 0, 0.08, 'square', 0.05); tone(1319, 0.08, 0.3, 'square', 0.05); },
      hello: () => [523, 659, 784].forEach((f, i) => tone(f, i * 0.07, 0.2, 'triangle', 0.07)),
      fanfare: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.3, 'square', 0.04)),
      fail: () => [392, 370, 349, 330].forEach((f, i) => tone(f, i * 0.18, 0.25, 'triangle', 0.07))
    };
  })();

  // ---- Main loop ----
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    time += dt;

    // Blink every few seconds
    blinkT -= dt;
    if (blinkT < 0) { blinkT = 2 + Math.random() * 3; }
    blink = blinkT < 0.14 ? 0.1 : 1;

    // Head follows the glove unless something is held
    if (!rotating) {
      manualYaw *= Math.max(0, 1 - dt * 0.8);
      manualPitch *= Math.max(0, 1 - dt * 0.8);
    }
    if (!grab) {
      const tx = pointer.inside ? (pointer.x / W - 0.5) * 0.7 : 0;
      const ty = pointer.inside ? (pointer.y / H - 0.5) * 0.35 : 0;
      yaw += (tx + manualYaw - yaw) * Math.min(1, dt * 4);
      pitch += (ty + manualPitch - pitch) * Math.min(1, dt * 4);
    }

    // Handles: held ones chase the pointer, released ones spring back
    for (const h of handles) {
      if (h.held) {
        h.target = screenDeltaToModel(pointer.x - h.sx, pointer.y - h.sy, h.depth);
        for (let k = 0; k < 3; k++) h.d[k] += (h.target[k] - h.d[k]) * Math.min(1, dt * 22);
      } else {
        for (let k = 0; k < 3; k++) {
          h.v[k] += (-SPRING_K * h.d[k] - SPRING_C * h.v[k]) * dt;
          h.d[k] += h.v[k] * dt;
        }
      }
    }
    for (let i = handles.length - 1; i >= 0; i--) {
      const h = handles[i];
      if (!h.held && Math.hypot(...h.d) < 0.002 && Math.hypot(...h.v) < 0.01) handles.splice(i, 1);
    }

    computePositions();
    project();

    if (state === 'play') logoT = Math.min(1, logoT + dt * 1.5);

    // Target check
    if (current) {
      const fx = scr[current.feature.v * 2], fy = scr[current.feature.v * 2 + 1];
      const inside = Math.hypot(fx - current.x, fy - current.y) < current.r * 0.9;
      current.hold = inside ? current.hold + dt : Math.max(0, current.hold - dt * 2);
      if (current.hold >= HOLD_TIME) collect();
    }

    // ---- Draw ----
    drawBackground();
    drawModel();

    if (current) {
      const c = current;
      const pulse = 1 + Math.sin(time * 6) * 0.06;
      const grow = Math.min(1, (time - c.born) * 4);
      drawStar(c.x, c.y, c.r * pulse * grow, Math.sin(time * 2) * 0.25, 0.95);
      if (c.hold > 0) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r * 1.25, -Math.PI / 2, -Math.PI / 2 + (c.hold / HOLD_TIME) * Math.PI * 2);
        ctx.stroke();
      }
      // Pulsing marker on the feature to pull
      const fx = scr[c.feature.v * 2], fy = scr[c.feature.v * 2 + 1];
      ctx.strokeStyle = `rgba(252,209,22,${0.6 + 0.4 * Math.sin(time * 8)})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(fx, fy, 16 + Math.sin(time * 8) * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const s of sparks) {
      s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 300 * dt; s.life -= dt;
      drawStar(s.x, s.y, 7, time * 5, Math.max(0, s.life), false);
    }
    sparks = sparks.filter((s) => s.life > 0);

    for (const p of pops) {
      p.t += dt;
      const a = Math.max(0, 1 - p.t / 1.4);
      ctx.save();
      ctx.globalAlpha = a;
      outlinedText(p.text, p.x, p.y - p.t * 40, Math.min(48, W / 14), p.color);
      ctx.restore();
    }
    pops = pops.filter((p) => p.t < 1.4);

    // HUD
    drawLogo(1 - logoT, -logoT * 80);
    if (state === 'waiting') {
      const blinkOn = Math.floor(time * 2) % 2 === 0;
      if (blinkOn) {
        outlinedText(standalone ? 'CLICK TO START' : 'PRESS  START  ROOM', W / 2, H * 0.9, Math.min(30, W / 22), '#ffffff');
      }
    }
    if (state !== 'waiting') {
      const size = Math.min(34, W / 18);
      drawStar(30 + size * 0.5, 30 + size * 0.4, size * 0.6, 0, 1, true);
      outlinedText(`× ${collected}/${STARS_TO_WIN}`, 30 + size * 1.3, 30 + size * 0.4, size, '#ffffff', 'left');
    }
    if (current && logoT >= 1) {
      outlinedText(`PULL THE ${current.feature.name} INTO THE STAR!`, W / 2, H - 78, Math.min(26, W / 26), '#fcd116');
    }
    if (endText) {
      outlinedText(endText, W / 2, H * 0.18, Math.min(72, W / 9), state === 'over' && collected >= STARS_TO_WIN ? '#fcd116' : '#e52521');
    }

    if (pointer.inside) drawGlove(pointer.x, pointer.y, !!grab);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
