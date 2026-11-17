// node --test tests/audio.test.js
// Node has no Web Audio, so the engine runs against a minimal fake AudioContext that records
// node creation and validates every scheduled time / value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio, SFX_NAMES, MUSIC_STATES } from '../src/audio/audio.js';

function makeFakeContext() {
  const ctx = {
    currentTime: 0,
    sampleRate: 8000, // small => fast noise-buffer generation
    state: 'running',
    created: {},
    connections: 0,
    disconnects: 0,
    violations: [],
    events: 0,
    destination: { fake: 'destination' },
  };
  const count = (kind) => { ctx.created[kind] = (ctx.created[kind] || 0) + 1; };
  const checkTime = (what, t) => {
    ctx.events++;
    if (!Number.isFinite(t)) ctx.violations.push(`${what}: time ${t}`);
    else if (t < ctx.currentTime - 1e-9) ctx.violations.push(`${what}: time ${t} is before now ${ctx.currentTime}`);
  };
  const checkVal = (what, v) => {
    if (!Number.isFinite(v)) ctx.violations.push(`${what}: value ${v}`);
  };
  const param = (name, value = 0) => {
    const p = { _v: value };
    Object.defineProperty(p, 'value', {
      get: () => p._v,
      set: (v) => { checkVal(`${name}.value`, v); p._v = v; },
    });
    p.setValueAtTime = (v, t) => { checkVal(`${name}.setValueAtTime`, v); checkTime(`${name}.setValueAtTime`, t); return p; };
    p.linearRampToValueAtTime = (v, t) => { checkVal(`${name}.linearRamp`, v); checkTime(`${name}.linearRamp`, t); return p; };
    p.exponentialRampToValueAtTime = (v, t) => {
      checkVal(`${name}.expRamp`, v);
      if (!(v > 0)) ctx.violations.push(`${name}.expRamp: non-positive target ${v}`);
      checkTime(`${name}.expRamp`, t);
      return p;
    };
    p.setTargetAtTime = (v, t, tc) => {
      checkVal(`${name}.setTarget`, v); checkTime(`${name}.setTarget`, t);
      if (!(tc > 0)) ctx.violations.push(`${name}.setTarget: bad timeConstant ${tc}`);
      return p;
    };
    p.cancelScheduledValues = (t) => { checkTime(`${name}.cancel`, t); return p; };
    return p;
  };
  const node = (kind, params = {}, extra = {}) => {
    count(kind);
    const n = { kind, ...extra };
    for (const [k, v] of Object.entries(params)) n[k] = param(`${kind}.${k}`, v);
    n.connect = (dest) => {
      if (dest === undefined || dest === null) ctx.violations.push(`${kind}.connect(${dest})`);
      ctx.connections++;
      return dest;
    };
    n.disconnect = () => { ctx.disconnects++; };
    return n;
  };
  const source = (kind, params) => node(kind, params, {
    start(t, off) {
      checkTime(`${kind}.start`, t === undefined ? ctx.currentTime : t);
      if (off !== undefined && !(off >= 0)) ctx.violations.push(`${kind}.start offset ${off}`);
    },
    stop(t) { checkTime(`${kind}.stop`, t); },
  });
  ctx.createGain = () => node('gain', { gain: 1 });
  ctx.createOscillator = () => source('osc', { frequency: 440, detune: 0 });
  ctx.createBufferSource = () => source('bufsrc', { playbackRate: 1, detune: 0 });
  ctx.createBiquadFilter = () => node('biquad', { frequency: 350, Q: 1, gain: 0, detune: 0 });
  ctx.createStereoPanner = () => node('panner', { pan: 0 });
  ctx.createWaveShaper = () => node('shaper');
  ctx.createConvolver = () => node('convolver');
  ctx.createDynamicsCompressor = () => node('compressor', { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 });
  ctx.createAnalyser = () => node('analyser', {}, { fftSize: 2048, getFloatTimeDomainData(a) { a.fill(0); } });
  ctx.createBuffer = (channels, length, sampleRate) => {
    count('buffer');
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c) => data[c] };
  };
  ctx.resume = () => { ctx.state = 'running'; return Promise.resolve(); };
  ctx.suspend = () => { ctx.state = 'suspended'; return Promise.resolve(); };
  ctx.total = () => Object.values(ctx.created).reduce((a, b) => a + b, 0);
  return ctx;
}

