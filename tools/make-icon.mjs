import { chromium } from 'playwright-core';
import fs from 'fs';
const svg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 256 256">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b3445"/><stop offset="1" stop-color="#0b0d12"/></linearGradient>
<linearGradient id="fn" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8fa0b5"/><stop offset=".5" stop-color="#eef3f8"/><stop offset="1" stop-color="#7a8aa0"/></linearGradient>
<linearGradient id="bolt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe066"/><stop offset="1" stop-color="#ff8a00"/></linearGradient></defs>
<rect x="8" y="8" width="240" height="240" rx="52" fill="url(#bg)"/>
<rect x="8" y="8" width="240" height="240" rx="52" fill="none" stroke="#ffb400" stroke-width="6"/>
${[[128,50,92,20],[124,82,74,17],[118,112,58,15],[112,140,44,13],[108,166,32,11],[106,190,22,9],[108,212,13,7]].map(([x,y,rx,ry],i)=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="url(#fn)" opacity="${0.95-i*0.03}" stroke="#2b3445" stroke-width="3"/>`).join('')}
<path d="M170 60 L132 132 L156 132 L120 214 L196 112 L168 112 L194 60 Z" fill="url(#bolt)" stroke="#1a1206" stroke-width="5" stroke-linejoin="round"/>
<ellipse cx="108" cy="228" rx="44" ry="7" fill="#c9a36a" opacity=".55"/>
</svg>`;
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
const pngs = {};
for (const s of [16, 32, 48, 64, 128, 256, 512]) {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(s)}</body></html>`);
  pngs[s] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
}
await browser.close();
fs.writeFileSync('electron/icon.png', pngs[512]);
fs.mkdirSync('public', { recursive: true }); fs.writeFileSync('public/favicon.png', pngs[64]);
// ICO with embedded PNGs
const sizes = [16, 32, 48, 64, 128, 256];
const head = Buffer.alloc(6 + 16 * sizes.length); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let off = head.length; const bodies = [];
sizes.forEach((s, i) => { const b = pngs[s], e = 6 + i * 16; head.writeUInt8(s === 256 ? 0 : s, e); head.writeUInt8(s === 256 ? 0 : s, e + 1); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(b.length, e + 8); head.writeUInt32LE(off, e + 12); off += b.length; bodies.push(b); });
fs.writeFileSync('electron/icon.ico', Buffer.concat([head, ...bodies]));
console.log('icon ok');
