// Enemy AI, projectiles, hazard zones, spawn director and the AEGIS boss.
import { PROPS, ENEMIES, TIERS, WORLD } from './defs.js';
import { clamp, TAU } from '../core/rng.js';

const THREAT_MASS = [250, 1800, 13000, 90000, 380000];
const THREAT_NAMES = ['', 'POLICE RESPONDING', 'NATIONAL GUARD DEPLOYED', 'ARMY TANKS INBOUND', 'AIR FORCE SCRAMBLED', 'TOTAL WAR'];
const WANT = [0, 3, 6, 8, 11, 13];
const POOLS = [
  [],
  ['police', 'police', 'police', 'news_van', 'news_heli'],
  ['police', 'jeep', 'jeep', 'apc', 'news_heli'],
  ['jeep', 'apc', 'tank', 'tank', 'gunship'],
  ['tank', 'gunship', 'sam', 'jet', 'cryo_drone', 'apc'],
  ['tank', 'sam', 'jet', 'jet', 'bomber', 'cryo_drone', 'gunship'],
];

export function spawnEnemy(G, t, x, z) {
  const def = PROPS[t], st = ENEMIES[t];
  const hpMul = G.power() * (1 + 0.25 * Math.max(0, G.threat - st.minThreat));
  const en = { t, def, stats: st, x, y: st.alt || 0, z, vx: 0, vz: 0, rx: 0, ry: Math.atan2(G.S.x - x, G.S.z - z), rz: 0, s: 1, c: 0xffffff,
    hp: st.hp * hpMul, hpMax: st.hp * hpMul, cd: st.cd * (0.5 + G.rng()), rad: Math.max(def.w, def.d) * 0.5, dead: false,
    chill: 0, frozen: 0, burn: 0, side: G.rng.sign(), air: st.move === 'air' || st.move === 'jet', id: 1e6 + (G._eid = (G._eid || 0) + 1), hitT: 0 };
  G.enemies.push(en);
  return en;
}

export function damageEnemy(G, en, dmg, src) {
  if (en.dead) return;
  const S = G.S;
  if (en.t === 'boss_core' && G.boss && G.boss.shield > 0) { if ((en.shT || 0) < G.t) { en.shT = G.t + 0.5; G.ev('shielded', { x: en.x, z: en.z }); } return; }
  if (en.frozen) dmg *= 3;
  en.hp -= dmg; en.hitT = 0.12; G.stats.dmgDealt += dmg;
  if (src !== 'storm' && src !== 'burn' && src !== 'chill') G.ev('hit', { x: en.x, y: en.y + en.def.h * 0.6, z: en.z, dmg, src });
  if (en.hp > 0) return;
  en.dead = true; G.stats.kills++;
  if (en.t === 'jet' || en.t === 'bomber') G.stats.jets++;
  if (en.t === 'tank') G.stats.tanks++;
  const gain = G.addMass(en.def.xp * (1 + Math.max(0, G.threat - 1) * 0.5), en);
  G.heal(2 + en.def.tier);
  G.ev('kill', { ent: en, xp: gain, src, frozen: en.frozen });
  if (en.t === 'boss_pylon' && G.boss) {
    G.boss.pylons--; G.boss.shield = G.boss.pylons / 3;
    G.ev('pylon', { left: G.boss.pylons, x: en.x, z: en.z });
    G.ev('explosion', { x: en.x, y: 12, z: en.z, r: 40, big: 1 });
    return;
  }
  if (en.t === 'boss_core') {
    G.ev('explosion', { x: en.x, y: 30, z: en.z, r: 220, big: 2 });
    G.stats.bossKill = 1; G.boss = null;
    for (const o of G.enemies) if (!o.dead) { o.dead = true; G.ev('explosion', { x: o.x, y: o.y, z: o.z, r: 14, big: 0 }); }
    G.shots.length = 0; G.zones.length = 0;
    G.win();
    return;
  }
  // wreck gets swallowed if the storm can lift it, otherwise it just blows up
  const near = Math.hypot(en.x - S.x, en.z - S.z) < G.pullR() * 1.6;
  if (near && en.def.tier <= S.tier && !en.frozen) {
    const w = G.spawnLoose(en.t, en.x, en.y, en.z, 1, 0x8a8a8a);
    w.ry = en.ry; w.st = G.ST.SUCK; w.p = 0; w.sx = w.x; w.sy = w.y; w.sz = w.z; w.loose = 1;
    w.oa = Math.atan2(w.z - S.z, w.x - S.x); w.oh = 0.2 + G.rng() * 0.6; w.ok = 1; w.ow = 1; w.sp = 5; w.life = 0.6;
  } else {
    G.ev('explosion', { x: en.x, y: en.y + 1, z: en.z, r: 8 + en.rad * 1.5, big: 0, ice: en.frozen });
  }
}

