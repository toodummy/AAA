// STORMZILLA simulation core. Headless (no rendering, no DOM) so it runs in Node tests and bots.
import { PROPS, TIERS, UPGRADES, META, STORMS, WORLD } from './defs.js';
import { generateWorld } from './world.js';
import { makeRng, clamp, lerp, TAU } from '../core/rng.js';
import { updateEnemies, updateDirector, updateShots, damageEnemy } from './enemies.js';
import { updateWeapons, rollChoices, applyUpgrade } from './weapons.js';

export const ST = { REST: 0, SUCK: 1, ORBIT: 2, FLUNG: 3, DEAD: 4, COLLAPSE: 5, DIGEST: 6, LIVE: 7 };
const CELL = 40;
const gkey = (cx, cz) => ((cx + 512) << 11) | (cz + 512);
const HPK = [1, 1, 1, 1.6, 2.2, 2.5];
const CHUNKS_BY_TIER = [
  ['chunk_plank', 'chunk_brick'],
  ['chunk_plank', 'chunk_plank', 'chunk_brick', 'chunk_roof'],
  ['chunk_plank', 'chunk_roof', 'chunk_wall', 'chunk_brick', 'chunk_wall'],
  ['chunk_wall', 'chunk_concrete', 'chunk_steel', 'chunk_glass', 'chunk_roof'],
  ['chunk_concrete', 'chunk_glass', 'chunk_steel', 'chunk_slab', 'chunk_glass'],
  ['chunk_slab', 'chunk_concrete', 'chunk_steel', 'chunk_glass', 'chunk_slab'],
];

