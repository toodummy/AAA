// STORMZILLA UI - HTML/CSS overlay: HUD, menus, level-up cards, results, toasts, news ticker, combat text.
// createUI({ root, actions, audio }) -> { setScreen, updateHud, toast, news, popup, flash, setLowHp, resize, destroy }
// The UI never implements game logic: it renders data and calls `actions`.
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-700-italic.css';
import '@fontsource/barlow-condensed/latin-800-italic.css';
import '@fontsource/barlow-condensed/latin-900-italic.css';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow/latin-700.css';
import '@fontsource/playfair-display/latin-900.css';
import '@fontsource/playfair-display/latin-700-italic.css';
import './ui.css';
import { TIERS, UPGRADES, META, STORMS, ACHIEVEMENTS } from '../game/defs.js';
import { icon, logoSVG } from './icons.js';
import {
  clamp01, metaCost, metaState, fmtNum, fmtInt, fmtTime, isUnlocked, unlockProgress, statValue,
  countUp, uiUnit, pickDirectional,
} from './format.js';

const RARITY_NAMES = ['COMMON', 'RARE', 'EPIC', 'MUTATION'];
const QUALITY_LEVELS = ['low', 'medium', 'high', 'ultra'];
const SCREENS = ['loading', 'title', 'menu', 'levelup', 'pause', 'results'];
const HUD_SCREENS = { hud: 1, levelup: 1, pause: 1 };
const TABS = [
  { id: 'play', label: 'Play', icon: 'play', title: 'Choose your storm', sub: 'Pick a funnel. Ruin a county.' },
  { id: 'upgrades', label: 'Upgrades', icon: 'up2', title: 'Permanent upgrades', sub: 'Spend Chaos Points. They carry over between runs.' },
  { id: 'achievements', label: 'Achievements', icon: 'trophy', title: 'Achievements', sub: 'Things the insurance industry will remember you for.' },
  { id: 'settings', label: 'Settings', icon: 'gear', title: 'Settings', sub: '' },
  { id: 'howto', label: 'How to play', icon: 'book', title: 'How to play', sub: 'You are the tornado. Everything else is lunch.' },
  { id: 'credits', label: 'Credits', icon: 'people', title: 'Credits', sub: '' },
];
const SETTINGS_ROWS = [
  { key: 'master', label: 'Master volume', icon: 'volume', type: 'slider' },
  { key: 'music', label: 'Music', icon: 'music', type: 'slider' },
  { key: 'sfx', label: 'Sound effects', icon: 'bolt', type: 'slider' },
  { key: 'quality', label: 'Graphics quality', icon: 'quality', type: 'seg' },
  { key: 'shake', label: 'Screen shake', icon: 'shake', type: 'slider' },
  { key: 'fullscreen', label: 'Fullscreen', icon: 'fullscreen', type: 'toggle' },
  { key: 'mouseSteer', label: 'Mouse steering', icon: 'mouse', type: 'toggle' },
  { key: 'showFps', label: 'Show FPS', icon: 'fps', type: 'toggle' },
];
const DEFAULT_SETTINGS = { master: 0.8, music: 0.7, sfx: 0.9, quality: 'high', shake: 1, fullscreen: false, mouseSteer: true, showFps: false };
const POPUP_MAX = 40;
const TOAST_ICONS = { achievement: 'trophy', unlock: 'lock', info: 'info' };
const TOAST_LABELS = { achievement: 'Achievement unlocked', unlock: 'Unlocked', info: 'Storm report' };
const POPUP_FRAMES = [
  { transform: 'translate(-50%,-20%) scale(.4)', opacity: 0 },
  { transform: 'translate(-50%,-90%) scale(1.25)', opacity: 1, offset: 0.14 },
  { transform: 'translate(-50%,-150%) scale(1)', opacity: 1, offset: 0.62 },
  { transform: 'translate(-50%,-240%) scale(.86)', opacity: 0 },
];
const POP_FRAMES = [{ transform: 'scale(1.38)' }, { transform: 'scale(1)' }];
const FLASH_SPEC = { hurt: [0.55, 380], tier: [0.85, 700], lightning: [0.9, 260], heal: [0.4, 520] };