function fire(G, en) {
  const S = G.S, st = en.stats, rng = G.rng;
  const dmgMul = 1.5 + 0.25 * Math.max(0, G.threat - 1);
  const dmg = st.dmg * dmgMul;
  const dist = Math.hypot(S.x - en.x, S.z - en.z);
  switch (st.shot) {
    case 'bullet': {
      const hit = rng() < 0.7;
      G.ev('tracer', { x: en.x, y: en.y + en.def.h * 0.7, z: en.z, tx: S.x + rng.range(-1, 1) * S.r * 0.6, ty: 3 + rng() * S.r, tz: S.z + rng.range(-1, 1) * S.r * 0.6 });
      if (hit) G.hurt(dmg, en.t);
      break;
    }
    case 'shell': {
      const ft = 1.25;   // seconds until impact - the red circle is the dodge window
      const lead = 0.55 + rng() * 0.5;
      const r = 7 + S.r * 0.32;
      G.zones.push({ kind: 'shell', x: S.x + S.vx * ft * lead + rng.range(-1, 1) * r * 0.4, z: S.z + S.vz * ft * lead + rng.range(-1, 1) * r * 0.4, r, t: ft, dur: ft, dmg, hostile: true, fx: en.x, fz: en.z });
      G.ev('shellfire', { x: en.x, y: en.y + 2, z: en.z });
      break;
    }
    case 'missile': case 'cryo': {
      const n = en.t === 'boss_core' ? 1 : 1;
      for (let i = 0; i < n; i++) {
        const a = Math.atan2(S.x - en.x, S.z - en.z) + rng.range(-0.5, 0.5);
        G.shots.push({ k: st.shot, t: 'missile', x: en.x, y: en.y + en.def.h * 0.8, z: en.z, vx: Math.sin(a) * 40, vy: en.air ? -4 : 22, vz: Math.cos(a) * 40, life: 7, dmg, hostile: true, sp: 58 + G.threat * 3, turn: 1.5, rx: 0, ry: a, rz: 0, s: st.shot === 'cryo' ? 1.3 : 1.2, c: st.shot === 'cryo' ? 0x7fd8ff : 0xffffff });
      }
      G.ev('missilefire', { x: en.x, y: en.y + 2, z: en.z });
      break;
    }
    case 'bomb': {
      const hx = Math.sin(en.ry), hz = Math.cos(en.ry);
      for (let i = 0; i < 6; i++) {
        const along = dist - 80 + i * 34;
        const zx = en.x + hx * along + rng.range(-8, 8), zz = en.z + hz * along + rng.range(-8, 8);
        G.zones.push({ kind: 'bomb', x: zx, z: zz, r: 22 + S.r * 0.2, t: 1.7 + i * 0.16, dur: 1.7 + i * 0.16, dmg, hostile: true, fx: zx, fz: zz, fall: 1 });
      }
      G.ev('bombdrop', { x: en.x, y: en.y, z: en.z });
      break;
    }
  }
}

