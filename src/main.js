// STORMZILLA - game shell: boot, main loop, input, save, and wiring sim events to renderer / audio / UI.
import { createSim, ST } from './game/sim.js';
import { TIERS, UPGRADES, META, STORMS, ACHIEVEMENTS, WORLD } from './game/defs.js';
import { createRenderer } from './render/renderer.js';
import { createAudio } from './audio/audio.js';
import { createUI } from './ui/ui.js';
import { headlineFor, eventNews, resultHeadline } from './game/news.js';

const SAVE_KEY = 'stormzilla.save.v1';
const params = new URLSearchParams(location.search);
const defaultSave = () => ({
  chaos: 0, meta: {}, achievements: {}, lastStorm: 'classic',
  stats: { bestTier: 0, bestScore: 0, bestTime: 0, wins: 0, runs: 0, totalChaos: 0, bossKills: 0, totalEaten: 0, totalCows: 0 },
  settings: { master: 0.8, music: 0.6, sfx: 0.9, quality: 'high', shake: 1, fullscreen: false, mouseSteer: true, showFps: false },
});
function loadSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && typeof s === 'object') { const d = defaultSave(); return { ...d, ...s, stats: { ...d.stats, ...s.stats }, settings: { ...d.settings, ...s.settings }, meta: { ...s.meta }, achievements: { ...s.achievements } }; } } catch (e) { /* ignore */ }
  return defaultSave();
}
let save = loadSave();
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } };

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');
const audio = createAudio();
const R = createRenderer(canvas, { quality: save.settings.quality, shake: save.settings.shake, preserve: params.has('shots') });
let G = null, mode = 'boot', runStorm = 'classic', attract = false, time = 0, acc = 0, last = performance.now();
let frameMs = 16, dynT = 0;
let fps = 60, fpsAcc = 0, fpsN = 0, intensity = 0, lastNewsT = -99, lowHp = false, autoBot = params.has('auto');
const run = { cowsNews: 0, firstBlocked: 0, hintT: 0, started: 0 };

const actions = {
  titleContinue() { if (mode === 'title') { audio.init(); applyVolume(); toMenu(); } },
  startRun(id) { audio.init(); applyVolume(); startRun(id); },
  pause() { if (mode === 'run') setMode('pause'); },
  resume() { if (mode === 'pause') setMode('run'); },
  restart() { startRun(runStorm); },
  quitToMenu() { toMenu(); },
  pickUpgrade(i) { if (mode === 'levelup' && G.awaiting) { const c = G.awaiting[i]; if (!c) return; G.pickUpgrade(i); audio.play(c.rarity === 3 ? 'tierup' : 'card_pick'); if (c.rarity === 3) { ui.toast(c.name + '!', 'unlock'); if (G.S.mutations >= 2) unlock('mutant'); } setMode('run'); } },
  reroll() { if (mode === 'levelup' && G.reroll()) { audio.play('card_show'); ui.setScreen('levelup', { choices: G.awaiting, rerolls: G.S.rerolls, level: G.S.level }); } },
  buyMeta(id) { const m = META[id], rank = save.meta[id] || 0; if (!m || rank >= m.max) return; const cost = Math.round(m.base * Math.pow(m.mult, rank)); if (save.chaos < cost) return; save.chaos -= cost; save.meta[id] = rank + 1; persist(); audio.play('cash'); ui.setScreen('menu', menuData()); },
  setSetting(k, v) { save.settings[k] = v; persist(); applySetting(k); },
  resetSave() { save = defaultSave(); persist(); applyVolume(); ui.setScreen('menu', menuData()); },
  toggleFullscreen() { toggleFs(); },
  ability(name) { if (mode !== 'run') return; if (name === 'dash') input.dashQ = true; else if (name === 'ult') input.ultQ = true; else if (name === 'fling') input.flingT = 0.6; },
};
if (window.stormzillaNative && window.stormzillaNative.quit) actions.quitApp = () => window.stormzillaNative.quit();
const ui = createUI({ root: uiRoot, actions, audio });
let menuTab = null;
const menuData = () => ({ ...save, tab: menuTab });

