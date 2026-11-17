// Auto-weapons granted by upgrades, plus level-up choice logic.
import { UPGRADES } from './defs.js';
import { TAU } from '../core/rng.js';
import { damageEnemy } from './enemies.js';

function nearestEnemy(G, x, z, maxD, skip) {
  let best = null, bd = maxD;
  for (const en of G.enemies) {
    if (en.dead || (skip && skip.has(en))) continue;
    if (en.t === 'boss_core' && G.boss && G.boss.shield > 0) continue;
    const d = Math.hypot(en.x - x, en.z - z);
    if (d < bd) { bd = d; best = en; }
  }
  return best;
}

function boltAt(G, x, z, dmg, r) {
  const S = G.S;
  G.ev('bolt', { x, z, r });
  for (const en of G.enemies) if (!en.dead && Math.hypot(en.x - x, en.z - z) < r + en.rad) damageEnemy(G, en, dmg, 'lightning');
  G.query(x, z, r, (b) => {
    if (Math.hypot(b.x - x, b.z - z) > r + b.rad * 0.5) return;
    if (b.def.kind === 'bld') { if (b.def.tier <= S.tier + 1) G.pendingDmg.push(b, dmg * 0.25 * (b.def.tier > S.tier ? 0.3 : 1)); }
    else if (b.def.tier <= S.tier) G.pendingSuck.push(b);
  });
}

export function updateWeapons(G, dt) {
  const S = G.S, up = S.up, rng = G.rng, w = S.wT;
  const wd = 4 * G.power();
  const R = S.r;

  // Chain Lightning
  if (up.lightning) {
    w.lightning -= dt * (up.thunder ? 2 : 1);
    if (w.lightning <= 0) {
      w.lightning = 2.7 - 0.28 * up.lightning;
      const seen = new Set();
      let from = { x: S.x, z: S.z }, tg = nearestEnemy(G, S.x, S.z, 150 + R * 2.5, seen);
      if (tg) {
        let y0 = G.funnelH() * 0.7;
        for (let c = 0; c <= up.lightning && tg; c++) {
          G.ev('arc', { x: from.x, y: c ? from.y : y0, z: from.z, tx: tg.x, ty: tg.y + tg.def.h * 0.5, tz: tg.z });
          damageEnemy(G, tg, wd * 2.4 * (1 + 0.25 * up.lightning), 'lightning');
          G.stats.lightning++;
          seen.add(tg); from = { x: tg.x, y: tg.y + tg.def.h * 0.5, z: tg.z };
          tg = nearestEnemy(G, from.x, from.z, 70 + R, seen);
        }
      } else {
        const a = rng() * TAU, d = R + rng() * (40 + R * 2);
        boltAt(G, S.x + Math.cos(a) * d, S.z + Math.sin(a) * d, wd * 3, 10 + R * 0.3);
        w.lightning *= 0.8;
      }
    }
  }
  // SUPERCELL mutation & the ultimate: random lightning carpet
  const storming = S.ultT > 0;
  if (up.thunder || storming) {
    w.thunder -= dt;
    if (w.thunder <= 0) {
      w.thunder = storming ? 0.1 : 0.45;
      let x, z;
      const tg = rng() < 0.5 ? nearestEnemy(G, S.x + rng.range(-1, 1) * 80, S.z + rng.range(-1, 1) * 80, 120 + R * 3) : null;
      if (tg) { x = tg.x; z = tg.z; }
      else { const a = rng() * TAU, d = R * 0.8 + Math.sqrt(rng()) * (30 + R * (storming ? 4 : 3)); x = S.x + Math.cos(a) * d; z = S.z + Math.sin(a) * d; }
      boltAt(G, x, z, wd * (storming ? 2.6 : 1.6), 9 + R * 0.35);
    }
  }
  // Hail Barrage
  if (up.hail) {
    w.hail -= dt;
    if (w.hail <= 0) {
      w.hail = 5 - 0.5 * up.hail;
      const tg = nearestEnemy(G, S.x, S.z, 160 + R * 3);
      const l = Math.hypot(S.vx, S.vz) || 1;
      const x = tg ? tg.x : S.x + S.vx / l * (R * 2.5 + 20), z = tg ? tg.z : S.z + S.vz / l * (R * 2.5 + 20);
      G.zones.push({ kind: 'hail', x, z, r: 14 + 4 * up.hail + R * 0.6, t: 2.6, dur: 2.6, dmg: wd * (1.5 + 0.3 * up.hail), hostile: false, acc: 0 });
      G.ev('hail', { x, z });
    }
  }
  // SHARKNADO
  if (up.sharknado) {
    w.shark -= dt;
    if (w.shark <= 0) {
      w.shark = 1.3;
      const seen = new Set();
      for (let k = 0; k < 2 + S.tier; k++) {
        const tg = nearestEnemy(G, S.x, S.z, 190 + R * 2.5, seen);
        if (!tg) break;
        seen.add(tg);
        const a = rng() * TAU, h = G.funnelH() * (0.3 + rng() * 0.4);
        G.shots.push({ k: 'shark', t: 'shark', x: S.x + Math.cos(a) * R, y: h, z: S.z + Math.sin(a) * R, vx: Math.cos(a) * 30, vy: 25, vz: Math.sin(a) * 30, life: 5, dmg: wd * 2.6, hostile: false, target: tg, sp: 85 + R, rx: 0, ry: 0, rz: 0, s: 1 + S.tier * 0.35, c: 0xffffff });
        G.stats.sharks++;
      }
      if (seen.size) G.ev('sharks', { n: seen.size });
    }
  }
  // Sister Twisters
  const nT = up.twins;
  while (G.twins.length < nT) G.twins.push({ x: S.x, z: S.z, r: 1, a: G.twins.length * 2.1, t: 0 });
  for (let i = 0; i < G.twins.length; i++) {
    const T = G.twins[i];
    T.a += dt * (0.8 + i * 0.13) * (i % 2 ? -1 : 1);
    const dist = R * 3 + 10 + i * R * 0.6;
    const tx = S.x + Math.cos(T.a) * dist, tz = S.z + Math.sin(T.a) * dist;
    T.x += (tx - T.x) * Math.min(1, dt * 3); T.z += (tz - T.z) * Math.min(1, dt * 3);
    T.r = Math.max(1.6, R * 0.42);
    const tt = Math.max(0, S.tier - 1);
    G.query(T.x, T.z, T.r * 2.2, (e) => {
      const d = Math.hypot(e.x - T.x, e.z - T.z);
      if (e.def.kind === 'bld') { if (d < T.r + e.rad * 0.7 && e.def.tier <= tt) G.pendingDmg.push(e, 9 * G.power() * 0.4 * dt); }
      else if (e.def.tier <= tt && d < T.r * 2.2) G.startSuck(e, i + 1);
    });
    for (const en of G.enemies) if (!en.dead && !en.air && Math.hypot(en.x - T.x, en.z - T.z) < T.r + en.rad) damageEnemy(G, en, 34 * G.power() * 0.4 * dt, 'storm');
  }
}