export function updateEnemies(G, dt) {
  const S = G.S, rng = G.rng, up = S.up;
  const contact = 34 * G.power() * (S.dashT > 0 ? 2.5 + up.dash : 1) * (S.ultT > 0 ? 2 : 1);
  const H = G.funnelH(), wd = 4 * G.power();
  const coldR = up.blizzard ? S.r * 2.2 + 20 : 0, fireR = up.firenado ? S.r * 1.7 + 8 : 0;
  for (let i = G.enemies.length - 1; i >= 0; i--) {
    const en = G.enemies[i];
    if (en.dead) { G.enemies[i] = G.enemies[G.enemies.length - 1]; G.enemies.pop(); continue; }
    const st = en.stats;
    let dx = S.x - en.x, dz = S.z - en.z; const d = Math.hypot(dx, dz) || 1;
    en.hitT -= dt;
    // auras
    if (d < coldR) { en.chill += dt; if (en.chill > 2.6 && !en.frozen && en.t !== 'boss_core' && en.t !== 'boss_pylon') { en.frozen = 1; en.c = 0x9fdcff; G.ev('freeze', { ent: en }); } }
    if (d < fireR) { damageEnemy(G, en, wd * 0.9 * dt, 'burn'); en.burn = 0.5; if (en.dead) continue; } else en.burn -= dt;
    const slow = en.frozen ? 0 : (d < coldR ? 0.45 : 1);
    // storm contact
    const reach = en.air ? (en.y < H ? S.r * (0.5 + 1.25 * Math.pow(clamp(en.y / H, 0, 1), 1.25)) * 1.2 : -1) : S.r;
    if (reach > 0 && d < reach + en.rad) { damageEnemy(G, en, contact * dt, 'storm'); if (en.dead) continue; }
    // movement
    const spd = (d > st.range * 0.72 + S.r ? Math.max(st.speed, Math.hypot(S.vx, S.vz) * 1.25 + 4) : st.speed) * slow;
    if (st.move === 'ground') {
      const want = st.range * 0.72 + S.r;
      let mv = 0;
      if (d > want) mv = 1; else if (d < want * 0.62) mv = -1;
      const tx = dx / d, tz = dz / d;
      // strafe sideways while in the pocket so they are not a static turret
      let vx = tx * mv * spd + -tz * en.side * spd * (mv === 0 ? 0.45 : 0.15), vz = tz * mv * spd + tx * en.side * spd * (mv === 0 ? 0.45 : 0.15);
      en.vx += (vx - en.vx) * Math.min(1, dt * 3); en.vz += (vz - en.vz) * Math.min(1, dt * 3);
      en.x += en.vx * dt; en.z += en.vz * dt;
      if (Math.hypot(en.vx, en.vz) > 1) en.ry = Math.atan2(en.vx, en.vz);
      const dc = Math.hypot(en.x, en.z); if (dc > WORLD.radius - 10) { en.x *= (WORLD.radius - 10) / dc; en.z *= (WORLD.radius - 10) / dc; en.side *= -1; }
    } else if (st.move === 'air') {
      const want = st.range * 0.7 + S.r * 1.3;
      const mv = d > want ? 1 : d < want * 0.7 ? -1 : 0;
      const tx = dx / d, tz = dz / d;
      const vx = tx * mv * spd - tz * en.side * spd * 0.5, vz = tz * mv * spd + tx * en.side * spd * 0.5;
      en.vx += (vx - en.vx) * Math.min(1, dt * 2); en.vz += (vz - en.vz) * Math.min(1, dt * 2);
      en.x += en.vx * dt; en.z += en.vz * dt;
      en.ry = Math.atan2(dx, dz); en.rz = clamp(-en.side * 0.25, -0.4, 0.4); en.rx = 0.12;
      en.y = (st.alt || 40) + Math.sin(G.t * 1.3 + en.id) * 3;
    } else if (st.move === 'jet') {
      const want = Math.atan2(dx, dz);
      let da = want - en.ry; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
      const facing = Math.cos(da);
      if (d > 330 || facing > 0.4) { const turn = clamp(da, -1, 1) * 0.95 * dt * (slow || 0.2); en.ry += turn; en.rz = clamp(-da * 1.2, -1.1, 1.1); }
      else en.rz *= 0.95;
      en.vx = Math.sin(en.ry) * spd; en.vz = Math.cos(en.ry) * spd;
      en.x += en.vx * dt; en.z += en.vz * dt;
      en.y = st.alt;
      en.facing = facing;
    } else if (st.move === 'boss') {
      bossAI(G, en, dt, d, dx, dz);
    }
    // shooting
    if (st.shot && !en.frozen && st.move !== 'boss') {
      en.cd -= dt * (slow < 1 ? 0.5 : 1);
      const canSee = st.move === 'jet' ? (en.facing > 0.85 && d < st.range && d > 60) : d < st.range + S.r;
      if (en.cd <= 0 && canSee) { en.cd = st.cd * (0.85 + rng() * 0.3); fire(G, en); }
    } else if (!st.shot && st.move !== 'static' && st.move !== 'boss') {
      en.cd -= dt;
      if (en.cd <= 0 && d < 160 + S.r) { en.cd = 11 + rng() * 6; G.ev('newscast', { ent: en }); }
    }
  }
}

