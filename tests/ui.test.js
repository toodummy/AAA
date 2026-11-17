import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp01, metaCost, metaState, fmtNum, fmtInt, fmtTime, fmtPercent, isUnlocked, unlockProgress,
  tierLabel, countUp, uiUnit, wrap, pickDirectional,
} from '../src/ui/format.js';
import { META, STORMS, TIERS, UPGRADES } from '../src/game/defs.js';

test('metaCost follows round(base * mult^rank)', () => {
  assert.equal(metaCost(META.startMass, 0), 60);
  assert.equal(metaCost(META.startMass, 3), 480);
  assert.equal(metaCost(META.greed, 2), Math.round(100 * 2.1 * 2.1));
  assert.equal(metaCost(META.reroll, 1), 375);
  assert.equal(metaCost(META.revive, 0), 1500);
  for (const id of Object.keys(META)) {
    for (let r = 0; r < META[id].max; r++) assert.ok(Number.isInteger(metaCost(META[id], r)));
  }
});

test('metaState', () => {
  assert.equal(metaState(META.startMass, 0, 59), 'poor');
  assert.equal(metaState(META.startMass, 0, 60), 'ok');
  assert.equal(metaState(META.startMass, 5, 1e9), 'max');
  assert.equal(metaState(META.revive, 1, 0), 'max');
  assert.equal(metaState(META.revive, undefined, undefined), 'poor');
});

test('fmtNum compacts large numbers', () => {
  assert.equal(fmtNum(0), '0');
  assert.equal(fmtNum(999), '999');
  assert.equal(fmtNum(999.9), '999');
  assert.equal(fmtNum(1000), '1K');
  assert.equal(fmtNum(12400), '12.4K');
  assert.equal(fmtNum(12499), '12.4K');
  assert.equal(fmtNum(999999), '999K');
  assert.equal(fmtNum(1200000), '1.2M');
  assert.equal(fmtNum(150000), '150K');
  assert.equal(fmtNum(3.45e9), '3.4B');
  assert.equal(fmtNum(-1500), '-1.5K');
  assert.equal(fmtNum(undefined), '0');
  assert.equal(fmtNum(NaN), '0');
});

test('fmtInt adds thousands separators', () => {
  assert.equal(fmtInt(0), '0');
  assert.equal(fmtInt(999), '999');
  assert.equal(fmtInt(1000), '1,000');
  assert.equal(fmtInt(1234567), '1,234,567');
  assert.equal(fmtInt(-45000), '-45,000');
  assert.equal(fmtInt(12.6), '13');
});

test('fmtTime', () => {
  assert.equal(fmtTime(0), '0:00');
  assert.equal(fmtTime(9.9), '0:09');
  assert.equal(fmtTime(75), '1:15');
  assert.equal(fmtTime(600), '10:00');
  assert.equal(fmtTime(3725), '1:02:05');
  assert.equal(fmtTime(-4), '0:00');
  assert.equal(fmtTime(undefined), '0:00');
});

test('clamp01 / fmtPercent / wrap / countUp', () => {
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01(NaN), 0);
  assert.equal(clamp01(0.25), 0.25);
  assert.equal(fmtPercent(0.456), '46%');
  assert.equal(wrap(-1, 5), 4);
  assert.equal(wrap(5, 5), 0);
  assert.equal(countUp(1000, 0), 0);
  assert.equal(countUp(1000, 1), 1000);
  assert.equal(countUp(1000, 5), 1000);
  assert.ok(countUp(1000, 0.5) > 500 && countUp(1000, 0.5) < 1000);
});

test('storm unlock checks', () => {
  const fresh = { stats: { bestTier: 0, bossKills: 0, totalChaos: 0 } };
  assert.equal(isUnlocked(STORMS.classic, fresh), true);
  assert.equal(isUnlocked(STORMS.fire, fresh), false);
  assert.equal(isUnlocked(STORMS.fire, { stats: { bestTier: 3 } }), true);
  assert.equal(isUnlocked(STORMS.shark, { stats: { bestTier: 3 } }), false);
  assert.equal(isUnlocked(STORMS.snow, { stats: { bossKills: 1 } }), true);
  assert.equal(isUnlocked(STORMS.cash, { stats: { totalChaos: 4999 } }), false);
  assert.equal(isUnlocked(STORMS.cash, { stats: { totalChaos: 5000 } }), true);
  assert.equal(isUnlocked(STORMS.fire, null), false);
  assert.equal(isUnlocked({ unlock: { stat: 'wins', gte: 1 } }, { wins: 2 }), true);
  assert.equal(unlockProgress(STORMS.cash, { stats: { totalChaos: 2500 } }), 0.5);
  assert.equal(unlockProgress(STORMS.classic, fresh), 1);
});

test('tierLabel', () => {
  assert.equal(tierLabel(TIERS, 3), 'F3 — WEDGE');
  assert.equal(tierLabel(TIERS, 99), 'F6 — STORMZILLA');
  assert.equal(tierLabel(TIERS, -2), 'F0 — DUST DEVIL');
});

test('uiUnit scales with the smaller axis and clamps', () => {
  assert.equal(uiUnit(1600, 900), 1);
  assert.equal(uiUnit(960, 600), 0.6);
  assert.equal(uiUnit(3840, 2160), 2.4);
  assert.equal(uiUnit(100, 100), 0.5);
  assert.equal(uiUnit(20000, 20000), 3);
});

test('pickDirectional spatial navigation', () => {
  // 2x2 grid + a wide button below
  const rects = [
    { x: 0, y: 0, w: 100, h: 50 }, { x: 120, y: 0, w: 100, h: 50 },
    { x: 0, y: 70, w: 100, h: 50 }, { x: 120, y: 70, w: 100, h: 50 },
    { x: 0, y: 140, w: 220, h: 50 },
  ];
  assert.equal(pickDirectional(rects, 0, 'right'), 1);
  assert.equal(pickDirectional(rects, 0, 'down'), 2);
  assert.equal(pickDirectional(rects, 0, 'left'), -1);
  assert.equal(pickDirectional(rects, 0, 'up'), -1);
  assert.equal(pickDirectional(rects, 3, 'left'), 2);
  assert.equal(pickDirectional(rects, 3, 'down'), 4);
  assert.equal(pickDirectional(rects, 4, 'up') >= 2, true);
  assert.equal(pickDirectional(rects, 1, 'down'), 3);
});

test('every upgrade / meta / storm id has an icon', async () => {
  const { ICONS, hasIcon } = await import('../src/ui/icons.js');
  for (const id of [...Object.keys(UPGRADES), ...Object.keys(META), ...Object.keys(STORMS), 'dash', 'fling', 'ult']) {
    assert.ok(hasIcon(id), 'missing icon: ' + id);
    assert.equal(typeof ICONS[id], 'string');
  }
});