export function createSim(opts = {}) {
  const seed = opts.seed ?? 1;
  const rng = makeRng(seed);
  const meta = opts.meta || {};
  const stormDef = STORMS[opts.storm] || STORMS.classic;
  const world = generateWorld(opts.worldSeed ?? 1);

  const G = {
    t: 0, rng, world, seed,
    ents: [], grid: new Map(),
    dyn: [],          // every entity that is not resting (renderer draws these each frame)
    critters: [], drivers: [], burning: [],
    enemies: [], shots: [], zones: [], bolts: [], twins: [],
    events: [],
    over: false, won: false, awaiting: null, // awaiting = level-up choices
    boss: null, bossPhase: 0, bossT: 0,
    threat: 0, heat: 0, spawnT: 3, totalValue: 0, eatenValue: 0,
    stats: { eaten: 0, cows: 0, people: 0, animals: 0, vehicles: 0, buildings: 0, kills: 0, jets: 0, tanks: 0, donuts: 0, maxCombo: 1, dmgTaken: 0, dmgDealt: 0, flung: 0, dashes: 0, lightning: 0, sharks: 0, burned: 0, minHpFrac: 1, duck: 0, nuke: 0, ferrisFlung: 0, bossKill: 0, f4Untouched: 0 },
    S: null, opts,
    ST,
  };
  const up = {}; for (const k in UPGRADES) up[k] = 0;
  const S = G.S = {
    x: WORLD.start[0], z: WORLD.start[1], vx: 0, vz: 0, heading: 0,
    tier: 0, mass: (meta.startMass || 0) * 15, r: TIERS[0].radius, rShow: TIERS[0].radius,
    hpMax: Math.round((100 + (meta.integrity || 0) * 12) * (stormDef.hpMul || 1)), hp: 0,
    level: 0, xp: 0, xpNext: 16,
    combo: 1, comboT: 0, comboProg: 0,
    dashMax: 1 + (meta.dashes || 0), dashCharges: 1 + (meta.dashes || 0), dashCd: 0, dashT: 0, dashDx: 0, dashDz: 1,
    ult: 0, ultT: 0, invuln: 0, slowT: 0, hurtT: 0,
    flingCd: 0, ammo: 0, ammoMax: 40, orbit: [],
    rerolls: meta.reroll || 0, revive: meta.revive ? 1 : 0, mutations: 0,
    up, score: 0, chaosMul: 1 + (meta.chaos || 0) * 0.1,
    speedMul: (stormDef.speedMul || 1) * (1 + (meta.swift || 0) * 0.04),
    massMul: 1 + (meta.greed || 0) * 0.06,
    threatMul: stormDef.threatMul || 1,
    aimX: 0, aimZ: 0, armorCars: 0,
    wT: { lightning: 1, hail: 2, shark: 1, thunder: 0.5, twin: 0 },
  };
  S.hp = S.hpMax;
  const ev = (e, o) => { if (G.events.length < 900) G.events.push(o ? Object.assign(o, { e }) : { e }); };
  G.ev = ev;

  // ---------------- entities ----------------
  let nextId = 1;
  function addEnt(t, x, z, ry, c, s) {
    const def = PROPS[t];
    const e = { id: nextId++, t, def, x, y: 0, z, rx: 0, ry, rz: 0, s, c, st: ST.REST, hp: def.hp * s * HPK[def.tier], hpMax: def.hp * s * HPK[def.tier], slot: -1, gi: -1, gk: 0,
      p: 0, sx: 0, sy: 0, sz: 0, oa: 0, oh: 0, ok: 1, ow: 1, vx: 0, vy: 0, vz: 0, sp: 0, life: 0, fire: 0, shake: 0, hx: x, hz: z, drive: null, own: 0, rad: Math.max(def.w, def.d) * 0.5 * s };
    return e;
  }
  function gridAdd(e) {
    const k = gkey(Math.floor(e.x / CELL), Math.floor(e.z / CELL));
    let l = G.grid.get(k); if (!l) G.grid.set(k, (l = []));
    e.gi = l.length; e.gk = k; l.push(e);
  }
  function gridRemove(e) {
    if (e.gi < 0) return;
    const l = G.grid.get(e.gk), last = l.pop();
    if (last !== e) { l[e.gi] = last; last.gi = e.gi; }
    e.gi = -1;
  }
  function gridMove(e) {
    const k = gkey(Math.floor(e.x / CELL), Math.floor(e.z / CELL));
    if (k !== e.gk) { gridRemove(e); gridAdd(e); }
  }
  G.gridRemove = gridRemove;
  G.query = function (x, z, r, fn) {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const l = G.grid.get(gkey(cx, cz));
      if (!l) continue;
      for (let i = l.length - 1; i >= 0; i--) { const e = l[i]; if (e) fn(e); }
    }
  };
  for (const p of world.placements) {
    const e = addEnt(p.t, p.x, p.z, p.r, p.c, p.s);
    e.slot = G.ents.length; G.ents.push(e); gridAdd(e);
    G.totalValue += e.def.xp;
    if (e.def.kind === 'crit') G.critters.push(e);
    if (p.drive) { e.drive = p.drive; G.drivers.push(e); }
  }
  G.staticCount = G.ents.length;

  function toDyn(e) { if (e.st === ST.REST) { gridRemove(e); ev('unrest', { ent: e }); G.dyn.push(e); } }
  G.toDyn = toDyn;
  function kill(e) { e.st = ST.DEAD; }
  G.spawnLoose = function (t, x, y, z, s = 1, c = 0xffffff) {
    const e = addEnt(t, x, z, rng() * TAU, c, s);
    e.y = y; e.st = ST.LIVE; G.dyn.push(e); return e;
  };

  // ---------------- storm helpers ----------------
  G.pullR = () => S.r * 2.1 * (1 + 0.18 * up.suction) * (S.ultT > 0 ? 1.8 : 1) * (S.slowT > 0 ? 0.75 : 1);
  G.flingRange = () => 45 + S.r * 2.2;
  G.funnelH = () => S.r * 5.5 + 14;
  G.power = () => Math.pow(3.1, S.tier + tierFrac() * 0.8);
  function tierFrac() {
    const a = TIERS[S.tier], b = TIERS[S.tier + 1];
    return b ? clamp((S.mass - a.mass) / (b.mass - a.mass), 0, 1) : 1;
  }
  G.tierFrac = tierFrac;
  function recalcRadius() {
    const a = TIERS[S.tier], b = TIERS[S.tier + 1];
    S.r = b ? lerp(a.radius, b.radius * 0.92, Math.pow(tierFrac(), 0.8)) : a.radius;
    S.ammoMax = Math.round(36 + S.tier * 26 + up.cannon * 10);
  }
  function addMass(v, e) {
    const gain = v * S.massMul * (1 + 0.1 * up.hunger) * (1 + Math.min(S.combo - 1, 50 + up.combo * 10) * 0.02);
    S.mass += gain; S.xp += gain; S.score += gain; G.eatenValue += v;
    S.ult = Math.min(1, S.ult + 0.0012 + gain / (TIERS[Math.min(6, S.tier + 1)].mass * 0.9));
    while (S.tier < 5 && S.mass >= TIERS[S.tier + 1].mass) {   // F6 only by beating the boss
      S.tier++; S.hp = Math.min(S.hpMax, S.hp + S.hpMax * 0.35); S.invuln = Math.max(S.invuln, 1.5);
      ev('tier', { tier: S.tier });
      if (S.tier === 4 && G.stats.minHpFrac >= 0.5) G.stats.f4Untouched = 1;
    }
    if (S.tier === 5 && S.mass > TIERS[6].mass * 0.98 && !G.won) S.mass = TIERS[6].mass * 0.98;
    recalcRadius();
    return gain;
  }
  G.addMass = addMass;
  function bumpCombo(n = 1) {
    S.comboT = 3.2 + up.combo * 1.2;
    S.comboProg += n;
    const need = 3 + S.combo * 1.0;
    if (S.comboProg >= need) {
      S.comboProg -= need; S.combo++;
      if (S.combo > G.stats.maxCombo) G.stats.maxCombo = S.combo;
      if (S.combo % 5 === 0) ev('combo', { n: S.combo });
    }
  }
  G.heal = function (v) {
    if (v <= 0 || S.hp >= S.hpMax) return;
    S.hp = Math.min(S.hpMax, S.hp + v * (1 + 0.4 * up.regen));
  };
  G.hurt = function (dmg, src) {
    if (G.over || S.invuln > 0 || S.dashT > 0) { if (dmg > 0) ev('dodge', { src }); return 0; }
    if (S.armorCars > 0 && dmg >= 5) { S.armorCars--; ev('block', { src }); return 0; }
    dmg *= (1 - 0.1 * up.armor) * (S.ultT > 0 ? 0.5 : 1);
    S.hp -= dmg; S.hurtT = 0.35; G.stats.dmgTaken += dmg;
    const f = S.hp / S.hpMax; if (f < G.stats.minHpFrac) G.stats.minHpFrac = f;
    ev('hurt', { dmg, src });
    if (S.hp <= 0) {
      if (S.revive > 0) { S.revive--; S.hp = S.hpMax * 0.5; S.invuln = 3; ev('revive'); }
      else { S.hp = 0; G.over = true; G.won = false; ev('gameover', { win: false }); }
    }
    return dmg;
  };

  // capture: an entity enters the funnel
  function startSuck(e, twin) {
    toDyn(e);
    e.st = ST.SUCK; e.p = 0; e.sx = e.x; e.sy = e.y; e.sz = e.z; e.own = twin || 0;
    e.oa = Math.atan2(e.z - S.z, e.x - S.x); e.oh = Math.pow(rng(), 1.4) * 0.9 + 0.04; e.ok = 0.8 + rng() * 0.5; e.ow = 0.8 + rng() * 0.5;
    e.sp = rng.range(2, 7) * rng.sign();
    e.life = 0.35 + Math.min(0.9, Math.hypot(e.x - S.x, e.z - S.z) / (S.r * 4 + 20));
  }
  G.startSuck = startSuck;
  function eat(e) {
    const d = e.def;
    let v = d.xp * e.s;
    if (d.kind === 'crit') v *= 1 + up.magnet;
    const gain = addMass(v, e);
    G.stats.eaten++;
    if (d.kind === 'crit') { if (e.t === 'cow') G.stats.cows++; if (e.t === 'person') G.stats.people++; else G.stats.animals++; }
    else if (d.kind === 'veh') { G.stats.vehicles++; if (up.magnetar && S.armorCars < 12) S.armorCars++; }
    bumpCombo(1);
    if (d.tier + 1 >= S.tier) G.heal(0.2 + d.tier * 0.3);
    ev('eat', { ent: e, xp: gain });
  }
  function orbitPos(e, out) {
    const H = G.funnelH(), R = S.rShow;
    const rad = R * (0.5 + 1.25 * Math.pow(e.oh, 1.25)) * e.ok;
    out.x = S.x + Math.cos(e.oa) * rad; out.z = S.z + Math.sin(e.oa) * rad; out.y = 1.5 + e.oh * H + Math.sin(G.t * 1.7 + e.id) * R * 0.08;
  }
  const tmp = { x: 0, y: 0, z: 0 };
  G.orbitPos = orbitPos;

  // building destruction
  function chunkBurst(b, n, scaleMul = 1) {
    const list = CHUNKS_BY_TIER[b.def.tier];
    const room = Math.max(0, 700 - G.dyn.length);
    n = Math.min(n, room);
    for (let i = 0; i < n; i++) {
      const t = rng.pick(list);
      const cs = clamp(scaleMul * (0.7 + rng() * 0.8) * (b.def.tier >= 4 ? 1.9 : b.def.tier === 3 ? 1.3 : 1), 0.6, 4);
      const c = G.spawnLoose(t, b.x + rng.range(-0.4, 0.4) * b.def.w * b.s, rng() * b.def.h * b.s * (0.3 + 0.7 * (b.hp > 0 ? b.hp / b.hpMax : 0.6)), b.z + rng.range(-0.4, 0.4) * b.def.d * b.s, cs, t === 'chunk_glass' ? 0xbfe4f2 : b.c);
      startSuckLoose(c);
    }
  }
  function startSuckLoose(c) {
    c.st = ST.SUCK; c.p = 0; c.sx = c.x; c.sy = c.y; c.sz = c.z;
    c.oa = Math.atan2(c.z - S.z, c.x - S.x); c.oh = Math.pow(rng(), 1.2) * 0.9 + 0.05; c.ok = 0.8 + rng() * 0.6; c.ow = 0.8 + rng() * 0.5;
    c.sp = rng.range(2, 8) * rng.sign(); c.life = 0.5 + rng() * 0.5; c.loose = 1;
  }
  G.damageBuilding = function (b, dmg, src) {
    if (b.st !== ST.REST || b.def.kind !== 'bld') return;
    if (up.blizzard) dmg *= 2;
    const before = b.hp;
    b.hp -= dmg; if (b.shake <= 0) G.shaken.push(b); b.shake = 0.25; G.stats.dmgDealt += dmg;
    const q = Math.floor(before / b.hpMax * 5), q2 = Math.floor(Math.max(0, b.hp) / b.hpMax * 5);
    if (q2 < q) { chunkBurst(b, 2 + b.def.tier, 1); ev('crack', { ent: b }); }
    if (b.hp <= 0) collapse(b, src);
  };
  function collapse(b, src) {
    gridRemove(b); ev('unrest', { ent: b }); G.dyn.push(b);
    b.st = ST.COLLAPSE; b.p = 0; b.life = 0.9 + b.def.tier * 0.35;
    chunkBurst(b, 5 + b.def.tier * 3, 1.1);
    let v = b.def.xp * b.s * (src === 'fire' ? 0.5 : 1);
    const gain = addMass(v, b);
    G.stats.buildings++; G.stats.eaten++;
    if (b.t === 'donut_shop') G.stats.donuts++;
    if (b.t === 'giant_duck') G.stats.duck = 1;
    if (b.t === 'cooling_tower') G.stats.nuke = 1;
    bumpCombo(2 + b.def.tier);
    if (b.def.tier + 1 >= S.tier) G.heal(1 + b.def.tier);
    ev('collapse', { ent: b, xp: gain, src });
    const fx = b.def.fx;
    if (fx === 'explode' || fx === 'nuke') {
      const R = fx === 'nuke' ? 170 : 34 + b.def.tier * 8;
      ev('explosion', { x: b.x, y: b.def.h * 0.4, z: b.z, r: R, big: fx === 'nuke' ? 2 : 1 });
      // chain reaction: damages neighbours and enemies (never the player - you ARE the weather)
      G.query(b.x, b.z, R, (o) => { if (o !== b && o.def.kind === 'bld' && o.def.tier <= S.tier + 1) { const dd = Math.hypot(o.x - b.x, o.z - b.z); if (dd < R) G.pendingDmg.push(o, (fx === 'nuke' ? 30000 : 260 * (b.def.tier + 1)) * (1 - dd / R * 0.6)); } else if (o !== b && o.def.kind !== 'bld' && o.def.tier <= S.tier + 1 && Math.hypot(o.x - b.x, o.z - b.z) < R * 0.7) G.pendingSuck.push(o); });
      for (const en of G.enemies) if (Math.hypot(en.x - b.x, en.z - b.z) < R) damageEnemy(G, en, fx === 'nuke' ? 50000 : 400 * (b.def.tier + 1), 'explosion');
    }
    if (up.firenado || b.fire > 0) igniteNear(b, 1);
  }
  G.pendingDmg = []; G.pendingSuck = []; G.shaken = []; G.moved = [];
  function igniteNear(b, p) {
    G.query(b.x, b.z, b.rad + 22, (o) => { if (o.def.kind === 'bld' && o.fire <= 0 && o.st === ST.REST && o.def.tier <= S.tier && rng() < p * 0.3) ignite(o); });
  }
  function ignite(o) { if (o.fire > 0 || G.burning.length > 60) return; o.fire = 1; G.burning.push(o); ev('ignite', { ent: o }); }
  G.ignite = ignite;

  // ---------------- main step ----------------
  const input0 = { mx: 0, mz: 0, aimX: 0, aimZ: 0, dash: false, fling: false, ult: false };
  G.step = function (dt, input = input0) {
    if (G.over || G.awaiting) return;
    G.t += dt;
    const R = S.r;
    S.rShow += (S.r - S.rShow) * Math.min(1, dt * 2.5);
    S.aimX = input.aimX; S.aimZ = input.aimZ;

    // --- movement
    let mx = input.mx, mz = input.mz; const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    let sp = TIERS[S.tier].speed * S.speedMul * (1 + 0.09 * up.speed) * (S.slowT > 0 ? 0.55 : 1) * (S.ultT > 0 ? 1.25 : 1);
    if (input.dash && S.dashCharges > 0 && S.dashT <= 0) {
      S.dashCharges--; S.dashT = 0.42; G.stats.dashes++;
      if (ml > 0.1) { S.dashDx = input.mx / ml; S.dashDz = input.mz / ml; }
      else { const l = Math.hypot(S.vx, S.vz); if (l > 0.5) { S.dashDx = S.vx / l; S.dashDz = S.vz / l; } }
      ev('dash');
    }
    if (S.dashCharges < S.dashMax) { S.dashCd += dt / (4.5 * Math.pow(0.8, up.dash)); if (S.dashCd >= 1) { S.dashCd = 0; S.dashCharges++; ev('dashready'); } }
    if (S.dashT > 0) {
      S.dashT -= dt; S.vx = S.dashDx * sp * 3.4; S.vz = S.dashDz * sp * 3.4;
    } else {
      const acc = Math.min(1, dt * 5.5);
      S.vx += (mx * sp - S.vx) * acc; S.vz += (mz * sp - S.vz) * acc;
    }
    S.x += S.vx * dt; S.z += S.vz * dt;
    const dC = Math.hypot(S.x, S.z), lim = WORLD.radius - R * 0.5 - 8;
    if (dC > lim) { S.x *= lim / dC; S.z *= lim / dC; }
    if (Math.hypot(S.vx, S.vz) > 1) S.heading = Math.atan2(S.vx, S.vz);
    S.invuln -= dt; S.slowT -= dt; S.hurtT -= dt;
    if (S.ultT > 0) { S.ultT -= dt; if (S.ultT <= 0) ev('ultend'); }
    if (input.ult && S.ult >= 1 && S.ultT <= 0) { S.ult = 0; S.ultT = 7; ev('ult'); }

    // --- combo
    if (S.comboT > 0) { S.comboT -= dt; if (S.comboT <= 0 && S.combo > 1) { ev('combobreak', { n: S.combo }); S.combo = 1; S.comboProg = 0; } }

    // --- interact with the resting world
    const pullR = G.pullR(), tier = S.tier, pw = G.power();
    const bdps = 5 * pw * (1 + 0.25 * up.shred) * (S.dashT > 0 ? 2.5 : 1) * (S.ultT > 0 ? 2 : 1);
    const critPull = pullR * (1 + up.magnet * 0.8);
    let blocked = null;
    G.query(S.x, S.z, Math.max(pullR, critPull) + 40, (e) => {
      const dx = e.x - S.x, dz = e.z - S.z, d = Math.hypot(dx, dz), k = e.def.kind;
      if (k === 'bld') {
        if (d < R + e.rad * 0.75) {
          if (e.def.tier <= tier) G.damageBuilding(e, bdps * dt, 'storm');
          else if (e.def.tier === tier + 1) { G.damageBuilding(e, bdps * dt * 0.1, 'storm'); if (d < R + e.rad * 0.4) blocked = e; }
          else if (d < R + e.rad * 0.4) blocked = e;
          if (up.firenado && e.fire <= 0 && e.def.tier <= tier) ignite(e);
        }
      } else if (e.def.tier <= tier) {
        if (d < (k === 'crit' ? critPull : pullR)) startSuck(e);
      } else if (d < R * 0.8) blocked = e;
    });
    if (blocked && (G.blockT || 0) < G.t) { G.blockT = G.t + 1.2; ev('blocked', { ent: blocked }); }
    // deferred chain reactions
    if (G.pendingDmg.length) { const l = G.pendingDmg.splice(0); for (let i = 0; i < l.length; i += 2) G.damageBuilding(l[i], l[i + 1], 'explosion'); }
    if (G.pendingSuck.length) { const l = G.pendingSuck.splice(0); for (const o of l) if (o.st === ST.REST) startSuck(o); }

    // --- critters flee, drivers drive
    const fleeR = R + 46;
    for (let i = G.critters.length - 1; i >= 0; i--) {
      const c = G.critters[i];
      if (c.st !== ST.REST) { G.critters[i] = G.critters[G.critters.length - 1]; G.critters.pop(); continue; }
      const dx = c.x - S.x, dz = c.z - S.z, d2 = dx * dx + dz * dz;
      if (d2 < fleeR * fleeR) {
        const d = Math.sqrt(d2) || 1, v = c.def.speed * (0.8 + ((c.id * 37) % 10) / 25);
        if (!c.panic) { c.panic = 1; ev('panic', { ent: c }); }
        c.x += dx / d * v * dt; c.z += dz / d * v * dt; c.ry = Math.atan2(dx, dz); G.moved.push(c);
        gridMove(c);
      } else if (c.panic) { c.panic = 0; }
    }
    for (let i = G.drivers.length - 1; i >= 0; i--) {
      const c = G.drivers[i];
      if (c.st !== ST.REST) { G.drivers[i] = G.drivers[G.drivers.length - 1]; G.drivers.pop(); continue; }
      const dv = c.drive, v = c.def.speed * 0.6 * dv.dir * dt;
      if (Math.abs(c.x - S.x) > 420 || Math.abs(c.z - S.z) > 420) continue;   // only simulate traffic nearby
      if (dv.axis) c.z += v; else c.x += v;
      if (Math.hypot(c.x, c.z) > 840) { dv.dir *= -1; c.ry += Math.PI; if (dv.axis) c.x -= dv.dir * -6.6; else c.z += dv.dir * -6.6; }
      G.moved.push(c); gridMove(c);
    }

    // --- dynamic entities
    const H = G.funnelH();
    const wBase = clamp(16 / (S.rShow + 3), 0.35, 3.2) * (S.ultT > 0 ? 1.6 : 1);
    let orbitN = 0;
    for (let i = G.dyn.length - 1; i >= 0; i--) {
      const e = G.dyn[i];
      switch (e.st) {
        case ST.SUCK: {
          e.p += dt / e.life;
          e.oa += wBase * e.ow * (2.2 / (0.45 + e.oh)) * dt;
          const src = e.own ? G.twins[e.own - 1] : null;
          if (src) { // eaten by a sister twister: spiral into her, then count as eaten
            const q = e.p * e.p;
            e.x = lerp(e.sx, src.x, q); e.z = lerp(e.sz, src.z, q); e.y = e.sy + q * src.r * 3;
            e.rx += e.sp * dt; e.rz += e.sp * 0.7 * dt;
            if (e.p >= 1) { eat(e); e.st = ST.DEAD; }
            break;
          }
          orbitPos(e, tmp);
          const q = e.p * e.p * (3 - 2 * e.p);
          e.x = lerp(e.sx, tmp.x, q); e.z = lerp(e.sz, tmp.z, q); e.y = lerp(e.sy, tmp.y, q * q) + Math.sin(q * Math.PI) * 1.5;
          e.rx += e.sp * dt * q; e.rz += e.sp * 0.7 * dt * q;
          if (e.p >= 1) {
            if (!e.loose) eat(e);
            if (S.orbit.length < S.ammoMax * 1.6) { e.st = ST.ORBIT; S.orbit.push(e); }
            else { e.st = ST.DIGEST; e.p = 0; }
          }
          break;
        }
        case ST.ORBIT: {
          orbitN++;
          e.oa += wBase * e.ow * (2.2 / (0.45 + e.oh)) * dt;
          orbitPos(e, tmp); e.x = tmp.x; e.y = tmp.y; e.z = tmp.z;
          e.rx += e.sp * dt; e.rz += e.sp * 0.6 * dt; e.ry += e.sp * 0.3 * dt;
          break;
        }
        case ST.DIGEST: {
          e.p += dt * 1.6;
          e.oa += wBase * 3 * dt; e.oh += dt * 0.5;
          orbitPos(e, tmp); e.x = tmp.x; e.y = tmp.y; e.z = tmp.z; e.rx += e.sp * dt;
          if (e.p >= 1) kill(e);
          break;
        }
        case ST.FLUNG: {
          e.life -= dt;
          e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
          e.rx += 9 * dt; e.rz += 6 * dt;
          let hit = e.y <= 0.5 || e.life <= 0;
          const hr = e.rad + 3;
          for (const en of G.enemies) {
            if (en.dead) continue;
            const dx = en.x - e.x, dz = en.z - e.z, dy = en.y + en.def.h * 0.5 - e.y;
            const rr = hr + en.rad;
            if (dx * dx + dz * dz < rr * rr && Math.abs(dy) < rr + en.def.h * 0.5) { hit = true; break; }
          }
          if (!hit && e.y < 80) {
            G.query(e.x, e.z, 4, (b) => { if (b.def.kind === 'bld' && b.def.tier <= S.tier + 1 && e.y < b.def.h * b.s && Math.abs(b.x - e.x) < b.def.w * b.s * 0.5 + 1 && Math.abs(b.z - e.z) < b.def.d * b.s * 0.5 + 1) hit = true; });
          }
          if (hit) {
            const dmg = e.dmg, ar = e.rad * 1.6 + 5;
            for (const en of G.enemies) if (!en.dead && Math.hypot(en.x - e.x, en.z - e.z) < ar + en.rad && Math.abs(en.y - e.y) < ar + en.def.h + 10) damageEnemy(G, en, dmg, 'fling');
            G.query(e.x, e.z, ar + 10, (b) => { if (b.def.kind === 'bld' && b.def.tier <= S.tier + 1 && Math.hypot(b.x - e.x, b.z - e.z) < ar + b.rad * 0.8) G.pendingDmg.push(b, dmg * 0.3 * (b.def.tier > S.tier ? 0.35 : 1)); });
            ev('impact', { x: e.x, y: Math.max(0, e.y), z: e.z, r: ar, ent: e });
            kill(e);
          }
          break;
        }
        case ST.COLLAPSE: {
          e.p += dt / e.life;
          if (e.p >= 1) kill(e);
          break;
        }
        case ST.LIVE: break;
      }
      if (e.st === ST.DEAD) { G.dyn[i] = G.dyn[G.dyn.length - 1]; G.dyn.pop(); }
    }
    // orbit housekeeping (digest overflow & tiny stuff, keeps the big impressive junk)
    if (S.orbit.length) {
      let w = 0;
      const over = S.orbit.length - S.ammoMax;
      let drop = over > 0 ? Math.ceil(over * dt * 3) + 1 : 0;
      for (let i = 0; i < S.orbit.length; i++) {
        const e = S.orbit[i];
        if (e.st !== ST.ORBIT) continue;
        if (drop > 0 && (e.def.tier < S.tier - 1 || i < over)) { drop--; e.st = ST.DIGEST; e.p = 0; continue; }
        S.orbit[w++] = e;
      }
      S.orbit.length = w;
    }
    S.ammo = S.orbit.length;

    // --- fling
    S.flingCd -= dt;
    if (input.fling && S.flingCd <= 0 && S.orbit.length > 0) {
      S.flingCd = 0.15;
      G.fling(input.aimX, input.aimZ, 1 + up.cannon);
    }

    // --- fire
    for (let i = G.burning.length - 1; i >= 0; i--) {
      const b = G.burning[i];
      if (b.st !== ST.REST) { G.burning[i] = G.burning[G.burning.length - 1]; G.burning.pop(); continue; }
      b.fire += dt;
      G.damageBuilding(b, b.hpMax * dt / (5 + b.def.tier * 2.5), 'fire');
      if (b.st !== ST.REST) { G.stats.burned++; continue; }
      if (rng() < dt * 0.1) igniteNear(b, 0.5);
    }

    updateWeapons(G, dt);
    updateEnemies(G, dt);
    updateShots(G, dt);
    updateDirector(G, dt);

    // --- level up
    if (!G.over && S.xp >= S.xpNext) {
      S.xp -= S.xpNext; S.level++;
      S.xpNext = Math.round(16 * Math.pow(1.4, S.level));
      const ch = rollChoices(G);
      if (ch.length) { G.awaiting = ch; ev('levelup', { level: S.level }); }
    }
  };

  G.fling = function (ax, az, n) {
    // auto-aim: nearest enemy to the cursor point (generous), else the point itself
    const maxR = G.flingRange();
    { const dx = ax - S.x, dz = az - S.z, d = Math.hypot(dx, dz); if (d > maxR) { ax = S.x + dx / d * maxR; az = S.z + dz / d * maxR; } }
    let tx = ax, ty = 2, tz = az, best = null, bd = 45 + S.r;
    for (const en of G.enemies) { if (en.dead || Math.hypot(en.x - S.x, en.z - S.z) > maxR + 15) continue; const d = Math.hypot(en.x - ax, en.z - az); if (d < bd) { bd = d; best = en; } }
    for (let k = 0; k < n && S.orbit.length; k++) {
      // prefer the heaviest junk
      let bi = S.orbit.length - 1, bt = -1;
      for (let j = 0; j < Math.min(8, S.orbit.length); j++) { const idx = (S.orbit.length - 1 - j * 3 + S.orbit.length * 8) % S.orbit.length; const o = S.orbit[idx]; const sc = o.def.tier + o.s * 0.2; if (sc > bt) { bt = sc; bi = idx; } }
      const e = S.orbit[bi]; S.orbit[bi] = S.orbit[S.orbit.length - 1]; S.orbit.pop();
      if (e.st !== ST.ORBIT) continue;
      const speed = 95 + S.r * 2.2;
      if (best) { const tt = Math.hypot(best.x - e.x, best.z - e.z) / speed; tx = best.x + (best.vx || 0) * tt; tz = best.z + (best.vz || 0) * tt; ty = best.y + best.def.h * 0.5; }
      const sx = (k - (n - 1) / 2) * 0.05;
      let dx = tx - e.x, dy = ty - e.y, dz = tz - e.z; const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      e.vx = (dx + dz * sx) * speed; e.vy = dy * speed; e.vz = (dz - dx * sx) * speed;
      e.st = ST.FLUNG; e.life = Math.min(4, l / speed + 0.4);
      e.dmg = 5 * G.power() * (0.7 + 0.15 * e.def.tier) * (1 + 0.2 * up.cannon);
      G.stats.flung++; if (e.t === 'ferris') G.stats.ferrisFlung = 1;
    }
    ev('fling', { n });
  };

  G.pickUpgrade = function (i) {
    if (!G.awaiting) return;
    const c = G.awaiting[i]; if (!c) return;
    applyUpgrade(G, c.id);
    G.awaiting = null; S.invuln = Math.max(S.invuln, 0.6);
    ev('picked', { id: c.id });
    recalcRadius();
  };
  G.reroll = function () {
    if (!G.awaiting || S.rerolls <= 0) return false;
    S.rerolls--; G.awaiting = rollChoices(G); return true;
  };
  G.win = function () {
    if (G.over) return;
    G.won = true; S.tier = 6; S.mass = Math.max(S.mass, TIERS[6].mass); recalcRadius(); S.invuln = 99;
    ev('tier', { tier: 6 });
    G.winT = 9;   // victory lap before the results screen
  };
  G.chaosEarned = function () {
    const base = 12 * S.tier * S.tier + Math.sqrt(S.score) * 1.6 + G.stats.kills * 2 + (G.won ? 600 : 0);
    return Math.round(base * S.chaosMul * (up.moneynado ? 2 : 1));
  };
  G.objective = function () {
    if (G.boss) return G.boss.shield > 0 ? 'Smash the 3 shield pylons powering AEGIS' : 'DESTROY PROJECT AEGIS';
    if (G.won) return 'YOU ARE STORMZILLA. Enjoy.';
    switch (S.tier) {
      case 0: return 'Eat small stuff to grow — reach F1 to lift cows and cars';
      case 1: return 'Hunt cows, cars and trees — reach F2 to wreck houses';
      case 2: return 'Tear through the suburbs — reach F3 for big buildings';
      case 3: return 'Level malls, factories and the port — reach F4 for towers';
      case 4: return 'Downtown is yours — topple skyscrapers to reach F5';
      default: return 'Feed. The military is preparing something big…';
    }
  };

  // starting upgrades from storm type
  for (const k in stormDef.start) for (let i = 0; i < stormDef.start[k]; i++) applyUpgrade(G, k);
  if (S.mass > 0) { S.xp = 0; }
  recalcRadius();
  return G;
}
