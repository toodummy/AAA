// Usage: node tools/shot.mjs <name> [url-query] [waitMs] [js-to-eval] [WxH]
import { chromium } from 'playwright-core';
import fs from 'fs';
const [name = 'shot', query = '', wait = '3000', js = '', size = '1280x720', post = '700'] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 400)); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + String(e.stack || e).slice(0, 800)));
await page.goto('http://127.0.0.1:' + (process.env.PORT || 5192) + '/?nopause&shots&' + query);
await page.waitForTimeout(+wait);
if (js) { const r = await page.evaluate(js); if (r !== undefined) console.log('eval:', JSON.stringify(r)); await page.waitForTimeout(+post); }
fs.mkdirSync('shots', { recursive: true });
await page.screenshot({ path: `shots/${name}.png` });
console.log([...new Set(errs)].slice(0, 12).join('\n') || 'no console errors');
await browser.close();