export function rollChoices(G) {
  const S = G.S, up = S.up, rng = G.rng;
  const cands = [], muts = [];
  for (const id in UPGRADES) {
    const u = UPGRADES[id];
    if (up[id] >= u.max) continue;
    if (u.rarity === 3) { if (S.mutations < 2) muts.push(id); }
    else cands.push(id);
  }
  const mk = (id) => { const u = UPGRADES[id]; return { id, name: u.name, icon: u.icon, short: u.desc[0], desc: u.desc[1], rank: up[id], max: u.max, rarity: u.rarity }; };
  const out = [];
  const mutLevel = (S.level === 3 || S.level === 11) && muts.length >= 2;
  if (mutLevel) {
    for (let i = 0; i < 3 && muts.length; i++) out.push(mk(muts.splice(Math.floor(rng() * muts.length), 1)[0]));
    return out;
  }
  const pool = cands.map((id) => ({ id, w: (UPGRADES[id].rarity === 0 ? 10 : 6) * (up[id] > 0 ? 1.4 : 1) }));
  if (muts.length && S.level > 5 && rng() < 0.06) pool.push({ id: rng.pick(muts), w: 8 });
  for (let i = 0; i < 3 && pool.length; i++) {
    let tot = 0; for (const p of pool) tot += p.w;
    let r = rng() * tot, k = 0;
    for (; k < pool.length - 1; k++) { r -= pool[k].w; if (r <= 0) break; }
    out.push(mk(pool.splice(k, 1)[0].id));
  }
  if (!out.length) out.push({ id: 'feast', name: 'Feast', icon: '🍖', short: 'Heal 50% integrity', desc: 'Nothing left to learn. Have a snack.', rank: 0, max: 99, rarity: 0 });
  return out;
}

export function applyUpgrade(G, id) {
  const S = G.S;
  if (id === 'feast') { S.hp = Math.min(S.hpMax, S.hp + S.hpMax * 0.5); return; }
  const u = UPGRADES[id]; if (!u) return;
  S.up[id]++;
  if (u.rarity === 3) S.mutations++;
  if (id === 'vitality') { S.hpMax += 25; S.hp = Math.min(S.hpMax, S.hp + 30); }
  if (id === 'moneynado') { /* chaos x2 handled in chaosEarned */ }
}