function ready() {
  const ctx = makeFakeContext();
  const audio = createAudio({ context: ctx, strict: true });
  audio.init();
  return { ctx, audio };
}

const EXPECTED = ('ui_hover ui_click ui_back card_show card_pick levelup tierup suck_small suck_big crunch_wood '
  + 'crunch_glass crunch_concrete crunch_metal collapse_small collapse_big explode explode_big nuke moo baa oink '
  + 'cluck neigh scream quack car_alarm honk siren gunfire shell_fire missile_fire missile_hit bomb_fall hit_taken '
  + 'lightning thunder hail dash fling fling_hit freeze shatter fire_whoosh shark cash combo_up combo_break warning '
  + 'boss_roar boss_charge boss_laser shield_down achievement low_hp heal news_jingle win lose').split(' ');

test('exports the complete SFX list from the brief', () => {
  assert.deepEqual([...SFX_NAMES].sort(), [...EXPECTED].sort());
  assert.equal(new Set(SFX_NAMES).size, SFX_NAMES.length);
});

test('API surface matches the contract', () => {
  const audio = createAudio();
  for (const k of ['init', 'setVolume', 'play', 'setStorm', 'setMusic', 'suspend', 'resume', 'isReady']) {
    assert.equal(typeof audio[k], 'function', k);
  }
});

test('every method is a silent no-op before init', () => {
  const ctx = makeFakeContext();
  const audio = createAudio({ context: ctx, strict: true });
  assert.equal(audio.isReady(), false);
  audio.setVolume({ master: 0.5 });
  audio.setVolume();
  for (const n of SFX_NAMES) audio.play(n, { vol: 1, pitch: 1.2, pan: 0.3, size: 0.8 });
  audio.play('nope');
  audio.setStorm({ size: 3, speed: 1, intensity: 1, fire: true, ice: true, electric: true, hp: 0.1 });
  for (const s of MUSIC_STATES) audio.setMusic(s, 0.5);
  audio.suspend();
  audio.resume();
  audio.pump(5);
  audio.tick();
  audio.getLevel();
  assert.equal(ctx.total(), 0, 'no nodes may be created before init');
  assert.equal(audio.isReady(), false);
});

test('without any AudioContext (plain Node) nothing throws', () => {
  const audio = createAudio();
  assert.equal(audio.init(), false);
  assert.equal(audio.isReady(), false);
  audio.play('moo');
  audio.setStorm({ size: 1 });
  audio.setMusic('menu', 1);
  audio.setVolume({ sfx: 0.2 });
  audio.suspend();
  audio.resume();
});

test('init is idempotent', () => {
  const { ctx, audio } = ready();
  assert.equal(audio.isReady(), true);
  const n = ctx.total();
  audio.init();
  audio.init();
  assert.equal(ctx.total(), n);
});

test('every SFX builds a graph without throwing, with sane times and values', () => {
  const { ctx, audio } = ready();
  ctx.currentTime = 1.2345;
  for (const name of SFX_NAMES) {
    for (const opts of [undefined, { vol: 0.5, pitch: 0.5, pan: -1, size: 0 }, { vol: 2, pitch: 2.5, pan: 1, size: 1 }]) {
      const before = ctx.total();
      ctx.currentTime += 1.7; // step past every rate-limit window
      assert.equal(audio.play(name, opts), true, `${name} should play`);
      assert.ok(ctx.total() > before, `${name} created no nodes`);
      assert.ok((ctx.created.osc || 0) + (ctx.created.bufsrc || 0) > 0);
    }
  }
  assert.deepEqual(ctx.violations, []);
});

