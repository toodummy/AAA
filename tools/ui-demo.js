// STORMZILLA UI harness. http://127.0.0.1:5202/tools/ui.html?screen=menu&tab=upgrades
// URL params: screen=loading|title|menu|hud|levelup|pause|results  tab=<menu tab>  win=1  mut=1  cards=2|3|4
//   boss=1  lowhp=1  tier=0..6  combo=N  threat=0..5  ups=N  fps=1  fresh=1 (empty save)  freeze=1 (stop HUD animation)
//   toast=tier|warning|achievement|unlock|info|all  news=1  popups=1  noquit=1  psettings=1  modal=1
// Debug keys (F-keys so they never clash with the UI): F1 title, F2 menu, F3 hud, F4 level-up, F6 pause,
//   F7 results (win), F8 results (lose), F9 toasts, F10 news, F11 popups+flash, F12 this help.
import { createUI } from '../src/ui/ui.js';
import { UPGRADES, TIERS, META } from '../src/game/defs.js';
import { metaCost } from '../src/ui/format.js';

const params = new URLSearchParams(location.search);
const flag = (name) => params.get(name) === '1';
const num = (name, fallback) => (params.has(name) ? +params.get(name) : fallback);
const calls = [];

const save = flag('fresh')
  ? { chaos: 0, meta: {}, stats: { bestTier: 0, bestScore: 0, bestTime: 0, wins: 0, runs: 0, totalChaos: 0, bossKills: 0 }, achievements: {},
    settings: { master: 0.8, music: 0.7, sfx: 0.9, quality: 'high', shake: 1, fullscreen: false, mouseSteer: true, showFps: false }, lastStorm: 'classic' }
  : { chaos: 1240, meta: { startMass: 2, integrity: 5, greed: 1, reroll: 1, revive: 0 },
    stats: { bestTier: 4, bestScore: 1284650, bestTime: 734, wins: 1, runs: 23, totalChaos: 3120, bossKills: 0 },
    achievements: { first_touch: true, moo: true, f3: true, donut: true, ferris: true, combo50: true },
    settings: { master: 0.8, music: 0.6, sfx: 1, quality: 'high', shake: 0.7, fullscreen: false, mouseSteer: true, showFps: true }, lastStorm: 'fire' };

const run = { time: 0, level: 7, upgrades: [] };
const allUp = Object.keys(UPGRADES);
const upCount = num('ups', 9);
for (let i = 0; i < upCount && i < allUp.length; i++) {
  const id = [0, 1, 7, 3, 14, 9, 6, 4, 15, 2, 5, 8, 10, 11, 12, 13, 16, 17, 18, 19][i];
  run.upgrades.push({ id: allUp[id], rank: Math.min(UPGRADES[allUp[id]].max, 1 + (i * 2) % 4) });
}

function levelChoices() {
  const n = num('cards', 3);
  const pool = flag('mut') ? ['lightning', 'sharknado', 'vitality', 'twins'] : ['suction', 'cannon', 'hail', 'combo'];
  if (run.rerolled) pool.reverse();
  return pool.slice(0, n).map((id, i) => {
    const d = UPGRADES[id];
    return { id, name: d.name, icon: d.icon, short: d.desc[0], desc: d.desc[1], rank: d.max === 1 ? 0 : (i * 2) % d.max, max: d.max, rarity: i === 2 && !flag('mut') ? 2 : d.rarity };
  });
}
const levelData = () => ({ choices: levelChoices(), rerolls: run.rerolls == null ? 2 : run.rerolls, level: run.level });
const resultsData = (win) => ({
  win, title: win ? 'AEGIS destroyed' : 'Storm dissipated', time: win ? 734 : 412, tier: win ? 6 : 3, mass: win ? 684200 : 5120,
  score: win ? 1284650 : 86420, best: win, chaos: win ? 860 : 145, chaosTotal: win ? 2100 : 1385,
  stats: [{ label: 'Cows abducted', value: win ? 214 : 61 }, { label: 'Buildings destroyed', value: win ? 389 : 44 }, { label: 'Jets swatted', value: win ? 17 : 0 },
    { label: 'Max combo', value: win ? 'x64' : 'x18' }, { label: 'Damage dealt', value: win ? 412800 : 9650 }, { label: 'Vehicles eaten', value: win ? 502 : 77 }],
  unlocks: win ? ['Snownado storm'] : [], achievements: win ? ['aegis', 'f6'] : ['f3'],
  headline: win ? 'Billion-dollar weather killer loses fight with weather' : 'Local tornado “just getting started” when tanks arrive, witnesses say',
});