function applyVolume() { audio.setVolume({ master: save.settings.master, music: save.settings.music, sfx: save.settings.sfx }); }
function applySetting(k) {
  if (k === 'master' || k === 'music' || k === 'sfx') applyVolume();
  else if (k === 'quality') R.setQuality(save.settings.quality);
  else if (k === 'shake') R.setShake(save.settings.shake);
  else if (k === 'fullscreen') toggleFs(save.settings.fullscreen);
}
function toggleFs(want) {
  const on = !!document.fullscreenElement; if (want === undefined) want = !on;
  if (window.stormzillaNative && window.stormzillaNative.setFullscreen) { window.stormzillaNative.setFullscreen(want); save.settings.fullscreen = want; persist(); return; }
  if (want && !on) document.documentElement.requestFullscreen?.().catch(() => {}); else if (!want && on) document.exitFullscreen?.();
  save.settings.fullscreen = want; persist();
}
function unlock(id) {
  if (save.achievements[id] || !ACHIEVEMENTS[id] || attract) return;
  save.achievements[id] = true; persist();
  ui.toast(ACHIEVEMENTS[id].name, 'achievement'); audio.play('achievement');
  run.newAch = run.newAch || []; run.newAch.push(id);
  try { window.stormzillaNative?.achievement?.(id); } catch (e) { /* ignore */ }
}

// ---------------- modes ----------------
function setMode(m) {
  mode = m;
  if (m === 'run') { ui.setScreen('hud'); audio.resume(); }
  else if (m === 'pause') { ui.setScreen('pause', { upgrades: upgradeList() }); audio.suspend(); }
  else if (m === 'levelup') { ui.setScreen('levelup', { choices: G.awaiting, rerolls: G.S.rerolls, level: G.S.level }); audio.play('levelup'); }
}
function newAttract() {
  attract = true;
  G = createSim({ seed: 4242, storm: save.lastStorm in STORMS ? save.lastStorm : 'classic', meta: {} });
  G.S.mass = 900; G.addMass(1); G.S.x = WORLD.start[0] + 40; G.S.z = WORLD.start[1] - 260; G.S.xp = 0; G.S.xpNext = 1e12;
  R.setSim(G);
}
function toMenu() {
  if (!attract) newAttract();
  mode = 'menu'; ui.setLowHp(false); lowHp = false;
  ui.setScreen('menu', menuData()); menuTab = null;
  audio.resume(); audio.setMusic('menu', 0.5);
}
function startRun(stormId) {
  const sd = STORMS[stormId] || STORMS.classic;
  runStorm = STORMS[stormId] ? stormId : 'classic';
  attract = false; save.lastStorm = runStorm; save.stats.runs++; persist();
  const seed = params.has('seed') ? +params.get('seed') : (Math.random() * 1e9) | 0;
  G = createSim({ seed, storm: runStorm, meta: save.meta });
  R.setSim(G);
  Object.assign(run, { cowsNews: 0, firstBlocked: 0, hintT: 0, newAch: [], started: time, sd });
  intensity = 0; lastNewsT = -99;
  setMode('run');
  audio.setMusic('calm', 0.2);
  ui.toast('F0 — ' + TIERS[0].title, 'tier');
  unlock('first_touch');
  window.__sz.G = G;
}
function upgradeList() { const out = []; for (const id in G.S.up) if (G.S.up[id] > 0) out.push({ id, rank: G.S.up[id] }); return out; }

