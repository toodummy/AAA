// Soundboard for the STORMZILLA audio engine (served by Vite: /tools/audio.html).
import { createAudio, SFX_NAMES, MUSIC_STATES } from '../src/audio/audio.js';

const audio = createAudio();
window.audio = audio; // poke at it from the console
const $ = (id) => document.getElementById(id);
const start = () => audio.init();
window.addEventListener('pointerdown', start, true);
window.addEventListener('keydown', start, true);

function slider(parent, label, min, max, value, step, onChange) {
  const row = document.createElement('div');
  row.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  const input = document.createElement('input');
  Object.assign(input, { type: 'range', min, max, step, value });
  const out = document.createElement('output');
  const upd = () => { out.textContent = (+input.value).toFixed(2); onChange(+input.value); };
  input.addEventListener('input', upd);
  row.append(l, input, out);
  parent.append(row);
  upd();
  return input;
}

// ---- volume -----------------------------------------------------------------------------------
for (const k of ['master', 'music', 'sfx']) {
  slider($('volume'), k, 0, 1, { master: 0.9, music: 0.7, sfx: 0.9 }[k], 0.01, (v) => audio.setVolume({ [k]: v }));
}
$('pause').onclick = () => audio.suspend();
$('resume').onclick = () => audio.resume();

// ---- sfx --------------------------------------------------------------------------------------
const opts = { vol: 1, pitch: 1, pan: 0, size: 0.5 };
slider($('sfxopts'), 'vol', 0, 2, 1, 0.01, (v) => { opts.vol = v; });
slider($('sfxopts'), 'pitch', 0.5, 2, 1, 0.01, (v) => { opts.pitch = v; });
slider($('sfxopts'), 'pan', -1, 1, 0, 0.01, (v) => { opts.pan = v; });
slider($('sfxopts'), 'size', 0, 1, 0.5, 0.01, (v) => { opts.size = v; });

const GROUPS = {
  UI: ['ui_hover', 'ui_click', 'ui_back', 'card_show', 'card_pick', 'levelup', 'tierup', 'achievement', 'cash', 'combo_up',
    'combo_break', 'news_jingle', 'win', 'lose', 'heal', 'low_hp', 'warning'],
  Destruction: ['suck_small', 'suck_big', 'crunch_wood', 'crunch_glass', 'crunch_concrete', 'crunch_metal', 'collapse_small',
    'collapse_big', 'explode', 'explode_big', 'nuke'],
  Creatures: ['moo', 'baa', 'oink', 'cluck', 'neigh', 'scream', 'quack', 'shark'],
  Enemies: ['car_alarm', 'honk', 'siren', 'gunfire', 'shell_fire', 'missile_fire', 'missile_hit', 'bomb_fall', 'hit_taken',
    'boss_roar', 'boss_charge', 'boss_laser', 'shield_down'],
  Storm: ['lightning', 'thunder', 'hail', 'dash', 'fling', 'fling_hit', 'freeze', 'shatter', 'fire_whoosh'],
};
const grouped = new Set(Object.values(GROUPS).flat());
GROUPS.Other = SFX_NAMES.filter((n) => !grouped.has(n));
for (const [title, names] of Object.entries(GROUPS)) {
  if (!names.length) continue;
  const h = document.createElement('div');
  h.className = 'hint';
  h.style.margin = '10px 0 4px';
  h.textContent = title;
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const name of names) {
    const b = document.createElement('button');
    b.textContent = name;
    b.onclick = () => { audio.init(); audio.play(name, { ...opts }); };
    grid.append(b);
  }
  $('sfx').append(h, grid);
}