function bossAI(G, en, dt, d, dx, dz) {
  const S = G.S, rng = G.rng, B = G.boss;
  if (!B) return;
  const phase2 = en.hp < en.hpMax * 0.5;
  if (phase2 && B.phase === 1) { B.phase = 2; G.ev('bossphase', { phase: 2 }); }
  // lumber toward the storm, but keep some distance
  const sp = en.stats.speed * (phase2 ? 1.5 : 1);
  if (d > 150 + S.r) { en.x += dx / d * sp * dt; en.z += dz / d * sp * dt; B.walk += dt * sp; }
  let da = Math.atan2(dx, dz) - en.ry; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
  en.ry += clamp(da, -1, 1) * dt * 0.8;
  en.y = 34 + Math.sin(B.walk * 0.25) * 1.5;
  const dmgMul = phase2 ? 1.3 : 1;
  B.cd -= dt;
  if (B.attack) {
    const A = B.attack; A.t += dt;
    if (A.k === 'missiles') {
      A.acc += dt;
      while (A.acc > 0.16 && A.n > 0) {
        A.acc -= 0.16; A.n--;
        const a = en.ry + rng.range(-1.4, 1.4);
        G.shots.push({ k: 'missile', t: 'missile', x: en.x + Math.sin(a) * 20, y: en.y + 30, z: en.z + Math.cos(a) * 20, vx: Math.sin(a) * 50, vy: 40, vz: Math.cos(a) * 50, life: 8, dmg: 18 * dmgMul, hostile: true, sp: 64, turn: 1.3, rx: 0, ry: a, rz: 0, s: 2.2, c: 0xffffff });
        G.ev('missilefire', { x: en.x, y: en.y + 30, z: en.z });
      }
      if (A.n <= 0) B.attack = null;
    } else if (A.k === 'beam') {
      // zone object holds the live beam so the renderer can draw it
      const Z = A.zone;
      Z.x = en.x; Z.z = en.z;
      if (A.t < Z.warm) { Z.t = Z.warm - A.t; }
      else {
        Z.live = 1; Z.ang += Z.sweep * dt;
        // distance from storm centre to the beam line
        const bx = Math.sin(Z.ang), bz = Math.cos(Z.ang);
        const px = S.x - Z.x, pz = S.z - Z.z, along = px * bx + pz * bz, perp = Math.abs(px * bz - pz * bx);
        if (along > 0 && along < Z.len && perp < Z.w * 0.5 + S.r * 0.25) G.hurt(26 * dmgMul * dt * 4, 'beam'), (S.invuln = Math.max(S.invuln, 0.22));
        if (A.t > Z.warm + 3.2) { Z.t = 0; Z.done = 1; B.attack = null; }
      }
    } else if (A.k === 'stomp') {
      const Z = A.zone;
      if (A.t >= 0.9) {
        if (!Z.live) { Z.live = 1; G.ev('stomp', { x: Z.x, z: Z.z }); }
        const prev = Z.r; Z.r += Z.speed * dt;
        const ds = Math.hypot(S.x - Z.x, S.z - Z.z);
        if (ds >= prev - 4 && ds <= Z.r + 4 && !Z.hit) { Z.hit = 1; G.hurt(30 * dmgMul, 'stomp'); }
        if (Z.r > Z.maxR) { Z.done = 1; B.attack = null; }
      }
    } else if (A.k === 'mortar') {
      A.acc += dt;
      while (A.acc > 0.14 && A.n > 0) {
        A.acc -= 0.14; A.n--;
        const a = rng() * TAU, rr = Math.sqrt(rng()) * (90 + S.r);
        G.zones.push({ kind: 'shell', x: S.x + S.vx * 0.8 + Math.cos(a) * rr, z: S.z + S.vz * 0.8 + Math.sin(a) * rr, r: 20 + S.r * 0.2, t: 1.5, dur: 1.5, dmg: 24 * dmgMul, hostile: true, fx: en.x, fz: en.z });
      }
      if (A.n <= 0) B.attack = null;
    }
  } else if (B.cd <= 0) {
    B.cd = phase2 ? 1.5 : 2.6;
    const opts = ['missiles', 'mortar', 'beam'];
    if (d < 260 + S.r) opts.push('stomp', 'stomp');
    let k = rng.pick(opts); if (k === B.last) k = rng.pick(opts);
    B.last = k;
    if (k === 'missiles') B.attack = { k, t: 0, acc: 0, n: phase2 ? 12 : 7 };
    else if (k === 'mortar') B.attack = { k, t: 0, acc: 0, n: phase2 ? 16 : 10 };
    else if (k === 'beam') {
      const side = rng.sign(), a0 = Math.atan2(dx, dz) - side * 0.75;
      const zone = { kind: 'beam', x: en.x, z: en.z, ang: a0, sweep: side * (phase2 ? 0.62 : 0.47), len: 700, w: 16, t: 1.6, warm: 1.6, dur: 1.6, hostile: true, live: 0 };
      G.zones.push(zone); B.attack = { k, t: 0, zone };
      G.ev('bosscharge', { x: en.x, z: en.z });
    } else {
      const zone = { kind: 'ring', x: en.x, z: en.z, r: 20, maxR: 300 + S.r, speed: phase2 ? 150 : 115, t: 0.9, dur: 0.9, hostile: true, live: 0 };
      G.zones.push(zone); B.attack = { k: 'stomp', t: 0, zone };
      G.ev('bosscharge', { x: en.x, z: en.z });
    }
  }
  // phase 2 reinforcements
  if (phase2) { B.addT -= dt; if (B.addT <= 0 && G.enemies.length < 10) { B.addT = 7; const a = rng() * TAU; spawnEnemy(G, rng.pick(['cryo_drone', 'gunship', 'jet']), en.x + Math.cos(a) * 60, en.z + Math.sin(a) * 60); } }
}