function finishRun() {
  const S = G.S, st = G.stats, win = G.won;
  const chaos = G.chaosEarned(), score = Math.round(S.score);
  const before = { ...save.stats };
  const best = score > save.stats.bestScore;
  save.chaos += chaos; save.stats.totalChaos += chaos;
  save.stats.bestTier = Math.max(save.stats.bestTier, S.tier); save.stats.bestScore = Math.max(save.stats.bestScore, score);
  save.stats.totalEaten += st.eaten; save.stats.totalCows += st.cows;
  if (win) { save.stats.wins++; save.stats.bossKills++; if (!save.stats.bestTime || G.t < save.stats.bestTime) save.stats.bestTime = Math.round(G.t); }
  const unlocks = [];
  for (const id in STORMS) { const u = STORMS[id].unlock; if (!u) continue; if ((before[u.stat] || 0) < u.gte && (save.stats[u.stat] || 0) >= u.gte) unlocks.push('New storm unlocked: ' + STORMS[id].name); }
  if (win && G.t < 540) unlock('speedrun');
  if (G.eatenValue / G.totalValue > 0.9) unlock('everything');
  persist();
  mode = 'results'; ui.setLowHp(false);
  audio.setMusic(win ? 'victory' : 'defeat', 1); audio.play(win ? 'win' : 'lose');
  ui.setScreen('results', {
    win, title: win ? 'STORMZILLA RISES' : 'STORM DISSIPATED', time: G.t, tier: S.tier, mass: Math.round(S.mass), score, best, chaos, chaosTotal: save.chaos,
    stats: [
      { label: 'Things eaten', value: st.eaten }, { label: 'Buildings destroyed', value: st.buildings }, { label: 'Cows abducted', value: st.cows },
      { label: 'People inconvenienced', value: st.people }, { label: 'Vehicles swallowed', value: st.vehicles }, { label: 'Military units wrecked', value: st.kills },
      { label: 'Aircraft swatted', value: st.jets }, { label: 'Max combo', value: 'x' + st.maxCombo }, { label: 'Debris flung', value: st.flung },
    ],
    unlocks, achievements: run.newAch || [], headline: resultHeadline(G),
  });
}

// ---------------- input ----------------
const keys = new Set();
const input = { mx: 0, mz: 0, aimX: 0, aimZ: 0, dash: false, fling: false, ult: false, dashQ: false, ultQ: false, flingT: 0 };
const mouse = { x: 0.5, y: 0.4, down: false, moved: 0, inside: true };
const aim = { x: 0, z: 0 };
let keyMoveT = -10, padAim = false;
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.code;
  if (mode === 'run') {
    keys.add(k);
    if (k === 'Space') { input.dashQ = true; e.preventDefault(); }
    else if (k === 'KeyQ' || k === 'KeyE' || k === 'KeyF') input.ultQ = true;
    else if (k === 'Escape' || k === 'KeyP') { actions.pause(); e.preventDefault(); }
    if (k.startsWith('Arrow')) e.preventDefault();
  } else if (mode === 'pause' && (k === 'Escape' || k === 'KeyP')) { actions.resume(); e.preventDefault(); }
  if (k === 'F11' || (k === 'Enter' && e.altKey)) { toggleFs(); e.preventDefault(); }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); mouse.down = false; if (mode === 'run' && !autoBot && !params.has('nopause')) actions.pause(); });
canvas.addEventListener('mousemove', (e) => { const r = canvas.getBoundingClientRect(); mouse.x = (e.clientX - r.left) / r.width; mouse.y = (e.clientY - r.top) / r.height; mouse.moved = time; padAim = false; });
canvas.addEventListener('mousedown', (e) => { audio.init(); if (mode !== 'run') return; if (e.button === 0) mouse.down = true; else if (e.button === 2) input.dashQ = true; e.preventDefault(); });
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.down = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('touchstart', (e) => { audio.init(); const t = e.touches[0], r = canvas.getBoundingClientRect(); mouse.x = (t.clientX - r.left) / r.width; mouse.y = (t.clientY - r.top) / r.height; e.preventDefault(); }, { passive: false });
canvas.addEventListener('touchmove', (e) => { const t = e.touches[0], r = canvas.getBoundingClientRect(); mouse.x = (t.clientX - r.left) / r.width; mouse.y = (t.clientY - r.top) / r.height; e.preventDefault(); }, { passive: false });
let padPrev = {};
function readInput(dt) {
  const S = G.S;
  let mx = 0, mz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) mz -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) mz += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
  let fling = mouse.down || keys.has('ShiftLeft') || keys.has('KeyX');
  R.aim(mouse.x, mouse.y, aim);
  // gamepad
  const gp = navigator.getGamepads ? navigator.getGamepads()[0] : null;
  if (gp) {
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    if (Math.hypot(ax, ay) > 0.2) { mx = ax; mz = ay; keyMoveT = time; }
    const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
    if (Math.hypot(rx, ry) > 0.3) { padAim = true; aim.x = S.x + rx * (60 + S.r * 3); aim.z = S.z + ry * (60 + S.r * 3); }
    else if (padAim) { // auto-aim at nearest enemy
      let bd = 1e9; for (const en of G.enemies) { const d = Math.hypot(en.x - S.x, en.z - S.z); if (d < bd) { bd = d; aim.x = en.x; aim.z = en.z; } }
    }
    const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
    if (b(7) || b(5) || b(2)) { fling = true; padAim = true; }
    if (b(0) && !padPrev.a) input.dashQ = true;
    if (b(3) && !padPrev.y) input.ultQ = true;
    if (b(9) && !padPrev.s) actions.pause();
    padPrev = { a: b(0), y: b(3), s: b(9) };
  }
  if (mx || mz) keyMoveT = time;
  else if (save.settings.mouseSteer && time - keyMoveT > 1.2 && !padAim) {
    // the storm chases the cursor
    const dx = aim.x - S.x, dz = aim.z - S.z, d = Math.hypot(dx, dz), dead = S.r * 0.35 + 1;
    if (d > dead) { const k = Math.min(1, (d - dead) / (S.r * 1.2 + 4)); mx = dx / d * k; mz = dz / d * k; }
  }
  input.mx = mx; input.mz = mz; input.aimX = aim.x; input.aimZ = aim.z;
  if (input.flingT > 0) { input.flingT -= dt; fling = true; }
  input.fling = fling;
}

