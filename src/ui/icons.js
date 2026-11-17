// STORMZILLA UI - custom inline SVG icon set + logo wordmark. Pure strings, no DOM, no imports.
// All icons: 24x24 grid, single 2.2 stroke weight, tinted with currentColor.

const dot = (x, y, r = 1.4) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;
const ring = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}"/>`;
const p = (d) => `<path d="${d}"/>`;
const solid = (d) => `<path d="${d}" fill="currentColor" stroke="none"/>`;

const TORNADO = p('M3 4h18M5 8.5h14M8 13h9M10.5 17.5h5M12 21.5h1.5');
const FLAME = p('M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-2.5 1-4 2.5-5.5C9 11 10 12 10.5 13 11 9.5 10 6 12 2z') + p('M12 17.5v.1');
const SHARK = p('M5 16C7 9 11 4 16 3c-1 4-.5 9 2 13z') + p('M2 20.5c2-1.5 3.5-1.5 5 0s3.5 1.5 5 0 3.5-1.5 5 0 3.5 1.5 5 0');
const SNOW = p('M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5M2.5 10.5l3.4-.9-.9-3.4M21.5 13.5l-3.4.9.9 3.4M2.5 13.5l3.4.9-.9 3.4M21.5 10.5l-3.4-.9.9-3.4');
const CASH = ring(12, 12, 9.5) + p('M15 8.6c-.6-1-1.7-1.6-3-1.6-1.8 0-3 1-3 2.4 0 3.2 6 1.6 6 4.9 0 1.5-1.3 2.7-3 2.7-1.5 0-2.7-.6-3.3-1.7M12 5v14');
const BOLT = p('M13 2L4 14h7l-1 8 9-12h-7z');
const CLOUD = 'M7 15a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.6 1.2A3.5 3.5 0 0 1 17.5 15';
const HEART = 'M12 20.5C5 15.5 2.5 12 2.5 8.5a4.8 4.8 0 0 1 9.5-1 4.8 4.8 0 0 1 9.5 1c0 3.5-2.5 7-9.5 12z';
const COW = p('M7 6.5C5 6.5 3.5 5 3.5 3c1.6 0 3 .6 4 1.8M17 6.5c2 0 3.5-1.5 3.5-3.5-1.6 0-3 .6-4 1.8')
  + p('M7 5.5h10v7a5 5 0 0 1-10 0z') + p('M7.6 14h8.8') + dot(10, 10, 1.2) + dot(14, 10, 1.2) + dot(10.4, 16.4, .9) + dot(13.6, 16.4, .9);
const MAGNET = p('M5 3v8a7 7 0 0 0 14 0V3h-4v8a3 3 0 0 1-6 0V3z') + p('M5 7.5h4M15 7.5h4');
const CHEV2 = p('M4 5l7 7-7 7M12 5l7 7-7 7');