export function updateShots(G, dt) {
  const S = G.S, rng = G.rng, up = S.up;
  // projectiles
  for (let i = G.shots.length - 1; i >= 0; i--) {
    const s = G.shots[i];
    s.life -= dt;
    let gone = s.life <= 0;
    if (s.hostile) {
      const dx = S.x - s.x, dz = S.z - s.z, dy = Math.min(S.r * 1.5 + 4, 30) - s.y;
      const d = Math.hypot(dx, dz, dy) || 1;
      // steer
      const sp = s.sp, k = Math.min(1, s.turn * dt);
      s.vx += (dx / d * sp - s.vx) * k; s.vy += (dy / d * sp - s.vy) * k; s.vz += (dz / d * sp - s.vz) * k;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      s.ry = Math.atan2(s.vx, s.vz); s.rx = -Math.atan2(s.vy, Math.hypot(s.vx, s.vz));
      const hd = Math.hypot(dx, dz);
      if (!s.checked && hd < S.r * 1.7 + 6) {   // orbiting junk can swat it
        s.checked = 1;
        const p = Math.min(0.55, (S.ammo / Math.max(1, S.ammoMax)) * 0.22 + 0.07 * up.armor + (up.magnetar ? 0.2 : 0));
        if (rng() < p && S.orbit.length) { const o = S.orbit.pop(); o.st = G.ST.DIGEST; o.p = 0.6; G.ev('block', { x: s.x, y: s.y, z: s.z }); G.ev('explosion', { x: s.x, y: s.y, z: s.z, r: 7, big: 0 }); gone = true; }
      }
      if (!gone && hd < Math.max(4, S.r * 0.5)) {
        const took = G.hurt(s.dmg, s.k);
        if (s.k === 'cryo' && took > 0) { S.slowT = 3.2; G.ev('chilled'); }
        G.ev('explosion', { x: s.x, y: s.y, z: s.z, r: 9, big: 0, ice: s.k === 'cryo' }); gone = true;
      }
    } else {
      const tg = s.target;
      if (!tg || tg.dead) { gone = true; }
      else {
        const dx = tg.x - s.x, dy = tg.y + tg.def.h * 0.5 - s.y, dz = tg.z - s.z, d = Math.hypot(dx, dy, dz) || 1;
        const k = Math.min(1, 5 * dt);
        s.vx += (dx / d * s.sp - s.vx) * k; s.vy += (dy / d * s.sp - s.vy) * k; s.vz += (dz / d * s.sp - s.vz) * k;
        s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
        s.ry = Math.atan2(s.vx, s.vz); s.rx = -Math.atan2(s.vy, Math.hypot(s.vx, s.vz)); s.rz += dt * 6;
        if (d < tg.rad + 4) { damageEnemy(G, tg, s.dmg, 'shark'); G.ev('chomp', { x: s.x, y: s.y, z: s.z }); gone = true; }
      }
    }
    if (gone) { G.shots[i] = G.shots[G.shots.length - 1]; G.shots.pop(); }
  }
  // zones
  for (let i = G.zones.length - 1; i >= 0; i--) {
    const z = G.zones[i];
    if (z.kind === 'beam' || z.kind === 'ring') { if (z.done) { G.zones[i] = G.zones[G.zones.length - 1]; G.zones.pop(); } else if (z.kind === 'ring' && !z.live) z.t -= dt; continue; }
    z.t -= dt;
    if (z.kind === 'hail') {
      z.acc += dt;
      if (z.acc > 0.25) {
        z.acc -= 0.25;
        for (const en of G.enemies) if (!en.dead && Math.hypot(en.x - z.x, en.z - z.z) < z.r + en.rad) damageEnemy(G, en, z.dmg * 0.25, 'hail');
        G.query(z.x, z.z, z.r, (b) => { if (Math.hypot(b.x - z.x, b.z - z.z) > z.r) return; if (b.def.kind === 'bld') { if (b.def.tier <= S.tier + 1) G.pendingDmg.push(b, z.dmg * 0.05 * (b.def.tier > S.tier ? 0.3 : 1)); } });
      }
      if (z.t <= 0) { G.zones[i] = G.zones[G.zones.length - 1]; G.zones.pop(); }
      continue;
    }
    if (z.t <= 0) {
      const d = Math.hypot(S.x - z.x, S.z - z.z);
      if (d < z.r) G.hurt(z.dmg, z.kind);
      G.ev('explosion', { x: z.x, y: 1, z: z.z, r: z.r, big: z.kind === 'bomb' ? 1 : 0, hostile: 1 });
      // collateral damage: the army is not careful
      G.query(z.x, z.z, z.r, (b) => { if (Math.hypot(b.x - z.x, b.z - z.z) > z.r * 0.8) return; if (b.def.kind === 'bld') { if (b.def.tier <= 3) G.pendingDmg.push(b, 160); } });
      G.zones[i] = G.zones[G.zones.length - 1]; G.zones.pop();
    }
  }
}