// simple autopilot used by the attract mode and by ?auto=1 test runs
const bot = { target: null, re: 0, ang: 0 };
function botInput(dt) {
  const S = G.S;
  if (attract) { bot.ang += dt * 0.25; input.mx = Math.cos(bot.ang) * 0.75; input.mz = Math.sin(bot.ang * 1.3) * 0.75; input.fling = false; input.dash = false; input.ult = false; S.hp = S.hpMax; return; }
  bot.re -= dt;
  if (bot.re <= 0 || !bot.target || bot.target.st !== ST.REST) {
    bot.re = 0.5; bot.target = null; let best = -1;
    const scan = (rad) => G.query(S.x, S.z, rad, (e) => { if (e.def.tier > S.tier) return; const d = Math.hypot(e.x - S.x, e.z - S.z); if (d > rad) return; const v = (e.def.xp + 1) / (d + S.r * 2 + 10); if (v > best) { best = v; bot.target = e; } });
    scan(S.r * 8 + 60); if (!bot.target) scan(400); if (!bot.target) scan(1500);
  }
  let tx = -S.x, tz = -S.z;
  if (G.boss) { let bd = 1e9; for (const en of G.enemies) if (!en.dead && (en.t === 'boss_pylon' || (en.t === 'boss_core' && G.boss.shield <= 0))) { const d = Math.hypot(en.x - S.x, en.z - S.z); if (d < bd) { bd = d; tx = en.x - S.x; tz = en.z - S.z; } } }
  else if (bot.target) { tx = bot.target.x - S.x; tz = bot.target.z - S.z; }
  let l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
  input.dashQ = false;
  for (const z of G.zones) if (z.hostile && (z.kind === 'shell' || z.kind === 'bomb')) { const dx = S.x - z.x, dz = S.z - z.z, d = Math.hypot(dx, dz); if (d < z.r * 1.25) { tx += dx / (d || 1) * 2.5; tz += dz / (d || 1) * 2.5; if (z.t < 0.3 && d < z.r) input.dashQ = true; } }
  l = Math.hypot(tx, tz) || 1; input.mx = tx / l; input.mz = tz / l;
  let ne = null, nd = G.flingRange(); for (const en of G.enemies) { const d = Math.hypot(en.x - S.x, en.z - S.z); if (d < nd) { nd = d; ne = en; } }
  input.fling = !!ne; if (ne) { input.aimX = ne.x; input.aimZ = ne.z; }
  input.ultQ = S.ult >= 1 && (G.enemies.length > 3 || !!G.boss);
}

