// Captures gameplay screenshots and composes Steam capsule art into promo/.
import { chromium } from 'playwright-core';
import fs from 'fs';
const B = 'http://127.0.0.1:5192';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const scenes = [
  // name, mass, x, z, upgrades, extra seconds, setup
  ['01-farm-f1', 300, 0, 900, {}, 7],
  ['02-suburb-f2', 3000, 420, 640, { twins: 1 }, 9],
  ['03-firenado-f3', 30000, 380, 380, { firenado: 1, lightning: 2 }, 10],
  ['04-downtown-f4', 200000, 120, 160, { thunder: 1, cannon: 3 }, 11],
  ['05-sharknado', 120000, -150, 300, { sharknado: 1, hail: 2 }, 10],
  ['06-boss', 1000000, -450, -300, { thunder: 1, lightning: 3 }, 13, 'boss'],
];
for (const [name, mass, x, z, ups, secs, extra] of scenes) {
  await page.goto(`${B}/?nopause&shots&play=classic&auto&seed=11&fixedres`);
  await page.waitForTimeout(2500);
  await page.evaluate(([mass, x, z, ups, extra]) => {
    const G = __sz.G; G.S.mass = mass; G.addMass(1); G.S.x = x; G.S.z = z; G.S.xpNext = 1e15;
    for (const k in ups) G.S.up[k] = ups[k];
    if (extra === 'boss') G.bossT = 999;
    G.S.invuln = 1e9;
    __sz.speed = 1;
  }, [mass, x, z, ups, extra]);
  await page.waitForTimeout(secs * 1000);
  await page.evaluate(() => { const S = __sz.G.S; S.hp = S.hpMax; });
  await page.screenshot({ path: `promo/raw/${name}.png` });
  await page.evaluate(() => { document.getElementById('ui').style.display = 'none'; });
  await page.waitForTimeout(120);
  await page.screenshot({ path: `promo/raw/${name}-clean.png` });
  console.log('shot', name);
}
// capsules (Steam sizes)
const art = (bg) => `/promo/raw/${bg}-clean.png`;
const caps = [
  ['header_capsule_920x430', 920, 430, '04-downtown-f4', 78, 50],
  ['small_capsule_462x174', 462, 174, '04-downtown-f4', 86, 50, '0'],
  ['main_capsule_1232x706', 1232, 706, '03-firenado-f3', 72, 46],
  ['vertical_capsule_748x896', 748, 896, '06-boss', 90, 30],
  ['library_capsule_600x900', 600, 900, '04-downtown-f4', 90, 24],
  ['library_hero_3840x1240', 3840, 1240, '06-boss', 0, 0, null, 1],
  ['page_background_1438x810', 1438, 810, '02-suburb-f2', 0, 0, null, 1],
];
for (const [name, w, h, bg, lw, ly, tag, nologo] of caps) {
  const p2 = await browser.newPage({ viewport: { width: w, height: h } });
  await p2.goto(`${B}/tools/capsule.html?w=${w}&h=${h}&bg=${encodeURIComponent(art(bg))}&lw=${lw}&ly=${ly}${tag ? '&tag=' + tag : ''}${nologo ? '&nologo=1' : ''}`);
  await p2.waitForFunction(() => window.ready); await p2.waitForTimeout(600);
  await p2.screenshot({ path: `promo/${name}.png` }); await p2.close(); console.log('capsule', name);
}
const p3 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await p3.goto(`${B}/tools/capsule.html?w=1280&h=720&transparent=1&lw=92&ly=50`);
await p3.waitForFunction(() => window.ready); await p3.waitForTimeout(500);
await p3.screenshot({ path: 'promo/library_logo_1280x720.png', omitBackground: true });
fs.mkdirSync('promo/screenshots', { recursive: true });
for (const f of fs.readdirSync('promo/raw')) if (!f.includes('clean')) fs.copyFileSync('promo/raw/' + f, 'promo/screenshots/' + f);
await browser.close();
