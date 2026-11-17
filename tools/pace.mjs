import { runBot } from '../tests/bot.js';
const seeds = (process.argv[2] || '1,2,3').split(',').map(Number);
const skill = +(process.argv[3] ?? 0.7);
for (const seed of seeds) {
  const t0 = Date.now();
  const r = runBot({ seed, skill });
  console.log(`seed ${seed} skill ${skill}: ${r.won ? 'WIN' : r.over ? 'DEAD' : 'TIMEOUT'} t=${r.time}s tier=F${r.tier} mass=${r.mass} lvl=${r.level} hpMin=${r.hpMin} chaos=${r.chaos} eaten=${r.eatenFrac} ents=${r.ents} (${Date.now() - t0}ms)`);
  console.log('  tiers@', r.tiers.join(' | '), ' threat@', r.threatAt.join(' | '), ' boss@', r.bossAt);
  if (process.argv[4]) console.log('  gaps>2s:', r.eatGaps.length, 'max', r.maxGap, ' kills', r.stats.kills, 'bld', r.stats.buildings, 'combo', r.stats.maxCombo, 'dmgTaken', Math.round(r.stats.dmgTaken));
  if (process.argv[4]) console.log('  ups:', r.upgrades.join(','));
  if (process.argv[4]) console.log('  ev:', Object.entries(r.events).map(([k, v]) => k + ':' + v).join(' '));
}