export function updateDirector(G, dt) {
  const S = G.S, rng = G.rng;
  if (G.won) { G.winT -= dt; if (G.winT <= 0 && !G.over) { G.over = true; G.ev('gameover', { win: true }); } return; }
  // threat level
  const heat = S.mass * S.threatMul;
  let th = 0; while (th < 5 && heat >= THREAT_MASS[th]) th++;
  if (th > G.threat) { G.threat = th; G.spawnT = 1.5; G.ev('threat', { level: th, name: THREAT_NAMES[th] }); }
  G.threatFrac = th >= 5 ? 1 : clamp((heat - (th ? THREAT_MASS[th - 1] : 0)) / (THREAT_MASS[th] - (th ? THREAT_MASS[th - 1] : 0)), 0, 1);
  // boss
  if (!G.boss && !G.bossDone && S.tier >= 5) {
    G.bossT += dt;
    if (G.bossT > 35 || S.mass > 1000000) spawnBoss(G);
  }
  // spawns
  if (G.threat <= 0) return;
  G.spawnT -= dt;
  let alive = 0; for (const e of G.enemies) if (e.t !== 'boss_core' && e.t !== 'boss_pylon') alive++;
  const want = G.boss ? 5 : WANT[G.threat];
  if (G.spawnT <= 0 && alive < want) {
    G.spawnT = G.boss ? 5 : clamp(3.4 - G.threat * 0.35, 1.4, 4) * (0.7 + rng() * 0.6);
    const pool = POOLS[G.threat];
    let t = rng.pick(pool);
    if ((t === 'news_van' || t === 'news_heli') && G.enemies.some((e) => e.t === t)) t = pool[0];
    const st = ENEMIES[t];
    const dist = (st.move === 'jet' ? 520 : 150 + S.r * 6) + rng() * 60;
    for (let tries = 0; tries < 8; tries++) {
      const a = Math.hypot(S.vx, S.vz) > 3 && rng() < 0.7 ? Math.atan2(S.vz, S.vx) + rng.range(-1.1, 1.1) : rng() * TAU, x = S.x + Math.cos(a) * dist, z = S.z + Math.sin(a) * dist;
      if (st.move !== 'jet' && Math.hypot(x, z) > WORLD.radius - 20) continue;
      const n = t === 'police' && G.threat >= 2 ? 2 : 1;
      for (let i = 0; i < n; i++) spawnEnemy(G, t, x + i * 7, z + i * 5);
      break;
    }
  }
  // cull strays
  for (const e of G.enemies) if (!e.dead && e.stats.move !== 'static' && e.stats.move !== 'boss' && Math.hypot(e.x - S.x, e.z - S.z) > 900) e.dead = true;
}