// ---------------- sim events -> everything ----------------
const pr = { x: 0, y: 0, vis: true };
function pan(x, z) { R.project(x, 2, z, pr); return Math.max(-1, Math.min(1, pr.x * 2 - 1)); }
function news(text) { if (!text || attract) return; ui.news(text); lastNewsT = time; audio.play('news_jingle', { vol: 0.5 }); }
const ANIMAL_SFX = { cow: 'moo', sheep: 'baa', pig: 'oink', chicken: 'cluck', horse: 'neigh', person: 'scream' };
function handleEvents() {
  const S = G.S, evs = G.events;
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    R.onEvent(e);
    if (attract) continue;
    switch (e.e) {
      case 'eat': {
        const en = e.ent, d = en.def, size = Math.min(1, d.tier / 4);
        intensity += 0.02 + d.tier * 0.03;
        const sfx = ANIMAL_SFX[en.t];
        if (sfx && Math.random() < (en.t === 'person' ? 0.35 : 0.6)) audio.play(sfx, { vol: 0.7, pan: pan(en.x, en.z), pitch: 0.9 + Math.random() * 0.25 });
        else audio.play(d.tier >= 2 ? 'suck_big' : 'suck_small', { vol: 0.5, size, pan: pan(en.x, en.z), pitch: 0.85 + Math.random() * 0.4 });
        if (d.kind === 'veh' && Math.random() < 0.25) audio.play(Math.random() < 0.5 ? 'car_alarm' : 'honk', { vol: 0.4, pan: pan(en.x, en.z) });
        if (e.xp >= TIERS[Math.min(6, S.tier + 1)].mass * 0.004 || d.tier >= S.tier) { R.project(en.x, en.y + d.h, en.z, pr); if (pr.vis) ui.popup(pr.x, pr.y, '+' + fmt(e.xp), 'xp'); }
        if (en.t === 'cow') { if (G.stats.cows === 1) news(headlineFor('firstCow')); if (G.stats.cows === 50) { unlock('moo'); news(headlineFor('cows50')); } }
        break;
      }
      case 'crack': audio.play(e.ent.def.tier >= 3 ? 'crunch_concrete' : e.ent.def.tier >= 2 ? 'crunch_wood' : 'crunch_wood', { vol: 0.6, size: e.ent.def.tier / 5, pan: pan(e.ent.x, e.ent.z) }); if (e.ent.def.tier >= 4 && Math.random() < 0.5) audio.play('crunch_glass', { vol: 0.5, pan: pan(e.ent.x, e.ent.z) }); intensity += 0.05; break;
      case 'collapse': {
        const b = e.ent, t = b.def.tier;
        intensity += 0.15 + t * 0.1;
        audio.play(t >= 3 ? 'collapse_big' : 'collapse_small', { vol: 0.9, size: t / 5, pan: pan(b.x, b.z) });
        R.project(b.x, b.def.h * 0.6, b.z, pr); if (pr.vis) ui.popup(pr.x, pr.y, '+' + fmt(e.xp), t >= S.tier ? 'crit' : 'xp');
        if (b.t === 'giant_duck') { audio.play('quack', { vol: 1 }); unlock('duck'); }
        if (b.t === 'cooling_tower') unlock('nuke');
        if (b.t === 'donut_shop' && G.stats.donuts >= 5) unlock('donut');
        if (up('moneynado') && t >= 3) audio.play('cash', { vol: 0.5 });
        const h = headlineFor('bld_' + b.t); if (h && (t >= 4 || time - lastNewsT > 9)) news(h);
        break;
      }
      case 'explosion': audio.play(e.big >= 2 ? 'nuke' : e.big ? 'explode_big' : 'explode', { vol: e.hostile ? 0.8 : 0.9, pan: pan(e.x, e.z) }); intensity += 0.2; break;
      case 'impact': audio.play('fling_hit', { vol: 0.5, pan: pan(e.x, e.z), size: Math.min(1, e.r / 20) }); break;
      case 'fling': audio.play('fling', { vol: 0.45, pitch: 0.9 + Math.random() * 0.3 }); break;
      case 'tier': {
        const T = TIERS[e.tier];
        ui.toast(T.name + ' — ' + T.title, 'tier'); ui.flash('tier'); audio.play('tierup');
        if (e.tier === 3) unlock('f3'); if (e.tier === 5) unlock('f5'); if (e.tier === 6) unlock('f6');
        if (e.tier === 4 && G.stats.f4Untouched) unlock('untouchable');
        news(headlineFor('tier' + e.tier));
        break;
      }
      case 'levelup': break;
      case 'combo': audio.play('combo_up', { pitch: 1 + Math.min(1, e.n / 60), vol: 0.6 }); if (e.n >= 50) unlock('combo50'); break;
      case 'combobreak': if (e.n >= 8) audio.play('combo_break', { vol: 0.5 }); break;
      case 'threat': ui.toast(e.name, 'warning'); audio.play('warning'); audio.play('siren', { vol: 0.6 }); news(headlineFor('threat' + e.level)); break;
      case 'hurt': { ui.flash('hurt'); audio.play('hit_taken', { vol: Math.min(1, 0.5 + e.dmg * 0.03) }); R.project(S.x, S.r * 2 + 3, S.z, pr); ui.popup(pr.x, pr.y, '-' + Math.max(1, Math.round(e.dmg)), 'hurt'); break; }
      case 'dodge': break;
      case 'block': audio.play('crunch_metal', { vol: 0.6 }); break;
      case 'dash': audio.play('dash'); break;
      case 'ult': audio.play('thunder'); audio.play('boss_roar', { vol: 0.5, pitch: 1.4 }); ui.toast('SUPERCELL!', 'info'); ui.flash('lightning'); break;
      case 'bolt': audio.play('lightning', { vol: 0.6, pan: pan(e.x, e.z) }); if (Math.random() < 0.3) audio.play('thunder', { vol: 0.5 }); ui.flash('lightning'); break;
      case 'arc': audio.play('lightning', { vol: 0.5, pitch: 1.3 }); break;
      case 'hail': audio.play('hail', { vol: 0.6, pan: pan(e.x, e.z) }); break;
      case 'sharks': audio.play('shark', { vol: 0.6 }); break;
      case 'chomp': audio.play('shark', { vol: 0.5, pitch: 1.3, pan: pan(e.x, e.z) }); break;
      case 'tracer': audio.play('gunfire', { vol: 0.35, pan: pan(e.x, e.z) }); break;
      case 'shellfire': audio.play('shell_fire', { vol: 0.6, pan: pan(e.x, e.z) }); break;
      case 'missilefire': audio.play('missile_fire', { vol: 0.6, pan: pan(e.x, e.z) }); break;
      case 'bombdrop': audio.play('bomb_fall', { vol: 0.8 }); ui.toast('BOMBS AWAY — MOVE!', 'warning'); break;
      case 'chilled': audio.play('freeze'); ui.toast('FROZEN — you are slowed', 'warning'); break;
      case 'freeze': audio.play('freeze', { vol: 0.5, pan: pan(e.ent.x, e.ent.z) }); break;
      case 'ignite': if (Math.random() < 0.3) audio.play('fire_whoosh', { vol: 0.4, pan: pan(e.ent.x, e.ent.z) }); break;
      case 'kill': {
        const en = e.ent;
        intensity += 0.2;
        if (e.frozen) audio.play('shatter', { pan: pan(en.x, en.z) });
        R.project(en.x, en.y + en.def.h, en.z, pr); if (pr.vis) ui.popup(pr.x, pr.y, '+' + fmt(e.xp), 'crit');
        if (G.stats.jets >= 10) unlock('jet');
        const h = headlineFor('kill_' + en.t); if (h && time - lastNewsT > 6) news(h);
        break;
      }
      case 'newscast': if (time - lastNewsT > 8) news(eventNews(G)); break;
      case 'blocked': if (!run.firstBlocked || time - run.firstBlocked > 12) { run.firstBlocked = time; ui.toast('TOO BIG — grow to ' + TIERS[Math.min(6, e.ent.def.tier)].name + ' first', 'info'); audio.play('ui_back', { vol: 0.6 }); } break;
      case 'boss': ui.toast('PROJECT AEGIS DEPLOYED', 'warning'); audio.play('boss_roar'); audio.setMusic('boss', 1); news(headlineFor('boss')); break;
      case 'bosscharge': audio.play('boss_charge', { pan: pan(e.x, e.z) }); break;
      case 'bossphase': ui.toast('AEGIS: OVERDRIVE', 'warning'); audio.play('boss_roar', { pitch: 1.2 }); break;
      case 'stomp': audio.play('explode_big', { pitch: 0.6 }); break;
      case 'shielded': audio.play('crunch_metal', { vol: 0.4, pitch: 1.6 }); if (!run.shieldHint || time - run.shieldHint > 8) { run.shieldHint = time; ui.toast('SHIELDED — destroy the pylons', 'info'); } break;
      case 'pylon': audio.play('shield_down'); ui.toast(e.left ? `PYLON DOWN — ${e.left} LEFT` : 'SHIELD DOWN — FINISH IT', 'info'); break;
      case 'revive': ui.toast('EYE WALL — REFORMED', 'unlock'); audio.play('heal'); ui.flash('heal'); break;
      case 'gameover': if (e.win) { unlock('aegis'); } break;
    }
  }
  evs.length = 0;
}
const up = (id) => G.S.up[id] > 0;
function fmt(v) { v = Math.round(v); return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? (v / 1e3).toFixed(0) + 'K' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : '' + v; }