test('unknown / garbage names and options are ignored', () => {
  const { ctx, audio } = ready();
  const n = ctx.total();
  for (const bad of ['nope', '', 'constructor', 'toString', '__proto__', null, undefined, 42, {}]) {
    assert.equal(audio.play(bad), false);
  }
  assert.equal(ctx.total(), n);
  ctx.currentTime = 5;
  assert.equal(audio.play('moo', { vol: NaN, pitch: 'x', pan: Infinity, size: -3 }), true);
  ctx.currentTime = 6;
  assert.equal(audio.play('moo', { vol: 0 }), false);
  assert.deepEqual(ctx.violations, []);
});

test('identical names are rate limited (~1 per 40 ms)', () => {
  const { ctx, audio } = ready();
  ctx.currentTime = 1;
  assert.equal(audio.play('crunch_wood'), true);
  assert.equal(audio.play('crunch_wood'), false);
  assert.equal(audio.play('crunch_glass'), true, 'other names are independent');
  ctx.currentTime = 1.02;
  assert.equal(audio.play('crunch_wood'), false);
  ctx.currentTime = 1.05;
  assert.equal(audio.play('crunch_wood'), true);
  let played = 0;
  for (let i = 0; i < 1000; i++) { ctx.currentTime = 2 + i * 0.001; if (audio.play('fling')) played++; }
  assert.ok(played >= 20 && played <= 26, `played ${played} in 1 s`);
});

test('voice limit: max 32 concurrent, quietest dropped, finished voices are disconnected', () => {
  const { ctx, audio } = ready();
  ctx.currentTime = 1;
  const long = ['nuke', 'collapse_big', 'thunder', 'boss_roar', 'tierup', 'explode_big'];
  let i = 0;
  while (audio.getStats().voices < 32 && i < 400) {
    ctx.currentTime += 0.0005;
    if (SFX_NAMES[i % SFX_NAMES.length] !== 'siren') audio.play(SFX_NAMES[i % SFX_NAMES.length], { vol: 0.6 });
    audio.play(long[i % long.length], { vol: 0.6 });
    i++;
  }
  assert.equal(audio.getStats().voices, 32);
  ctx.currentTime += 0.05;
  const nodes = ctx.total();
  assert.equal(audio.play('ui_hover', { vol: 0.05 }), false, 'a quieter newcomer is dropped');
  assert.equal(ctx.total(), nodes);
  assert.equal(audio.play('siren', { vol: 2, size: 1 }), true, 'a loud newcomer steals the quietest voice');
  assert.equal(audio.getStats().voices, 32);
  ctx.currentTime += 30;
  const d = ctx.disconnects;
  audio.play('ui_click');
  assert.equal(audio.getStats().voices, 1);
  assert.ok(ctx.disconnects >= d + 32);
  assert.deepEqual(ctx.violations, []);
});

test('heavy event spam stays bounded', () => {
  const { ctx, audio } = ready();
  for (let f = 0; f < 600; f++) { // 10 s at 60 fps, 30 events per frame
    ctx.currentTime = f / 60;
    for (let k = 0; k < 30; k++) audio.play(SFX_NAMES[(f * 7 + k * 13) % SFX_NAMES.length], { vol: Math.random(), size: Math.random() });
    assert.ok(audio.getStats().voices <= 32);
  }
  assert.deepEqual(ctx.violations, []);
});

test('setStorm accepts every combination and throttles automation', () => {
  const { ctx, audio } = ready();
  ctx.currentTime = 0.5;
  audio.setStorm({});
  audio.setStorm(null);
  audio.setStorm({ size: NaN, speed: 'fast', intensity: undefined, hp: null });
  const built = ctx.total();
  let maxPerCall = 0;
  for (let f = 0; f < 1200; f++) {
    ctx.currentTime = 1 + f / 120; // 120 fps
    const e = ctx.events;
    audio.setStorm({
      size: (f / 1200) * 6, speed: Math.random(), intensity: Math.random(),
      fire: f > 200, ice: f > 400 && f < 900, electric: f > 600, hp: 1 - f / 1200,
    });
    maxPerCall = Math.max(maxPerCall, ctx.events - e);
    audio.tick();
  }
  assert.ok(maxPerCall < 40, `one setStorm call scheduled ${maxPerCall} events`);
  audio.setStorm({ size: 6, speed: 1, intensity: 1, hp: 0.05 });
  const n = ctx.total();
  for (let f = 0; f < 100; f++) { ctx.currentTime += 0.001; audio.setStorm({ size: 6, speed: 1, intensity: 1, hp: 1 }); }
  assert.equal(ctx.total(), n, 'steady setStorm must not create nodes');
  assert.ok(ctx.total() - built < 2500);
  audio.setStorm({ off: true });
  assert.deepEqual(ctx.violations, []);
});

