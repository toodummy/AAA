// Procedural world layout. Pure data: returns placements + ground paint instructions.
import { PROPS, WORLD } from './defs.js';
import { makeRng, TAU } from '../core/rng.js';

const HOUSE_TINTS = [0xf4e3c1, 0xe8c9a0, 0xc9dfe8, 0xf2b8a2, 0xd5e8c4, 0xf6f1e6, 0xe3c4dc, 0xf7d98b, 0xb9d3c2, 0xe9a48a];
const CAR_TINTS = [0xd83a2e, 0x2f6fd6, 0xf2f2f2, 0x222831, 0xf2b705, 0x3fa34d, 0x9aa5b1, 0xe8762c, 0x7b4bc4, 0x1fb5a8];
const TOWER_TINTS = [0x9fc4d8, 0x7fb0c9, 0xb8c6cf, 0xd8c9a8, 0x88a7b8, 0xa9d0c6, 0xc7b6d6, 0x6f93a8];
const SHIRT_TINTS = [0xe84a4a, 0x4a8fe8, 0xf2d24a, 0x5ac46a, 0xf29a4a, 0xb86ad8, 0xf2f2f2, 0x40c8c8, 0xf06aa8];
const ROOF_TINTS = [0xffffff, 0xf0f0f0, 0xe6e6e6];
const BLD_TINTS = [0xe9dccb, 0xd9b99b, 0xcfd6dc, 0xc98b6b, 0xe6e0d4, 0xb8a79a, 0xd6c3a5, 0xa8b5a2];

export const GRID = 100;      // city block pitch
export const ROAD_W = 14;
export const CITY_R = 860;

export function zoneAt(x, z) {
  const d = Math.hypot(x, z);
  if (Math.hypot(x + 640, z + 560) < 150) return 'military';
  if (Math.hypot(x + 640, z - 170) < 135) return 'fair';
  if (Math.hypot(x - 640, z - 660) < 170) return 'airport';
  if (Math.hypot(x - 640, z + 690) < 150) return 'nuclear';
  if (x > 520 && Math.abs(z) < 330 && d < 1000) return 'port';
  if (d < 300) return 'downtown';
  if (d < 540) return 'midtown';
  if (d < CITY_R) return 'suburb';
  return 'farm';
}

