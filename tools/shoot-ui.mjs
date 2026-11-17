// Screenshots every UI screen/state at several sizes into shots/ui/.
// Usage: node tools/shoot-ui.mjs [nameFilter] [WxH,WxH...]   (needs: npx vite --port 5202 --strictPort)
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:5202/tools/ui.html';
const OUT = 'shots/ui';
const SHOTS = {
  loading: 'screen=loading',
  title: 'screen=title',
  'menu-play': 'screen=menu',
  'menu-play-fresh': 'screen=menu&fresh=1&noquit=1',
  'menu-upgrades': 'screen=menu&tab=upgrades',
  'menu-achievements': 'screen=menu&tab=achievements',
  'menu-settings': 'screen=menu&tab=settings',
  'menu-settings-modal': 'screen=menu&tab=settings&modal=1',
  'menu-howto': 'screen=menu&tab=howto',
  'menu-credits': 'screen=menu&tab=credits',
  hud: 'screen=hud&freeze=1&tier=3&combo=8&threat=2&fps=1',
  'hud-boss': 'screen=hud&freeze=1&tier=5&combo=34&threat=5&boss=1&ultready=1&ups=16',
  'hud-lowhp': 'screen=hud&freeze=1&tier=1&combo=1&threat=1&lowhp=1&ups=3',
  'hud-toasts': 'screen=hud&freeze=1&tier=3&combo=14&threat=3&toast=all&news=1&popups=1',
  'hud-warning': 'screen=hud&freeze=1&tier=2&combo=3&threat=3&toast=warning&news=1',
  levelup: 'screen=levelup&freeze=1&tier=3',
  'levelup-mutation': 'screen=levelup&freeze=1&tier=3&mut=1&cards=4',
  'levelup-2': 'screen=levelup&freeze=1&tier=3&cards=2',
  pause: 'screen=pause&freeze=1&tier=3&ups=14',
  'pause-settings': 'screen=pause&freeze=1&tier=3&psettings=1',
  'pause-modal': 'screen=pause&freeze=1&tier=3&modal=1',
  'results-win': 'screen=results&win=1',
  'results-lose': 'screen=results',
};
const filter = process.argv[2] || '';
const sizes = (process.argv[3] || '960x600,1238x802,1920x1080').split(',').map((s) => s.split('x').map(Number));
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
let problems = 0;
for (const [w, h] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => { problems++; console.log('PAGE ERROR', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { problems++; console.log('CONSOLE ERROR', m.text()); } });
  for (const [name, query] of Object.entries(SHOTS)) {
    if (filter && !name.includes(filter)) continue;
    await page.goto(`${BASE}?${query}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(name.startsWith('results') ? 2600 : name.includes('toasts') ? 700 : 1300);
    await page.screenshot({ path: `${OUT}/${name}-${w}x${h}.png` });
    // overflow audit: every visible element of the active UI must be inside the viewport
    const out = await page.evaluate(() => {
      const bad = [];
      const vw = innerWidth, vh = innerHeight;
      const skip = '.sz-popups, .sz-flash, .sz-vignette, .sz-banner, .sz-news, .sz-radar, .sz-card-ribbon, .sz-paper, .sz-btn, .sz-ico, .sz-combo, .sz-card';
      for (const el of document.querySelectorAll('#ui *')) {
        if (el.closest(skip) && !el.matches('.sz-paper, .sz-btn, .sz-combo, .sz-card')) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
        let p = el, hidden = false;
        while (p && p.id !== 'ui') { const s = getComputedStyle(p); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) { hidden = true; break; } p = p.parentElement; }
        if (hidden) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) bad.push(`${el.className || el.tagName} [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}]`);
        if ((el.matches('.sz-page, .sz-build, .sz-card-body, .sz-res-panel, .sz-paper, .sz-pause-view')) && (el.scrollHeight > el.clientHeight + 2)) bad.push(`SCROLL/CLIP ${el.className} ${el.scrollHeight}>${el.clientHeight}`);
      }
      return bad.slice(0, 8);
    });
    if (out.length) { problems++; console.log(`OVERFLOW ${name} ${w}x${h}:\n  ` + out.join('\n  ')); }
  }
  await page.close();
}
await browser.close();
console.log(problems ? `done with ${problems} problem(s)` : 'done, no overflow / errors');
