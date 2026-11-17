// Screenshot the model viewer with headless Chrome (needs `npx vite --port 5201 --strictPort` running).
//   node tools/shoot-models.mjs                 -> contact sheets for every group + hero shots
//   node tools/shoot-models.mjs sheets [group]  -> only contact sheets (optionally one group: 0..5|chunk|enemy)
//   node tools/shoot-models.mjs heroes          -> only hero close-ups
//   node tools/shoot-models.mjs one cow,car [az] [el] [extraQuery]   -> shots/models/one_<names>.png
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { PROPS } from '../src/game/defs.js';

const BASE = process.env.VIEWER || 'http://127.0.0.1:5201/tools/models.html';
const OUT = 'shots/models';
mkdirSync(OUT, { recursive: true });
const [mode = 'all', a1, a2, a3, a4] = process.argv.slice(2);

const groupOf = (d) => (d.kind === 'chunk' ? 'chunk' : d.kind === 'enemy' ? 'enemy' : String(d.tier));
const GROUPS = ['0', '1', '2', '3', '4', '5', 'chunk', 'enemy'];
const PER_SHEET = { 0: 10, 1: 8, 2: 6, 3: 6, 4: 4, 5: 4, chunk: 13, enemy: 6 };

const HEROES = [
  ['cow', 35, 22], ['car', 35, 24], ['house_a', 32, 26], ['barn', 35, 24], ['donut_shop', 28, 20], ['ferris', 25, 14],
  ['giant_duck', 35, 16], ['boss_core', 30, 14], ['boss_pylon', 30, 14], ['tank', 35, 24], ['tower_a', 30, 12], ['capitol', 28, 20],
  ['cargo_ship', 50, 22], ['stadium', 30, 34], ['mega_tower', 30, 10], ['coaster', 30, 28],
];

const shots = [];
if (mode === 'one') {
  shots.push({ file: `one_${a1.split(',').slice(0, 3).join('_')}${a4 ? '_' + a4 : ''}`, q: `only=${a1}&az=${a2 || 32}&el=${a3 || 24}${a1.includes(',') ? '&norm=1' : ''}${process.env.Q ? '&' + process.env.Q : ''}` });
} else {
  if (mode === 'all' || mode === 'sheets') {
    for (const g of GROUPS) {
      if (a1 && a1 !== g) continue;
      const list = Object.keys(PROPS).filter((n) => groupOf(PROPS[n]) === g), per = PER_SHEET[g];
      for (let i = 0, k = 0; i < list.length; i += per, k++) {
        const part = list.slice(i, i + per), cols = Math.ceil(part.length / (part.length > 3 ? 2 : 1));
        shots.push({ file: `sheet_${g}_${k}`, q: `only=${part.join(',')}&norm=1&cols=${cols}&az=28&el=30` });
      }
    }
  }
  if (mode === 'all' || mode === 'heroes') {
    for (const [n, az, el] of HEROES) shots.push({ file: `hero_${n}`, q: `only=${n}&az=${az}&el=${el}&labels=0&clean=1` });
    shots.push({ file: 'dusk_downtown', q: 'only=office,tower_a,tower_b,hotel,hospital,mega_tower&dusk=1&az=30&el=12&labels=0&clean=1' });
    shots.push({ file: 'dusk_suburb', q: 'only=house_a,house_b,house_c,diner,donut_shop,gas_station&dusk=1&az=30&el=22&labels=0&clean=1' });
    shots.push({ file: 'tier_all', q: 'az=30&el=30&labels=0&clean=1' });
  }
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
for (const s of shots) {
  await page.goto(`${BASE}?${s.q}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', null, { timeout: 60000 }).catch(() => errors.push('timeout ' + s.file));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${s.file}.png` });
  console.log('shot', `${OUT}/${s.file}.png`);
}
await browser.close();
if (errors.length) { console.log('PAGE ERRORS:\n' + [...new Set(errors)].slice(0, 12).join('\n')); process.exitCode = 1; }
