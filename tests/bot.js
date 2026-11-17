// Headless playtest bot: plays the sim with simple human-like heuristics and records pacing metrics.
import { createSim, ST } from '../src/game/sim.js';
import { TIERS, WORLD } from '../src/game/defs.js';

export function runBot(opts = {}) {
  const G = createSim({ seed: opts.seed ?? 1, storm: opts.storm, meta: opts.meta });
  const S = G.S, dt = 1 / 30, maxT = opts.maxT ?? 1500;
  const skill = opts.skill ?? 0.7;        // 0 = never dodges, 1 = always reacts
  const log = { tiers: [0], levels: [], eatGaps: [], hpMin: 1, threatAt: [], events: {}, bossAt: 0, upgrades: [], src: {} };
  let target = null, retarget = 0, lastEat = 0, maxGap = 0, input = { mx: 0, mz: 0, aimX: 0, aimZ: 0, dash: false, fling: false, ult: false };
  let rs = (opts.seed ?? 1) * 9301 + 7; const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
  while (!G.over && G.t < maxT) {
    if (G.awaiting) {
      // prefer mutations, then ranks we already own
      let bi = 0, bs = -1; G.awaiting.forEach((c, i) => { const sc = c.rarity * 3 + c.rank + rnd(); if (sc > bs) { bs = sc; bi = i; } });
      log.upgrades.push(G.awaiting[bi].id); G.pickUpgrade(bi); continue;
    }
    retarget -= dt;
    if (retarget <= 0 || !target || target.st !== ST.REST) {
      retarget = 0.5; target = null; let best = -1;
      const scan = (rad) => G.query(S.x, S.z, rad, (e) => {
        const d = Math.hypot(e.x - S.x, e.z - S.z);
        let ok = e.def.kind === 'bld' ? e.def.tier <= S.tier : e.def.tier <= S.tier;
        if (!ok || d > rad) return;
        const v = (e.def.xp + 1) / (d + S.r * 2 + 10);
        if (v > best) { best = v; target = e; }
      });
      scan(S.r * 8 + 60); if (!target) scan(400); if (!target) scan(1400);
    }
    let tx = 0, tz = 0;
    if (G.boss) {
      // attack pylons first, then the core
      let tg = null, bd = 1e9; for (const en of G.enemies) { if (en.dead) continue; if (en.t === 'boss_pylon' || (en.t === 'boss_core' && G.boss.shield <= 0)) { const d = Math.hypot(en.x - S.x, en.z - S.z); if (d < bd) { bd = d; tg = en; } } }
      if (tg) { tx = tg.x - S.x; tz = tg.z - S.z; }
    } else if (target) { tx = target.x - S.x; tz = target.z - S.z; }
    else { tx = -S.x; tz = -S.z; }
    let l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    // dodge hostile zones
    input.dash = false;
    for (const z of G.zones) {
      if (!z.hostile) continue;
      if (z.kind === 'shell' || z.kind === 'bomb') {
        const dx = S.x - z.x, dz = S.z - z.z, d = Math.hypot(dx, dz);
        if (d < z.r * 1.25 && rnd() < skill) { tx += dx / (d || 1) * 2.5; tz += dz / (d || 1) * 2.5; if (z.t < 0.3 && d < z.r && rnd() < skill * 0.5) input.dash = true; }
      } else if (z.kind === 'ring' && z.live) {
        const d = Math.hypot(S.x - z.x, S.z - z.z); if (Math.abs(d - z.r) < 26 && rnd() < skill * 0.6) input.dash = true;
      }
    }
    for (const s of G.shots) if (s.hostile && Math.hypot(s.x - S.x, s.z - S.z) < 30 + S.r && rnd() < skill * 0.08) input.dash = true;
    l = Math.hypot(tx, tz) || 1; input.mx = tx / l; input.mz = tz / l;
    // fling at nearest enemy
    let ne = null, nd = G.flingRange(); for (const en of G.enemies) { if (en.dead) continue; const d = Math.hypot(en.x - S.x, en.z - S.z); if (d < nd) { nd = d; ne = en; } }
    input.fling = !!ne; if (ne) { input.aimX = ne.x; input.aimZ = ne.z; }
    input.ult = S.ult >= 1 && (G.enemies.length > 3 || !!G.boss);
    const tier0 = S.tier, lvl0 = S.level, eaten0 = G.stats.eaten, th0 = G.threat;
    G.step(dt, input);
    for (const e of G.events) { log.events[e.e] = (log.events[e.e] || 0) + 1; if (e.xp) { const k = 'F' + tier0 + ':' + e.e + ':' + (e.ent ? e.ent.def.kind + e.ent.def.tier : ''); log.src[k] = (log.src[k] || 0) + e.xp; } }
    G.events.length = 0;
    if (S.tier !== tier0) log.tiers[S.tier] = +G.t.toFixed(1);
    if (S.level !== lvl0) log.levels.push(+G.t.toFixed(1));
    if (G.threat !== th0) log.threatAt[G.threat] = +G.t.toFixed(1);
    if (G.stats.eaten !== eaten0) { const gap = G.t - lastEat; if (gap > maxGap) maxGap = gap; if (gap > 2) log.eatGaps.push(+gap.toFixed(1)); lastEat = G.t; }
    if (G.boss) lastEat = G.t;   // the boss fight is combat, not grazing
    if (G.boss && !log.bossAt) log.bossAt = +G.t.toFixed(1);
    const f = S.hp / S.hpMax; if (f < log.hpMin) log.hpMin = f;
  }
  log.time = +G.t.toFixed(1); log.won = G.won; log.over = G.over; log.tier = S.tier; log.mass = Math.round(S.mass); log.level = S.level;
  log.maxGap = +maxGap.toFixed(1); log.stats = G.stats; log.chaos = G.chaosEarned(); log.hpMin = +log.hpMin.toFixed(2);
  log.eatenFrac = +(G.eatenValue / G.totalValue).toFixed(3); log.ents = G.staticCount;
  return log;
}