export const ICONS = {
  // ---- storms ----
  classic: TORNADO,
  fire: FLAME,
  shark: SHARK,
  snow: SNOW,
  cash: CASH,
  // ---- run upgrades ----
  suction: ring(12, 12, 2.6) + p('M3 3l5 5M8 4v4H4M21 3l-5 5M16 4v4h4M3 21l5-5M8 20v-4H4M21 21l-5-5M16 20v-4h4'),
  speed: p('M2 8h9a2.5 2.5 0 1 0-2.5-2.5M2 12h16a3 3 0 1 1-3 3M2 16h7a2.5 2.5 0 1 1-2.5 2.5'),
  hunger: p('M20 7.6A9 9 0 1 0 20 16.4L12.5 12z') + dot(11, 7.4, 1.3),
  armor: p('M12 2.5l8 3v6.5c0 4.5-3.2 7.8-8 9.5-4.8-1.700-8-5-8-9.500V5.500z') + p('M12 8v7M8.500 11.500h7'),
  vitality: p('M2 12s3.600-6.500 10-6.500S22 12 22 12s-3.600 6.500-10 6.500S2 12 2 12z') + dot(12, 12, 2.8),
  shred: p('M12 1.5l2 3.6 3.800-1.400.300 4.100 3.900 1.200-2.400 3.300 2.400 3.300-3.900 1.200-.300 4.100-3.800-1.400-2 3.600-2-3.600-3.800 1.400-.300-4.100-3.900-1.200L4.400 12.300 2 9l3.900-1.200.300-4.100L10 5.100z') + ring(12, 12.3, 2.6),
  cannon: p('M3.500 3.500l6.500 6.500M9.500 3l3.500 3.500M3 9.500l3.500 3.500') + `<circle cx="15.5" cy="15.5" r="5" fill="currentColor" stroke="none"/>`,
  lightning: BOLT,
  hail: p(CLOUD + 'z') + dot(8, 19) + dot(12, 21.2) + dot(16, 19),
  twins: p('M2 4.500h10M3.500 8.500h7M5.500 12.500h4M7 16.500h1.500') + p('M12.500 9.500h9.500M14 13.500h7M16 17.500h4M17.500 21.500h1.500'),
  magnet: COW,
  dash: CHEV2,
  regen: p(HEART) + p('M12 9.500v5M9.500 12h5'),
  combo: p('M12 7.500C10.500 4 5 2.500 3.500 5.500S4 11.500 8 12c-3 .500-4.500 3.500-3 6s5.500.500 7-4M12 7.500c1.500-3.500 7-5 8.500-2S20 11.500 16 12c3 .500 4.500 3.500 3 6s-5.500.500-7-4') + p('M12 6.500v13'),
  firenado: FLAME,
  sharknado: SHARK,
  blizzard: SNOW,
  thunder: p(CLOUD) + p('M13 11l-3.500 5.500h4.500L11 22'),
  magnetar: MAGNET,
  moneynado: CASH,
  // ---- meta ----
  startMass: p('M2.500 5h11M4.500 9.500h8M6.500 14h5M8.500 18.500h2') + p('M19 20V8M15.500 11.500L19 8l3.500 3.500'),
  integrity: p('M3 5h18v14H3zM3 12h18M10 5v7M14 12v7'),
  greed: p('M4 10a8 6 0 0 1 16 0z') + p('M3 13.500h18') + p('M4.500 17h15v1a2.500 2.500 0 0 1-2.500 2.500h-10a2.500 2.500 0 0 1-2.500-2.500z'),
  swift: p('M12 2l6 7-6 8-6-8zM12 2v15M6 9h12') + p('M12 17c0 2 1.500 2.500 3 3.500s2.500 1.500 5 1.500'),
  reroll: p('M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z') + dot(8, 8) + dot(16, 8) + dot(12, 12) + dot(8, 16) + dot(16, 16),
  dashes: p('M2 6l6 6-6 6M9 6l6 6-6 6') + p('M19 9.500v5M16.500 12h5'),
  chaos: p('M6 2h12v20l-3-2-3 2-3-2-3 2z') + p('M9 7h6M9 11h6M9 15h3'),
  revive: p('M20 11a8 8 0 0 0-14.500-4M4 3.500V8h4.500M4 13a8 8 0 0 0 14.500 4M20 20.500V16h-4.500'),
  // ---- abilities ----
  fling: ring(12, 12, 7.5) + p('M12 2v5M12 17v5M2 12h5M17 12h5') + dot(12, 12, 2),
  ult: ring(12, 12, 4.5) + p('M12 7.500c3.500 0 7-1.500 8.500-5.500M12 16.500c-3.500 0-7 1.500-8.500 5.500') + dot(12, 12, 1.3),
  // ---- stats / ui ----
  tornado: TORNADO,
  bolt: BOLT,
  cow: COW,
  time: ring(12, 12, 9.5) + p('M12 6.500V12l3.500 2'),
  star: solid('M12 2.2l3 6.300 6.800.900-5 4.700 1.300 6.800L12 17.600l-6.100 3.300 1.300-6.800-5-4.700 6.800-.900z'),
  score: p('M12 2.500l2.900 6.200 6.600.800-4.900 4.600 1.300 6.600L12 17.400l-5.900 3.300 1.300-6.600L2.500 9.500l6.600-.800z'),
  mass: p('M8 7a4 4 0 1 1 8 0M5.500 7h13L21 21H3z'),
  heart: p(HEART),
  chaosPt: p('M12 2l8.500 5v10L12 22l-8.500-5V7z') + solid('M13.200 6.500L8.500 13h3l-.800 4.500L15.500 11h-3z'),
  trophy: p('M7 3.500h10v5.500a5 5 0 0 1-10 0zM7 5.500H3.500c0 3 1.500 4.700 4 5.200M17 5.500h3.500c0 3-1.500 4.700-4 5.200M12 14v4M8 21h8M9.500 18h5v3h-5z'),
  lock: p('M5.500 11h13v10h-13zM8.500 11V7.500a3.500 3.500 0 0 1 7 0V11') + dot(12, 16, 1.3),
  check: p('M4 12.500l5 5L20 6.500'),
  building: p('M5 21V4h9v17M14 9h5v12M3 21h18M8 8h3M8 12h3M8 16h3'),
  jet: p('M12 2c1 0 1.500 1.500 1.500 3v4l7.500 5v2l-7.500-2.500V18l2.500 2v1.500L12 20.500l-4 1V20l2.500-2v-4.500L3 16v-2l7.500-5V5c0-1.500.500-3 1.500-3z'),
  tank: p('M4 14h16a3 3 0 0 1 0 6H4a3 3 0 0 1 0-6zM7 14v-4.500h8V14M15 11.500h7'),
  car: p('M3 16v-4l2.500-5h13L21 12v4zM3 12h18') + ring(7.5, 17, 1.8) + ring(16.5, 17, 1.8),
  skull: p('M12 3a8 8 0 0 0-8 8c0 2.500 1 4.500 3 5.500V20h10v-3.500c2-1 3-3 3-5.500a8 8 0 0 0-8-8zM10 20v-2M14 20v-2') + dot(9, 11.5, 1.6) + dot(15, 11.5, 1.6),
  warning: p('M12 3L2 20.500h20zM12 10v4.500') + dot(12, 17.4, 1.1),
  play: solid('M7 4l13 8-13 8z'),
  gear: ring(12, 12, 6.5) + ring(12, 12, 2.4) + p('M12 2v3.500M12 18.500V22M2 12h3.500M18.500 12H22M4.900 4.900l2.500 2.500M16.600 16.600l2.500 2.500M4.900 19.100l2.500-2.500M16.600 7.400l2.500-2.500'),
  book: p('M3.500 4.500h6a2.500 2.500 0 0 1 2.500 2.500v13a2 2 0 0 0-2-2H3.500zM20.500 4.500h-6a2.500 2.500 0 0 0-2.500 2.500v13a2 2 0 0 1 2-2h6.500z'),
  info: ring(12, 12, 9.5) + p('M12 11v6') + dot(12, 7.5, 1.2),
  quit: p('M9 4H5v16h4M10 12h10M16 8l4 4-4 4'),
  left: p('M15 5l-7 7 7 7'),
  right: p('M9 5l7 7-7 7'),
  up2: p('M5 13l7-7 7 7M5 20l7-7 7 7'),
  pause: p('M8 5v14M16 5v14'),
  restart: p('M4 12a8 8 0 1 0 2.500-5.800M4 3.500v4.700h4.700'),
  home: p('M3 11.500L12 4l9 7.500M5.500 10v10h13V10M10 20v-5.500h4V20'),
  mouse: p('M12 3a5 5 0 0 1 5 5v8a5 5 0 0 1-10 0V8a5 5 0 0 1 5-5zM12 3v7M7 10h10'),
  keyboard: p('M2 6h20v12H2zM6 10h1M10 10h1M14 10h1M18 10h1M7 14h10'),
  fullscreen: p('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'),
  volume: p('M4 9v6h4l5 4V5L8 9zM16.500 8.500a5 5 0 0 1 0 7M19 6a8.500 8.500 0 0 1 0 12'),
  music: p('M9 18V5l11-2v13') + ring(6.5, 18, 2.5) + ring(17.5, 16, 2.5),
  shake: p('M8 5h8v14H8zM4 8v8M20 8v8M1.500 10v4M22.500 10v4'),
  quality: p('M12 3l9 5-9 5-9-5zM3 12.500l9 5 9-5M3 17l9 5 9-5'),
  fps: p('M3 20V4M3 20h18M7 15l4-5 3 3 6-7'),
  tv: p('M3 6.500h18v12H3zM8 21.500h8M8.500 2.500l3.500 4 3.500-4'),
  people: ring(9, 8, 3.2) + p('M2.500 20c0-3.600 2.900-6 6.500-6s6.500 2.400 6.500 6M16 5a3.200 3.200 0 0 1 0 6.200M18 14.500c2 .800 3.500 2.700 3.500 5.500'),
  trash: p('M4 6.500h16M9 6.500V4h6v2.500M6 6.500l1 14h10l1-14M10 10.500v6M14 10.500v6'),
  flame: FLAME,
  target: ring(12, 12, 9) + ring(12, 12, 4.5) + dot(12, 12, 1.3),
  shield: p('M12 2.500l8 3v6.500c0 4.500-3.200 7.800-8 9.500-4.800-1.700-8-5-8-9.500V5.500z'),
  news: p('M3 5h14v14H5a2 2 0 0 1-2-2zM17 9h4v8a2 2 0 0 1-2 2h-2M6.500 9h7M6.500 12.500h7M6.500 16h4'),
};

