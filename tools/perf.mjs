import { chromium } from 'playwright-core';
const q = process.argv[2] || '';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
await page.goto(`http://127.0.0.1:5192/?nopause&play=classic&auto&seed=7&${q}`);
await page.waitForTimeout(2500);
const info = await page.evaluate(() => { const gl = __sz.R.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; });
console.log('GPU:', info);
for (const mass of [0, 500, 30000, 470000]) {
  await page.evaluate((m) => { const G = __sz.G; if (m) { G.S.mass = m; G.addMass(1); G.S.x = 40; G.S.z = m > 100000 ? 250 : m > 10000 ? 600 : 900; } __sz.R.renderer.info.autoReset = false; }, mass);
  await page.waitForTimeout(5000);
  const r = await page.evaluate(() => new Promise((res) => {
    const R = __sz.R, G = __sz.G; let c = 0, simMs = 0, renMs = 0; const t = performance.now();
    const of = R.frame; R.frame = function (...a) { R.renderer.info.reset(); const t0 = performance.now(); of.apply(R, a); R.renderer.getContext().finish(); renMs += performance.now() - t0; };
    const os = G.step; G.step = function (...a) { const t0 = performance.now(); os.apply(G, a); simMs += performance.now() - t0; };
    const f = () => { c++; if (performance.now() - t > 3000) { R.frame = of; G.step = os; res({ fps: Math.round(c / 3), simMs: +(simMs / c).toFixed(2), renMs: +(renMs / c).toFixed(2), calls: R.renderer.info.render.calls, tris: R.renderer.info.render.triangles, dyn: G.dyn.length, tier: G.S.tier }); } else requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }));
  console.log(JSON.stringify(r));
}
await browser.close();
