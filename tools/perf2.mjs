import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:5192/?nopause&play=classic&auto&seed=7&fixedres`);
await page.waitForTimeout(2500);
const measure = () => page.evaluate(() => new Promise((res) => { const R = __sz.R; let c = 0, ren = 0; const t = performance.now(); const of = R.frame; R.renderer.info.autoReset = false; R.frame = function (...a) { R.renderer.info.reset(); const t0 = performance.now(); of.apply(R, a); R.renderer.getContext().finish(); ren += performance.now() - t0; }; const f = () => { c++; if (performance.now() - t > 2500) { R.frame = of; res(`ren ${(ren / c).toFixed(1)}ms calls ${R.renderer.info.render.calls} tris ${R.renderer.info.render.triangles}`); } else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
for (const mass of [0, 470000]) {
  await page.evaluate((m) => { const G = __sz.G; if (m) { G.S.mass = m; G.addMass(1); G.S.x = 40; G.S.z = 250; } __sz.R.setQuality('high'); }, mass);
  await page.waitForTimeout(5000);
  console.log('mass', mass, 'high      ', await measure());
  await page.evaluate(() => { __sz.R.renderer.shadowMap.enabled = false; __sz.R.scene.traverse(o => { if (o.isLight) o.castShadow = false; }); }); await page.waitForTimeout(500);
  console.log('  no shadows   ', await measure());
  await page.evaluate(() => { __sz.R.setQuality('low'); }); await page.waitForTimeout(500);
  console.log('  low (no bloom, .75 res)', await measure());
  await page.evaluate(() => { __sz.R.scene.traverse(o => { if (o.isPoints) o.visible = false; }); }); await page.waitForTimeout(500);
  console.log('  + no particles', await measure());
  await page.evaluate(() => { __sz.R.scene.traverse(o => { if (o.isPoints) o.visible = true; if (o.isInstancedMesh) o.visible = false; }); const of = __sz.R.frame; }); await page.waitForTimeout(100);
  await page.evaluate(() => { __sz.R.scene.traverse(o => { if (o.isPoints) o.visible = true; }); });
}
await browser.close();