// ---------------- HUD ----------------
const blips = new Float32Array(64 * 3);
const hud = { time: 0, tier: 0, tierFrac: 0, mass: 0, level: 0, xpFrac: 0, hp: 100, hpMax: 100, combo: 1, comboFrac: 0, threat: 0, threatFrac: 0, dashCharges: 1, dashMax: 1, dashFrac: 0, ammo: 0, ammoMax: 40, ult: 0, score: 0, chaos: 0, objective: '', boss: null, upgrades: [], fps: 60, showFps: false, radar: { x: 0, z: 0, heading: 0, range: 200, blips, n: 0 } };
const bossHud = { name: 'PROJECT AEGIS', hp: 1, hpMax: 1, shield: 0 };
let upSig = '', radarT = 0;
function updateHud(dt) {
  const S = G.S;
  hud.time = G.t; hud.tier = S.tier; hud.tierFrac = S.tier >= 6 ? 1 : G.tierFrac(); hud.mass = S.mass; hud.level = S.level; hud.xpFrac = Math.min(1, S.xp / S.xpNext);
  hud.hp = S.hp; hud.hpMax = S.hpMax; hud.combo = S.combo; hud.comboFrac = Math.max(0, S.comboT / (3.2 + S.up.combo * 1.2));
  hud.threat = G.threat; hud.threatFrac = G.threatFrac || 0; hud.dashCharges = S.dashCharges; hud.dashMax = S.dashMax; hud.dashFrac = S.dashCharges >= S.dashMax ? 1 : S.dashCd;
  hud.ammo = S.ammo; hud.ammoMax = S.ammoMax; hud.ult = S.ultT > 0 ? S.ultT / 7 : S.ult; hud.score = S.score; hud.chaos = G.chaosEarned(); hud.objective = G.objective();
  if (G.boss) { bossHud.hp = Math.max(0, G.boss.ent.hp); bossHud.hpMax = G.boss.ent.hpMax; bossHud.shield = G.boss.shield; hud.boss = bossHud; } else hud.boss = null;
  let sig = ''; for (const id in S.up) if (S.up[id]) sig += id + S.up[id];
  if (sig !== upSig) { upSig = sig; hud.upgrades = upgradeList(); }
  hud.fps = fps; hud.showFps = save.settings.showFps;
  radarT -= dt;
  if (radarT <= 0) {
    radarT = 0.15;
    const rd = hud.radar; rd.x = S.x; rd.z = S.z; rd.heading = S.heading; rd.range = 160 + S.r * 11;
    let n = 0;
    for (const en of G.enemies) { if (n >= 40) break; blips[n * 3] = en.x - S.x; blips[n * 3 + 1] = en.z - S.z; blips[n * 3 + 2] = en.t === 'boss_core' ? 3 : en.t === 'boss_pylon' ? 2 : 1; n++; }
    G.query(S.x, S.z, rd.range, (e) => { if (n >= 64 || e.def.kind !== 'bld') return; if (e.def.tier === S.tier || (e.def.tier === S.tier - 1 && e.def.tier >= 2)) { blips[n * 3] = e.x - S.x; blips[n * 3 + 1] = e.z - S.z; blips[n * 3 + 2] = e.def.tier === S.tier ? 2 : 0; n++; } });
    rd.n = n;
  }
  ui.updateHud(hud);
  const low = S.hp / S.hpMax < 0.28 && !G.over;
  if (low !== lowHp) { lowHp = low; ui.setLowHp(low); if (low) audio.play('low_hp'); }
}