export function hasIcon(id) {
  return Object.prototype.hasOwnProperty.call(ICONS, id);
}

// Returns an <svg> string. Unknown ids fall back to `fallback` text (e.g. the emoji from defs) or a tornado.
export function icon(id, cls = '', fallback = '') {
  if (!hasIcon(id)) {
    if (fallback) return `<span class="sz-ico sz-ico-emoji ${cls}" aria-hidden="true">${fallback}</span>`;
    id = 'tornado';
  }
  return `<svg class="sz-ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[id]}</svg>`;
}

// ---------------------------------------------------------------------------------------------
// LOGO - custom block-italic wordmark. Letters are hand-built polygons on a 14-unit cap height
// (no font dependency) so the same SVG can be reused for store capsule art.
// The O's counter is a negative-space funnel with wind bands; the Z is a lightning bolt.
// ---------------------------------------------------------------------------------------------
const GLYPHS = {
  S: { w: 10, d: 'M10 0H2L0 2v4.500l2 2h5V11H0v3h8l2-2V7.500l-2-2H3V3h7z' },
  T: { w: 10, d: 'M0 0h10v3H6.500v11h-3V3H0z' },
  O: { w: 12, d: 'M2 0h8l2 2v10l-2 2H2l-2-2V2zM2.700 2.700L5.200 11.300h1.600L9.300 2.700z' },
  R: { w: 10, d: 'M0 0h8l2 2v4.500L8.500 8 10 10v4H7v-3.500L6 9H3v5H0zM3 3v3h4V3z' },
  M: { w: 11, d: 'M0 0h3.200l2.300 4.500L7.800 0H11v14H8V6.500l-2.500 4.500L3 6.500V14H0z' },
  Z: { w: 10, d: 'M0 0h7.500l3.500-4-1 7-6 8h6v3H2.500l-3.500 4 1-7 6-8H0z' },
  I: { w: 3, d: 'M0 0h3v14H0z' },
  L: { w: 9, d: 'M0 0h3v11h6v3H0z' },
  A: { w: 10.5, d: 'M3.300 0h3.900l3.300 14H7.400l-.600-3H3.700l-.600 3H0zM4.300 8.200h1.900L5.250 3.600z' },
};
const WORD = 'STORMZILLA';
const GAP = 1.5;
let logoSeq = 0;