let ui = null;
const log = (name, args) => { calls.push({ name, args }); console.log('[action]', name, ...args); };
const actions = {
  titleContinue: (...a) => { log('titleContinue', a); ui.setScreen('menu', save); },
  startRun: (...a) => { log('startRun', a); ui.setScreen('hud'); },
  pause: (...a) => { log('pause', a); ui.setScreen('pause', { settings: save.settings }); },
  resume: (...a) => { log('resume', a); ui.setScreen('hud'); },
  restart: (...a) => { log('restart', a); ui.setScreen('hud'); },
  quitToMenu: (...a) => { log('quitToMenu', a); ui.setScreen('menu', save); },
  pickUpgrade: (...a) => { log('pickUpgrade', a); setTimeout(() => ui.setScreen('hud'), 350); },
  reroll: (...a) => { log('reroll', a); run.rerolls = (run.rerolls == null ? 2 : run.rerolls) - 1; run.rerolled = !run.rerolled; ui.setScreen('levelup', levelData()); },
  buyMeta: (...a) => { log('buyMeta', a); const id = a[0]; save.chaos -= metaCost(META[id], save.meta[id] | 0); save.meta = { ...save.meta, [id]: (save.meta[id] | 0) + 1 }; ui.setScreen('menu', { ...save }); },
  setSetting: (...a) => { log('setSetting', a); save.settings[a[0]] = a[1]; },
  resetSave: (...a) => { log('resetSave', a); },
  toggleFullscreen: (...a) => { log('toggleFullscreen', a); },
  ability: (...a) => { log('ability', a); },
};
if (!flag('noquit')) actions.quitApp = (...a) => { log('quitApp', a); };
const audio = { play: (name) => { calls.push({ name: 'audio', args: [name] }); } };

ui = createUI({ root: document.getElementById('ui'), actions, audio });

