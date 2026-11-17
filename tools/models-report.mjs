// Dev report: triangle counts vs budget, auto-fit distortion, missing models, per-tier totals.
//   node tools/models-report.mjs [--all]
import { PROPS } from '../src/game/defs.js';
import { buildModel, hasModel, MODEL_INFO } from '../src/render/models.js';

const budget = (n, d) => (n === 'boss_core' ? 6000 : d.kind === 'chunk' ? 60 : [180, 450, 1100, 2600, 4500, 4500][d.tier]);
const groupOf = (d) => (d.kind === 'chunk' ? 'chunk' : d.kind === 'enemy' ? 'enemy' : 'tier' + d.tier);
const all = process.argv.includes('--all');
const totals = {}, missing = [];
for (const [n, d] of Object.entries(PROPS)) {
  if (!hasModel(n)) { missing.push(n); continue; }
  let info;
  try { buildModel(n); info = MODEL_INFO[n]; } catch (e) { console.log(`!! ${n}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); continue; }
  const b = budget(n, d), f = info.fit, bad = f.some((k) => k < 0.93 || k > 1.07), over = info.tris > b;
  const gk = groupOf(d); (totals[gk] ||= { n: 0, tris: 0 }); totals[gk].n++; totals[gk].tris += info.tris;
  if (all || bad || over) console.log(`${over ? 'OVER ' : bad ? 'fit  ' : '     '}${n.padEnd(14)} ${String(info.tris).padStart(5)}/${String(b).padEnd(5)} fit ${f.map((k) => k.toFixed(2)).join(' ')}${info.tintable ? ' tint' : ''}${info.glows ? ' glow' : ''}`);
}
console.log('missing:', missing.length ? missing.join(' ') : 'none');
console.log(Object.entries(totals).map(([k, v]) => `${k}: ${v.n} models, ${v.tris} tris`).join('\n'));
