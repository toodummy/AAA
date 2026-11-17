// STORMZILLA UI - pure helpers (no DOM). Covered by tests/ui.test.js.

export function clamp01(value) {
  const n = +value;
  if (!(n > 0)) return 0;
  return n > 1 ? 1 : n;
}

// cost(rank) = round(base * mult^rank)
export function metaCost(def, rank) {
  return Math.round(def.base * Math.pow(def.mult, rank || 0));
}

// 'max' | 'poor' | 'ok'
export function metaState(def, rank, chaos) {
  if ((rank || 0) >= def.max) return 'max';
  return (chaos || 0) >= metaCost(def, rank) ? 'ok' : 'poor';
}

function trimFixed(n, digits) {
  let s = n.toFixed(digits);
  if (s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, '');
  return s;
}

// 950 -> "950", 12400 -> "12.4K", 1200000 -> "1.2M", 3.4e9 -> "3.4B"
export function fmtNum(value) {
  let n = Math.floor(+value || 0);
  const neg = n < 0;
  if (neg) n = -n;
  let out;
  if (n < 1000) out = String(n);
  else {
    const units = ['K', 'M', 'B', 'T'];
    let u = -1;
    let v = n;
    while (v >= 1000 && u < units.length - 1) { v /= 1000; u++; }
    // floor (never round up past what the player really has)
    let digits = v >= 100 ? 0 : 1;
    let shown = Math.floor(v * Math.pow(10, digits) + 1e-9) / Math.pow(10, digits);
    out = trimFixed(shown, digits) + units[u];
  }
  return neg ? '-' + out : out;
}

// 1234567 -> "1,234,567"
export function fmtInt(value) {
  const n = Math.round(+value || 0);
  const s = String(Math.abs(n));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return n < 0 ? '-' + out : out;
}

// 75 -> "1:15", 3725 -> "1:02:05"
export function fmtTime(seconds) {
  let s = Math.max(0, Math.floor(+seconds || 0));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const ss = s < 10 ? '0' + s : '' + s;
  if (h > 0) return h + ':' + (m < 10 ? '0' + m : m) + ':' + ss;
  return m + ':' + ss;
}

export function fmtPercent(frac) {
  return Math.round(clamp01(frac) * 100) + '%';
}

// Storm unlock check against save.stats (falls back to save root, e.g. save.wins).
export function statValue(save, stat) {
  if (!save) return 0;
  const stats = save.stats || {};
  if (typeof stats[stat] === 'number') return stats[stat];
  if (typeof save[stat] === 'number') return save[stat];
  return 0;
}

export function isUnlocked(storm, save) {
  if (!storm || !storm.unlock) return true;
  return statValue(save, storm.unlock.stat) >= storm.unlock.gte;
}

export function unlockProgress(storm, save) {
  if (!storm || !storm.unlock) return 1;
  const need = storm.unlock.gte || 1;
  return clamp01(statValue(save, storm.unlock.stat) / need);
}

export function tierLabel(tiers, index) {
  const i = Math.max(0, Math.min(tiers.length - 1, index | 0));
  return tiers[i].name + ' — ' + tiers[i].title;
}

// Ease-out count-up value at progress t (0..1).
export function countUp(target, t) {
  const p = clamp01(t);
  const e = 1 - Math.pow(1 - p, 3);
  return p >= 1 ? target : Math.floor(target * e);
}

// Scale unit: 1u = 1px on a 1600x900 reference, clamped so tiny/huge windows stay sane.
export function uiUnit(width, height) {
  const u = Math.min(width / 1600, height / 900);
  return Math.max(0.5, Math.min(3, u));
}

// Wrap index into [0, n)
export function wrap(i, n) {
  return ((i % n) + n) % n;
}

// Spatial focus navigation: pick the best rect index in a direction.
// rects: [{x, y, w, h}] ; from: index or rect ; dir: 'up'|'down'|'left'|'right'. Returns -1 if none.
export function pickDirectional(rects, from, dir) {
  const a = typeof from === 'number' ? rects[from] : from;
  if (!a) return -1;
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const horiz = dir === 'left' || dir === 'right';
  const sign = dir === 'left' || dir === 'up' ? -1 : 1;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const b = rects[i];
    if (b === a || i === from) continue;
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    const main = (horiz ? bx - ax : by - ay) * sign;
    // must be clearly beyond: centre past a quarter of the source size (ignores focus-lift offsets)
    if (main <= Math.max(1, (horiz ? a.w : a.h) * 0.25)) continue;
    // orthogonal gap: zero if the two rects overlap on the other axis
    let gap;
    if (horiz) gap = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
    else gap = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
    const cross = Math.abs(horiz ? by - ay : bx - ax);
    const score = main + gap * 4 + cross * 0.35;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}