function esc(text) {
  return String(text == null ? '' : text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}
function make(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}
function pips(rank, max, extraCls = '') {
  let out = `<span class="sz-pips ${extraCls}">`;
  for (let i = 0; i < max; i++) out += `<i class="${i < rank ? 'on' : ''}"></i>`;
  return out + '</span>';
}
function kbd(label, cls = '') {
  return `<kbd class="sz-kbd ${cls}">${label}</kbd>`;
}
function btn(label, act, opts = {}) {
  return `<button type="button" class="sz-btn ${opts.cls || ''}" data-nav data-act="${act}" ${opts.key ? `data-key="${opts.key}"` : ''}>`
    + `<span class="sz-btn-in">${opts.icon ? icon(opts.icon) : ''}<span>${label}</span>${opts.kbd ? kbd(opts.kbd) : ''}</span></button>`;
}

export function createUI({ root, actions = {}, audio = null } = {}) {
  if (!root) throw new Error('createUI: root element required');
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  let destroyed = false;
  const timers = new Set();
  const later = (fn, ms) => {
    const id = win.setTimeout(() => { timers.delete(id); if (!destroyed) fn(); }, ms);
    timers.add(id);
    return id;
  };
  const act = (name, ...args) => {
    const fn = actions && actions[name];
    if (typeof fn !== 'function') return undefined;
    try { return fn(...args); } catch (err) { console.error('[ui] action ' + name + ' failed', err); return undefined; }
  };
  const sfx = (name) => {
    if (audio && typeof audio.play === 'function') { try { audio.play(name); } catch (err) { /* audio is optional */ } }
  };
  const animate = (el, frames, opts) => (el.animate ? el.animate(frames, opts) : null);

  // ------------------------------------------------------------------ state
  let screen = '';
  let save = null;
  let settings = { ...DEFAULT_SETTINGS };
  let menuTab = 'play';
  let pendingTab = null;
  let viewedStorm = 'classic';
  let levelData = null;
  let levelLockUntil = 0;
  let levelPicked = false;
  let resultsLockUntil = 0;
  let titleLockUntil = 0;
  let pauseView = 'main';
  let modal = null; // { el, onYes, prevFocus }
  let quietFocus = false;
  let keyNav = false;
  let lastHover = null;
  let countRaf = 0;
  let countDone = null;
  let lastUpgrades = [];
  let unit = 1;
  let rootW = 1600;
  let rootH = 900;

  // ------------------------------------------------------------------ skeleton
  root.classList.add('sz-root');
  const abilitySlot = (id, key, extra) => `<button type="button" class="sz-ab sz-ab-${id}" data-act="ability" data-ab="${id}" tabindex="-1" aria-label="${id}">`
    + `<span class="sz-ab-bg"></span><span class="sz-ab-sweep" data-r="${id}Sweep"></span>${icon(id, 'sz-ab-ico')}${extra}${kbd(key, 'sz-ab-key')}</button>`;
  let starsHtml = '';
  for (let i = 0; i < 5; i++) starsHtml += `<span class="sz-star">${icon('star')}<span class="sz-star-fill">${icon('star')}</span></span>`;

  root.innerHTML = `
<div class="sz-hud" data-r="hud">
  <div class="sz-vignette"></div>
  <div class="sz-hud-tl">
    <div class="sz-id">
      <div class="sz-tier" data-r="tierBadge"><span data-r="tierName">F0</span></div>
      <div class="sz-id-main">
        <div class="sz-tier-title" data-r="tierTitle">DUST DEVIL</div>
        <div class="sz-mass"><span class="sz-lbl">Mass</span><b data-r="mass">0</b><span class="sz-next" data-r="tierNext"></span></div>
        <div class="sz-bar sz-bar-tier"><i data-r="tierFill"></i></div>
      </div>
    </div>
    <div class="sz-hp" data-r="hp">
      <span class="sz-hp-ico">${icon('heart')}</span>
      <div class="sz-bar sz-bar-hp"><i class="ghost" data-r="hpGhost"></i><i data-r="hpFill"></i></div>
      <span class="sz-hp-num"><b data-r="hpNum">100</b><span data-r="hpMax">/100</span></span>
    </div>
  </div>
  <div class="sz-hud-tc">
    <div class="sz-objective" data-r="objective"><span class="sz-obj-tag">Objective</span><span data-r="objectiveText"></span></div>
    <div class="sz-boss" data-r="boss">
      <div class="sz-boss-head">${icon('skull')}<span class="sz-boss-name" data-r="bossName"></span><em data-r="bossShieldTag">${icon('shield')}Shielded</em><b data-r="bossPct"></b></div>
      <div class="sz-bar sz-bar-boss"><i class="ghost" data-r="bossGhost"></i><i data-r="bossFill"></i><i class="shield" data-r="bossShield"></i></div>
    </div>
  </div>
  <div class="sz-hud-tr">
    <div class="sz-clock">
      <div class="sz-score"><span class="sz-lbl">Score</span><b data-r="score">0</b></div>
      <div class="sz-time">${icon('time')}<b data-r="time">0:00</b></div>
    </div>
    <div class="sz-threat" data-r="threat"><span class="sz-lbl">Threat</span><div class="sz-stars" data-r="stars">${starsHtml}</div></div>
    <div class="sz-radar"><canvas data-r="radar"></canvas><span class="sz-radar-n">N</span></div>
    <div class="sz-fps" data-r="fps"></div>
  </div>
  <div class="sz-combo" data-r="combo">
    <div class="sz-combo-ring" data-r="comboRing"></div>
    <div class="sz-combo-num" data-r="comboPop"><span>x</span><b data-r="comboNum">2</b></div>
    <div class="sz-combo-lbl">Combo</div>
  </div>
  <div class="sz-hud-bl"><div class="sz-owned" data-r="owned"></div></div>
  <div class="sz-hud-bc">
    <div class="sz-abilities">
      ${abilitySlot('dash', 'Space', '<span class="sz-ab-pips" data-r="dashPips"></span>')}
      ${abilitySlot('fling', 'LMB', '<span class="sz-ab-count" data-r="ammo">0</span>')}
      ${abilitySlot('ult', 'Q', '<span class="sz-ab-ready">Ready</span>')}
    </div>
    <div class="sz-xp">
      <div class="sz-level"><span>Lv</span><b data-r="level">1</b></div>
      <div class="sz-bar sz-bar-xp"><i data-r="xpFill"></i></div>
    </div>
  </div>
  <div class="sz-hud-br">
    <div class="sz-chaos">${icon('chaosPt')}<b data-r="chaos">0</b><span class="sz-lbl">Chaos</span></div>
    <button type="button" class="sz-pausebtn" data-act="hudPause" tabindex="-1" aria-label="Pause">${icon('pause')}${kbd('Esc')}</button>
  </div>
</div>
<div class="sz-popups" data-r="popups"></div>
<div class="sz-news" data-r="news"><span class="sz-news-tag"><i></i>Breaking</span><span class="sz-news-text" data-r="newsText"></span></div>

<div class="sz-screen sz-loading" data-screen="loading">
  <div class="sz-loading-in">
    ${logoSVG({ cls: 'sz-loading-logo' })}
    <div class="sz-bar sz-bar-load"><i data-r="loadFill"></i></div>
    <div class="sz-loading-row"><span data-r="loadText">Loading</span><b data-r="loadPct">0%</b></div>
  </div>
</div>

<div class="sz-screen sz-title" data-screen="title" data-act="titleContinue">
  <div class="sz-title-in">
    ${logoSVG({ cls: 'sz-title-logo' })}
    <div class="sz-title-press"><span>Press any key</span><i></i><span>or click</span></div>
  </div>
  <div class="sz-title-foot"><span>${icon('tv')}Channel 6 Storm Desk is live</span><span>v0.1</span></div>
</div>

<div class="sz-screen sz-menu" data-screen="menu">
  <div class="sz-rail">
    <div class="sz-rail-logo">${logoSVG({ tagline: false })}</div>
    <div class="sz-rail-tag">You are the tornado</div>
    <nav class="sz-tabs" data-r="tabs">
      ${TABS.map((t) => `<button type="button" class="sz-tab" data-nav data-act="tab" data-tab="${t.id}" data-key="tab:${t.id}">${icon(t.icon)}<span>${t.label}</span></button>`).join('')}
      <button type="button" class="sz-tab sz-tab-quit" data-nav data-act="quitApp" data-key="quit" data-r="quitBtn">${icon('quit')}<span>Quit</span></button>
    </nav>
    <div class="sz-rail-hints">${kbd('↑')}${kbd('↓')}${kbd('←')}${kbd('→')}<span>Navigate</span>${kbd('Enter')}<span>Select</span>${kbd('Esc')}<span>Back</span></div>
  </div>
  <div class="sz-panel" data-r="menuPanel">
    <header class="sz-panel-head">
      <div><h2 data-r="tabTitle"></h2><p data-r="tabSub"></p></div>
      <div class="sz-balance" title="Chaos Points">${icon('chaosPt')}<b data-r="balance">0</b><span>Chaos Points</span></div>
    </header>
    <div class="sz-page" data-page="play"></div>
    <div class="sz-page" data-page="upgrades"></div>
    <div class="sz-page" data-page="achievements"></div>
    <div class="sz-page" data-page="settings"></div>
    <div class="sz-page" data-page="howto"></div>
    <div class="sz-page" data-page="credits"></div>
  </div>
</div>

<div class="sz-screen sz-levelup" data-screen="levelup">
  <div class="sz-lu-head">
    <div class="sz-lu-kicker"><i></i>Level <b data-r="luLevel">2</b><i></i></div>
    <h2>Storm surge <em>— choose an upgrade</em></h2>
  </div>
  <div class="sz-cards" data-r="cards"></div>
  <div class="sz-lu-foot" data-r="luFoot"></div>
</div>

<div class="sz-screen sz-pause" data-screen="pause">
  <div class="sz-pause-box">
    <div class="sz-pause-left">
      <div class="sz-pause-kicker">${icon('pause')}Storm on hold</div>
      <h2>Paused</h2>
      <div class="sz-pause-btns">
        ${btn('Resume', 'resume', { cls: 'sz-btn-primary', icon: 'play', key: 'resume', kbd: 'Esc' })}
        ${btn('Restart run', 'askRestart', { icon: 'restart', key: 'restart' })}
        ${btn('Settings', 'pauseSettings', { icon: 'gear', key: 'psettings' })}
        ${btn('Quit to menu', 'askQuitMenu', { icon: 'home', key: 'quitmenu' })}
      </div>
    </div>
    <div class="sz-pause-right">
      <div class="sz-pause-view" data-r="pauseBuild"></div>
      <div class="sz-pause-view" data-r="pauseSettings"></div>
    </div>
  </div>
</div>

<div class="sz-screen sz-results" data-screen="results"><div class="sz-res-wrap" data-r="results"></div></div>

<div class="sz-banners" data-r="banners"></div>
<div class="sz-toasts" data-r="toasts"></div>
<div class="sz-modal" data-r="modal"></div>
<div class="sz-flash" data-r="flash"></div>`;

  const ref = {};
  root.querySelectorAll('[data-r]').forEach((el) => { ref[el.dataset.r] = el; });
  const screenEls = {};
  root.querySelectorAll('[data-screen]').forEach((el) => { screenEls[el.dataset.screen] = el; });
  const pageEls = {};
  root.querySelectorAll('[data-page]').forEach((el) => { pageEls[el.dataset.page] = el; });
  const tabEls = {};
  root.querySelectorAll('[data-tab]').forEach((el) => { tabEls[el.dataset.tab] = el; });
  const starEls = Array.from(ref.stars.children);
  const starFillEls = starEls.map((el) => el.lastElementChild);
  const radarCtx = ref.radar.getContext('2d');
  if (typeof actions.quitApp !== 'function') ref.quitBtn.remove();

  // ------------------------------------------------------------------ focus / navigation
  function scopeEl() {
    if (modal) return ref.modal;
    return screenEls[screen] || null;
  }
  function navList(scope) {
    if (!scope) return [];
    const out = [];
    const list = scope.querySelectorAll('[data-nav]');
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (el.disabled || el.offsetParent === null) continue;
      out.push(el);
    }
    return out;
  }
  function focusEl(el, quiet) {
    if (!el) return;
    quietFocus = !!quiet;
    try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); }
    quietFocus = false;
    if (el.scrollIntoView && el.closest('.sz-page')) el.scrollIntoView({ block: 'nearest' });
  }
  function focusKey(key, quiet) {
    const scope = scopeEl();
    const el = scope && scope.querySelector(`[data-key="${key}"]`);
    if (el && !el.disabled && el.offsetParent !== null) { focusEl(el, quiet); return true; }
    return false;
  }
  function focusDefault(quiet) {
    const scope = scopeEl();
    if (!scope) return;
    if (modal) { focusKey('modal-no', quiet); return; }
    if (screen === 'menu') {
      if (menuTab === 'play' && focusKey('start', quiet)) return;
      focusEl(tabEls[menuTab], quiet);
      return;
    }
    if (screen === 'pause') { if (pauseView === 'settings') { focusKey('set:master', quiet); } else focusKey('resume', quiet); return; }
    if (screen === 'results') { focusKey('again', quiet); return; }
    const list = navList(scope);
    if (list.length) focusEl(list[screen === 'levelup' ? Math.min(list.length - 1, Math.floor((levelData ? levelData.choices.length : 1) / 2)) : 0], quiet);
  }
  function moveFocus(dir) {
    const scope = scopeEl();
    const list = navList(scope);
    if (!list.length) return;
    const cur = doc.activeElement;
    const idx = list.indexOf(cur);
    if (idx < 0) { focusDefault(); return; }
    const rects = list.map((el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    let next = list[pickDirectional(rects, idx, dir)];
    if (!next) return;
    if (screen === 'menu' && !modal && next.closest('.sz-rail') && !cur.closest('.sz-rail')) next = tabEls[menuTab];
    focusEl(next);
  }

  // ------------------------------------------------------------------ settings panels
  const settingsPanels = [];
  function buildSettings(host, withReset) {
    let html = '<div class="sz-settings">';
    for (const row of SETTINGS_ROWS) {
      let ctl;
      if (row.type === 'slider') ctl = '<span class="sz-slider" data-slider><i></i><u></u></span><b class="sz-set-val"></b>';
      else if (row.type === 'seg') ctl = `<span class="sz-seg">${QUALITY_LEVELS.map((q) => `<span data-opt="${q}">${q}</span>`).join('')}</span>`;
      else ctl = '<b class="sz-set-val"></b><span class="sz-toggle"><i></i></span>';
      html += `<div class="sz-set sz-set-${row.type}" data-nav tabindex="0" data-act="setRow" data-set="${row.key}" data-key="set:${row.key}" role="${row.type === 'slider' ? 'slider' : row.type === 'toggle' ? 'switch' : 'listbox'}" aria-label="${row.label}">`
        + `<span class="sz-set-ico">${icon(row.icon)}</span><span class="sz-set-lbl">${row.label}</span><span class="sz-set-ctl">${ctl}</span></div>`;
    }
    html += '</div>';
    if (withReset) {
      html += `<div class="sz-set-foot"><span>Wipes Chaos Points, upgrades, records and achievements.</span>${btn('Reset save', 'askReset', { cls: 'sz-btn-danger sz-btn-sm', icon: 'trash', key: 'reset' })}</div>`;
    }
    host.innerHTML = html;
    const rows = {};
    host.querySelectorAll('[data-set]').forEach((el) => { rows[el.dataset.set] = el; });
    const panel = {
      sync() {
        for (const row of SETTINGS_ROWS) {
          const el = rows[row.key];
          const value = settings[row.key];
          if (row.type === 'slider') {
            const v = clamp01(value);
            el.style.setProperty('--v', v);
            el.querySelector('.sz-set-val').textContent = Math.round(v * 100) + '%';
            el.setAttribute('aria-valuenow', Math.round(v * 100));
          } else if (row.type === 'seg') {
            el.querySelectorAll('[data-opt]').forEach((o) => o.classList.toggle('on', o.dataset.opt === value));
          } else {
            el.classList.toggle('on', !!value);
            el.querySelector('.sz-set-val').textContent = value ? 'On' : 'Off';
            el.setAttribute('aria-checked', value ? 'true' : 'false');
          }
        }
      },
    };
    settingsPanels.push(panel);
    return panel;
  }
  function syncSettings() { for (const panel of settingsPanels) panel.sync(); }
  function changeSetting(key, value) {
    if (settings[key] === value) return;
    settings[key] = value;
    if (save && save.settings && save.settings !== settings) save.settings[key] = value;
    syncSettings();
    if (key === 'fullscreen') act('toggleFullscreen');
    else act('setSetting', key, value);
  }
  function adjustSetting(rowEl, dir) {
    const key = rowEl.dataset.set;
    const row = SETTINGS_ROWS.find((r) => r.key === key);
    if (!row) return;
    if (row.type === 'slider') {
      const v = Math.round((clamp01(settings[key]) + dir * 0.1) * 10) / 10;
      changeSetting(key, clamp01(v));
    } else if (row.type === 'seg') {
      const i = Math.max(0, QUALITY_LEVELS.indexOf(settings[key]));
      const j = Math.max(0, Math.min(QUALITY_LEVELS.length - 1, i + dir));
      changeSetting(key, QUALITY_LEVELS[j]);
    } else changeSetting(key, dir > 0);
    sfx('ui_hover');
  }
  function sliderFromPointer(rowEl, ev) {
    const track = rowEl.querySelector('[data-slider]');
    const r = track.getBoundingClientRect();
    const v = clamp01((ev.clientX - r.left) / Math.max(1, r.width));
    changeSetting(rowEl.dataset.set, Math.round(v * 20) / 20);
  }
  let dragRow = null;

  // ------------------------------------------------------------------ menu
  buildSettings(pageEls.settings, true);
  buildSettings(ref.pauseSettings, false);
  ref.pauseSettings.insertAdjacentHTML('afterbegin', '<h3>Settings</h3>');
  ref.pauseSettings.insertAdjacentHTML('beforeend', `<div class="sz-pause-back">${btn('Back', 'pauseBack', { cls: 'sz-btn-sm', icon: 'left', key: 'pback', kbd: 'Esc' })}</div>`);

  const keycap = (label, cls = '') => `<span class="sz-keycap ${cls}">${label}</span>`;
  pageEls.howto.innerHTML = `
<div class="sz-how">
  <div class="sz-how-col">
    <h3>Controls</h3>
    <div class="sz-how-row"><div class="sz-how-keys">${keycap('W')}${keycap('A')}${keycap('S')}${keycap('D')}<em>or</em>${keycap('↑')}${keycap('←')}${keycap('↓')}${keycap('→')}</div><div><b>Move the storm</b><span>…or just point: the storm follows your mouse cursor.</span></div></div>
    <div class="sz-how-row"><div class="sz-how-keys">${keycap('Space', 'wide')}<em>or</em>${keycap(icon('mouse') + 'Right', 'wide')}</div><div><b>Dash</b><span>Burst forward through anything in the way.</span></div></div>
    <div class="sz-how-row"><div class="sz-how-keys">${keycap(icon('mouse') + 'Left (hold)', 'wide')}</div><div><b>Fling debris</b><span>Hurl the junk orbiting you at the cursor.</span></div></div>
    <div class="sz-how-row"><div class="sz-how-keys">${keycap('Q')}</div><div><b>Supercell ultimate</b><span>Unleash it when the ring is fully charged.</span></div></div>
    <div class="sz-how-row"><div class="sz-how-keys">${keycap('Esc', 'wide')}</div><div><b>Pause</b><span>Even disasters need a break.</span></div></div>
  </div>
  <div class="sz-how-col">
    <h3>How to be a disaster</h3>
    <div class="sz-how-rule">${icon('tornado')}<div><b>Eat to grow</b><span>Swallow anything smaller than you. Things that are still too big <i class="sz-red">show red</i>.</span></div></div>
    <div class="sz-how-rule">${icon('flame')}<div><b>Keep the combo alive</b><span>Chain destruction before the ring drains for huge multipliers.</span></div></div>
    <div class="sz-how-rule">${icon('up2')}<div><b>Level up, mutate</b><span>Pick an upgrade every level. Mutations change the whole storm.</span></div></div>
    <div class="sz-how-rule">${icon('star')}<div><b>Threat rises</b><span>Police, then tanks, then jets… then Project AEGIS comes to kill the weather.</span></div></div>
    <div class="sz-how-rule">${icon('chaosPt')}<div><b>Bank the chaos</b><span>Every run pays Chaos Points for permanent upgrades.</span></div></div>
  </div>
</div>
<div class="sz-ladder">${TIERS.map((t, i) => `<div class="sz-ladder-step ${i >= 3 ? 'is-dark' : ''}" style="--tc:${t.color}"><b>${t.name}</b><span>${esc(t.title)}</span>${i < TIERS.length - 1 ? icon('right') : ''}</div>`).join('')}</div>`;

  pageEls.credits.innerHTML = `
<div class="sz-credits">
  <div class="sz-credits-logo">${logoSVG({})}</div>
  <p class="sz-credits-lead">A destruction roguelite about being extremely bad weather.</p>
  <div class="sz-credits-grid">
    <div><h3>Made by</h3><p>The STORMZILLA team<br>Design, code, art, sound &amp; meteorological malpractice</p></div>
    <div><h3>Technology</h3><p>three.js (MIT)<br>Vite · Electron</p></div>
    <div><h3>Typefaces</h3><p>Barlow &amp; Barlow Condensed — Jeremy Tribby<br>Playfair Display — Claus Eggers Sørensen<br>SIL Open Font License 1.1</p></div>
    <div><h3>Disclaimer</h3><p>No cows were harmed.<br>Several were relocated. Upwards.</p></div>
  </div>
</div>`;

  function stormIds() { return Object.keys(STORMS); }
  function renderPlay() {
    const ids = stormIds();
    if (!STORMS[viewedStorm]) viewedStorm = ids[0];
    const stats = (save && save.stats) || {};
    const bestTier = Math.max(0, Math.min(TIERS.length - 1, stats.bestTier | 0));
    let cards = '';
    for (const id of ids) {
      const s = STORMS[id];
      const open = isUnlocked(s, save);
      cards += `<button type="button" class="sz-storm ${open ? '' : 'is-locked'}" data-nav data-act="storm" data-storm="${id}" data-key="storm:${id}">`
        + `<span class="sz-storm-ico">${icon(id, '', s.icon)}</span><span class="sz-storm-name">${esc(s.name)}</span>`
        + (open ? '' : `<span class="sz-storm-lock">${icon('lock')}</span>`) + '</button>';
    }
    pageEls.play.innerHTML = `
<div class="sz-storms">${cards}</div>
<div class="sz-storm-detail">
  <div class="sz-storm-big" data-p="big"></div>
  <div class="sz-storm-info">
    <div class="sz-storm-title" data-p="name"></div>
    <div class="sz-storm-desc" data-p="desc"></div>
    <div class="sz-storm-req" data-p="req"></div>
  </div>
</div>
<div class="sz-records">
  <div><span class="sz-lbl">Best score</span><b>${fmtInt(stats.bestScore || 0)}</b></div>
  <div><span class="sz-lbl">Best tier</span><b>${TIERS[bestTier].name}<small>${esc(TIERS[bestTier].title)}</small></b></div>
  <div><span class="sz-lbl">Best time</span><b>${stats.bestTime ? fmtTime(stats.bestTime) : '—'}</b></div>
  <div><span class="sz-lbl">Wins / runs</span><b>${stats.wins | 0}<small>/ ${stats.runs | 0}</small></b></div>
</div>
<div class="sz-start-row"><button type="button" class="sz-btn sz-btn-primary sz-btn-xl" data-nav data-act="start" data-key="start"><span class="sz-btn-in">${icon('play')}<span data-p="startLabel">Start storm</span>${kbd('Enter')}</span></button></div>`;
    viewStorm(viewedStorm);
  }
  function viewStorm(id) {
    if (!STORMS[id]) return;
    viewedStorm = id;
    const s = STORMS[id];
    const open = isUnlocked(s, save);
    const page = pageEls.play;
    page.querySelectorAll('.sz-storm').forEach((el) => el.classList.toggle('is-on', el.dataset.storm === id));
    const q = (name) => page.querySelector(`[data-p="${name}"]`);
    if (!q('big')) return;
    q('big').innerHTML = icon(id, '', s.icon);
    q('big').classList.toggle('is-locked', !open);
    q('name').textContent = s.name;
    q('desc').textContent = s.desc;
    const starts = Object.keys(s.start || {}).filter((u) => UPGRADES[u]);
    if (open) {
      q('req').className = 'sz-storm-req';
      q('req').innerHTML = starts.length
        ? `<span class="sz-chip">${icon('up2')}Starts with ${starts.map((u) => esc(UPGRADES[u].name)).join(' + ')}</span>`
        : `<span class="sz-chip">${icon('check')}Ready to touch down</span>`;
    } else {
      const have = statValue(save, s.unlock.stat);
      q('req').className = 'sz-storm-req is-locked';
      q('req').innerHTML = `<span class="sz-chip sz-chip-lock">${icon('lock')}Locked — ${esc(s.unlock.text)}</span>`
        + `<span class="sz-req-bar"><i style="transform:scaleX(${unlockProgress(s, save)})"></i></span><span class="sz-req-num">${fmtInt(Math.min(have, s.unlock.gte))} / ${fmtInt(s.unlock.gte)}</span>`;
    }
    const start = page.querySelector('[data-key="start"]');
    start.classList.toggle('is-disabled', !open);
    start.setAttribute('aria-disabled', open ? 'false' : 'true');
    q('startLabel').textContent = open ? 'Start storm' : 'Locked';
  }
  function renderUpgrades(prevRanks) {
    const chaos = (save && save.chaos) || 0;
    const ranks = (save && save.meta) || {};
    let html = '<div class="sz-metas">';
    for (const id of Object.keys(META)) {
      const def = META[id];
      const rank = ranks[id] | 0;
      const state = metaState(def, rank, chaos);
      const cost = state === 'max' ? 0 : metaCost(def, rank);
      const bought = prevRanks && (prevRanks[id] | 0) < rank;
      html += `<button type="button" class="sz-meta is-${state} ${bought ? 'is-bought' : ''}" data-nav data-act="buyMeta" data-meta="${id}" data-key="meta:${id}" aria-disabled="${state === 'ok' ? 'false' : 'true'}">`
        + `<span class="sz-meta-ico">${icon(id, '', def.icon)}</span>`
        + `<span class="sz-meta-main"><span class="sz-meta-name">${esc(def.name)}</span><span class="sz-meta-desc">${esc(def.desc)}</span>${pips(rank, def.max)}</span>`
        + `<span class="sz-meta-buy">${state === 'max' ? `${icon('check')}<b>Maxed</b>` : `<small>${state === 'ok' ? 'Buy' : 'Need'}</small><b>${icon('chaosPt')}${fmtInt(state === 'ok' ? cost : cost - chaos)}</b>${state === 'poor' ? `<small>of ${fmtInt(cost)}</small>` : ''}`}</span>`
        + '</button>';
    }
    pageEls.upgrades.innerHTML = html + '</div>';
  }
  function renderAchievements() {
    const got = (save && save.achievements) || {};
    const ids = Object.keys(ACHIEVEMENTS);
    let n = 0;
    let html = '';
    for (const id of ids) {
      const a = ACHIEVEMENTS[id];
      const on = !!got[id];
      if (on) n++;
      html += `<div class="sz-ach ${on ? 'on' : ''}"><span class="sz-ach-ico">${icon(on ? 'trophy' : 'lock')}</span><span class="sz-ach-txt"><b>${esc(a.name)}</b><span>${esc(a.desc)}</span></span></div>`;
    }
    pageEls.achievements.innerHTML = `<div class="sz-ach-top"><div class="sz-bar sz-bar-ach"><i style="transform:scaleX(${n / ids.length})"></i></div><b>${n} / ${ids.length}</b></div><div class="sz-achs">${html}</div>`;
  }
  function showTab(id, fromKeys) {
    const tab = TABS.find((t) => t.id === id) || TABS[0];
    menuTab = tab.id;
    for (const t of TABS) {
      tabEls[t.id].classList.toggle('is-on', t.id === menuTab);
      pageEls[t.id].classList.toggle('is-on', t.id === menuTab);
    }
    ref.tabTitle.textContent = tab.title;
    ref.tabSub.textContent = tab.sub;
    ref.menuPanel.dataset.tab = menuTab;
    if (!fromKeys) animate(pageEls[menuTab], [{ opacity: 0, transform: 'translateX(-12px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  function renderMenu(data) {
    const prev = save;
    const prevRanks = prev && prev.meta ? { ...prev.meta } : null;
    const prevChaos = prev ? prev.chaos : null;
    const activeKey = doc.activeElement && root.contains(doc.activeElement) ? doc.activeElement.dataset.key : null;
    if (data) {
      save = data;
      if (data.settings) settings = { ...DEFAULT_SETTINGS, ...data.settings };
      if (!prev && data.lastStorm && STORMS[data.lastStorm] && isUnlocked(STORMS[data.lastStorm], data)) viewedStorm = data.lastStorm;
    }
    ref.balance.textContent = fmtInt((save && save.chaos) || 0);
    if (prevChaos != null && save && prevChaos !== save.chaos) animate(ref.balance, POP_FRAMES, { duration: 320, easing: 'ease-out' });
    renderPlay();
    renderUpgrades(prev === save ? null : prevRanks);
    renderAchievements();
    syncSettings();
    return activeKey;
  }

  // ------------------------------------------------------------------ level-up
  function renderLevelUp(data) {
    levelData = data || { choices: [], rerolls: 0, level: 1 };
    levelPicked = false;
    levelLockUntil = win.performance.now() + 350;
    ref.luLevel.textContent = levelData.level | 0;
    const n = levelData.choices.length;
    ref.cards.dataset.n = n;
    let html = '';
    levelData.choices.forEach((c, i) => {
      const rarity = Math.max(0, Math.min(3, c.rarity | 0));
      const rank = c.rank | 0;
      const max = c.max || 1;
      const rankTxt = rarity === 3 ? 'One of a kind' : rank === 0 ? 'New' : `Rank ${rank} <i>›</i> ${rank + 1}`;
      html += `<button type="button" class="sz-card r${rarity}" data-nav data-act="pick" data-i="${i}" data-key="card:${i}" style="--i:${i}">`
        + '<span class="sz-card-edge"></span><span class="sz-card-body">'
        + (rarity === 3 ? '<span class="sz-card-ribbon">Mutation</span>' : '')
        + `<span class="sz-card-top"><span class="sz-card-rarity">${RARITY_NAMES[rarity]}</span>${kbd(i + 1)}</span>`
        + `<span class="sz-card-icon">${icon(c.id, '', c.icon)}</span>`
        + `<span class="sz-card-name">${esc(c.name)}</span>`
        + `<span class="sz-card-short">${esc(c.short)}</span>`
        + `<span class="sz-card-desc">${esc(c.desc)}</span>`
        + `<span class="sz-card-rank">${max > 1 ? pips(rank, max, 'next') : ''}<span class="sz-card-ranktxt ${rank === 0 ? 'new' : ''}">${rankTxt}</span></span>`
        + '</span></button>';
    });
    ref.cards.innerHTML = html;
    markGainPips();
    const rerolls = levelData.rerolls | 0;
    ref.luFoot.innerHTML = rerolls > 0
      ? `<button type="button" class="sz-btn sz-btn-sm" data-nav data-act="reroll" data-key="reroll"><span class="sz-btn-in">${icon('reroll')}<span>Reroll</span><em class="sz-btn-count">${rerolls} left</em>${kbd('R')}</span></button>`
      : '<span class="sz-lu-hint">No rerolls left</span>';
    ref.luFoot.insertAdjacentHTML('beforeend', `<span class="sz-lu-hint">${kbd('1')}–${kbd(String(Math.max(1, n)))} or ${kbd('←')}${kbd('→')} + ${kbd('Enter')}</span>`);
    sfx('card_show');
  }
  function markGainPips() {
    ref.cards.querySelectorAll('.sz-pips.next').forEach((el) => {
      const firstOff = el.querySelector('i:not(.on)');
      if (firstOff) firstOff.classList.add('gain');
    });
  }
  function pickCard(index) {
    if (screen !== 'levelup' || levelPicked || !levelData) return;
    if (win.performance.now() < levelLockUntil) return;
    if (index < 0 || index >= levelData.choices.length) return;
    levelPicked = true;
    const cards = ref.cards.children;
    for (let i = 0; i < cards.length; i++) cards[i].classList.add(i === index ? 'is-picked' : 'is-passed');
    sfx('card_pick');
    act('pickUpgrade', index);
  }
  function doReroll() {
    if (screen !== 'levelup' || levelPicked || !levelData || (levelData.rerolls | 0) <= 0) return;
    if (win.performance.now() < levelLockUntil) return;
    sfx('ui_click');
    act('reroll');
  }

  // ------------------------------------------------------------------ pause
  function renderPause(data) {
    if (data && data.settings) { settings = { ...DEFAULT_SETTINGS, ...data.settings }; }
    const ups = (data && data.upgrades) || lastUpgrades || [];
    let html = `<h3>Current build<small>${ups.length} upgrade${ups.length === 1 ? '' : 's'}</small></h3>`;
    if (!ups.length) html += `<div class="sz-build-empty">${icon('tornado')}<span>No upgrades yet. Go eat something.</span></div>`;
    else {
      html += '<div class="sz-build">';
      for (const u of ups) {
        const def = UPGRADES[u.id] || { name: u.id, max: 1, rarity: 0, desc: ['', ''] };
        html += `<div class="sz-build-row r${def.rarity}"><span class="sz-build-ico">${icon(u.id, '', def.icon)}</span><span class="sz-build-txt"><b>${esc(def.name)}</b><span>${esc(def.desc[0])}</span></span>${def.max > 1 ? pips(u.rank | 0, def.max) : '<span class="sz-build-mut">Mutation</span>'}</div>`;
      }
      html += '</div>';
    }
    ref.pauseBuild.innerHTML = html;
    syncSettings();
    setPauseView('main');
  }
  function setPauseView(view) {
    pauseView = view;
    ref.pauseBuild.classList.toggle('is-on', view === 'main');
    ref.pauseSettings.classList.toggle('is-on', view === 'settings');
  }

  // ------------------------------------------------------------------ results
  function renderResults(data) {
    const d = data || {};
    const tierIdx = Math.max(0, Math.min(TIERS.length - 1, d.tier | 0));
    const tier = TIERS[tierIdx];
    const win_ = !!d.win;
    screenEls.results.classList.toggle('is-win', win_);
    screenEls.results.classList.toggle('is-lose', !win_);
    const stats = d.stats || [];
    const unlocks = d.unlocks || [];
    const achs = (d.achievements || []).map((id) => (ACHIEVEMENTS[id] ? ACHIEVEMENTS[id].name : id));
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const body = win_
      ? `Officials confirm the experimental weather-control platform has been “returned to its component parts” by an ${tier.name} of unusual ambition. The storm declined to comment, being a storm.`
      : `After ${fmtTime(d.time)} of what experts are calling “a lot”, the ${tier.name} finally ran out of county. Residents are advised that roughly ${fmtNum(d.mass)} tonnes of their belongings are now elsewhere.`;
    const headline = String(d.headline || (win_ ? 'Weather wins' : 'Storm finally runs out of things to eat'));
    let rows = '';
    stats.forEach((s, i) => {
      const numeric = typeof s.value === 'number';
      rows += `<div class="sz-res-stat" style="--i:${i}"><span>${esc(s.label)}</span><b ${numeric ? `data-count="${s.value}" data-fmt="int"` : ''}>${numeric ? '0' : esc(s.value)}</b></div>`;
    });
    let chips = '';
    for (const u of unlocks) chips += `<span class="sz-chip sz-chip-unlock">${icon('lock')}${esc(u)}</span>`;
    for (const a of achs) chips += `<span class="sz-chip sz-chip-ach">${icon('trophy')}${esc(a)}</span>`;
    ref.results.innerHTML = `
<div class="sz-paper">
  <div class="sz-paper-top"><span>Extra edition</span><span>${esc(dateStr)}</span><span>Price: one cow</span></div>
  <div class="sz-paper-mast">The Daily Funnel</div>
  <div class="sz-paper-rule"><span>“All the weather that’s fit to print”</span></div>
  <h1 class="sz-paper-headline ${headline.length <= 34 ? 'len-s' : headline.length <= 62 ? '' : headline.length <= 90 ? 'len-m' : 'len-l'}">${esc(headline)}</h1>
  <div class="sz-paper-deck">${win_ ? '“We spent nine years building it,” says general, watching it leave.' : '“It just kept getting bigger,” says man formerly of house.'}</div>
  <div class="sz-paper-cols">
    <div class="sz-paper-photo">
      <div class="sz-paper-img">${icon('tornado')}<b>${tier.name}</b></div>
      <div class="sz-paper-cap">Artist’s impression of the suspect, “${esc(tier.title)}”.</div>
    </div>
    <div class="sz-paper-text"><p>${esc(body)}</p><div class="sz-paper-lines"><i></i><i></i><i></i><i></i><i></i></div></div>
  </div>
  ${d.best ? '<div class="sz-stamp">New record</div>' : ''}
</div>
<div class="sz-res-panel">
  <div class="sz-res-kicker ${win_ ? 'win' : 'lose'}">${icon(win_ ? 'trophy' : 'skull')}${win_ ? 'Victory' : 'Run over'}</div>
  <div class="sz-res-title">${esc(d.title || (win_ ? 'Weather wins' : 'Storm dissipated'))}</div>
  <div class="sz-res-score"><span class="sz-lbl">Final score</span><b data-count="${Math.round(d.score || 0)}" data-fmt="int" data-main>0</b>${d.best ? '<em>New record</em>' : ''}</div>
  <div class="sz-res-trio">
    <div>${icon('time')}<span class="sz-lbl">Time</span><b data-count="${Math.floor(d.time || 0)}" data-fmt="time">0:00</b></div>
    <div>${icon('tornado')}<span class="sz-lbl">Peak tier</span><b>${tier.name}<small>${esc(tier.title)}</small></b></div>
    <div>${icon('mass')}<span class="sz-lbl">Mass</span><b data-count="${Math.round(d.mass || 0)}" data-fmt="num">0</b></div>
  </div>
  <div class="sz-res-stats">${rows}</div>
  <div class="sz-res-chaos">${icon('chaosPt')}<div><span class="sz-lbl">Chaos Points earned</span><b>+<span data-count="${Math.round(d.chaos || 0)}" data-fmt="int">0</span></b></div><div class="sz-res-total"><span class="sz-lbl">Balance</span><b>${fmtInt(d.chaosTotal || 0)}</b></div></div>
  ${chips ? `<div class="sz-res-chips">${chips}</div>` : ''}
  <div class="sz-res-btns">
    ${btn('Play again', 'again', { cls: 'sz-btn-primary', icon: 'restart', key: 'again' })}
    ${btn('Upgrades', 'resUpgrades', { icon: 'up2', key: 'resup' })}
    ${btn('Menu', 'resMenu', { icon: 'home', key: 'resmenu' })}
  </div>
</div>`;
    resultsLockUntil = win.performance.now() + 500;
    startCountUp();
  }
  function stopCountUp(finish) {
    if (countRaf) { win.cancelAnimationFrame(countRaf); countRaf = 0; }
    if (finish && countDone) countDone();
    countDone = null;
  }
  function startCountUp() {
    stopCountUp(false);
    const els = Array.from(ref.results.querySelectorAll('[data-count]'));
    const targets = els.map((el) => +el.dataset.count || 0);
    const fmts = els.map((el) => (el.dataset.fmt === 'time' ? fmtTime : el.dataset.fmt === 'num' ? fmtNum : fmtInt));
    const t0 = win.performance.now() + 350;
    const DUR = 1100;
    const STAGGER = 90;
    const paint = (now) => {
      let done = true;
      for (let i = 0; i < els.length; i++) {
        const t = (now - t0 - i * STAGGER) / DUR;
        if (t < 1) done = false;
        els[i].textContent = fmts[i](countUp(targets[i], t));
      }
      return done;
    };
    countDone = () => { paint(Infinity); screenEls.results.classList.add('is-counted'); };
    screenEls.results.classList.remove('is-counted');
    const step = (now) => {
      if (destroyed || screen !== 'results') { countRaf = 0; return; }
      if (paint(now)) { countRaf = 0; const fin = countDone; countDone = null; if (fin) fin(); return; }
      countRaf = win.requestAnimationFrame(step);
    };
    countRaf = win.requestAnimationFrame(step);
  }

  // ------------------------------------------------------------------ modal
  function openModal(opts, onYes) {
    closeModal(true);
    modal = { onYes, prevFocus: doc.activeElement };
    ref.modal.innerHTML = `<div class="sz-modal-box ${opts.danger ? 'is-danger' : ''}" role="alertdialog" aria-label="${esc(opts.title)}">`
      + `<div class="sz-modal-ico">${icon(opts.icon || 'warning')}</div><h3>${esc(opts.title)}</h3><p>${esc(opts.text)}</p>`
      + `<div class="sz-modal-btns">${btn(opts.no || 'Cancel', 'modalNo', { key: 'modal-no', kbd: 'Esc' })}${btn(opts.yes || 'Confirm', 'modalYes', { cls: opts.danger ? 'sz-btn-danger' : 'sz-btn-primary', key: 'modal-yes' })}</div></div>`;
    ref.modal.classList.add('is-on');
    focusKey('modal-no', true);
  }
  function closeModal(silent) {
    if (!modal) return;
    const prev = modal.prevFocus;
    modal = null;
    ref.modal.classList.remove('is-on');
    if (!silent && prev && root.contains(prev)) focusEl(prev, true);
  }

  // ------------------------------------------------------------------ click handlers
  const handlers = {
    titleContinue() {
      if (screen !== 'title' || win.performance.now() < titleLockUntil) return;
      titleLockUntil = Infinity;
      sfx('ui_click');
      act('titleContinue');
    },
    tab(el) { sfx('ui_click'); showTab(el.dataset.tab); },
    quitApp() { sfx('ui_click'); openModal({ title: 'Quit STORMZILLA?', text: 'The county breathes a sigh of relief.', yes: 'Quit', icon: 'quit' }, () => act('quitApp')); },
    storm(el) { sfx('ui_click'); viewStorm(el.dataset.storm); },
    start(el) {
      if (!isUnlocked(STORMS[viewedStorm], save)) { sfx('ui_back'); animate(el, [{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 180 }); return; }
      sfx('ui_click');
      act('startRun', viewedStorm);
    },
    buyMeta(el) {
      const id = el.dataset.meta;
      const def = META[id];
      const rank = ((save && save.meta) || {})[id] | 0;
      if (!def || metaState(def, rank, (save && save.chaos) || 0) !== 'ok') {
        sfx('ui_back');
        animate(el, [{ transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'none' }], { duration: 180 });
        return;
      }
      sfx('ui_click');
      const res = act('buyMeta', id);
      if (res && typeof res === 'object' && res.meta && screen === 'menu') api.setScreen('menu', res);
    },
    setRow(el, ev) {
      const key = el.dataset.set;
      const row = SETTINGS_ROWS.find((r) => r.key === key);
      if (!row) return;
      if (row.type === 'toggle') { changeSetting(key, !settings[key]); sfx('ui_click'); }
      else if (row.type === 'seg') {
        const opt = ev && ev.target && ev.target.closest ? ev.target.closest('[data-opt]') : null;
        if (opt) changeSetting(key, opt.dataset.opt);
        else changeSetting(key, QUALITY_LEVELS[(QUALITY_LEVELS.indexOf(settings[key]) + 1) % QUALITY_LEVELS.length]);
        sfx('ui_click');
      }
    },
    askReset() {
      sfx('ui_click');
      openModal({ title: 'Reset all progress?', text: 'Chaos Points, permanent upgrades, records and achievements will be gone for good.', yes: 'Erase everything', danger: true, icon: 'trash' }, () => act('resetSave'));
    },
    modalNo() { sfx('ui_back'); closeModal(); },
    modalYes() { sfx('ui_click'); const m = modal; closeModal(); if (m && m.onYes) m.onYes(); },
    pick(el) { pickCard(+el.dataset.i); },
    reroll() { doReroll(); },
    resume() { sfx('ui_back'); act('resume'); },
    askRestart() { sfx('ui_click'); openModal({ title: 'Restart this run?', text: 'Your current storm and everything it ate will be lost.', yes: 'Restart', icon: 'restart' }, () => act('restart')); },
    askQuitMenu() { sfx('ui_click'); openModal({ title: 'Quit to menu?', text: 'Your current storm will dissipate. Chaos earned so far is kept.', yes: 'Quit to menu', icon: 'home' }, () => act('quitToMenu')); },
    pauseSettings() { sfx('ui_click'); setPauseView('settings'); focusKey('set:master', true); },
    pauseBack() { sfx('ui_back'); setPauseView('main'); focusKey('psettings', true); },
    again() { if (resultsBusy()) return; sfx('ui_click'); act('restart'); },
    resUpgrades() { if (resultsBusy()) return; sfx('ui_click'); pendingTab = 'upgrades'; act('quitToMenu'); },
    resMenu() { if (resultsBusy()) return; sfx('ui_click'); pendingTab = 'play'; act('quitToMenu'); },
    ability(el) { act('ability', el.dataset.ab); animate(el.querySelector('.sz-ab-bg'), [{ filter: 'brightness(2.2)' }, { filter: 'brightness(1)' }], { duration: 200 }); },
    hudPause() { if (screen === 'hud') { sfx('ui_click'); act('pause'); } },
  };
  function resultsBusy() {
    if (win.performance.now() < resultsLockUntil) return true;
    return false;
  }

  function onClick(ev) {
    if (destroyed) return;
    if (screen === 'results' && countDone) { stopCountUp(true); }
    const el = ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!el || !root.contains(el)) return;
    if (modal && !ref.modal.contains(el)) return;
    const fn = handlers[el.dataset.act];
    if (fn) fn(el, ev);
  }
  function onPointerMove(ev) {
    keyNav = false;
    if (dragRow) { sliderFromPointer(dragRow, ev); return; }
    const el = ev.target.closest ? ev.target.closest('[data-nav]') : null;
    if (el === lastHover) return;
    lastHover = el;
    if (!el || el.disabled) return;
    const scope = scopeEl();
    if (scope && scope.contains(el) && doc.activeElement !== el) focusEl(el);
  }
  function onPointerDown(ev) {
    const target = ev.target;
    if (!target.closest) return;
    if (target.closest('.sz-ab, .sz-pausebtn')) { ev.preventDefault(); return; } // HUD buttons never steal keyboard focus
    const track = target.closest('[data-slider]');
    if (track) {
      const row = track.closest('[data-set]');
      if (row) {
        dragRow = row;
        try { track.setPointerCapture(ev.pointerId); } catch (err) { /* ok */ }
        sliderFromPointer(row, ev);
        ev.preventDefault();
        focusEl(row, true);
      }
    }
  }
  function onPointerUp() {
    if (dragRow) { dragRow = null; sfx('ui_click'); }
  }
  function onFocusIn(ev) {
    const el = ev.target;
    if (!el || !el.dataset || el.dataset.nav == null) return;
    if (!quietFocus) sfx('ui_hover');
    if (keyNav && screen === 'menu' && !modal) {
      if (el.dataset.tab && el.dataset.tab !== menuTab) showTab(el.dataset.tab);
      else if (el.dataset.storm && el.dataset.storm !== viewedStorm) viewStorm(el.dataset.storm);
    }
  }
  const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
  function onKeyDown(ev) {
    if (destroyed || !screen || screen === 'hud' || screen === 'loading') return;
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    const code = ev.code;
    if (/^F\d+$/.test(code)) return;
    const eat = () => { ev.preventDefault(); ev.stopPropagation(); };
    if (screen === 'title') { eat(); if (!ev.repeat) handlers.titleContinue(); return; }
    if (screen === 'results' && countDone) { stopCountUp(true); if (code === 'Enter' || code === 'Space') { eat(); return; } }
    const dir = DIRS[code];
    if (dir) {
      eat();
      keyNav = true;
      const cur = doc.activeElement;
      if (cur && cur.dataset && cur.dataset.set && (dir === 'left' || dir === 'right') && scopeEl() && scopeEl().contains(cur)) { adjustSetting(cur, dir === 'left' ? -1 : 1); return; }
      moveFocus(dir);
      return;
    }
    if (code === 'Escape') {
      eat();
      if (ev.repeat) return;
      if (modal) { handlers.modalNo(); return; }
      if (screen === 'pause') { if (pauseView === 'settings') handlers.pauseBack(); else handlers.resume(); return; }
      if (screen === 'menu') {
        const cur = doc.activeElement;
        if (cur && !cur.closest('.sz-rail')) { sfx('ui_back'); keyNav = true; focusEl(tabEls[menuTab], true); }
        else if (menuTab !== 'play') { sfx('ui_back'); showTab('play'); focusEl(tabEls.play, true); }
      }
      return;
    }
    if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
      keyNav = true;
      const cur = doc.activeElement;
      const scope = scopeEl();
      if (!cur || !scope || !scope.contains(cur) || cur.dataset.nav == null) { eat(); focusDefault(); return; }
      if (cur.tagName !== 'BUTTON') { eat(); if (!ev.repeat) cur.click(); return; }
      if (ev.repeat) eat();
      ev.stopPropagation();
      return; // native button activation -> click
    }
    if (screen === 'levelup' && !modal) {
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
      if (m) { eat(); if (!ev.repeat) pickCard(+m[1] - 1); return; }
      if (code === 'KeyR') { eat(); if (!ev.repeat) doReroll(); return; }
    }
    if (code === 'Tab') { keyNav = true; return; }
  }
  function onKeyUp(ev) {
    if (destroyed || !screen || screen === 'hud' || screen === 'loading') return;
    if (ev.code === 'Escape' || DIRS[ev.code]) ev.stopPropagation();
  }
  root.addEventListener('click', onClick);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('focusin', onFocusIn);
  win.addEventListener('pointerup', onPointerUp);
  win.addEventListener('keydown', onKeyDown, true);
  win.addEventListener('keyup', onKeyUp, true);

  // ------------------------------------------------------------------ HUD (per-frame, diffed)
  const hc = {
    time: -1, tier: -1, tierFill: -1, mass: -1, level: -1, xpFill: -1, hp: -1, hpMax: -1, hpFill: -1, hpState: '',
    combo: -1, comboP: -1, comboCls: '', threat: -1, threatP: -1, dashCharges: -1, dashMax: -1, dashP: -1,
    ammo: -1, ammoMax: -1, ultP: -1, ultReady: null, score: -1, scoreShown: 0, chaos: -1, objective: null,
    boss: null, bossName: null, bossFill: -1, bossShield: -1, bossPct: -1, upHash: -1, fps: -1, showFps: null, frame: 0,
  };
  function setFill(el, key, frac) {
    const q = Math.round(clamp01(frac) * 400);
    if (hc[key] === q) return;
    hc[key] = q;
    el.style.transform = 'scaleX(' + q / 400 + ')';
  }
  function renderOwned(list) {
    let html = '';
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      const def = UPGRADES[u.id] || { name: u.id, max: 1, rarity: 0 };
      html += `<div class="sz-own r${def.rarity}" title="${esc(def.name)}">${icon(u.id, '', def.icon)}${def.max > 1 ? pips(u.rank | 0, def.max) : ''}</div>`;
    }
    ref.owned.innerHTML = html;
    ref.owned.classList.toggle('is-dense', list.length > 9);
  }
  let radarPx = 0;
  function drawRadar(r) {
    const ctx = radarCtx;
    const size = radarPx;
    if (!ctx || size < 8) return;
    const c = size / 2;
    const R = c - size * 0.06;
    const k = R / (r.range || 1);
    const b = r.blips;
    const n = b ? (r.n | 0) : 0;
    const s = size / 190;
    ctx.clearRect(0, 0, size, size);
    // food
    ctx.fillStyle = 'rgba(226,236,246,.78)';
    const fs = Math.max(1.5, 2.6 * s);
    for (let i = 0; i < n; i++) {
      if (b[i * 3 + 2] !== 0) continue;
      const px = b[i * 3] * k;
      const py = b[i * 3 + 1] * k;
      if (px * px + py * py > R * R) continue;
      ctx.fillRect(c + px - fs / 2, c + py - fs / 2, fs, fs);
    }
    // enemies, targets, boss (clamped to the rim when out of range)
    for (let i = 0; i < n; i++) {
      const type = b[i * 3 + 2];
      if (type === 0) continue;
      let px = b[i * 3] * k;
      let py = b[i * 3 + 1] * k;
      const d2 = px * px + py * py;
      if (d2 > R * R) {
        if (type === 1) continue;
        const f = R / Math.sqrt(d2);
        px *= f; py *= f;
      }
      const x = c + px;
      const y = c + py;
      if (type === 1) {
        ctx.fillStyle = '#ff4638';
        ctx.beginPath(); ctx.arc(x, y, 3.4 * s, 0, 6.2832); ctx.fill();
      } else if (type === 2) {
        const q = 5.5 * s;
        ctx.fillStyle = '#ffb400';
        ctx.beginPath(); ctx.moveTo(x, y - q); ctx.lineTo(x + q, y); ctx.lineTo(x, y + q); ctx.lineTo(x - q, y); ctx.closePath(); ctx.fill();
      } else {
        const pulse = 1 + 0.25 * Math.sin(hc.frame * 0.2);
        ctx.fillStyle = '#ff2a1c';
        ctx.beginPath(); ctx.arc(x, y, 5.5 * s, 0, 6.2832); ctx.fill();
        ctx.strokeStyle = 'rgba(255,90,70,.85)';
        ctx.lineWidth = 2 * s;
        ctx.beginPath(); ctx.arc(x, y, 9.5 * s * pulse, 0, 6.2832); ctx.stroke();
      }
    }
    // the storm: heading arrow (heading = atan2(dirX, dirZ); +z is down on the radar)
    const h = r.heading || 0;
    const sx = Math.sin(h);
    const sz = Math.cos(h);
    const a = 10 * s;
    ctx.fillStyle = '#3fe0ff';
    ctx.strokeStyle = '#041018';
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.moveTo(c + sx * a, c + sz * a);
    ctx.lineTo(c - sx * a * 0.7 - sz * a * 0.62, c - sz * a * 0.7 + sx * a * 0.62);
    ctx.lineTo(c - sx * a * 0.3, c - sz * a * 0.3);
    ctx.lineTo(c - sx * a * 0.7 + sz * a * 0.62, c - sz * a * 0.7 - sx * a * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function updateHud(h) {
    if (destroyed || !h) return;
    hc.frame++;
    // --- identity
    const tier = h.tier | 0;
    if (tier !== hc.tier) {
      const first = hc.tier < 0;
      hc.tier = tier;
      const t = TIERS[Math.max(0, Math.min(TIERS.length - 1, tier))];
      const nxt = TIERS[tier + 1];
      ref.tierName.textContent = t.name;
      ref.tierTitle.textContent = t.title;
      ref.tierNext.textContent = nxt ? 'Next ' + nxt.name + ' · ' + fmtNum(nxt.mass) : 'Maximum power';
      ref.hud.dataset.tier = tier;
      if (!first) animate(ref.tierBadge, [{ transform: 'skewX(-10deg) scale(1.7)', filter: 'brightness(2.4)' }, { transform: 'skewX(-10deg) scale(1)', filter: 'brightness(1)' }], { duration: 520, easing: 'cubic-bezier(.2,1.4,.3,1)' });
    }
    setFill(ref.tierFill, 'tierFill', h.tierFrac);
    const mass = Math.floor(h.mass);
    if (mass !== hc.mass) { hc.mass = mass; ref.mass.textContent = fmtNum(mass); }
    // --- integrity
    const hp = Math.ceil(h.hp);
    const hpMax = Math.ceil(h.hpMax) || 1;
    if (hp !== hc.hp) { hc.hp = hp; ref.hpNum.textContent = hp < 0 ? 0 : hp; }
    if (hpMax !== hc.hpMax) { hc.hpMax = hpMax; ref.hpMax.textContent = '/' + hpMax; }
    const hpFrac = clamp01(h.hp / hpMax);
    const hq = Math.round(hpFrac * 400);
    if (hq !== hc.hpFill) {
      hc.hpFill = hq;
      const tf = 'scaleX(' + hq / 400 + ')';
      ref.hpFill.style.transform = tf;
      ref.hpGhost.style.transform = tf;
      const state = hpFrac <= 0.25 ? 'crit' : hpFrac <= 0.5 ? 'warn' : 'ok';
      if (state !== hc.hpState) { hc.hpState = state; ref.hp.dataset.state = state; }
    }
    // --- xp / level
    setFill(ref.xpFill, 'xpFill', h.xpFrac);
    if (h.level !== hc.level) {
      const first = hc.level < 0;
      hc.level = h.level;
      ref.level.textContent = h.level;
      if (!first) animate(ref.level, POP_FRAMES, { duration: 360, easing: 'ease-out' });
    }
    // --- clock / score / chaos
    const sec = Math.floor(h.time);
    if (sec !== hc.time) { hc.time = sec; ref.time.textContent = fmtTime(sec); }
    const score = Math.floor(h.score);
    if (score !== hc.score) hc.score = score;
    if (hc.scoreShown !== score) {
      const diff = score - hc.scoreShown;
      hc.scoreShown = Math.abs(diff) < 3 ? score : hc.scoreShown + (diff > 0 ? Math.ceil(diff * 0.2) : Math.floor(diff * 0.2));
      ref.score.textContent = fmtInt(hc.scoreShown);
    }
    const chaos = Math.floor(h.chaos);
    if (chaos !== hc.chaos) {
      const first = hc.chaos < 0;
      hc.chaos = chaos;
      ref.chaos.textContent = fmtInt(chaos);
      if (!first) animate(ref.chaos, POP_FRAMES, { duration: 260, easing: 'ease-out' });
    }
    // --- threat
    const threat = h.threat | 0;
    if (threat !== hc.threat) {
      const up = hc.threat >= 0 && threat > hc.threat;
      hc.threat = threat;
      hc.threatP = -1;
      for (let i = 0; i < 5; i++) starEls[i].classList.toggle('on', i < threat);
      ref.threat.dataset.level = threat;
      if (up) {
        ref.threat.classList.remove('is-flash');
        void ref.threat.offsetWidth;
        ref.threat.classList.add('is-flash');
      }
    }
    const tp = threat >= 5 ? 0 : Math.round(clamp01(h.threatFrac) * 20);
    if (tp !== hc.threatP) {
      hc.threatP = tp;
      for (let i = 0; i < 5; i++) starFillEls[i].style.width = i < threat ? '100%' : i === threat ? tp * 5 + '%' : '0%';
    }
    // --- combo
    const combo = h.combo | 0;
    if (combo !== hc.combo) {
      const up = combo > hc.combo;
      hc.combo = combo;
      const show = combo > 1;
      const cls = !show ? '' : combo >= 30 ? 'is-on c3' : combo >= 10 ? 'is-on c2' : 'is-on c1';
      if (cls !== hc.comboCls) { hc.comboCls = cls; ref.combo.className = 'sz-combo ' + cls; }
      if (show) {
        ref.comboNum.textContent = combo;
        ref.combo.style.setProperty('--cs', 1 + Math.min(combo, 50) / 50 * 0.55);
        if (up) animate(ref.comboPop, [{ transform: 'scale(1.55) rotate(-6deg)' }, { transform: 'scale(1) rotate(0deg)' }], { duration: 240, easing: 'cubic-bezier(.2,1.6,.4,1)' });
      }
    }
    if (combo > 1) {
      const cp = Math.round(clamp01(h.comboFrac) * 100);
      if (cp !== hc.comboP) { hc.comboP = cp; ref.comboRing.style.setProperty('--p', cp); }
    }
    // --- abilities
    if (h.dashCharges !== hc.dashCharges || h.dashMax !== hc.dashMax) {
      hc.dashCharges = h.dashCharges; hc.dashMax = h.dashMax;
      let html = '';
      for (let i = 0; i < h.dashMax; i++) html += `<i class="${i < h.dashCharges ? 'on' : ''}"></i>`;
      ref.dashPips.innerHTML = html;
      ref.dashSweep.parentNode.classList.toggle('is-empty', h.dashCharges <= 0);
      hc.dashP = -1;
    }
    const dp = h.dashCharges >= h.dashMax ? 100 : Math.round(clamp01(h.dashFrac) * 100);
    if (dp !== hc.dashP) { hc.dashP = dp; ref.dashSweep.style.setProperty('--p', dp); }
    if (h.ammo !== hc.ammo || h.ammoMax !== hc.ammoMax) {
      hc.ammo = h.ammo; hc.ammoMax = h.ammoMax;
      ref.ammo.textContent = h.ammo;
      ref.ammo.parentNode.classList.toggle('is-empty', h.ammo <= 0);
      ref.ammo.parentNode.classList.toggle('is-full', h.ammo >= h.ammoMax && h.ammoMax > 0);
      ref.flingSweep.style.setProperty('--p', h.ammoMax > 0 ? Math.round(clamp01(h.ammo / h.ammoMax) * 100) : 0);
    }
    const up_ = Math.round(clamp01(h.ult) * 100);
    if (up_ !== hc.ultP) {
      hc.ultP = up_;
      ref.ultSweep.style.setProperty('--p', up_);
      const ready = up_ >= 100;
      if (ready !== hc.ultReady) { hc.ultReady = ready; ref.ultSweep.parentNode.classList.toggle('is-ready', ready); }
    }
    // --- objective
    if (h.objective !== hc.objective) {
      hc.objective = h.objective;
      ref.objectiveText.textContent = h.objective || '';
      ref.objective.classList.toggle('is-on', !!h.objective);
      if (h.objective) animate(ref.objective, [{ transform: 'translateY(-60%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1)' });
    }
    // --- boss
    const boss = h.boss;
    if (!!boss !== hc.boss) {
      hc.boss = !!boss;
      ref.boss.classList.toggle('is-on', hc.boss);
      hc.bossName = null; hc.bossFill = -1; hc.bossShield = -1; hc.bossPct = -1;
    }
    if (boss) {
      if (boss.name !== hc.bossName) { hc.bossName = boss.name; ref.bossName.textContent = boss.name; }
      const bf = clamp01(boss.hp / (boss.hpMax || 1));
      const bq = Math.round(bf * 600);
      if (bq !== hc.bossFill) {
        hc.bossFill = bq;
        const tf = 'scaleX(' + bq / 600 + ')';
        ref.bossFill.style.transform = tf;
        ref.bossGhost.style.transform = tf;
        const pct = Math.ceil(bf * 100);
        if (pct !== hc.bossPct) { hc.bossPct = pct; ref.bossPct.textContent = pct + '%'; }
      }
      const sq = Math.round(clamp01(boss.shield || 0) * 200);
      if (sq !== hc.bossShield) {
        const had = hc.bossShield > 0;
        hc.bossShield = sq;
        ref.bossShield.style.transform = 'scaleX(' + sq / 200 + ')';
        if (had !== sq > 0) ref.boss.classList.toggle('is-shielded', sq > 0);
      }
    }
    // --- owned upgrades
    const ups = h.upgrades;
    if (ups) {
      let hash = ups.length;
      for (let i = 0; i < ups.length; i++) hash = (hash * 31 + ups[i].rank * 7 + ups[i].id.length * 13 + ups[i].id.charCodeAt(0)) | 0;
      if (hash !== hc.upHash) { hc.upHash = hash; lastUpgrades = ups.map((u) => ({ id: u.id, rank: u.rank })); renderOwned(ups); }
    }
    // --- fps
    const showFps = !!h.showFps;
    if (showFps !== hc.showFps) { hc.showFps = showFps; ref.fps.classList.toggle('is-on', showFps); }
    if (showFps && (hc.frame & 15) === 0) {
      const fps = Math.round(h.fps);
      if (fps !== hc.fps) { hc.fps = fps; ref.fps.textContent = fps + ' FPS'; }
    }
    // --- radar (every other frame)
    if (h.radar && (hc.frame & 1) === 0) drawRadar(h.radar);
  }

  // ------------------------------------------------------------------ toasts / banners / news
  const bannerQueue = [];
  let bannerBusy = false;
  function nextBanner() {
    if (bannerBusy || !bannerQueue.length || destroyed) return;
    bannerBusy = true;
    const item = bannerQueue.shift();
    const text = String(item.text);
    let inner;
    if (item.kind === 'tier') {
      const parts = text.split(/\s+[—–-]\s+/);
      inner = `<div class="sz-banner-band"></div><div class="sz-banner-txt"><b>${esc(parts[0])}</b>${parts[1] ? `<span>${esc(parts.slice(1).join(' — '))}</span>` : ''}</div>`;
    } else {
      inner = `<div class="sz-banner-band"></div><div class="sz-banner-txt">${icon('warning')}<span>${esc(text)}</span>${icon('warning')}</div>`;
    }
    const el = make(`<div class="sz-banner k-${item.kind}">${inner}</div>`);
    ref.banners.appendChild(el);
    const dur = item.kind === 'tier' ? 2300 : 2200;
    later(() => { el.classList.add('is-out'); }, dur);
    later(() => { el.remove(); bannerBusy = false; nextBanner(); }, dur + 320);
  }
  const toastQueue = [];
  let toastLive = 0;
  function nextToast() {
    if (destroyed) return;
    while (toastLive < 3 && toastQueue.length) {
      const item = toastQueue.shift();
      toastLive++;
      const kind = TOAST_ICONS[item.kind] ? item.kind : 'info';
      const el = make(`<div class="sz-toast k-${kind}"><span class="sz-toast-ico">${icon(kind === 'unlock' ? 'check' : TOAST_ICONS[kind])}</span><span class="sz-toast-txt"><small>${TOAST_LABELS[kind]}</small><b>${esc(item.text)}</b></span></div>`);
      ref.toasts.appendChild(el);
      later(() => { el.classList.add('is-out'); }, 3600);
      later(() => { el.remove(); toastLive--; nextToast(); }, 3950);
    }
  }
  function toast(text, kind) {
    if (destroyed) return;
    if (kind === 'tier' || kind === 'warning') {
      bannerQueue.push({ text, kind });
      nextBanner();
    } else {
      toastQueue.push({ text, kind: kind || 'info' });
      nextToast();
    }
  }
  const newsQueue = [];
  let newsBusy = false;
  function nextNews() {
    if (newsBusy || !newsQueue.length || destroyed) return;
    newsBusy = true;
    let text = String(newsQueue.shift());
    text = text.replace(/^\s*BREAKING\s*:\s*/i, '');
    ref.newsText.textContent = text;
    ref.news.classList.add('is-on');
    later(() => { ref.news.classList.remove('is-on'); }, 4500);
    later(() => { newsBusy = false; nextNews(); }, 4950);
  }
  function news(text) {
    if (destroyed) return;
    if (newsQueue.length > 5) newsQueue.shift();
    newsQueue.push(text);
    nextNews();
  }

  // ------------------------------------------------------------------ popups / flash
  const popNodes = [];
  const popAnims = [];
  let popIndex = 0;
  for (let i = 0; i < POPUP_MAX; i++) {
    const node = doc.createElement('div');
    node.className = 'sz-pop';
    const inner = doc.createElement('span');
    node.appendChild(inner);
    ref.popups.appendChild(node);
    popNodes.push(node);
    popAnims.push(null);
  }
  function popup(xNorm, yNorm, text, kind) {
    if (destroyed) return;
    const i = popIndex;
    popIndex = (popIndex + 1) % POPUP_MAX;
    const node = popNodes[i];
    const inner = node.firstChild;
    node.className = 'sz-pop k-' + (kind || 'xp');
    inner.textContent = text;
    const jitter = ((i * 37) % 21 - 10) * unit;
    node.style.transform = 'translate3d(' + Math.round(xNorm * rootW + jitter) + 'px,' + Math.round(yNorm * rootH) + 'px,0)';
    if (popAnims[i]) popAnims[i].cancel();
    popAnims[i] = animate(inner, POPUP_FRAMES, { duration: kind === 'crit' || kind === 'chaos' ? 1150 : 850, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' });
  }
  let flashAnim = null;
  function flash(kind) {
    if (destroyed) return;
    const spec = FLASH_SPEC[kind] || FLASH_SPEC.hurt;
    ref.flash.className = 'sz-flash k-' + (FLASH_SPEC[kind] ? kind : 'hurt');
    if (flashAnim) flashAnim.cancel();
    flashAnim = animate(ref.flash, [{ opacity: spec[0] }, { opacity: 0 }], { duration: spec[1], easing: 'ease-out' });
  }
  function setLowHp(on) {
    root.classList.toggle('is-lowhp', !!on);
  }

  // ------------------------------------------------------------------ screens
  function setScreen(name, data) {
    if (destroyed) return;
    if (name !== 'hud' && SCREENS.indexOf(name) < 0) { console.warn('[ui] unknown screen', name); return; }
    const same = name === screen;
    const prevScreen = screen;
    let restoreKey = null;
    if (!same) {
      closeModal(true);
      stopCountUp(false);
      if (doc.activeElement && root.contains(doc.activeElement)) doc.activeElement.blur();
      lastHover = null;
    }
    screen = name;
    root.dataset.szScreen = name;
    if (name === 'loading') {
      const pr = clamp01(data && data.progress);
      ref.loadFill.style.transform = 'scaleX(' + pr + ')';
      ref.loadPct.textContent = Math.round(pr * 100) + '%';
      ref.loadText.textContent = (data && data.text) || 'Loading';
    } else if (name === 'title') {
      if (!same) titleLockUntil = win.performance.now() + 400;
    } else if (name === 'menu') {
      restoreKey = renderMenu(data);
      const tab = (data && data.tab) || pendingTab || (same ? menuTab : 'play');
      pendingTab = null;
      if (!same || tab !== menuTab) showTab(tab, same);
    } else if (name === 'levelup') {
      renderLevelUp(data);
    } else if (name === 'pause') {
      if (!same) renderPause(data);
    } else if (name === 'results') {
      renderResults(data);
    }
    root.dataset.screen = name;
    ref.hud.classList.toggle('is-on', !!HUD_SCREENS[name]);
    for (const id of SCREENS) screenEls[id].classList.toggle('is-on', id === name);
    if (!same && prevScreen && name !== 'hud' && name !== 'loading') sfx(name === 'levelup' ? '' : 'ui_click');
    if (name === 'hud' || name === 'loading' || name === 'title') return;
    if (same && restoreKey && focusKey(restoreKey, true)) return;
    if (name === 'menu' && !same && menuTab !== 'play') {
      const first = navList(pageEls[menuTab])[0];
      if (first) { focusEl(first, true); return; }
    }
    focusDefault(true);
  }

  function resize() {
    if (destroyed) return;
    rootW = root.clientWidth || win.innerWidth || 1600;
    rootH = root.clientHeight || win.innerHeight || 900;
    unit = uiUnit(rootW, rootH);
    root.style.setProperty('--u', unit + 'px');
    const dpr = Math.min(2, win.devicePixelRatio || 1);
    const px = Math.round(190 * unit * dpr);
    if (px !== radarPx) { radarPx = px; ref.radar.width = px; ref.radar.height = px; }
  }
  let observer = null;
  if (typeof win.ResizeObserver === 'function') { observer = new win.ResizeObserver(resize); observer.observe(root); }
  win.addEventListener('resize', resize);
  resize();

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    stopCountUp(false);
    for (const id of timers) win.clearTimeout(id);
    timers.clear();
    if (observer) observer.disconnect();
    root.removeEventListener('click', onClick);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('focusin', onFocusIn);
    win.removeEventListener('pointerup', onPointerUp);
    win.removeEventListener('keydown', onKeyDown, true);
    win.removeEventListener('keyup', onKeyUp, true);
    win.removeEventListener('resize', resize);
    root.innerHTML = '';
    root.classList.remove('sz-root', 'is-lowhp');
    root.style.removeProperty('--u');
    delete root.dataset.screen;
  }

  const api = { setScreen, updateHud, toast, news, popup, flash, setLowHp, resize, destroy };
  return api;
}