export function generateWorld(seed = 1) {
  const rng = makeRng(seed * 7919 + 13);
  const out = [];
  const paint = [];   // {k:'rect'|'circle', x,z,w,d,r,rot,color}
  const occ = new Map(); // coarse occupancy hash (8m cells) -> radius list
  const key = (x, z) => ((Math.floor(x / 16) + 512) << 11) | (Math.floor(z / 16) + 512);
  function free(x, z, r) {
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16), n = Math.ceil(r / 16) + 1;
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const l = occ.get(((cx + i + 512) << 11) | (cz + j + 512));
      if (!l) continue;
      for (let k = 0; k < l.length; k += 3) {
        const dx = l[k] - x, dz = l[k + 1] - z, rr = l[k + 2] + r;
        if (dx * dx + dz * dz < rr * rr) return false;
      }
    }
    return true;
  }
  function put(t, x, z, r = 0, c = 0xffffff, s = 1, force = false) {
    const def = PROPS[t];
    if (!def) throw new Error('unknown prop ' + t);
    if (Math.hypot(x, z) > WORLD.radius - 20) return false;
    const rad = Math.max(def.w, def.d) * 0.5 * s * (def.kind === 'bld' ? 0.8 : 0.55);
    if (!force && !free(x, z, rad)) return false;
    const k = key(x, z);
    let l = occ.get(k); if (!l) occ.set(k, (l = []));
    l.push(x, z, rad);
    out.push({ t, x, z, r, c, s });
    return true;
  }
  const P = (k, o) => paint.push({ k, ...o });
  const scatter = (t, cx, cz, rad, n, opt = {}) => {
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, d = Math.sqrt(rng()) * rad;
      const tt = Array.isArray(t) ? rng.pick(t) : t;
      put(tt, cx + Math.cos(a) * d, cz + Math.sin(a) * d, opt.rot ?? rng() * TAU, opt.tints ? rng.pick(opt.tints) : 0xffffff, opt.s ? rng.range(opt.s[0], opt.s[1]) : 1);
    }
  };
  const person = (x, z) => put('person', x, z, rng() * TAU, rng.pick(SHIRT_TINTS), rng.range(0.92, 1.1));
  const car = (x, z, r) => put(rng.chance(0.2) ? 'pickup' : rng.chance(0.12) ? 'taxi' : 'car', x, z, r, rng.pick(CAR_TINTS));

  // ---------------- special landmarks (placed first so they win space) ----------------
  P('circle', { x: 0, z: 0, r: 70, color: '#8d8f94' });
  put('mega_tower', 0, 0, 0, 0x8fb6cc, 1, true);
  put('capitol', 0, -330, 0, 0xf2efe6, 1, true);
  P('rect', { x: 0, z: -330, w: 150, d: 110, color: '#7fae62' });
  // duck lake park
  P('circle', { x: 300, z: 300, r: 95, color: '#6fae5a' });
  P('circle', { x: 300, z: 300, r: 62, color: '#3d8fc4', water: 1 });
  put('giant_duck', 300, 300, -0.6, 0xffd91a, 1, true);
  // stadium
  P('rect', { x: -300, z: -300, w: 170, d: 150, color: '#77797f' });
  put('stadium', -300, -300, 0, 0xe6e6ea, 1, true);
  // nuclear plant
  P('circle', { x: 640, z: -690, r: 150, color: '#9a9b93' });
  put('cooling_tower', 600, -720, 0, 0xe9e9e4, 1, true);
  put('cooling_tower', 690, -650, 0, 0xe9e9e4, 1, true);
  put('factory', 610, -620, 0, 0xcfd6dc, 1, true);
  for (let i = 0; i < 4; i++) put('fuel_tank', 700 + (i % 2) * 22, -760 + Math.floor(i / 2) * 22, 0, 0xf2f2f2);
  put('radio_tower', 560, -640, 0);
  // fairground
  P('circle', { x: -640, z: 170, r: 135, color: '#d9c48a' });
  put('ferris', -640, 130, 0.3, 0xffffff, 1, true);
  put('coaster', -700, 220, 0.2, 0xffffff, 1, true);
  for (let i = 0; i < 16; i++) { const a = rng() * TAU, d = 30 + rng() * 95; put(rng.pick(['tent', 'foodcart', 'foodcart', 'portapotty', 'bench', 'trashcan']), -640 + Math.cos(a) * d, 170 + Math.sin(a) * d, rng() * TAU, rng.pick(CAR_TINTS)); }
  for (let i = 0; i < 70; i++) { const a = rng() * TAU, d = 15 + rng() * 115; person(-640 + Math.cos(a) * d, 170 + Math.sin(a) * d); }
  // airport
  P('circle', { x: 640, z: 660, r: 170, color: '#93a07c' });
  P('rect', { x: 640, z: 660, w: 300, d: 34, rot: 0.5, color: '#3c3f45', runway: 1 });
  P('rect', { x: 600, z: 740, w: 150, d: 70, rot: 0.5, color: '#5b5e64' });
  put('airliner', 570, 720, 2.2, 0xffffff, 1, true); put('airliner', 630, 760, 2.2, 0xffffff, 1, true);
  put('airliner', 700, 640, 0.5 + Math.PI / 2, 0xffffff, 1, true);
  for (let i = 0; i < 6; i++) put('small_plane', 520 + i * 18, 640 + i * 9, 2.0, rng.pick(CAR_TINTS));
  put('warehouse', 700, 780, 0.5, 0xcfd6dc); put('warehouse', 742, 742, 0.5, 0xcfd6dc);
  put('radio_tower', 760, 690, 0);
  // military base
  P('circle', { x: -640, z: -560, r: 150, color: '#7d8468' });
  P('rect', { x: -640, z: -560, w: 190, d: 150, color: '#5f6258' });
  for (let i = 0; i < 4; i++) put('warehouse', -720 + i * 44, -640, 0, 0x7d8a5a);
  put('radio_tower', -560, -620, 0); put('fuel_tank', -730, -500, 0, 0x9aa37a); put('fuel_tank', -705, -480, 0, 0x9aa37a);
  // wind farm (west farmland)
  for (let i = 0; i < 9; i++) put('wind_turbine', -1010 + (i % 3) * 70 + rng.range(-10, 10), -180 + Math.floor(i / 3) * 80, rng() * TAU);

  // ---------------- city blocks ----------------
  const N = Math.ceil(CITY_R / GRID);
  for (let i = -N; i < N; i++) for (let j = -N; j < N; j++) {
    const cx = i * GRID + GRID / 2, cz = j * GRID + GRID / 2;
    const d = Math.hypot(cx, cz);
    if (d > CITY_R) continue;
    const zone = zoneAt(cx, cz);
    if (zone === 'military' || zone === 'fair' || zone === 'airport' || zone === 'nuclear') continue;
    const L = GRID - ROAD_W;       // lot size
    const h = L / 2;
    if (Math.hypot(cx, cz) < 80) continue;                 // mega tower plaza
    if (Math.hypot(cx, cz + 330) < 110) continue;          // capitol
    if (Math.hypot(cx - 300, cz - 300) < 120) continue;    // duck park
    if (Math.hypot(cx + 300, cz + 300) < 120) continue;    // stadium
    // street furniture & parked cars along the block edges
    const furn = zone === 'suburb' ? 3 : 6;
    for (let k = 0; k < furn; k++) {
      const side = rng.int(0, 3), u = rng.range(-h + 4, h - 4), e = h + 1.2;
      const x = side < 2 ? cx + u : cx + (side === 2 ? -e : e), z = side < 2 ? cz + (side === 0 ? -e : e) : cz + u;
      put(rng.pick(['streetlight', 'streetlight', 'hydrant', 'trashcan', 'bench', 'sign', 'busstop', 'mailbox', 'cone']), x, z, side < 2 ? 0 : Math.PI / 2);
    }
    const ncars = zone === 'suburb' ? 2 : 5;
    for (let k = 0; k < ncars; k++) {
      const side = rng.int(0, 3), u = rng.range(-h + 6, h - 6), e = h + 4.6;
      const x = side < 2 ? cx + u : cx + (side === 2 ? -e : e), z = side < 2 ? cz + (side === 0 ? -e : e) : cz + u;
      if (rng.chance(0.1)) put(rng.pick(['bus', 'semi', 'schoolbus']), x, z, side < 2 ? Math.PI / 2 : 0, rng.pick(CAR_TINTS));
      else car(x, z, side < 2 ? Math.PI / 2 : 0);
    }
    if (zone === 'downtown') {
      P('rect', { x: cx, z: cz, w: L, d: L, color: '#9a9ca3' });
      const big = rng.pick(['tower_a', 'tower_b', 'tower_a', 'tower_b', 'hotel']);
      if (rng.chance(0.55)) {
        put(big, cx, cz, rng.int(0, 3) * Math.PI / 2, rng.pick(TOWER_TINTS), 1, true);
      } else {
        for (const [ox, oz] of [[-22, -22], [22, -22], [-22, 22], [22, 22]]) {
          if (rng.chance(0.85)) put(rng.pick(['office', 'office', 'tower_a', 'apartment']), cx + ox, cz + oz, rng.int(0, 3) * Math.PI / 2, rng.pick(TOWER_TINTS), rng.range(0.85, 1.0), true);
        }
      }
      for (let k = 0; k < 9; k++) person(cx + rng.range(-h, h), cz + rng.sign() * (h - 1.5));
    } else if (zone === 'midtown') {
      P('rect', { x: cx, z: cz, w: L, d: L, color: rng.chance(0.25) ? '#7fae62' : '#a3a39c' });
      const roll = rng();
      if (roll < 0.1) { put('mall', cx, cz, rng.int(0, 1) * Math.PI / 2, rng.pick(BLD_TINTS), 1, true); }
      else if (roll < 0.2) { put('hospital', cx, cz, rng.int(0, 3) * Math.PI / 2, 0xf2f2f2, 1, true); }
      else if (roll < 0.3) { put('school', cx - 8, cz, 0, rng.pick(BLD_TINTS), 1, true); put('playground', cx + 28, cz + 26, 0); for (let k = 0; k < 12; k++) person(cx + rng.range(10, 36), cz + rng.range(-10, 36)); }
      else if (roll < 0.38) { // park
        P('rect', { x: cx, z: cz, w: L, d: L, color: '#6fae5a' });
        scatter(['tree_big', 'tree_small', 'tree_small', 'bush', 'bench'], cx, cz, 38, 22);
        for (let k = 0; k < 14; k++) person(cx + rng.range(-h, h), cz + rng.range(-h, h));
        if (rng.chance(0.5)) put('foodcart', cx + rng.range(-20, 20), cz + rng.range(-20, 20), rng() * TAU, rng.pick(CAR_TINTS));
      } else if (roll < 0.46) { // parking + store
        put('store', cx, cz - 26, 0, rng.pick(BLD_TINTS), 1, true);
        P('rect', { x: cx, z: cz + 16, w: L - 6, d: 46, color: '#4a4c52' });
        for (let k = 0; k < 16; k++) if (rng.chance(0.7)) car(cx - 35 + (k % 8) * 10, cz + 6 + Math.floor(k / 8) * 20, 0);
      } else {
        const picks = ['apartment', 'apartment', 'store', 'church', 'office', 'apartment', 'diner', 'donut_shop', 'gas_station'];
        for (const [ox, oz] of [[-21, -21], [21, -21], [-21, 21], [21, 21]]) {
          const t = rng.pick(picks);
          put(t, cx + ox, cz + oz, rng.int(0, 3) * Math.PI / 2, rng.pick(BLD_TINTS), t === 'store' ? 0.8 : 1, true);
        }
        scatter(['tree_small', 'dumpster', 'bush'], cx, cz, 40, 5);
      }
      for (let k = 0; k < 5; k++) person(cx + rng.range(-h, h), cz + rng.sign() * (h - 1.5));
    } else if (zone === 'port') {
      P('rect', { x: cx, z: cz, w: L, d: L, color: '#77797c' });
      const roll = rng();
      if (roll < 0.3) { put('warehouse', cx, cz - 20, 0, rng.pick(BLD_TINTS), 1, true); put('warehouse', cx, cz + 22, 0, rng.pick(BLD_TINTS), 1, true); }
      else if (roll < 0.5) { put('factory', cx, cz, rng.int(0, 1) * Math.PI / 2, rng.pick(BLD_TINTS), 1, true); }
      else if (roll < 0.7) { for (const [ox, oz] of [[-20, -20], [20, -20], [-20, 20], [20, 20]]) put('fuel_tank', cx + ox, cz + oz, 0, 0xf2f2f2, 1, true); }
      else { // container yard
        for (let a = 0; a < 5; a++) for (let b = 0; b < 4; b++) if (rng.chance(0.8)) put('container', cx - 32 + a * 16, cz - 30 + b * 20, Math.PI / 2 * rng.int(0, 1) * 0, rng.pick(CAR_TINTS), 1, true);
        put('crane', cx + 30, cz, 0, 0xf2b705);
      }
      scatter(['crate', 'barrel', 'dumpster', 'cone'], cx, cz, 40, 8);
    } else { // suburb
      P('rect', { x: cx, z: cz, w: L, d: L, color: rng.pick(['#7fb866', '#86bd6a', '#79b060']) });
      const roll = rng();
      if (roll < 0.06) { put(rng.pick(['diner', 'donut_shop', 'gas_station']), cx, cz - 20, 0, rng.pick(BLD_TINTS), 1, true); P('rect', { x: cx, z: cz + 14, w: 60, d: 34, color: '#4a4c52' }); for (let k = 0; k < 6; k++) if (rng.chance(0.6)) car(cx - 25 + k * 10, cz + 14, 0); }
      else if (roll < 0.11) { scatter(['tree_big', 'tree_small', 'bush', 'bench'], cx, cz, 38, 16); put('playground', cx, cz, 0, 0xffffff, 1, true); for (let k = 0; k < 8; k++) person(cx + rng.range(-20, 20), cz + rng.range(-20, 20)); }
      else if (roll < 0.14) { put('church', cx, cz, rng.int(0, 3) * Math.PI / 2, 0xf6f1e6, 1, true); scatter(['tree_small', 'bush'], cx, cz, 40, 8); }
      else if (roll < 0.17) { put('water_tower', cx + 20, cz + 20, 0, 0xcfe3ee, 1, true); scatter(['tree_small', 'bush', 'shed'], cx, cz, 38, 8, { tints: HOUSE_TINTS }); }
      else {
        // two rows of houses facing the north/south streets
        for (let row = 0; row < 2; row++) for (let k = 0; k < 4; k++) {
          if (rng.chance(0.08)) continue;
          const hx = cx - 31 + k * 20.5 + rng.range(-1, 1), hz = cz + (row ? 23 : -23);
          const rot = row ? 0 : Math.PI;
          put(rng.pick(['house_a', 'house_b', 'house_c']), hx, hz, rot, rng.pick(HOUSE_TINTS), rng.range(0.9, 1.0), true);
          const fz = cz + (row ? 36 : -36);   // front yard
          if (rng.chance(0.6)) put('mailbox', hx + 5, fz + (row ? 4 : -4), 0);
          if (rng.chance(0.5)) car(hx - 5.5, fz, 0);
          if (rng.chance(0.35)) put(rng.pick(['flamingo', 'gnome', 'bush', 'bush']), hx + rng.range(-3, 3), fz + rng.range(-2, 2), rng() * TAU);
          const bz = cz + (row ? 8 : -8);     // back yard
          if (rng.chance(0.3)) put(rng.pick(['trampoline', 'shed', 'tree_small', 'tree_small', 'boat']), hx + rng.range(-3, 3), bz, rng() * TAU, rng.pick(HOUSE_TINTS));
          if (rng.chance(0.4)) put('fence', hx + 9.5, bz, Math.PI / 2);
          if (rng.chance(0.25)) person(hx + rng.range(-4, 4), fz + rng.range(-2, 2));
        }
      }
    }
  }
  // driving traffic on the grid roads + highways
  const traffic = [];
  for (let k = 0; k < 150; k++) {
    const axis = rng.int(0, 1), line = rng.int(-N + 1, N - 1) * GRID, along = rng.range(-CITY_R * 0.9, CITY_R * 0.9);
    const dir = rng.sign(), lane = dir * 3.3;
    const x = axis ? line + lane : along, z = axis ? along : line - lane;
    if (Math.hypot(x, z) > CITY_R - 30) continue;
    const t = rng.chance(0.12) ? rng.pick(['bus', 'semi', 'schoolbus']) : rng.chance(0.15) ? 'taxi' : rng.chance(0.2) ? 'pickup' : 'car';
    out.push({ t, x, z, r: axis ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2), c: rng.pick(CAR_TINTS), s: 1, drive: { axis, dir } });
  }

  // ---------------- highways ----------------
  for (const [ax, az] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const len = WORLD.radius - CITY_R + 40, mid = CITY_R + len / 2 - 20;
    P('rect', { x: ax * mid, z: az * mid, w: ax ? len : ROAD_W, d: az ? len : ROAD_W, color: '#44464c', road: 1 });
    for (let s = CITY_R + 10; s < WORLD.radius - 40; s += rng.range(26, 60)) {
      const side = rng.sign();
      const px = ax ? ax * s : side * 10, pz = az ? az * s : side * 10;
      put(rng.pick(['powerpole', 'powerpole', 'sign', 'billboard', 'fence', 'mailbox']), px, pz, ax ? 0 : Math.PI / 2);
      if (rng.chance(0.3)) { const l = rng.sign() * 3.3; car(ax ? ax * s : l, az ? az * s : l, ax ? Math.PI / 2 : 0); }
    }
  }

  // ---------------- farmland ----------------
  // patchwork fields
  const fieldCols = ['#b9c46a', '#a6bf5e', '#d2c877', '#8fb558', '#c8b76a', '#9cc061', '#dccf85', '#84ad52'];
  for (let k = 0; k < 420; k++) {
    const a = rng() * TAU, d = rng.range(CITY_R + 30, WORLD.radius + 60);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (zoneAt(x, z) !== 'farm') continue;
    P('rect', { x, z, w: rng.range(50, 130), d: rng.range(40, 110), rot: rng.int(0, 3) * 0.26, color: rng.pick(fieldCols), field: rng.int(0, 2) });
  }
  // farmsteads
  for (let k = 0; k < 46; k++) {
    const a = rng() * TAU, d = rng.range(CITY_R + 70, WORLD.radius - 70);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (zoneAt(x, z) !== 'farm' || Math.abs(x) < 30 || Math.abs(z) < 30) continue;
    if (Math.hypot(x - WORLD.start[0], z - WORLD.start[1]) < 60) continue;
    const r = rng() * TAU;
    P('circle', { x, z, r: 34, color: '#b59f72' });
    put('barn', x, z, r, 0xc8452f);
    put(rng.pick(['house_a', 'house_c']), x + Math.cos(r) * 26, z + Math.sin(r) * 26, r, rng.pick(HOUSE_TINTS));
    if (rng.chance(0.7)) put('silo', x - Math.sin(r) * 15, z + Math.cos(r) * 15, 0, 0xdfe3e6);
    if (rng.chance(0.5)) put('windmill', x + rng.range(-35, 35), z + rng.range(-35, 35), rng() * TAU);
    if (rng.chance(0.6)) put('tractor', x + rng.range(-22, 22), z + rng.range(-22, 22), rng() * TAU, rng.pick([0xd83a2e, 0x3fa34d, 0x2f6fd6]));
    scatter(['haybale', 'haybale', 'crate', 'barrel', 'fence', 'chicken', 'chicken', 'outhouse', 'shed', 'pig', 'rock'], x, z, 42, 26, { tints: HOUSE_TINTS });
    const herd = rng.pick(['cow', 'cow', 'sheep', 'horse', 'pig']);
    const hx = x + rng.range(-70, 70), hz = z + rng.range(-70, 70);
    scatter(herd, hx, hz, 28, rng.int(8, 16));
    scatter('fence', hx, hz, 32, 8);
    for (let p = 0; p < 2; p++) person(x + rng.range(-20, 20), z + rng.range(-20, 20));
  }
  // woods & singles
  for (let k = 0; k < 60; k++) {
    const a = rng() * TAU, d = rng.range(CITY_R + 40, WORLD.radius - 30);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (zoneAt(x, z) !== 'farm') continue;
    scatter(['tree_small', 'pine', 'pine', 'tree_big', 'bush', 'rock'], x, z, rng.range(18, 46), rng.int(8, 22), { s: [0.8, 1.25] });
  }
  // trailer park (south-west) - obviously
  P('circle', { x: -420, z: 960, r: 80, color: '#b59f72' });
  for (let k = 0; k < 26; k++) { const x = -470 + (k % 7) * 17, z = 920 + Math.floor(k / 7) * 24; put('trailer', x, z, 0, rng.pick(HOUSE_TINTS)); if (rng.chance(0.6)) put(rng.pick(['flamingo', 'gnome', 'trampoline', 'pickup', 'dumpster', 'tent']), x + 6, z + rng.range(-5, 5), rng() * TAU, rng.pick(CAR_TINTS)); if (rng.chance(0.4)) person(x + 5, z + rng.range(-6, 6)); }
  // starting area: a dense buffet of tiny things so the first 60 seconds feel great
  const [sx, sz] = WORLD.start;
  P('circle', { x: sx, z: sz, r: 26, color: '#c9b37e' });
  P('rect', { x: sx - 70, z: sz + 10, w: 70, d: 60, color: '#c3b85a', field: 1 });
  P('rect', { x: sx + 75, z: sz - 5, w: 80, d: 70, color: '#d98a2b', field: 2 });
  for (let a = 0; a < 9; a++) for (let b = 0; b < 8; b++) put('corn', sx - 100 + a * 7.2 + rng.range(-1, 1), sz - 16 + b * 7 + rng.range(-1, 1), rng() * TAU, 0xffffff, rng.range(0.85, 1.2));
  for (let a = 0; a < 44; a++) put('pumpkin', sx + 42 + rng.range(0, 66), sz - 36 + rng.range(0, 62), rng() * TAU, 0xffffff, rng.range(0.8, 1.5));
  scatter(['haybale', 'crate', 'barrel', 'fence', 'fence', 'bush', 'rock', 'chicken', 'chicken', 'scarecrow', 'sign'], sx, sz, 60, 80);
  scatter(['chicken'], sx + 10, sz - 30, 18, 14);
  for (let k = 0; k < 10; k++) put('fence', sx - 24 + k * 2.5, sz + 30, 0);
  scatter(['cow'], sx - 30, sz - 90, 30, 14);
  scatter(['sheep'], sx + 70, sz - 110, 26, 12);
  scatter(['tree_small', 'pine'], sx + 10, sz - 150, 50, 16);
  put('shed', sx + 28, sz + 22, 0.4, 0xc8452f); put('outhouse', sx - 30, sz + 18, 0); put('tractor', sx + 16, sz - 34, 1.1, 0x3fa34d);
  put('barn', sx - 60, sz - 170, 0.3, 0xc8452f); put('silo', sx - 40, sz - 180, 0, 0xdfe3e6); put('house_a', sx + 60, sz - 190, 0, HOUSE_TINTS[0]); put('windmill', sx + 100, sz - 60, 0);
  for (let k = 0; k < 6; k++) person(sx + rng.range(-40, 40), sz + rng.range(-60, -10));
  // generic farmland clutter everywhere
  for (let k = 0; k < 1500; k++) {
    const a = rng() * TAU, d = rng.range(CITY_R + 14, WORLD.radius - 24);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (zoneAt(x, z) !== 'farm') continue;
    const t = rng.pick(['haybale', 'haybale', 'bush', 'bush', 'rock', 'corn', 'corn', 'corn', 'fence', 'pumpkin', 'scarecrow', 'crate', 'barrel', 'tree_small', 'pine', 'cow', 'sheep', 'chicken', 'tree_big', 'horse']);
    if (t === 'corn' || t === 'pumpkin') scatter(t, x, z, 12, 9, { s: [0.85, 1.3] }); else put(t, x, z, rng() * TAU, 0xffffff, rng.range(0.9, 1.15));
  }
  // suburb edge trees
  for (let k = 0; k < 260; k++) {
    const a = rng() * TAU, d = rng.range(500, CITY_R + 10);
    put(rng.pick(['tree_small', 'tree_small', 'tree_big', 'bush', 'pine']), Math.cos(a) * d, Math.sin(a) * d, rng() * TAU, 0xffffff, rng.range(0.85, 1.2));
  }
  return { placements: out, paint, traffic };
}