$('spam').onclick = () => {
  const names = ['crunch_wood', 'crunch_glass', 'crunch_concrete', 'crunch_metal', 'suck_small', 'suck_big', 'collapse_small',
    'explode', 'moo', 'scream', 'fling', 'fling_hit', 'cash', 'honk', 'car_alarm'];
  const t0 = performance.now();
  const id = setInterval(() => {
    for (let i = 0; i < 12; i++) {
      audio.play(names[(Math.random() * names.length) | 0], {
        vol: 0.3 + Math.random() * 0.7, pan: Math.random() * 2 - 1, size: Math.random(), pitch: 0.9 + Math.random() * 0.2,
      });
    }
    if (performance.now() - t0 > 5000) clearInterval(id);
  }, 16);
};
$('combo').onclick = () => {
  for (let i = 0; i < 12; i++) setTimeout(() => audio.play('combo_up', { pitch: 1 + i * 0.08 }), i * 110);
  setTimeout(() => audio.play('combo_break'), 12 * 110 + 250);
};

// ---- storm ------------------------------------------------------------------------------------
const storm = { on: false, size: 1, speed: 0.4, intensity: 0.3, hp: 1, fire: false, ice: false, electric: false };
slider($('storm'), 'size (0-6)', 0, 6, storm.size, 0.01, (v) => { storm.size = v; });
slider($('storm'), 'speed', 0, 1, storm.speed, 0.01, (v) => { storm.speed = v; });
slider($('storm'), 'intensity', 0, 1, storm.intensity, 0.01, (v) => { storm.intensity = v; });
slider($('storm'), 'hp', 0, 1, storm.hp, 0.01, (v) => { storm.hp = v; });
for (const k of ['on', 'fire', 'ice', 'electric']) {
  const b = document.createElement('button');
  b.textContent = k === 'on' ? 'STORM ON/OFF' : k;
  b.onclick = () => { storm[k] = !storm[k]; b.classList.toggle('on', storm[k]); };
  $('stormflags').append(b);
}

// ---- music ------------------------------------------------------------------------------------
const music = { state: 'none', intensity: 0.5 };
const musicButtons = {};
for (const s of MUSIC_STATES) {
  const b = document.createElement('button');
  b.textContent = s;
  b.onclick = () => { music.state = s; };
  musicButtons[s] = b;
  $('music').append(b);
}
slider($('musicopts'), 'intensity', 0, 1, 0.5, 0.01, (v) => { music.intensity = v; });

// ---- frame loop: drives setStorm / setMusic like the game would, plus the live meter ----------
const scope = $('scope');
const g2 = scope.getContext('2d');
let peakHold = 0;
let x = 0;
function frame() {
  if (audio.isReady()) {
    audio.setStorm(storm.on ? storm : { off: true });
    audio.setMusic(music.state, music.intensity);
    const { peak, rms } = audio.getLevel();
    peakHold = Math.max(peak, peakHold * 0.97);
    const db = (v) => (v > 1e-5 ? 20 * Math.log10(v) : -100);
    const pos = (v) => `${Math.max(0, Math.min(100, ((db(v) + 60) / 60) * 100))}%`;
    $('rms').style.width = pos(rms);
    $('peak').style.left = pos(peakHold);
    const st = audio.getStats();
    $('read').textContent = `peak ${db(peakHold).toFixed(1)} dB  rms ${db(rms).toFixed(1)} dB  voices ${st.voices}  `
      + `music ${st.music} ${st.bar + 1}:${st.step + 1}`;
    for (const s of MUSIC_STATES) musicButtons[s].classList.toggle('on', st.music === s);
    // scrolling level history
    g2.fillStyle = '#0c0f15';
    g2.fillRect(x, 0, 2, 70);
    g2.fillStyle = peak > 0.97 ? '#e5533d' : '#f0b541';
    g2.fillRect(x, 70 - peak * 70, 2, peak * 70);
    g2.fillStyle = '#3fbf7f';
    g2.fillRect(x, 70 - rms * 70, 2, rms * 70);
    x = (x + 2) % scope.width;
    g2.fillStyle = '#ffffff';
    g2.fillRect(x, 0, 1, 70);
  }
  requestAnimationFrame(frame);
}
frame();
