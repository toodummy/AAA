// Gameplay tests: determinism, invariants, and fun/pacing metrics measured by playtest bots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, ST } from '../src/game/sim.js';
import { generateWorld } from '../src/game/world.js';
import { PROPS, TIERS, UPGRADES, ENEMIES, META, STORMS, WORLD } from '../src/game/defs.js';
import { rollChoices } from '../src/game/weapons.js';
import { runBot } from './bot.js';

test('world generation is deterministic and well-formed', () => {
  const a = generateWorld(1), b = generateWorld(1);
  assert.equal(a.placements.length, b.placements.length);
  assert.deepEqual(a.placements[100], b.placements[100]);
  assert.ok(a.placements.length > 9000 && a.placements.length < 16000, 'entity budget ' + a.placements.length);
  for (const p of a.placements) {
    assert.ok(PROPS[p.t], 'known prop ' + p.t);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
    assert.ok(Math.hypot(p.x, p.z) <= WORLD.radius, 'inside world');
  }
  const tiers = [0, 0, 0, 0, 0, 0]; for (const p of a.placements) tiers[PROPS[p.t].tier]++;
  assert.ok(tiers[0] > 3000 && tiers[1] > 1500 && tiers[2] > 600 && tiers[3] > 80 && tiers[4] > 30 && tiers[5] >= 5, 'food at every tier ' + tiers);
});

test('there is a dense buffet of tiny food at the start', () => {
  const G = createSim({ seed: 1 });
  let n = 0; G.query(G.S.x, G.S.z, 60, (e) => { if (e.def.tier === 0 && Math.hypot(e.x - G.S.x, e.z - G.S.z) < 60) n++; });
  assert.ok(n >= 60, 'tier-0 items within 60m: ' + n);
});

test('every tier has enough food on the map to reach the next one', () => {
  const w = generateWorld(1);
  const val = [0, 0, 0, 0, 0, 0]; for (const p of w.placements) val[PROPS[p.t].tier] += PROPS[p.t].xp * p.s;
  let cum = 0;
  for (let t = 0; t < 5; t++) { cum += val[t]; assert.ok(cum * 2.2 > TIERS[t + 1].mass, `food up to tier ${t} (${Math.round(cum)}) can reach ${TIERS[t + 1].name}`); }
});

test('sim is deterministic for a seed', () => {
  const a = runBot({ seed: 5, maxT: 60 }), b = runBot({ seed: 5, maxT: 60 });
  assert.equal(a.mass, b.mass); assert.equal(a.level, b.level);
});

test('upgrade choices are valid, distinct, and mutations appear on schedule', () => {
  const G = createSim({ seed: 3 });
  G.S.level = 3;
  const ch = rollChoices(G);
  assert.ok(ch.length >= 2); assert.ok(ch.every((c) => c.rarity === 3), 'level 3 offers mutations');
  G.S.level = 6;
  for (let i = 0; i < 50; i++) { const c = rollChoices(G); assert.equal(new Set(c.map((x) => x.id)).size, c.length); for (const x of c) assert.ok(UPGRADES[x.id] && G.S.up[x.id] < UPGRADES[x.id].max); }
  // every upgrade can be applied to max without breaking the sim
  for (const id in UPGRADES) for (let r = 0; r < UPGRADES[id].max; r++) { G.awaiting = [{ id }]; G.pickUpgrade(0); }
  for (let i = 0; i < 600; i++) { G.step(1 / 30, { mx: 0, mz: -1, aimX: 0, aimZ: 0, fling: true, dash: i % 90 === 0, ult: true }); if (G.awaiting) G.pickUpgrade(0); G.events.length = 0; }
  assert.ok(Number.isFinite(G.S.x) && Number.isFinite(G.S.mass) && Number.isFinite(G.S.hp));
});

test('every storm type and meta upgrade starts cleanly', () => {
  const meta = {}; for (const id in META) meta[id] = META[id].max;
  for (const id in STORMS) {
    const G = createSim({ seed: 2, storm: id, meta });
    for (let i = 0; i < 300; i++) { G.step(1 / 30, { mx: 0.3, mz: -1, aimX: 0, aimZ: 0 }); if (G.awaiting) G.pickUpgrade(0); G.events.length = 0; }
    assert.ok(G.S.mass > 0 && Number.isFinite(G.S.hp), id);
  }
});

test('too-big things cannot be eaten; right-sized things can', () => {
  const G = createSim({ seed: 1 });
  const S = G.S;
  let house = null; for (const e of G.ents) if (e.t === 'house_a') { house = e; break; }
  S.x = house.x; S.z = house.z;
  for (let i = 0; i < 90; i++) { G.step(1 / 30, { mx: 0, mz: 0, aimX: 0, aimZ: 0 }); if (G.awaiting) G.pickUpgrade(0); }
  assert.equal(house.st, ST.REST, 'F0 cannot eat a house'); assert.equal(house.hp, house.hpMax);
  S.mass = TIERS[2].mass + 10; G.addMass(1);
  for (let i = 0; i < 240; i++) { S.x = house.x; S.z = house.z; G.step(1 / 30, { mx: 0, mz: 0, aimX: 0, aimZ: 0 }); if (G.awaiting) G.pickUpgrade(0); }
  assert.notEqual(house.st, ST.REST, 'F2 destroys a house');
});