// ---- fake HUD feed
const blips = new Float32Array(3 * 60);
for (let i = 0; i < 60; i++) {
  const ang = i * 2.399;
  const dist = 20 + (i * 37) % 170;
  blips[i * 3] = Math.cos(ang) * dist;
  blips[i * 3 + 1] = Math.sin(ang) * dist;
  blips[i * 3 + 2] = i < 44 ? 0 : i < 55 ? 1 : i < 59 ? 2 : 3;
}
const hud = {
  time: 0, tier: 0, tierFrac: 0, mass: 0, level: 1, xpFrac: 0, hp: 100, hpMax: 100, combo: 1, comboFrac: 1, threat: 0, threatFrac: 0,
  dashCharges: 2, dashMax: 2, dashFrac: 0, ammo: 0, ammoMax: 24, ult: 0, score: 0, chaos: 0, objective: '', boss: null,
  upgrades: run.upgrades, fps: 60, showFps: flag('fps'), radar: { x: 0, z: 0, heading: 0, range: 160, blips, n: 60 },
};
const boss = { name: 'Project AEGIS', hp: 62000, hpMax: 90000, shield: 0.6 };
const freeze = flag('freeze');
let t = freeze ? 137 : 0;
function feed(dt) {
  if (!freeze) t += dt;
  hud.time = t;
  const fixedTier = params.has('tier');
  const cyc = (t / 6) % 7;
  hud.tier = fixedTier ? num('tier', 3) : Math.floor(cyc);
  hud.tierFrac = fixedTier ? 0.62 : cyc % 1;
  const tier = TIERS[hud.tier];
  const next = TIERS[hud.tier + 1];
  hud.mass = next ? tier.mass + (next.mass - tier.mass) * hud.tierFrac : tier.mass * 1.2;
  hud.level = 7 + Math.floor(t / 5);
  hud.xpFrac = (t / 5) % 1;
  hud.hpMax = 150;
  hud.hp = flag('lowhp') ? 22 + Math.sin(t * 3) * 6 : 95 + Math.sin(t * 0.7) * 50;
  hud.combo = params.has('combo') ? num('combo', 1) : Math.max(1, Math.floor(18 + Math.sin(t * 0.5) * 20));
  hud.comboFrac = 1 - (t * 0.6) % 1;
  hud.threat = params.has('threat') ? num('threat', 0) : Math.floor(t / 4) % 6;
  hud.threatFrac = (t / 4) % 1;
  hud.dashMax = 2;
  hud.dashCharges = freeze ? 1 : Math.floor(t / 2) % 3;
  hud.dashFrac = freeze ? 0.4 : (t / 2) % 1;
  hud.ammo = freeze ? 17 : Math.floor((t * 3) % 25);
  hud.ult = flag('ultready') ? 1 : freeze ? 0.7 : (t / 8) % 1.25;
  hud.score = Math.floor(t * 9431);
  hud.chaos = Math.floor(t * 3);
  hud.objective = hud.tier < 2 ? 'Reach F2 to eat houses' : hud.tier < 5 ? 'Flatten downtown — towers need F4' : 'Destroy Project AEGIS';
  hud.boss = flag('boss') ? boss : null;
  boss.hp = 90000 * (0.3 + 0.5 * Math.abs(Math.sin(t * 0.2)));
  boss.shield = Math.max(0, Math.sin(t * 0.4));
  hud.fps = 58 + Math.sin(t) * 3;
  hud.radar.heading = t * 0.6;
  ui.updateHud(hud);
}
let last = performance.now();
function loop(now) {
  feed(Math.max(0, Math.min(0.05, (now - last) / 1000)));
  last = now;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---- demo drivers
function fireToasts(kind) {
  const all = kind === 'all';
  if (all || kind === 'tier') ui.toast('F3 — WEDGE', 'tier');
  if (all || kind === 'warning') ui.toast('Tanks inbound', 'warning');
  if (all || kind === 'achievement') ui.toast('Holy Cow', 'achievement');
  if (all || kind === 'unlock') ui.toast('Firenado storm', 'unlock');
  if (all || kind === 'info') ui.toast('Downtown is now edible', 'info');
}
function firePopups() {
  const kinds = ['xp', 'dmg', 'crit', 'heal', 'hurt', 'chaos'];
  const texts = ['+12', '48', 'CRIT 960!', '+30', '-16', '+5 CHAOS'];
  for (let i = 0; i < 18; i++) ui.popup(0.3 + ((i * 53) % 40) / 100, 0.35 + ((i * 29) % 30) / 100, texts[i % 6], kinds[i % 6]);
}
function show(name, opt = {}) {
  if (name === 'loading') ui.setScreen('loading', { progress: 0.64, text: 'Brewing supercells' });
  else if (name === 'title') ui.setScreen('title');
  else if (name === 'menu') ui.setScreen('menu', { ...save, tab: opt.tab || params.get('tab') || undefined });
  else if (name === 'hud') ui.setScreen('hud');
  else if (name === 'levelup') ui.setScreen('levelup', levelData());
  else if (name === 'pause') ui.setScreen('pause', { settings: save.settings });
  else if (name === 'results') ui.setScreen('results', resultsData(opt.win != null ? opt.win : flag('win')));
}
feed(0);
const startScreen = params.get('screen') || 'title';
if (['levelup', 'pause'].includes(startScreen)) ui.setScreen('hud');
show(startScreen);
ui.setLowHp(flag('lowhp'));
if (params.has('toast')) fireToasts(params.get('toast'));
if (flag('news')) { ui.news('BREAKING: Local cow achieves low orbit'); ui.news('Mayor insists town is “mostly still there”'); }
if (flag('popups')) setTimeout(firePopups, 150);
if (flag('psettings')) document.querySelector('[data-act="pauseSettings"]').click();
if (flag('modal')) document.querySelector(startScreen === 'pause' ? '[data-act="askRestart"]' : '[data-act="askReset"]').click();

const dbg = document.getElementById('dbg');
dbg.textContent = 'F1 title   F2 menu   F3 hud   F4 level-up   F6 pause\nF7 results (win)   F8 results (lose)\nF9 toasts   F10 news   F11 popups + flash   F12 help';
window.addEventListener('keydown', (ev) => {
  const map = {
    F1: () => show('title'), F2: () => show('menu'), F3: () => show('hud'), F4: () => { ui.setScreen('hud'); show('levelup'); },
    F6: () => { ui.setScreen('hud'); show('pause'); }, F7: () => show('results', { win: true }), F8: () => show('results', { win: false }),
    F9: () => fireToasts('all'), F10: () => ui.news('BREAKING: Local cow achieves low orbit'),
    F11: () => { firePopups(); ui.flash(['hurt', 'tier', 'lightning', 'heal'][Math.floor(t) % 4]); },
    F12: () => { dbg.style.display = dbg.style.display === 'block' ? 'none' : 'block'; },
  };
  if (map[ev.key]) { ev.preventDefault(); map[ev.key](); }
});

window.__uiDemo = { ui, calls, save, show, fireToasts, firePopups, hud };