test('music: all states and transitions schedule cleanly on the audio clock', () => {
  const { ctx, audio } = ready();
  ctx.currentTime = 2;
  audio.setMusic('bogus', 0.5);
  audio.setMusic(undefined, NaN);
  assert.equal(audio.getStats().music, 'none');
  const order = ['menu', 'calm', 'action', 'boss', 'action', 'victory', 'menu', 'defeat', 'none', 'boss', 'none', 'calm'];
  for (const state of order) {
    audio.setMusic(state, Math.random());
    for (let k = 0; k < 150; k++) { // 6 s of 40 ms ticks
      ctx.currentTime += 0.04;
      audio.setMusic(state, (k % 50) / 50);
      audio.tick();
    }
    if (state !== 'victory' && state !== 'defeat') assert.equal(audio.getStats().music, state, `should have reached ${state}`);
  }
  assert.ok(ctx.created.osc > 500, 'music should have scheduled notes');
  assert.deepEqual(ctx.violations, []);
});

test('music: stingers end in silence and are not retriggered by repeated calls', () => {
  const { ctx, audio } = ready();
  ctx.currentTime = 1;
  for (const st of ['victory', 'defeat']) {
    audio.setMusic(st, 1);
    for (let k = 0; k < 400; k++) { ctx.currentTime += 0.04; audio.setMusic(st, 1); audio.tick(); }
    assert.equal(audio.getStats().music, 'none', `${st} should finish`);
    const n = ctx.created.osc;
    for (let k = 0; k < 100; k++) { ctx.currentTime += 0.04; audio.setMusic(st, 1); audio.tick(); }
    assert.equal(ctx.created.osc, n, 'silence after the stinger');
  }
  assert.deepEqual(ctx.violations, []);
});

test('music: survives tab stutter without late notes or catch-up bursts', () => {
  const { ctx, audio } = ready();
  ctx.currentTime = 1;
  audio.setMusic('action', 1);
  for (let k = 0; k < 50; k++) { ctx.currentTime += 0.04; audio.tick(); }
  const perTick = [];
  for (const jump of [0.5, 3, 12, 0.04, 0.04, 7.77, 0.04]) {
    ctx.currentTime += jump;
    const n = ctx.total();
    audio.tick();
    perTick.push(ctx.total() - n);
  }
  // one tick may schedule at most the lookahead horizon (<= 1.5 s), never the whole gap
  assert.ok(Math.max(...perTick) < 1500, `burst of ${Math.max(...perTick)} nodes`);
  assert.deepEqual(ctx.violations, []);
});

test('offline-style pump() schedules ahead; suspend/resume/setVolume do not throw', () => {
  const { ctx, audio } = ready();
  audio.setMusic('boss', 1);
  audio.setStorm({ size: 4, speed: 0.5, intensity: 0.5, hp: 0.1 });
  const n = ctx.total();
  audio.pump(20);
  assert.ok(ctx.total() > n + 1000);
  audio.setVolume({ master: 0.5 });
  audio.setVolume({ music: 2, sfx: -1, master: NaN });
  audio.suspend();
  assert.equal(ctx.state, 'suspended');
  audio.tick();
  audio.resume();
  assert.equal(ctx.state, 'running');
  audio.suspend();
  assert.deepEqual(ctx.violations, []);
});