// opts: { tagline: bool (default true), taglineText, mono: bool (single currentColor fill), cls, title }
export function logoSVG(opts = {}) {
  const uid = 'szlg' + (++logoSeq);
  const tagline = opts.tagline !== false;
  const mono = !!opts.mono;
  const text = opts.taglineText || 'YOU ARE THE TORNADO';
  let x = 0;
  let main = '';
  let accent = '';
  let bands = '';
  for (const ch of WORD) {
    const g = GLYPHS[ch];
    const piece = `<path transform="translate(${x} 0)" fill-rule="evenodd" d="${g.d}"/>`;
    if (ch === 'Z') accent += piece; else main += piece;
    if (ch === 'O') {
      bands = `<g transform="translate(${x} 0)"><path d="M3.900 4.100h4.200l-.400 1.300H4.300zM4.600 6.400h2.800l-.400 1.300H5zM5.200 8.700h1.600l-.300 1.200h-1z"/></g>`;
    }
    x += g.w + GAP;
  }
  const W = x - GAP; // 107
  const skew = -12;
  const padX = 7;
  const top = 6;
  const bottom = tagline ? 13 : 6;
  const vbW = W + padX * 2 + 3;
  const vbH = 14 + top + bottom;
  const fillMain = mono ? 'currentColor' : `url(#${uid}a)`;
  const fillZ = mono ? 'currentColor' : `url(#${uid}b)`;
  const fillBand = mono ? 'currentColor' : `url(#${uid}c)`;
  const defs = mono ? '' : `<defs>
<linearGradient id="${uid}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".48" stop-color="#e9f1f8"/><stop offset=".5" stop-color="#b9c8d8"/><stop offset="1" stop-color="#7f93a8"/></linearGradient>
<linearGradient id="${uid}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0a8"/><stop offset=".45" stop-color="#ffc21a"/><stop offset="1" stop-color="#ff7a00"/></linearGradient>
<linearGradient id="${uid}c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bff6ff"/><stop offset="1" stop-color="#22c8f0"/></linearGradient>
<filter id="${uid}g" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="1.1"/></filter>
</defs>`;
  const shadow = mono ? '' : `<g transform="translate(.9 1.1)" fill="#05080d" stroke="#05080d" stroke-width="1.6" stroke-linejoin="round">${main}${accent}</g>
<g fill="#ff9d00" opacity=".55" filter="url(#${uid}g)">${accent}</g>`;
  const outline = mono ? '' : ` stroke="#05080d" stroke-width=".5" stroke-linejoin="round" paint-order="stroke"`;
  const tag = tagline ? `<g transform="translate(${padX + 1} ${top + 14 + 4.6})">
<path d="M-.5 0h${W * 0.18}l-.9 .9H-1.400z" fill="${mono ? 'currentColor' : '#ffb400'}" transform="translate(0 2.300)"/>
<path d="M0 0h${W * 0.18}l-.9 .9H-.900z" fill="${mono ? 'currentColor' : '#ffb400'}" transform="translate(${W * 0.82 - 1} 2.300)"/>
<text x="${W / 2 - 1}" y="4.300" text-anchor="middle" font-family="'Barlow Condensed','Arial Narrow',Arial,sans-serif" font-weight="700" font-style="italic" font-size="5.200" letter-spacing="1.500" fill="${mono ? 'currentColor' : '#f4f7fb'}">${text}</text></g>` : '';
  return `<svg class="sz-logo ${opts.cls || ''}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH}" role="img" aria-label="${opts.title || 'STORMZILLA'}">${defs}
<g transform="translate(${padX + 3.5} ${top}) skewX(${skew})">${shadow}
<g fill="${fillMain}"${outline}>${main}</g>
<g fill="${fillBand}">${bands}</g>
<g fill="${fillZ}"${outline}>${accent}</g>
</g>${tag}</svg>`;
}