test('enemy tables are consistent', () => {
  for (const k in ENEMIES) { assert.ok(PROPS[k], k + ' has a model'); assert.ok(ENEMIES[k].hp > 0); }
});

// ---------- playtest bots: is it paced like a game people want to play? ----------
const SEEDS = [1, 2, 3, 4, 5, 6];
let skilled = null, sloppy = null;
const getSkilled = () => skilled || (skilled = SEEDS.map((seed) => runBot({ seed, skill: 0.8 })));
const getSloppy = () => sloppy || (sloppy = SEEDS.map((seed) => runBot({ seed, skill: 0.25 })));

test('pacing: first growth is fast, every tier arrives on a sane schedule', () => {
  for (const r of getSkilled()) {
    assert.ok(r.levels[0] < 12, 'first level-up within 12s: ' + r.levels[0]);
    assert.ok(r.tiers[1] > 12 && r.tiers[1] < 60, 'F1 at ' + r.tiers[1]);
    assert.ok(r.tiers[2] < 120, 'F2 at ' + r.tiers[2]);
    assert.ok(r.tiers[3] > 50 && r.tiers[3] < 240, 'F3 at ' + r.tiers[3]);
    if (r.tiers[5]) assert.ok(r.tiers[5] > 150, 'F5 is earned, not handed out: ' + r.tiers[5]);
  }
});

test('pacing: constant feedback - no long dead air, frequent level-ups', () => {
  for (const r of getSkilled()) {
    assert.ok(r.maxGap < 15, 'longest gap without eating ' + r.maxGap);
    const pre = r.levels.filter((t) => !r.bossAt || t < r.bossAt);   // boss fight is pure combat
    const gaps = pre.map((t, i) => (i ? t - pre[i - 1] : t));
    assert.ok(Math.max(...gaps) < 75, 'longest gap between upgrades ' + Math.max(...gaps));
    assert.ok(r.level >= 18, 'enough upgrade picks to build a storm: ' + r.level);
    assert.ok(r.stats.maxCombo >= 15, 'combo system engages: ' + r.stats.maxCombo);
  }
});

test('tension: the military is a real threat and skill matters', () => {
  const a = getSkilled(), b = getSloppy();
  const wins = (l) => l.filter((r) => r.won).length;
  const dmg = (l) => l.reduce((s, r) => s + r.stats.dmgTaken, 0) / l.length;
  assert.ok(wins(a) >= 2, 'a skilled player can win: ' + wins(a) + '/' + a.length);
  assert.ok(wins(a) >= wins(b), 'skill helps: ' + wins(a) + ' vs ' + wins(b));
  assert.ok(wins(b) < b.length, 'a sloppy player does not always win');
  assert.ok(dmg(b) > 60, 'sloppy players get hurt: ' + dmg(b));
  for (const r of a) assert.ok(r.stats.kills >= 10 || !r.tiers[3], 'combat happens: ' + r.stats.kills);
});

test('run length is a satisfying session, and the boss fight is a real fight', () => {
  const a = getSkilled().filter((r) => r.won);
  for (const r of a) {
    assert.ok(r.time > 200 && r.time < 900, 'winning run length ' + r.time);
    assert.ok(r.time - r.bossAt > 15, 'boss fight lasts: ' + (r.time - r.bossAt));
    assert.ok(r.chaos > 500, 'meaningful payout ' + r.chaos);
  }
});

test('no NaNs or runaway entity counts after a full run', () => {
  const G = createSim({ seed: 9 });
  const inp = { mx: 0, mz: -1, aimX: 0, aimZ: 0, fling: true, dash: false, ult: true };
  G.S.mass = TIERS[4].mass; G.addMass(1); G.S.z = 300;
  let maxDyn = 0;
  for (let i = 0; i < 30 * 120 && !G.over; i++) {
    inp.mx = Math.sin(i * 0.01); inp.mz = Math.cos(i * 0.013); inp.dash = i % 200 === 0;
    G.step(1 / 30, inp); if (G.awaiting) G.pickUpgrade(0); G.events.length = 0;
    maxDyn = Math.max(maxDyn, G.dyn.length);
  }
  assert.ok(maxDyn < 1500, 'dynamic entity cap ' + maxDyn);
  for (const e of G.dyn) assert.ok(Number.isFinite(e.x + e.y + e.z), 'finite dyn pos');
  assert.ok(Number.isFinite(G.S.mass + G.S.hp + G.S.x + G.S.z));
});