function spawnBoss(G) {
  const S = G.S, rng = G.rng;
  G.bossDone = 1;
  let bx = WORLD.bossSpawn[0], bz = WORLD.bossSpawn[1];
  let dx = bx - S.x, dz = bz - S.z, d = Math.hypot(dx, dz);
  if (d < 300) { dx = -S.x; dz = -S.z; d = Math.hypot(dx, dz) || 1; }
  const dist = clamp(d, 380, 480);
  bx = S.x + dx / d * dist; bz = S.z + dz / d * dist;
  const dc = Math.hypot(bx, bz); if (dc > WORLD.radius - 200) { bx *= (WORLD.radius - 200) / dc; bz *= (WORLD.radius - 200) / dc; }
  const core = spawnEnemy(G, 'boss_core', bx, bz);
  core.y = 34; core.hp = core.hpMax = ENEMIES.boss_core.hp * G.power();
  G.boss = { ent: core, shield: 1, pylons: 3, phase: 1, cd: 4, attack: null, walk: 0, addT: 3, name: 'PROJECT AEGIS' };
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * TAU + rng() * 0.5;
    let px = bx + Math.cos(a) * 170, pz = bz + Math.sin(a) * 170;
    const pc = Math.hypot(px, pz); if (pc > WORLD.radius - 40) { px *= (WORLD.radius - 40) / pc; pz *= (WORLD.radius - 40) / pc; }
    const p = spawnEnemy(G, 'boss_pylon', px, pz);
    p.hp = p.hpMax = ENEMIES.boss_pylon.hp * G.power(); p.pylon = i;
  }
  G.ev('boss', { x: bx, z: bz });
}