// ---------------- main loop ----------------
const STEP = 1 / 60;
function tick(now) {
  requestAnimationFrame(tick);
  let dt = Math.min(0.1, (now - last) / 1000); last = now;
  fpsAcc += dt; fpsN++; if (fpsAcc >= 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  if (mode === 'boot') return;
  // dynamic resolution: hold ~50+ fps on weak GPUs
  frameMs += (dt * 1000 - frameMs) * 0.05; dynT += dt;
  if (dynT > 1.5 && !params.has('fixedres')) { dynT = 0; const sc = R.getResScale(); if (frameMs > 21 && sc > 0.6) R.setResScale(Math.max(0.6, sc - 0.1)); else if (frameMs < 14 && sc < 1) R.setResScale(Math.min(1, sc + 0.05)); }
  const speed = window.__sz.speed || 1;
  const simulate = mode === 'run' || mode === 'title' || mode === 'menu' || (mode === 'results');
  if (mode !== 'pause') time += dt;
  if (simulate && G) {
    acc += dt * speed; let n = 0;
    while (acc >= STEP && n < 4 * speed) {
      acc -= STEP; n++;
      if (mode === 'run') {
        if (autoBot) botInput(STEP); else readInput(STEP);
        input.dash = input.dashQ; input.ult = input.ultQ; input.dashQ = false; input.ultQ = false;
        G.step(STEP, input);
        handleEvents();
        if (G.awaiting) { setMode('levelup'); if (autoBot) setTimeout(() => actions.pickUpgrade(0), 400); break; }
        if (G.over) { finishRun(); break; }
      } else if (attract) { botInput(STEP); G.step(STEP, input); if (G.awaiting) G.pickUpgrade(0); handleEvents(); }
    }
    if (acc > STEP * 4) acc = 0;
  }
  if (!G) return;
  if (mode === 'run') {
    updateHud(dt);
    intensity = Math.max(0, intensity - dt * (0.25 + intensity * 0.5));
    const S = G.S;
    const mi = Math.min(1, 0.12 + S.tier * 0.13 + G.threat * 0.06 + Math.min(0.3, intensity * 0.2));
    if (!G.boss && !G.won) audio.setMusic(S.tier < 1 && G.threat < 1 ? 'calm' : 'action', mi);
    audio.setStorm({ size: S.tier + G.tierFrac(), speed: Math.min(1, Math.hypot(S.vx, S.vz) / 40), intensity: Math.min(1, intensity * 0.5), fire: up('firenado'), ice: up('blizzard'), electric: up('thunder') || S.ultT > 0, hp: S.hp / S.hpMax });
  } else if (attract && (mode === 'menu' || mode === 'title')) {
    audio.setStorm({ size: 1.5, speed: 0.4, intensity: 0.15, fire: up('firenado'), ice: up('blizzard'), electric: false, hp: 1 });
  }
  R.frame(mode === 'pause' || mode === 'levelup' ? 0 : dt, time, { menu: attract, lowHp, lowFx: save.settings.quality === 'low' });
}

// ---------------- boot ----------------
window.__sz = { get G() { return G; }, set G(v) { }, R, ui, audio, actions, get mode() { return mode; }, get save() { return save; }, speed: 1, input, setAuto(v) { autoBot = v; }, snapshot() { return canvas.toDataURL('image/jpeg', 0.85); } };
window.addEventListener('resize', () => { R.resize(); ui.resize?.(); });
document.addEventListener('fullscreenchange', () => { save.settings.fullscreen = !!document.fullscreenElement; });
ui.setScreen('loading', { progress: 0.3, text: 'Brewing storm…' });
requestAnimationFrame(() => {
  R.setQuality(save.settings.quality); R.resize();
  newAttract();
  mode = 'title'; ui.setScreen('title');
  if (params.has('play')) { actions.titleContinue(); startRun(params.get('play') || 'classic'); }
  requestAnimationFrame(tick);
});
