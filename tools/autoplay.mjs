// Plays a full run in real Chrome with the autopilot; screenshots along the way; reports errors + fps.
// Usage: node tools/autoplay.mjs [speed=3] [maxSeconds=240] [WxH] [query]
import { chromium } from 'playwright-core';
import fs from 'fs';
const [speed = '3', maxS = '240', size = '1280x720', query = ''] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push('error: ' + m.text().slice(0, 300)); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + String(e.stack || e).slice(0, 600)));
await page.goto(`http://127.0.0.1:${process.env.PORT || 5192}/?nopause&shots&play=classic&auto&seed=7&${query}`);
await page.waitForTimeout(2500);
await page.evaluate((s) => { __sz.speed = s; }, +speed);
fs.mkdirSync('shots/auto', { recursive: true });
const t0 = Date.now(); let n = 0, lastTier = -1, fpsMin = 999, fpsSum = 0, fpsN = 0;
while (Date.now() - t0 < +maxS * 1000) {
  await page.waitForTimeout(1500);
  const s = await page.evaluate(() => { const G = __sz.G, S = G.S; return { mode: __sz.mode, t: +G.t.toFixed(0), tier: S.tier, mass: Math.round(S.mass), hp: Math.round(S.hp), lvl: S.level, en: G.enemies.length, dyn: G.dyn.length, boss: !!G.boss, fps: +document.querySelector('#ui') && 0 }; });
  const fps = await page.evaluate(() => new Promise((res) => { let c = 0; const t = performance.now(); const f = () => { c++; if (performance.now() - t > 500) res(Math.round(c * 2)); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
  fpsMin = Math.min(fpsMin, fps); fpsSum += fps; fpsN++;
  if (s.tier !== lastTier || n % 12 === 0 || s.mode === 'results') { await page.screenshot({ path: `shots/auto/${String(n).padStart(3, '0')}-F${s.tier}-${s.t}s.png` }); lastTier = s.tier; console.log(JSON.stringify(s), 'fps', fps); }
  n++;
  if (s.mode === 'results') break;
}
console.log('fps avg', Math.round(fpsSum / fpsN), 'min', fpsMin);
console.log([...new Set(errs)].slice(0, 10).join('\n') || 'no errors');
await browser.close();
