// STORMZILLA procedural audio engine.
// Everything is synthesised with the Web Audio API - no samples, no assets, no dependencies.
//
//   const audio = createAudio();
//   window.addEventListener('pointerdown', () => audio.init(), { once: true });
//   audio.play('moo', { size: 0.8, pan: -0.3 });
//   audio.setStorm({ size, speed, intensity, fire, ice, electric, hp });   // every frame
//   audio.setMusic('action', 0.7);
//
// createAudio({ context }) accepts any BaseAudioContext (e.g. an OfflineAudioContext) so the
// very same graph can be rendered offline; in that case call audio.pump(seconds) to schedule
// music/heartbeat ahead of time, because there is no realtime clock driving the scheduler.

export const SFX_NAMES = [
  'ui_hover', 'ui_click', 'ui_back', 'card_show', 'card_pick', 'levelup', 'tierup',
  'suck_small', 'suck_big', 'crunch_wood', 'crunch_glass', 'crunch_concrete', 'crunch_metal',
  'collapse_small', 'collapse_big', 'explode', 'explode_big', 'nuke',
  'moo', 'baa', 'oink', 'cluck', 'neigh', 'scream', 'quack',
  'car_alarm', 'honk', 'siren', 'gunfire', 'shell_fire', 'missile_fire', 'missile_hit', 'bomb_fall',
  'hit_taken', 'lightning', 'thunder', 'hail', 'dash', 'fling', 'fling_hit', 'freeze', 'shatter',
  'fire_whoosh', 'shark', 'cash', 'combo_up', 'combo_break', 'warning',
  'boss_roar', 'boss_charge', 'boss_laser', 'shield_down', 'achievement', 'low_hp', 'heal',
  'news_jingle', 'win', 'lose',
];

export const MUSIC_STATES = ['none', 'menu', 'calm', 'action', 'boss', 'victory', 'defeat'];

const MAX_VOICES = 32;
const DEFAULT_GAP = 0.04; // seconds between two plays of the same SFX name

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const num = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const rnd = (a, b) => a + Math.random() * (b - a);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const fq = (f) => clamp(f, 8, 18000);
const smooth = (x, a, b) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------
// Score data (shared key: D minor; action/calm 126 bpm, menu/defeat 84 bpm (2/3), boss 152 in 7/8)
// ---------------------------------------------------------------------------------------------
// 8-bar progression: Dm Dm Bb A | Gm Gm Eb A
const PROG = [
  { r: 38, ch: [62, 65, 69] }, { r: 38, ch: [62, 65, 69] },
  { r: 34, ch: [58, 62, 65] }, { r: 33, ch: [57, 61, 64] },
  { r: 31, ch: [55, 58, 62] }, { r: 31, ch: [55, 58, 62] },
  { r: 39, ch: [58, 63, 67] }, { r: 33, ch: [57, 61, 64] },
];
// The hook: [step(16ths), midi, length(steps)] per bar. Slightly mischievous (grace notes, Neapolitan bar).
const HOOK = [
  [[0, 74, 3], [4, 77, 2], [6, 76, 2], [8, 74, 3], [12, 69, 4]],
  [[0, 75, 1], [1, 74, 5], [8, 69, 2], [10, 70, 2], [12, 69, 4]],
  [[0, 70, 3], [4, 74, 2], [6, 72, 2], [8, 70, 3], [12, 65, 4]],
  [[0, 69, 2], [2, 73, 2], [4, 76, 4], [8, 73, 2], [10, 69, 6]],
  [[0, 67, 3], [4, 70, 2], [6, 69, 2], [8, 67, 3], [12, 74, 4]],
  [[0, 77, 1], [1, 76, 5], [8, 74, 2], [10, 76, 2], [12, 77, 4]],
  [[0, 75, 3], [4, 79, 2], [6, 77, 2], [8, 75, 3], [12, 70, 4]],
  [[0, 69, 2], [2, 73, 2], [4, 76, 2], [6, 79, 2], [8, 82, 2], [10, 81, 6]],
];
const OST = [0, 0, 3, 0, 0, 2, 0, 3, 0, 0, 3, 0, 1, 0, 2, 3]; // index into [root, third, fifth, octave]
const STR_STEPS = [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0];
// Boss: 7/8 (14 sixteenths, grouped 4+4+6), D phrygian riff
const BPROG = [
  { r: 38, ch: [62, 65, 69] }, { r: 38, ch: [62, 65, 69] }, { r: 39, ch: [63, 67, 70] }, { r: 38, ch: [62, 65, 69] },
  { r: 38, ch: [62, 65, 69] }, { r: 38, ch: [62, 65, 69] }, { r: 34, ch: [58, 62, 65] }, { r: 33, ch: [57, 61, 64] },
];
const RIFF = [0, 0, 12, 0, 0, 0, 12, 0, 0, 12, 13, 12, 10, 7];

export function createAudio(options = {}) {
  const strict = !!options.strict; // tests: rethrow internal errors instead of swallowing them
  let ctx = options.context || null;
  let ready = false;
  let offline = false;
  let paused = false;
  let timer = null;
  let lastTick = 0;
  let tickGap = 0.05;

  const vol = { master: 0.9, music: 0.7, sfx: 0.9 };
  let N = null; // graph nodes
  let buffers = null;
  const curves = new Map();
  const voices = []; // active SFX voices
  const tails = []; // finished-soon music notes / stolen voices awaiting disconnect
  const lastPlay = new Map();
  let storm = null;
  let stormOn = false;
  let lastStormApply = -1;
  const hb = { on: false, next: 0, bpm: 90, level: 0 };
  const M = {
    name: 'none', want: 'none', asked: 'none', cur: null,
    bar: 0, step: 0, next: 0, bus: 0, inten: 0.5,
  };

  const guard = (fn, fallback) => (...args) => {
    if (!ready) return fallback;
    try {
      return fn(...args);
    } catch (err) {
      if (strict) throw err;
      return fallback;
    }
  };

  // -------------------------------------------------------------------------------------------
  // Graph
  // -------------------------------------------------------------------------------------------
  function shaperCurve(drive) {
    let c = curves.get(drive);
    if (!c) {
      const n = 1024;
      c = new Float32Array(n);
      const k = Math.tanh(drive);
      for (let i = 0; i < n; i++) c[i] = Math.tanh(drive * ((i / (n - 1)) * 2 - 1)) / k;
      curves.set(drive, c);
    }
    return c;
  }

  function makeBuffers() {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 3);
    const xf = Math.floor(sr * 0.05);
    const total = len + xf;
    const gen = {
      white: () => () => Math.random() * 2 - 1,
      pink: () => {
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        return () => {
          const w = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          const o = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
          return o;
        };
      },
      brown: () => {
        let last = 0;
        return () => {
          last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
          return last * 3.5;
        };
      },
      crackle: () => {
        let e = 0;
        const decay = Math.exp(-1 / (0.0025 * sr));
        const p = 42 / sr;
        return () => {
          if (Math.random() < p) e = Math.max(e, 0.25 + 0.75 * Math.random() * Math.random());
          e *= decay;
          return e * (Math.random() * 2 - 1);
        };
      },
    };
    const out = {};
    for (const kind of Object.keys(gen)) {
      const f = gen[kind]();
      const tmp = new Float32Array(total);
      for (let i = 0; i < total; i++) tmp[i] = f();
      const buf = ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = tmp[i];
      for (let i = 0; i < xf; i++) { // seamless loop
        const k = i / xf;
        d[i] = tmp[i] * k + tmp[len + i] * (1 - k);
      }
      out[kind] = buf;
    }
    return out;
  }

  function makeImpulse() {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 2.3);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const a = Math.min(1, t / 0.004) * Math.exp(-t * 3.1);
        const k = 0.75 * Math.exp(-t * 1.6) + 0.05; // gets darker over time
        lp += k * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * a;
      }
    }
    return buf;
  }

  function build() {
    buffers = makeBuffers();
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    N = {};
    N.pre = g(1);
    N.master = g(vol.master);
    N.comp = ctx.createDynamicsCompressor();
    N.comp.threshold.value = -14;
    N.comp.knee.value = 8;
    N.comp.ratio.value = 12;
    N.comp.attack.value = 0.003;
    N.comp.release.value = 0.22;
    N.trim = g(0.5);
    // final safety soft-clipper: linear to 0.8, then squashes; never exceeds 0.98
    N.clip = ctx.createWaveShaper();
    const cn = 4096;
    const cc = new Float32Array(cn);
    for (let i = 0; i < cn; i++) {
      const x = ((i / (cn - 1)) * 2 - 1) * 2; // input is pre-scaled by 0.5, so x spans -2..2
      const ax = Math.abs(x);
      const y = ax < 0.8 ? ax : 0.8 + 0.18 * Math.tanh((ax - 0.8) / 0.18);
      cc[i] = Math.sign(x) * y;
    }
    N.clip.curve = cc;
    N.pre.connect(N.master); N.master.connect(N.comp); N.comp.connect(N.trim); N.trim.connect(N.clip);
    N.clip.connect(ctx.destination);
    if (ctx.createAnalyser) {
      N.analyser = ctx.createAnalyser();
      N.analyser.fftSize = 1024;
      N.clip.connect(N.analyser);
      N.meterBuf = new Float32Array(1024);
    }

    N.musicBus = g(vol.music);
    N.duck = g(1);
    N.layer = [g(0), g(0)];
    N.layer[0].connect(N.musicBus); N.layer[1].connect(N.musicBus);
    N.musicBus.connect(N.duck); N.duck.connect(N.pre);
    N.sfxBus = g(vol.sfx);
    N.sfxBus.connect(N.pre);
    N.stormBus = g(vol.sfx);
    N.stormBus.connect(N.pre);

    N.reverb = ctx.createConvolver();
    N.reverb.buffer = makeImpulse();
    N.reverbOut = g(0.9);
    N.reverb.connect(N.reverbOut); N.reverbOut.connect(N.pre);
    N.mSend = g(0.3); N.musicBus.connect(N.mSend); N.mSend.connect(N.reverb);
    N.sSend = g(0.1); N.sfxBus.connect(N.sSend); N.sSend.connect(N.reverb);
  }

  // -------------------------------------------------------------------------------------------
  // Synth kit. `o` is a voice/note descriptor: { t, f, ff, ln, out, end }.
  // -------------------------------------------------------------------------------------------
  function env(param, t, pts) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let v = p[1];
      const mode = p[2];
      const nextExp = i + 1 < pts.length && pts[i + 1][2] === 'e';
      if (mode === 'e' || nextExp) v = Math.max(v, 1e-4);
      const tt = t + p[0];
      if (i === 0 || mode === 's') param.setValueAtTime(v, tt);
      else if (mode === 'e') param.exponentialRampToValueAtTime(v, tt);
      else param.linearRampToValueAtTime(v, tt);
    }
  }
  function setF(param, t0, f, f1, dur, mul) {
    if (Array.isArray(f)) env(param, t0, f.map((p) => [p[0], fq(p[1] * mul), p[2] || 'e']));
    else {
      param.setValueAtTime(fq(f * mul), t0);
      if (f1) param.exponentialRampToValueAtTime(fq(f1 * mul), t0 + dur);
    }
  }
  function setG(param, t0, c, dur, v) {
    if (c.ev) {
      const pts = c.ev.map((p) => [p[0], p[1] * v, p[2]]);
      if (pts[pts.length - 1][0] < dur - 1e-5) pts.push([dur, 0]);
      env(param, t0, pts);
    } else {
      const a = c.a ?? 0.004;
      const hold = c.hold || 0;
      param.setValueAtTime(0, t0);
      param.linearRampToValueAtTime(v, t0 + a);
      if (hold) param.setValueAtTime(v, t0 + a + hold);
      param.exponentialRampToValueAtTime(Math.max(v * 0.001, 1e-5), t0 + dur);
      param.setValueAtTime(0, t0 + dur + 0.001);
    }
  }
  function G(o, v, dest) {
    const n = ctx.createGain();
    n.gain.value = v;
    n.connect(dest || o.out);
    return n;
  }
  function F(o, type, f, q, dest) {
    const n = ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = fq(f * o.f);
    n.Q.value = q ?? 0.7;
    n.connect(dest || o.out);
    return n;
  }
  function SH(o, drive, dest) {
    const n = ctx.createWaveShaper();
    n.curve = shaperCurve(drive);
    n.connect(dest || o.out);
    return n;
  }
  // oscillator with pitch + amplitude envelope
  function tone(o, c) {
    const t0 = o.t + (c.t || 0);
    const a = c.a ?? 0.004;
    const dur = Math.max(c.dur ?? 0.2, c.ev ? 0.01 : a + (c.hold || 0) + 0.01);
    const osc = ctx.createOscillator();
    osc.type = c.type || 'sine';
    setF(osc.frequency, t0, c.f, c.f1, c.ft || dur, o.f);
    if (c.det) osc.detune.value = c.det;
    let g = null;
    if (c.raw) osc.connect(c.dest || o.out);
    else {
      g = ctx.createGain();
      setG(g.gain, t0, c, dur, c.vol ?? 1);
      osc.connect(g);
      g.connect(c.dest || o.out);
    }
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    if (t0 + dur > o.end) o.end = t0 + dur;
    return { osc, g };
  }
  // filtered noise burst
  function noise(o, c) {
    const t0 = o.t + (c.t || 0);
    const a = c.a ?? 0.003;
    const dur = Math.max(c.dur ?? 0.2, c.ev ? 0.01 : a + (c.hold || 0) + 0.01);
    const src = ctx.createBufferSource();
    const buf = buffers[c.kind || 'white'];
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = c.rate || 1;
    const g = ctx.createGain();
    setG(g.gain, t0, c, dur, c.vol ?? 1);
    let flt = null;
    const type = c.type === undefined ? 'lowpass' : c.type;
    if (type) {
      flt = ctx.createBiquadFilter();
      flt.type = type;
      flt.Q.value = c.q ?? 0.7;
      setF(flt.frequency, t0, c.f ?? 1000, c.f1, dur, o.f);
      src.connect(flt);
      flt.connect(g);
    } else src.connect(g);
    g.connect(c.dest || o.out);
    src.start(t0, Math.random() * (buf.duration - 0.2));
    src.stop(t0 + dur + 0.02);
    if (t0 + dur > o.end) o.end = t0 + dur;
    return { src, flt, g };
  }
  function lfo(o, c) {
    const t0 = o.t + (c.t || 0);
    const osc = ctx.createOscillator();
    osc.type = c.type || 'sine';
    setF(osc.frequency, t0, c.f, c.f1, c.dur, 1);
    const g = ctx.createGain();
    g.gain.value = c.depth;
    osc.connect(g);
    g.connect(c.target);
    osc.start(t0);
    osc.stop(t0 + c.dur + 0.02);
    return osc;
  }
  // parallel band-pass formant bank; formants = [[freq | pts, q, gain], ...]
  function bank(o, formants, dest, t0) {
    const input = ctx.createGain();
    const filters = [];
    for (const [f, q, gn] of formants) {
      const b = ctx.createBiquadFilter();
      b.type = 'bandpass';
      b.Q.value = q;
      if (Array.isArray(f)) setF(b.frequency, t0 ?? o.t, f, 0, 0, o.ff);
      else b.frequency.value = fq(f * o.ff);
      const g = ctx.createGain();
      g.gain.value = gn;
      input.connect(b); b.connect(g); g.connect(dest || o.out);
      filters.push(b);
    }
    return { in: input, filters };
  }
  // vocal-ish source: glottal saw -> formants, with vibrato / tremolo / chest body
  function vox(o, c) {
    const t = c.t || 0;
    const t0 = o.t + t;
    const dur = c.dur;
    const g = G(o, 0, c.dest);
    setG(g.gain, t0, { ev: c.ev || [[0, 0], [0.015, 1], [dur * 0.7, 0.9], [dur, 0]] }, dur, c.vol ?? 1);
    let dest = g;
    if (c.trem) {
      const tg = G(o, 1 - c.trem[1] / 2, g);
      lfo(o, { f: c.trem[0], depth: c.trem[1] / 2, t, dur, target: tg.gain, type: c.trem[2] || 'sine' });
      dest = tg;
    }
    const b = bank(o, c.fm, dest, t0);
    const src = tone(o, { type: c.type || 'sawtooth', f: c.f, t, dur, raw: true, dest: b.in });
    if (c.vib) lfo(o, { f: c.vib[0], depth: c.vib[1] * o.f, t, dur, target: src.osc.frequency });
    if (c.body) {
      const lp = F(o, 'lowpass', c.bodyF || 300, 0.7, G(o, c.body, dest));
      src.osc.connect(lp);
    }
    if (c.sub) {
      const sg = G(o, c.sub, b.in);
      tone(o, { type: 'square', f: c.f.map((p) => [p[0], p[1] / 2, p[2]]), t, dur, raw: true, dest: sg });
    }
    if (c.breath) noise(o, { kind: 'pink', type: null, t, dur, ev: [[0, 1], [dur, 1]], vol: c.breath, dest: b.in });
    return { g, b, src };
  }

  // -------------------------------------------------------------------------------------------
  // SFX definitions: { fn(o), lvl, gap, duck, pri }
  // -------------------------------------------------------------------------------------------
  const T = tone;
  const NZ = noise;
  const brassChord = (o, freqs, t, dur, v, bright = 3000) => {
    const lp = F(o, 'lowpass', 400, 1.1);
    env(lp.frequency, o.t + t, [[0, fq(350 * o.f)], [0.06, fq(bright * o.f), 'e'], [dur, fq(bright * 0.35 * o.f), 'e']]);
    const ev = [[0, 0], [0.03, 1], [Math.max(0.04, dur - 0.1), 0.7], [dur, 0]];
    freqs.forEach((f, i) => {
      T(o, { type: 'sawtooth', f, t, dur, ev, vol: v, dest: lp, det: i % 2 ? 7 : -6 });
    });
    T(o, { type: 'sawtooth', f: freqs[0], t, dur, ev, vol: v * 0.7, dest: lp, det: 11 });
  };

  const SFX = {
    ui_hover: { lvl: 0.5, fn(o) { T(o, { f: 1900, f1: 2350, dur: 0.05, vol: 0.5 }); } },
    ui_click: {
      lvl: 0.7,
      fn(o) {
        T(o, { type: 'triangle', f: 950, f1: 600, dur: 0.07, vol: 0.8 });
        NZ(o, { type: 'highpass', f: 3500, dur: 0.018, vol: 0.4 });
      },
    },
    ui_back: {
      lvl: 0.7,
      fn(o) {
        T(o, { type: 'triangle', f: 620, f1: 320, dur: 0.13, vol: 0.8 });
        NZ(o, { type: 'bandpass', f: 1200, dur: 0.03, vol: 0.25 });
      },
    },
    card_show: {
      lvl: 0.8,
      fn(o) {
        NZ(o, { type: 'bandpass', f: 700, f1: 4500, q: 1.2, dur: 0.2, a: 0.09, vol: 0.9 });
        T(o, { f: 1320, f1: 1760, t: 0.11, dur: 0.18, vol: 0.4 });
      },
    },
    card_pick: {
      lvl: 0.8,
      fn(o) {
        NZ(o, { type: 'bandpass', f: 3000, f1: 800, q: 1, dur: 0.12, vol: 0.4 });
        [988, 1319, 1976].forEach((f, i) => {
          T(o, { type: 'triangle', f, t: i * 0.055, dur: 0.32, vol: 0.5 });
          T(o, { f: f * 2, t: i * 0.055, dur: 0.2, vol: 0.15 });
        });
      },
    },
    levelup: {
      lvl: 0.8, gap: 0.2,
      fn(o) {
        [587.3, 740, 880, 1174.7].forEach((f, i) => {
          T(o, { type: 'triangle', f, t: i * 0.085, dur: i === 3 ? 0.6 : 0.24, vol: 0.55 });
          T(o, { type: 'square', f, t: i * 0.085, dur: 0.1, vol: 0.08 });
        });
        T(o, { f: 2349, t: 0.3, dur: 0.5, vol: 0.14 });
        T(o, { f: 3520, t: 0.36, dur: 0.45, vol: 0.08 });
        NZ(o, { type: 'highpass', f: 7000, t: 0.26, dur: 0.4, a: 0.02, vol: 0.06 });
      },
    },
    tierup: {
      lvl: 1.0, gap: 0.5, duck: [0.45, 1.6], pri: 3,
      fn(o) {
        const L = 1.15;
        const rise = [[0, 0], [L * 0.97, 1], [L + 0.04, 0]];
        NZ(o, { kind: 'pink', type: 'bandpass', f: 250, f1: 6000, q: 1.6, dur: L + 0.04, ev: rise, vol: 1.2 });
        const lp = F(o, 'lowpass', 300, 1);
        env(lp.frequency, o.t, [[0, 300], [L, 5000, 'e']]);
        T(o, { type: 'sawtooth', f: [[0, 70], [L, 560]], dur: L + 0.04, ev: rise, vol: 0.35, dest: lp });
        T(o, { type: 'sawtooth', f: [[0, 105], [L, 840]], dur: L + 0.04, ev: rise, vol: 0.22, dest: lp });
        T(o, { f: [[0, 140], [L, 1120]], dur: L + 0.04, ev: rise, vol: 0.25 });
        // impact
        T(o, { f: [[0, 90], [0.5, 32]], t: L, dur: 1.7, vol: 1.3 });
        NZ(o, { kind: 'brown', f: [[0, 2500], [1.1, 120]], t: L, dur: 1.4, vol: 1.6, dest: SH(o, 3) });
        NZ(o, { type: 'highpass', f: 5500, t: L, dur: 1.6, vol: 0.14 });
        // triumphant D major brass
        brassChord(o, [146.8, 220, 293.7, 370, 440, 587.3], L, 1.7, 0.16, 3600);
        [1174.7, 1480, 1760].forEach((f, i) => T(o, { type: 'triangle', f, t: L + 0.05 + i * 0.07, dur: 0.9, vol: 0.1 }));
      },
    },
    suck_small: {
      lvl: 0.85,
      fn(o) {
        NZ(o, { type: 'bandpass', f: [[0, 350], [0.12, 2600]], q: 2, dur: 0.14, ev: [[0, 0], [0.11, 1], [0.14, 0]], vol: 1.3 });
        T(o, { f: [[0, 320], [0.035, 950]], t: 0.11, dur: 0.055, vol: 0.7 });
      },
    },
    suck_big: {
      lvl: 0.9, gap: 0.08,
      fn(o) {
        const ev = [[0, 0], [0.42, 1], [0.5, 0]];
        NZ(o, { kind: 'pink', type: 'bandpass', f: [[0, 140], [0.45, 1900]], q: 1.5, dur: 0.5, ev, vol: 2.2 });
        T(o, { f: [[0, 55], [0.45, 190]], dur: 0.5, ev, vol: 0.5 });
        T(o, { f: [[0, 170], [0.08, 60]], t: 0.46, dur: 0.22, vol: 1 });
        NZ(o, { type: 'bandpass', f: 900, t: 0.46, dur: 0.05, vol: 0.6 });
      },
    },
    crunch_wood: {
      lvl: 0.9,
      fn(o) {
        [0, rnd(0.02, 0.05), rnd(0.07, 0.12)].forEach((t) => {
          NZ(o, { type: 'bandpass', f: rnd(700, 1600), q: 2.5, t, dur: rnd(0.03, 0.07), vol: 1.4 });
        });
        T(o, { type: 'triangle', f: [[0, rnd(190, 230)], [0.06, 95]], dur: 0.09, vol: 0.7 });
        NZ(o, { kind: 'crackle', type: 'bandpass', f: 2500, q: 0.8, dur: 0.2 * o.ln, vol: 1.4 });
      },
    },
    crunch_glass: {
      lvl: 0.9,
      fn(o) {
        NZ(o, { type: 'highpass', f: 4200, dur: 0.07, vol: 0.9 });
        NZ(o, { kind: 'crackle', type: 'highpass', f: 5000, dur: 0.3 * o.ln, vol: 1.6 });
        for (let i = 0; i < 5; i++) {
          T(o, { f: rnd(2600, 7200), t: rnd(0, 0.14), dur: rnd(0.06, 0.26), vol: rnd(0.12, 0.28) });
        }
      },
    },
    crunch_concrete: {
      lvl: 0.9,
      fn(o) {
        NZ(o, { kind: 'pink', f: [[0, 1400], [0.3, 220]], dur: 0.38 * o.ln, vol: 2.4 });
        NZ(o, { kind: 'crackle', type: 'bandpass', f: 1500, q: 0.8, dur: 0.36 * o.ln, vol: 1.8 });
        T(o, { f: [[0, 95], [0.1, 44]], dur: 0.2, vol: 0.9 });
      },
    },
    crunch_metal: {
      lvl: 0.9,
      fn(o) {
        const base = rnd(190, 260);
        const hp = F(o, 'highpass', 250, 0.7);
        [1, 2.76, 5.4, 8.93].forEach((m, i) => {
          const f = base * m;
          T(o, { type: 'square', f: [[0, f], [0.3, f * 0.86]], dur: (0.5 / (1 + i * 0.35)) * o.ln, vol: 0.32 / (i + 1), dest: hp });
        });
        NZ(o, { type: 'bandpass', f: 3200, q: 2, dur: 0.08, vol: 1 });
        const s = T(o, { type: 'sawtooth', f: [[0, 950], [0.2, 480]], dur: 0.22, vol: 0.16, dest: hp });
        lfo(o, { f: 70, depth: 220 * o.f, dur: 0.22, target: s.osc.frequency });
      },
    },
    collapse_small: {
      lvl: 0.95, gap: 0.08, pri: 1.5,
      fn(o) {
        const L = 0.95 * o.ln;
        NZ(o, { kind: 'brown', f: [[0, 900], [L, 110]], dur: L, ev: [[0, 0], [0.03, 1], [0.3 * L, 0.6], [L, 0]], vol: 3 });
        NZ(o, { kind: 'crackle', type: 'bandpass', f: 1400, q: 0.7, dur: L * 0.9, vol: 1.5 });
        T(o, { f: [[0, 90], [0.15, 42]], dur: 0.3, vol: 0.9 });
        T(o, { f: [[0, 75], [0.12, 38]], t: rnd(0.25, 0.45) * o.ln, dur: 0.26, vol: 0.7 });
      },
    },
    collapse_big: {
      lvl: 1.0, gap: 0.3, duck: [0.6, 2.2], pri: 2.5,
      fn(o) {
        const L = 3.4 * o.ln;
        NZ(o, {
          kind: 'brown', f: [[0, 400], [0.6, 700], [L, 70]], dur: L,
          ev: [[0, 0], [0.35, 1], [0.5 * L, 0.8], [L, 0]], vol: 3.2, dest: SH(o, 2),
        });
        NZ(o, {
          kind: 'crackle', type: 'bandpass', f: [[0, 2200], [L, 700]], q: 0.7, dur: L * 0.85,
          ev: [[0, 0], [0.3, 1], [L * 0.85, 0]], vol: 1.3,
        });
        NZ(o, { kind: 'crackle', rate: 0.5, f: 900, dur: L, ev: [[0, 0], [0.2, 1], [L, 0]], vol: 1.6 });
        for (let i = 0; i < 5; i++) {
          T(o, { f: [[0, rnd(60, 85)], [0.2, 30]], t: rnd(0.1, L * 0.75), dur: 0.42, vol: rnd(0.5, 0.9) });
        }
        NZ(o, { kind: 'pink', f: 2500, dur: L, ev: [[0, 0], [1, 0.3], [L, 0]], vol: 0.6 });
        T(o, { f: 31, dur: L, ev: [[0, 0], [0.5, 1], [L * 0.6, 0.7], [L, 0]], vol: 0.5 });
      },
    },
    explode: {
      lvl: 0.95, gap: 0.06, duck: [0.7, 0.5], pri: 2,
      fn(o) {
        NZ(o, { f: [[0, 4500], [0.7, 140]], dur: 0.95 * o.ln, vol: 1.2, dest: SH(o, 4) });
        T(o, { f: [[0, 115], [0.4, 34]], dur: 0.75 * o.ln, vol: 1.1 });
        NZ(o, { type: 'highpass', f: 3000, dur: 0.03, vol: 0.7 });
        NZ(o, { kind: 'brown', f: 400, t: 0.05, dur: 1.1 * o.ln, vol: 1.6 });
      },
    },
    explode_big: {
      lvl: 1.0, gap: 0.12, duck: [0.5, 1.4], pri: 3,
      fn(o) {
        NZ(o, { f: [[0, 3500], [1.2, 100]], dur: 1.9 * o.ln, vol: 1.4, dest: SH(o, 6) });
        T(o, { f: [[0, 85], [0.7, 24]], dur: 1.5 * o.ln, vol: 1.3 });
        NZ(o, {
          kind: 'brown', f: [[0, 250], [2.4, 60]], dur: 2.6 * o.ln,
          ev: [[0, 0], [0.05, 1], [0.6, 0.6], [2.6 * o.ln, 0]], vol: 2.6,
        });
        NZ(o, { kind: 'crackle', type: 'bandpass', f: 1800, t: 0.2, dur: 1.5, vol: 0.9 });
        NZ(o, { type: 'highpass', f: 2500, dur: 0.04, vol: 0.9 });
      },
    },
    nuke: {
      lvl: 1.0, gap: 1, duck: [0.3, 4], pri: 5,
      fn(o) {
        NZ(o, { type: 'highpass', f: 2000, dur: 0.09, vol: 1 });
        T(o, { f: [[0, 130], [2.2, 19]], dur: 3.3, ev: [[0, 0], [0.01, 1], [1.5, 0.8], [3.3, 0]], vol: 1.4 });
        NZ(o, {
          kind: 'brown', f: [[0, 120], [1.2, 520], [6, 50]], dur: 6.3,
          ev: [[0, 0], [0.08, 0.7], [1.3, 1], [3, 0.6], [6.3, 0]], vol: 4, dest: SH(o, 3),
        });
        NZ(o, {
          kind: 'pink', f: [[0, 5000], [4.5, 150]], dur: 4.8,
          ev: [[0, 0], [0.02, 0.8], [0.5, 0.4], [4.8, 0]], vol: 1.6,
        });
        T(o, { f: 31, dur: 5.5, ev: [[0, 0], [1.2, 1], [3, 0.6], [5.5, 0]], vol: 0.6 });
      },
    },

    // ---- animals & comedy voices ----
    moo: {
      lvl: 1.0, gap: 0.08,
      fn(o) {
        const L = 1.15 * o.ln * rnd(0.9, 1.15);
        const k = rnd(0.94, 1.07);
        vox(o, {
          f: [[0, 88 * k], [0.28 * L, 138 * k], [0.7 * L, 127 * k], [L, 80 * k]], dur: L,
          fm: [
            [[[0, 290], [0.3 * L, 500], [0.8 * L, 430], [L, 300]], 4, 1],
            [[[0, 700], [0.3 * L, 980], [L, 760]], 5, 0.6],
            [2400, 5, 0.1],
          ],
          ev: [[0, 0], [0.12, 0.8], [0.35 * L, 1], [0.75 * L, 0.85], [L, 0]],
          vib: [5.3, 1.6], sub: 0.35, body: 0.5, bodyF: 260, breath: 0.25,
        });
      },
    },
    baa: {
      lvl: 1.0, gap: 0.08,
      fn(o) {
        const L = 0.62 * o.ln * rnd(0.9, 1.2);
        const k = rnd(0.92, 1.1);
        vox(o, {
          f: [[0, 330 * k], [0.08, 405 * k], [0.5 * L, 385 * k], [L, 300 * k]], dur: L,
          fm: [[820, 4, 1], [1750, 6, 0.7], [2700, 6, 0.3]],
          ev: [[0, 0], [0.03, 1], [0.7 * L, 0.9], [L, 0]],
          trem: [rnd(8.5, 10.5), 0.85], vib: [9.5, 14], breath: 0.15,
        });
      },
    },
    oink: {
      lvl: 1.0, gap: 0.08,
      fn(o) {
        const k = rnd(0.92, 1.1);
        vox(o, {
          f: [[0, 108 * k], [0.11, 92 * k]], dur: 0.12,
          fm: [[460, 3, 1], [1200, 4, 0.5]], trem: [38, 0.9], body: 0.4, breath: 0.4,
        });
        vox(o, {
          t: 0.13, f: [[0, 320 * k], [0.07, 650 * k], [0.21, 500 * k]], dur: 0.23,
          fm: [[950, 4, 1], [2100, 5, 0.8]], trem: [44, 0.55], vol: 0.8,
        });
        NZ(o, { kind: 'pink', type: 'bandpass', f: 750, q: 2, dur: 0.12, vol: 1.2 });
      },
    },
    cluck: {
      lvl: 1.0, gap: 0.08,
      fn(o) {
        const k = rnd(0.9, 1.12);
        const fm = [[1350, 4, 1], [2650, 5, 0.6]];
        for (let i = 0; i < 3; i++) {
          vox(o, { t: i * 0.11, f: [[0, 520 * k], [0.02, 650 * k], [0.06, 420 * k]], dur: 0.065, fm, vol: 0.8 });
        }
        vox(o, {
          t: 0.36, f: [[0, 560 * k], [0.06, 990 * k], [0.2, 610 * k]], dur: 0.25, fm, trem: [28, 0.45],
        });
      },
    },
    neigh: {
      lvl: 1.0, gap: 0.1,
      fn(o) {
        const L = 1.1 * o.ln * rnd(0.9, 1.1);
        const k = rnd(0.92, 1.08);
        vox(o, {
          f: [[0, 700 * k], [0.08, 1250 * k], [0.35 * L, 1020 * k], [L, 420 * k]], dur: L,
          fm: [[1050, 3, 1], [2300, 4, 0.8], [3300, 5, 0.3]],
          ev: [[0, 0], [0.04, 1], [0.6 * L, 0.9], [L, 0]],
          vib: [12, 85], trem: [12, 0.65], breath: 0.1,
        });
        NZ(o, { kind: 'pink', type: 'bandpass', f: 520, q: 1.2, t: L - 0.05, dur: 0.22, a: 0.03, vol: 1.2 });
      },
    },
    scream: {
      lvl: 1.0, gap: 0.08,
      fn(o) {
        const b = rnd(0.88, 1.22);
        const L = 0.8 * rnd(0.85, 1.15);
        vox(o, {
          f: [[0, 480 * b], [0.07, 830 * b], [0.25, 770 * b], [L, 390 * b]], dur: L,
          fm: [[900, 4, 1], [1350, 5, 0.8], [2800, 6, 0.4]],
          ev: [[0, 0], [0.03, 1], [0.6 * L, 0.9], [L, 0]],
          vib: [6.5, 30], breath: 0.05,
        });
      },
    },
    quack: {
      lvl: 1.0, gap: 0.08,
      fn(o) {
        const k = rnd(0.92, 1.1);
        const fm = [[1500, 5, 1], [3000, 6, 0.6]];
        vox(o, { type: 'square', f: [[0, 900 * k], [0.05, 1520 * k], [0.1, 1350 * k]], dur: 0.11, fm, vol: 0.8 });
        vox(o, {
          t: 0.15, type: 'square', f: [[0, 1720 * k], [0.04, 1260 * k], [0.17, 790 * k]], dur: 0.19, fm,
          trem: [62, 0.3],
        });
        NZ(o, { type: 'bandpass', f: 2500, q: 1.5, t: 0.13, dur: 0.06, a: 0.02, vol: 0.2 });
      },
    },
    shark: {
      lvl: 1.0, gap: 0.1,
      fn(o) {
        [0, 0.19].forEach((t, i) => {
          vox(o, {
            t, f: [[0, 230 - i * 20], [0.075, 78]], dur: 0.095,
            fm: [[[[0, 950], [0.075, 300]], 3, 1], [[[0, 1700], [0.075, 650]], 4, 0.5]], body: 0.5,
          });
          T(o, { type: 'square', f: 1150 - i * 150, t: t + 0.08, dur: 0.035, vol: 0.25 });
          NZ(o, { type: 'bandpass', f: 2600, q: 1.5, t: t + 0.08, dur: 0.03, vol: 0.9 });
          T(o, { f: [[0, 140], [0.06, 60]], t: t + 0.08, dur: 0.09, vol: 0.6 });
        });
      },
    },

    // ---- vehicles & military ----
    car_alarm: {
      lvl: 0.75, gap: 0.3,
      fn(o) {
        const bp = F(o, 'bandpass', 1800, 0.9);
        for (let i = 0; i < 6; i++) {
          T(o, {
            type: 'square', f: i % 2 ? 1250 : 950, t: i * 0.12, dur: 0.11,
            ev: [[0, 0], [0.005, 1], [0.1, 1], [0.11, 0]], vol: 0.5, dest: bp,
          });
        }
      },
    },
    honk: {
      lvl: 0.8, gap: 0.1,
      fn(o) {
        const lp = F(o, 'lowpass', 2300, 1.2);
        const d = 0.34 * o.ln;
        const ev = [[0, 0], [0.012, 1], [d - 0.04, 0.9], [d, 0]];
        [392, 494].forEach((f) => {
          T(o, { type: 'square', f: [[0, f * 0.94], [0.03, f]], dur: d, ev, vol: 0.4, dest: lp });
          T(o, { type: 'sawtooth', f: f * 1.004, dur: d, ev, vol: 0.2, dest: lp });
        });
      },
    },
    siren: {
      lvl: 0.75, gap: 0.3,
      fn(o) {
        const lp = F(o, 'lowpass', 2600, 1);
        const ev = [[0, 0], [0.03, 1], [0.92, 1], [1, 0]];
        T(o, { type: 'sawtooth', f: [[0, 620], [0.45, 1350], [0.95, 640]], dur: 1, ev, vol: 0.5, dest: lp });
        T(o, { type: 'square', f: [[0, 623], [0.45, 1356], [0.95, 643]], dur: 1, ev, vol: 0.2, dest: lp });
      },
    },
    gunfire: {
      lvl: 0.85,
      fn(o) {
        for (let i = 0; i < 3; i++) {
          const t = i * 0.075 + rnd(0, 0.008);
          NZ(o, { f: [[0, 6000], [0.07, 800]], t, dur: 0.09, vol: 1.2 });
          T(o, { type: 'triangle', f: [[0, 170], [0.06, 60]], t, dur: 0.07, vol: 0.8 });
          NZ(o, { type: 'highpass', f: 4000, t, dur: 0.015, vol: 0.6 });
        }
      },
    },
    shell_fire: {
      lvl: 0.95, gap: 0.06, pri: 1.5,
      fn(o) {
        T(o, { f: [[0, 150], [0.25, 38]], dur: 0.45, vol: 1.2 });
        NZ(o, { f: [[0, 3500], [0.35, 180]], dur: 0.5, vol: 1.1, dest: SH(o, 3) });
        T(o, { type: 'square', f: 880, dur: 0.06, vol: 0.12 });
        NZ(o, { type: 'bandpass', f: 2500, q: 1, dur: 0.03, vol: 0.7 });
      },
    },
    missile_fire: {
      lvl: 0.85, gap: 0.08,
      fn(o) {
        NZ(o, {
          type: 'bandpass', f: [[0, 400], [0.25, 2800], [1.1, 1200]], q: 1.2, dur: 1.2,
          ev: [[0, 0], [0.06, 1], [0.3, 0.7], [1.2, 0]], vol: 1.4,
        });
        NZ(o, { kind: 'pink', f: 500, dur: 0.9, ev: [[0, 0], [0.04, 1], [0.9, 0]], vol: 1.6 });
        T(o, { type: 'sawtooth', f: [[0, 70], [0.8, 160]], dur: 0.9, a: 0.03, vol: 0.25, dest: F(o, 'lowpass', 600, 0.7) });
      },
    },
    missile_hit: {
      lvl: 0.95, gap: 0.06, duck: [0.75, 0.4], pri: 1.8,
      fn(o) {
        T(o, { f: [[0, 130], [0.3, 40]], dur: 0.5, vol: 1.1 });
        NZ(o, { f: [[0, 5000], [0.5, 200]], dur: 0.65, vol: 1.2, dest: SH(o, 4) });
        NZ(o, { kind: 'crackle', type: 'bandpass', f: 2500, q: 0.8, t: 0.05, dur: 0.5, vol: 1.2 });
        NZ(o, { type: 'highpass', f: 3500, dur: 0.025, vol: 0.7 });
      },
    },
    bomb_fall: {
      lvl: 0.7, gap: 0.15,
      fn(o) {
        const ev = [[0, 0], [0.15, 0.35], [1.15, 1], [1.3, 0]];
        const a = T(o, { f: [[0, 2600], [1.25, 650]], dur: 1.3, ev, vol: 0.6 });
        T(o, { type: 'triangle', f: [[0, 2630], [1.25, 655]], dur: 1.3, ev, vol: 0.2 });
        lfo(o, { f: 6.5, depth: 14, dur: 1.3, target: a.osc.frequency });
      },
    },
    hit_taken: {
      lvl: 0.95, gap: 0.1, pri: 2,
      fn(o) {
        T(o, { f: [[0, 170], [0.15, 48]], dur: 0.26, vol: 1.1 });
        T(o, { type: 'sawtooth', f: [[0, 420], [0.16, 90]], dur: 0.2, vol: 0.5, dest: SH(o, 3, F(o, 'lowpass', 1800, 0.7)) });
        NZ(o, { type: 'bandpass', f: 1500, q: 1, dur: 0.07, vol: 1 });
      },
    },
    lightning: {
      lvl: 0.9, gap: 0.08, pri: 1.5,
      fn(o) {
        NZ(o, { type: 'highpass', f: 2500, dur: 0.06, vol: 1.2 });
        NZ(o, { type: 'bandpass', f: [[0, 4000], [0.3, 900]], q: 0.8, dur: 0.32, vol: 1 });
        NZ(o, { kind: 'crackle', type: 'highpass', f: 1500, dur: 0.38, vol: 2.2 });
        T(o, { type: 'sawtooth', f: [[0, 3000], [0.05, 200]], dur: 0.06, vol: 0.4 });
      },
    },
    thunder: {
      lvl: 0.95, gap: 0.4, duck: [0.75, 1.5], pri: 2,
      fn(o) {
        const L = 3.6 * o.ln;
        const ev = [[0, 0], [0.05, 1]];
        let t = 0.05;
        let lv = 1;
        while (t < L - 0.7) {
          t += rnd(0.2, 0.45);
          ev.push([t, lv * rnd(0.3, 0.55)]);
          t += rnd(0.15, 0.3);
          lv *= 0.78;
          ev.push([t, lv]);
        }
        ev.push([L, 0]);
        NZ(o, { kind: 'brown', f: [[0, 600], [L, 130]], dur: L, ev, vol: 4, dest: SH(o, 2) });
        NZ(o, { f: [[0, 1500], [0.25, 300]], dur: 0.28, vol: 0.8 });
        T(o, { f: [[0, 55], [1.2, 30]], dur: 1.6, vol: 0.6 });
      },
    },
    hail: {
      lvl: 0.85, gap: 0.1,
      fn(o) {
        NZ(o, {
          kind: 'crackle', type: 'bandpass', f: 3800, q: 1.5, dur: 0.45,
          ev: [[0, 0], [0.02, 1], [0.3, 0.7], [0.45, 0]], vol: 3,
        });
        NZ(o, { kind: 'crackle', rate: 1.7, type: 'highpass', f: 6000, dur: 0.4, vol: 2 });
        for (let i = 0; i < 3; i++) T(o, { f: rnd(2500, 4500), t: rnd(0, 0.3), dur: 0.04, vol: 0.25 });
      },
    },

    // ---- storm abilities ----
    dash: {
      lvl: 0.9, gap: 0.15, pri: 1.5,
      fn(o) {
        const ev = [[0, 0], [0.18, 1], [0.8, 0]];
        NZ(o, { kind: 'pink', type: 'bandpass', f: [[0, 250], [0.25, 2000], [0.75, 450]], q: 1.1, dur: 0.8, ev, vol: 3 });
        NZ(o, { kind: 'brown', f: 300, dur: 0.7, ev: [[0, 0], [0.15, 1], [0.7, 0]], vol: 2 });
        NZ(o, { type: 'highpass', f: 5000, dur: 0.5, ev: [[0, 0], [0.2, 0.2], [0.5, 0]], vol: 1 });
      },
    },
    fling: {
      lvl: 0.8,
      fn(o) {
        NZ(o, { type: 'bandpass', f: [[0, 500], [0.2, 3800]], q: 2, dur: 0.24, ev: [[0, 0], [0.14, 1], [0.24, 0]], vol: 1.6 });
        T(o, { f: [[0, 280], [0.2, 1300]], dur: 0.22, ev: [[0, 0], [0.12, 0.5], [0.22, 0]], vol: 0.6 });
      },
    },
    fling_hit: {
      lvl: 0.9,
      fn(o) {
        T(o, { f: [[0, 140], [0.1, 48]], dur: 0.22, vol: 1.1 });
        NZ(o, { type: 'bandpass', f: 1300, q: 0.8, dur: 0.09, vol: 1.2 });
        NZ(o, { kind: 'crackle', type: 'bandpass', f: 2600, q: 0.8, dur: 0.25, vol: 1.2 });
        T(o, { type: 'triangle', f: [[0, 320], [0.05, 180]], dur: 0.06, vol: 0.5 });
      },
    },
    freeze: {
      lvl: 0.8, gap: 0.1,
      fn(o) {
        for (let i = 0; i < 7; i++) T(o, { f: 2400 * Math.pow(1.18, i) * rnd(0.98, 1.02), t: i * 0.05, dur: 0.3, vol: 0.22 });
        NZ(o, { type: 'highpass', f: [[0, 9000], [0.4, 4500]], dur: 0.55, ev: [[0, 0], [0.3, 0.5], [0.55, 0]], vol: 0.6 });
        NZ(o, { kind: 'crackle', type: 'highpass', f: 5000, dur: 0.5, vol: 1.6 });
        T(o, { f: [[0, 400], [0.4, 1600]], dur: 0.45, ev: [[0, 0], [0.35, 1], [0.45, 0]], vol: 0.12 });
      },
    },
    shatter: {
      lvl: 0.9, gap: 0.06,
      fn(o) {
        NZ(o, { type: 'highpass', f: 3500, dur: 0.09, vol: 1 });
        for (let i = 0; i < 7; i++) T(o, { f: rnd(2800, 8500), t: rnd(0, 0.2), dur: rnd(0.08, 0.35), vol: rnd(0.1, 0.25) });
        NZ(o, { kind: 'crackle', type: 'highpass', f: 4500, dur: 0.55 * o.ln, vol: 2 });
        T(o, { type: 'triangle', f: [[0, 260], [0.05, 120]], dur: 0.08, vol: 0.5 });
      },
    },
    fire_whoosh: {
      lvl: 0.9, gap: 0.1,
      fn(o) {
        const tg = G(o, 0.8);
        lfo(o, { f: 17, depth: 0.2, dur: 0.95, target: tg.gain });
        NZ(o, {
          kind: 'pink', f: [[0, 300], [0.25, 2200], [0.9, 350]], dur: 0.95,
          ev: [[0, 0], [0.2, 1], [0.95, 0]], vol: 3, dest: tg,
        });
        NZ(o, { kind: 'crackle', type: 'bandpass', f: 1500, q: 0.7, dur: 0.9, vol: 1.2 });
        NZ(o, { kind: 'brown', f: 250, dur: 0.8, ev: [[0, 0], [0.15, 1], [0.8, 0]], vol: 2 });
      },
    },
    cash: {
      lvl: 0.75, gap: 0.06,
      fn(o) {
        NZ(o, { type: 'highpass', f: 2500, dur: 0.03, vol: 0.6 });
        T(o, { type: 'square', f: 320, dur: 0.04, vol: 0.3 });
        [2093, 2637, 3136, 4186, 5274].forEach((f, i) => T(o, { f, t: 0.09, dur: 0.7 - i * 0.1, vol: 0.3 / (1 + i * 0.6) }));
        for (let i = 0; i < 4; i++) T(o, { f: rnd(4500, 7500), t: 0.14 + i * 0.045, dur: 0.08, vol: 0.12 });
      },
    },
    combo_up: {
      lvl: 0.7,
      fn(o) {
        T(o, { type: 'triangle', f: [[0, 640], [0.03, 700]], dur: 0.15, vol: 0.8 });
        T(o, { f: 1400, dur: 0.11, vol: 0.25 });
        NZ(o, { type: 'highpass', f: 6000, dur: 0.02, vol: 0.15 });
      },
    },
    combo_break: {
      lvl: 0.8, gap: 0.2,
      fn(o) {
        const lp = F(o, 'lowpass', 2200, 1);
        env(lp.frequency, o.t, [[0, fq(2200 * o.f)], [0.4, fq(300 * o.f), 'e']]);
        const a = T(o, { type: 'sawtooth', f: [[0, 470], [0.38, 150]], dur: 0.42, vol: 0.6, dest: lp, hold: 0.2 });
        T(o, { type: 'square', f: [[0, 332], [0.38, 106]], dur: 0.42, vol: 0.3, dest: lp, hold: 0.2 });
        lfo(o, { f: 9, depth: 15, dur: 0.42, target: a.osc.frequency });
        NZ(o, { type: 'bandpass', f: [[0, 2500], [0.3, 500]], q: 1, dur: 0.3, vol: 0.4 });
      },
    },
    warning: {
      lvl: 0.8, gap: 0.5, pri: 2,
      fn(o) {
        const sh = SH(o, 2, F(o, 'bandpass', 1100, 0.8));
        const ev = [[0, 0], [0.015, 1], [0.25, 1], [0.28, 0]];
        [0, 0.34].forEach((t) => {
          T(o, { type: 'sawtooth', f: [[0, 470], [0.06, 560], [0.28, 545]], t, dur: 0.28, ev, vol: 0.5, dest: sh });
          T(o, { type: 'square', f: [[0, 235], [0.06, 280], [0.28, 272]], t, dur: 0.28, ev, vol: 0.3, dest: sh });
        });
      },
    },

    // ---- boss ----
    boss_roar: {
      lvl: 1.0, gap: 0.6, duck: [0.45, 2.2], pri: 4,
      fn(o) {
        const L = 2.8;
        const lp = F(o, 'lowpass', 150, 1.4, SH(o, 3));
        env(lp.frequency, o.t, [[0, fq(150 * o.f)], [0.35, fq(1900 * o.f), 'e'], [1.6, fq(950 * o.f), 'e'], [L, fq(120 * o.f), 'e']]);
        const ev = [[0, 0], [0.09, 1], [L * 0.75, 0.85], [L, 0]];
        [36.7, 36.95, 73.4, 73.9, 110.1, 146.8].forEach((f) => {
          T(o, { type: 'sawtooth', f: [[0, f], [L * 0.7, f], [L, f * 0.88]], dur: L, ev, vol: 0.3, dest: lp });
        });
        T(o, { f: [[0, 36.7], [L * 0.7, 36.7], [L, 32]], dur: L, ev, vol: 0.9 });
        NZ(o, { kind: 'pink', type: 'bandpass', f: 320, q: 1, dur: L, ev, vol: 1.2 });
        NZ(o, { kind: 'brown', f: 200, dur: 0.5, vol: 2 });
      },
    },
    boss_charge: {
      lvl: 0.85, gap: 0.5, pri: 2,
      fn(o) {
        const L = 1.5;
        const ev = [[0, 0], [L * 0.92, 1], [L, 0]];
        const tg = G(o, 0.7);
        lfo(o, { f: [[0, 5], [L, 48]], depth: 0.3, dur: L, target: tg.gain });
        const lp = F(o, 'lowpass', 400, 1, tg);
        env(lp.frequency, o.t, [[0, 400], [L, 6000, 'e']]);
        T(o, { type: 'sawtooth', f: [[0, 70], [L, 950]], dur: L, ev, vol: 0.45, dest: lp });
        T(o, { f: [[0, 140], [L, 1900]], dur: L, ev, vol: 0.35, dest: tg });
        NZ(o, { type: 'bandpass', f: [[0, 500], [L, 7000]], q: 3, dur: L, ev, vol: 1.2, dest: tg });
      },
    },
    boss_laser: {
      lvl: 0.9, gap: 0.3, pri: 2,
      fn(o) {
        const L = 1.0;
        T(o, { type: 'sawtooth', f: [[0, 2600], [0.12, 320]], dur: 0.16, vol: 0.6 });
        const tg = G(o, 0.75);
        lfo(o, { f: 55, depth: 0.25, dur: L + 0.06, target: tg.gain, type: 'square' });
        const bp = F(o, 'bandpass', 1500, 1.1, tg);
        const sh = SH(o, 4, bp);
        const ev = [[0, 0], [0.05, 1], [L - 0.15, 1], [L, 0]];
        T(o, { type: 'sawtooth', f: 155, t: 0.05, dur: L, ev, vol: 0.6, dest: sh });
        T(o, { type: 'square', f: 311.5, t: 0.05, dur: L, ev, vol: 0.4, dest: sh });
        NZ(o, { type: 'highpass', f: 4500, t: 0.05, dur: L, ev, vol: 0.2, dest: tg });
        T(o, { f: [[0, 1900], [L, 1500]], t: 0.05, dur: L, ev, vol: 0.15 });
      },
    },
    shield_down: {
      lvl: 0.9, gap: 0.5, pri: 2,
      fn(o) {
        const tg = G(o, 0.7);
        lfo(o, { f: [[0, 28], [0.85, 4]], depth: 0.3, dur: 0.9, target: tg.gain });
        const lp = F(o, 'lowpass', 5000, 1, tg);
        env(lp.frequency, o.t, [[0, 5000], [0.85, 200, 'e']]);
        T(o, { type: 'sawtooth', f: [[0, 950], [0.85, 55]], dur: 0.9, vol: 0.5, dest: lp, hold: 0.5 });
        T(o, { type: 'square', f: [[0, 475], [0.85, 40]], dur: 0.9, vol: 0.3, dest: lp, hold: 0.5 });
        NZ(o, { type: 'highpass', f: 3000, dur: 0.12, vol: 0.8 });
        NZ(o, { kind: 'crackle', type: 'bandpass', f: 3000, q: 0.8, dur: 0.5, vol: 1.2 });
        T(o, { f: [[0, 80], [0.2, 35]], t: 0.8, dur: 0.32, vol: 0.9 });
      },
    },

    // ---- meta ----
    achievement: {
      lvl: 0.8, gap: 0.5,
      fn(o) {
        [880, 1108.7, 1318.5].forEach((f, i) => T(o, { type: 'triangle', f, t: i * 0.07, dur: 0.16, vol: 0.45 }));
        [1174.7, 1480, 1760].forEach((f) => {
          T(o, { type: 'triangle', f, t: 0.24, dur: 0.95, vol: 0.32 });
          T(o, { f: f * 2, t: 0.24, dur: 0.6, vol: 0.07 });
        });
        NZ(o, { type: 'highpass', f: 8000, t: 0.24, dur: 0.6, vol: 0.07 });
      },
    },
    low_hp: {
      lvl: 0.85, gap: 0.3, pri: 2,
      fn(o) {
        const lp = F(o, 'lowpass', 2400, 0.7);
        [0, 0.2].forEach((t, i) => {
          T(o, { f: [[0, 95], [0.1, 45]], t, dur: 0.17, vol: i ? 0.7 : 1 });
          T(o, { type: 'square', f: 780, t, dur: 0.09, ev: [[0, 0], [0.005, 1], [0.08, 1], [0.09, 0]], vol: 0.22, dest: lp });
        });
      },
    },
    heal: {
      lvl: 0.75, gap: 0.2,
      fn(o) {
        [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => {
          T(o, { f, t: i * 0.08, dur: 0.6, a: 0.04, vol: 0.35 });
          T(o, { type: 'triangle', f: f * 2, t: i * 0.08, dur: 0.4, a: 0.03, vol: 0.07 });
        });
        NZ(o, { type: 'bandpass', f: [[0, 2000], [0.6, 7000]], q: 2, dur: 0.7, ev: [[0, 0], [0.45, 1], [0.7, 0]], vol: 0.3 });
      },
    },
    news_jingle: {
      lvl: 0.8, gap: 1, duck: [0.5, 2],
      fn(o) {
        const lp = F(o, 'lowpass', 3200, 1);
        [587.3, 587.3, 587.3, 698.5, 587.3, 880, 784, 880].forEach((f, i) => {
          const t = i * 0.105;
          T(o, { type: 'sawtooth', f, t, dur: 0.09, vol: 0.4, dest: lp, hold: 0.04 });
          T(o, { type: 'square', f: f / 2, t, dur: 0.09, vol: 0.2, dest: lp, hold: 0.04 });
          NZ(o, { type: 'highpass', f: 6000, t, dur: 0.02, vol: 0.2 });
        });
        brassChord(o, [293.7, 440, 587.3, 740, 880], 0.88, 1.1, 0.16, 3400);
        T(o, { f: [[0, 110], [0.2, 73.4]], t: 0.88, dur: 0.95, vol: 0.9 });
        NZ(o, { kind: 'pink', f: 500, t: 0.88, dur: 0.1, vol: 1.2 });
        NZ(o, { type: 'highpass', f: 6000, t: 0.88, dur: 1.1, vol: 0.1 });
      },
    },
    win: {
      lvl: 0.85, gap: 1, duck: [0.5, 1.6],
      fn(o) {
        [293.7, 370, 440, 587.3].forEach((f, i) => brassChord(o, [f, f * 2], i * 0.11, 0.13, 0.22, 3000));
        brassChord(o, [293.7, 370, 440, 587.3, 740], 0.46, 1.15, 0.14, 3600);
        T(o, { f: [[0, 120], [0.25, 50]], t: 0.46, dur: 0.7, vol: 0.9 });
        NZ(o, { type: 'highpass', f: 6000, t: 0.46, dur: 1.1, vol: 0.12 });
        [1174.7, 1480, 1760, 2349].forEach((f, i) => T(o, { type: 'triangle', f, t: 0.5 + i * 0.06, dur: 0.7, vol: 0.1 }));
      },
    },
    lose: {
      lvl: 0.85, gap: 1, duck: [0.5, 1.6],
      fn(o) {
        const lp = F(o, 'lowpass', 1800, 1);
        env(lp.frequency, o.t, [[0, 1800], [1.5, 380, 'e']]);
        [293.7, 261.6, 233.1, 220].forEach((f, i) => {
          const last = i === 3;
          const d = last ? 0.75 : 0.28;
          const ev = [[0, 0], [0.02, 1], [d * 0.7, 0.8], [d, 0]];
          const a = T(o, {
            type: 'sawtooth', f: last ? [[0, f], [0.25, f], [d, f * 0.82]] : f, t: i * 0.26, dur: d, ev, vol: 0.5, dest: lp,
          });
          T(o, { type: 'square', f: f / 2, t: i * 0.26, dur: d, ev, vol: 0.25, dest: lp });
          lfo(o, { f: 6, depth: f * 0.012, t: i * 0.26, dur: d, target: a.osc.frequency });
        });
        T(o, { f: [[0, 90], [0.3, 40]], t: 0.78, dur: 0.7, vol: 0.9 });
      },
    },
  };

  // -------------------------------------------------------------------------------------------
  // SFX voices
  // -------------------------------------------------------------------------------------------
  function sweep(now) {
    for (let i = voices.length - 1; i >= 0; i--) {
      if (voices[i].end < now) {
        const v = voices[i];
        v.out.disconnect();
        if (v.pan) v.pan.disconnect();
        voices.splice(i, 1);
      }
    }
    for (let i = tails.length - 1; i >= 0; i--) {
      if (tails[i].end < now) {
        tails[i].out.disconnect();
        if (tails[i].pan) tails[i].pan.disconnect();
        tails.splice(i, 1);
      }
    }
  }

  function duckMusic(amount, hold) {
    const t = ctx.currentTime;
    const p = N.duck.gain;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(amount, t, 0.03);
    p.setTargetAtTime(1, t + 0.1 + hold * 0.5, 0.25 + hold * 0.25);
  }

  function play(name, opts) {
    if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(SFX, name)) return false;
    const def = SFX[name];
    const now = ctx.currentTime;
    const last = lastPlay.get(name);
    if (last !== undefined && now - last < (def.gap || DEFAULT_GAP) && now >= last) return false;
    const op = opts || {};
    const v = clamp(num(op.vol, 1), 0, 2);
    if (v <= 0.001) return false;
    const pitch = clamp(num(op.pitch, 1), 0.25, 4);
    const pan = clamp(num(op.pan, 0), -1, 1);
    const size = clamp(num(op.size, 0.5), 0, 1);
    const weight = 0.6 + 0.8 * size;
    const level = v * weight * (def.pri || 1);

    sweep(now);
    if (voices.length >= MAX_VOICES) {
      let qi = 0;
      for (let i = 1; i < voices.length; i++) if (voices[i].level < voices[qi].level) qi = i;
      if (level < voices[qi].level) return false; // the new one is the quietest: drop it
      const q = voices[qi];
      voices.splice(qi, 1);
      q.out.gain.cancelScheduledValues(now);
      q.out.gain.setTargetAtTime(0, now, 0.008);
      q.end = now + 0.06;
      tails.push(q);
    }
    lastPlay.set(name, now);

    const t = now + 0.004;
    const out = ctx.createGain();
    out.gain.value = def.lvl * v * weight;
    let panner = null;
    if (ctx.createStereoPanner) {
      panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      out.connect(panner);
      panner.connect(N.sfxBus);
    } else out.connect(N.sfxBus);
    const sf = 1.25 - 0.5 * size; // bigger = lower
    const o = { t, f: pitch * sf, ff: Math.sqrt(pitch * sf), ln: 0.7 + 0.6 * size, s: size, out, end: t };
    def.fn(o);
    voices.push({ name, out, pan: panner, end: o.end + 0.08, level });
    if (def.duck) duckMusic(1 - (1 - def.duck[0]) * clamp(v * weight), def.duck[1]);
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Storm bed
  // -------------------------------------------------------------------------------------------
  function buildStorm() {
    const t = ctx.currentTime;
    const S = { opt: {} };
    const g = (v, dest) => { const n = ctx.createGain(); n.gain.value = v; if (dest) n.connect(dest); return n; };
    const flt = (type, f, q, dest) => {
      const n = ctx.createBiquadFilter();
      n.type = type; n.frequency.value = f; n.Q.value = q; n.connect(dest);
      // k-rate: LFO-modulated filter cutoffs would otherwise recompute coefficients every sample
      if ('automationRate' in n.frequency) n.frequency.automationRate = 'k-rate';
      return n;
    };
    const pan = (p, dest) => {
      if (!ctx.createStereoPanner) return dest;
      const n = ctx.createStereoPanner();
      n.pan.value = p; n.connect(dest);
      return n;
    };
    const loop = (kind, rate, dest) => {
      const s = ctx.createBufferSource();
      s.buffer = buffers[kind]; s.loop = true; s.playbackRate.value = rate;
      s.connect(dest);
      s.start(ctx.currentTime, Math.random() * 2.5);
      return s;
    };
    const mod = (f, depth, target, type) => {
      const o = ctx.createOscillator();
      o.type = type || 'sine'; o.frequency.value = f;
      const d = g(depth, target);
      o.connect(d);
      o.start(ctx.currentTime);
      return o;
    };
    S.g = g; S.flt = flt; S.pan = pan; S.loop = loop; S.mod = mod;
    S.master = g(0, N.stormBus);

    // 1. whistle (dominant when tiny)
    S.whG = g(0, S.master);
    const whT1 = g(0.6, pan(-0.3, S.whG));
    const whT2 = g(0.5, pan(0.35, S.whG));
    S.wh1 = flt('bandpass', 1200, 16, whT1);
    S.wh2 = flt('bandpass', 1900, 22, whT2);
    const wsrc = loop('white', 1, S.wh1);
    wsrc.connect(S.wh2);
    mod(0.31, 0.4, whT1.gain); mod(0.23, 0.5, whT2.gain);
    mod(0.13, 180, S.wh1.frequency); mod(0.09, 260, S.wh2.frequency);
    mod(0.057, 120, S.wh1.frequency);

    // 2. wind body (stereo, gusting)
    S.bodyG = g(0, S.master);
    const tA = g(1, pan(-0.55, S.bodyG));
    const tB = g(1, pan(0.55, S.bodyG));
    S.bA = flt('bandpass', 420, 0.9, tA);
    S.bB = flt('bandpass', 470, 0.9, tB);
    loop('pink', 1, S.bA); loop('pink', 0.9, S.bB);
    mod(0.071, 0.35, tA.gain); mod(0.19, 0.2, tA.gain);
    mod(0.113, 0.35, tB.gain); mod(0.27, 0.2, tB.gain);
    mod(0.045, 70, S.bA.frequency); mod(0.062, 80, S.bB.frequency);
    // air hiss with speed
    S.airG = g(0, S.master);
    const airLp = flt('lowpass', 6500, 0.5, S.airG);
    loop('pink', 1.3, flt('highpass', 2400, 0.5, airLp));

    // 3. roar
    S.roarG = g(0, S.master);
    const rT = g(1, S.roarG);
    const sh = ctx.createWaveShaper();
    sh.curve = shaperCurve(1.5);
    sh.connect(rT);
    S.rlp = flt('lowpass', 180, 0.8, sh);
    loop('brown', 1, g(2.2, S.rlp));
    S.chug = mod(1, 0.22, rT.gain);
    mod(0.083, 0.2, rT.gain);

    // 4. sub rumble
    S.subG = g(0, S.master);
    const subT = g(0.7, S.subG);
    mod(0.1, 0.3, subT.gain);
    for (const f of [33, 34.3]) {
      const o = ctx.createOscillator();
      o.frequency.value = f; o.connect(g(0.5, subT)); o.start(t);
    }
    loop('brown', 0.7, g(2.5, flt('lowpass', 55, 0.7, subT)));

    // 5. debris rattle + grind
    S.debG = g(0, S.master);
    S.deb1 = flt('bandpass', 2000, 0.7, pan(-0.25, S.debG));
    S.deb2 = flt('bandpass', 900, 1, pan(0.3, S.debG));
    loop('crackle', 1, S.deb1); loop('crackle', 0.63, S.deb2);
    S.grindG = g(0, S.master);
    const gT = g(0.5, S.grindG);
    mod(8.3, 0.5, gT.gain);
    loop('pink', 1.4, flt('bandpass', 350, 2.5, gT));

    // 9. low-hp tension drone (heartbeat itself is scheduled by the clock)
    S.tenG = g(0, S.master);
    const tlp = flt('lowpass', 320, 1, S.tenG);
    for (const f of [73.42, 77.78]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f; o.connect(g(0.3, tlp)); o.start(t);
    }
    S.hbBus = g(1, N.stormBus);
    return S;
  }

  function stormLayer(kind) {
    const S = storm;
    if (S.opt[kind]) return S.opt[kind];
    const { g, flt, pan, loop, mod } = S;
    const out = g(0, S.master);
    if (kind === 'fire') {
      loop('crackle', 0.7, g(3, flt('bandpass', 1100, 0.7, pan(0.2, out))));
      loop('crackle', 1.15, g(2, flt('highpass', 2500, 0.7, pan(-0.3, out))));
      const fl = g(0.7, out);
      mod(6.3, 0.2, fl.gain); mod(11, 0.12, fl.gain);
      loop('brown', 1.2, g(3, flt('lowpass', 700, 0.7, fl)));
    } else if (kind === 'ice') {
      const src = loop('white', 1.1, g(1, null));
      [[5200, 20, 0.7, -0.5], [7100, 25, 1.1, 0.4], [9300, 25, 1.6, 0]].forEach(([f, q, rate, p]) => {
        const tg = g(0.5, pan(p, out));
        mod(rate, 0.5, tg.gain);
        src.connect(flt('bandpass', f, q, tg));
      });
      for (const [f, rate] of [[3136, 0.37], [4699, 0.53]]) {
        const tg = g(0.008, out);
        mod(rate, 0.008, tg.gain);
        const o = ctx.createOscillator();
        o.frequency.value = f; o.connect(tg); o.start(ctx.currentTime);
      }
    } else if (kind === 'electric') {
      const zap = g(0, out); // gain is driven by the crackle buffer => random arcing
      loop('crackle', 0.8, g(5, zap.gain));
      const hp = flt('highpass', 900, 0.7, zap);
      for (const [type, f] of [['sawtooth', 100], ['square', 150.7]]) {
        const o = ctx.createOscillator();
        o.type = type; o.frequency.value = f; o.connect(hp); o.start(ctx.currentTime);
      }
      const hum = ctx.createOscillator();
      hum.type = 'sawtooth'; hum.frequency.value = 50;
      hum.connect(g(0.12, flt('lowpass', 420, 0.7, out)));
      hum.start(ctx.currentTime);
    }
    S.opt[kind] = out;
    return out;
  }

  function setStorm(s) {
    if (!storm) storm = buildStorm();
    const S = storm;
    const now = ctx.currentTime;
    const set = (p, v, tc) => p.setTargetAtTime(v, now, tc);
    if (!s || s.off) {
      if (stormOn) { set(S.master.gain, 0, 0.3); stormOn = false; hb.on = false; }
      return;
    }
    // throttle automation spam: at most ~30 updates/s (always apply when the clock is not moving)
    if (stormOn && now > lastStormApply && now - lastStormApply < 0.033) return;
    lastStormApply = now;
    stormOn = true;
    const size = clamp(num(s.size, 0), 0, 6);
    const z = size / 6;
    const sp = clamp(num(s.speed, 0));
    const it = clamp(num(s.intensity, 0));
    const hp = clamp(num(s.hp, 1));

    set(S.master.gain, 0.5 + 0.5 * Math.pow(z, 0.8), 0.4);
    // whistle
    set(S.whG.gain, (1 - smooth(size, 0.4, 3.6)) * (0.55 + 0.45 * sp) * 5.5, 0.3);
    set(S.wh1.frequency, 1250 - 450 * z + 320 * sp, 0.3);
    set(S.wh2.frequency, 1950 - 600 * z + 420 * sp, 0.3);
    // body
    set(S.bodyG.gain, 0.5 + 0.55 * z + 0.25 * sp, 0.3);
    set(S.bA.frequency, 520 - 330 * z + 160 * sp, 0.3);
    set(S.bB.frequency, 580 - 360 * z + 180 * sp, 0.3);
    set(S.airG.gain, (0.05 + 0.3 * sp) * (0.5 + 0.5 * z), 0.2);
    // roar
    set(S.roarG.gain, Math.pow(z, 1.3) * (0.85 + 0.25 * it) * 1.5, 0.4);
    set(S.rlp.frequency, 140 + 260 * z + 160 * it, 0.3);
    set(S.chug.frequency, 0.6 + 2.4 * sp + z, 0.3);
    // sub
    set(S.subG.gain, Math.pow(smooth(size, 2.2, 6), 1.2) * 0.9, 0.5);
    // debris
    set(S.debG.gain, it * (0.5 + 1.2 * z), 0.12);
    set(S.deb1.frequency, 2500 - 1200 * z, 0.3);
    set(S.grindG.gain, it * z * 0.9, 0.15);
    // elemental layers (built lazily)
    for (const [kind, lvl] of [['fire', 0.55], ['ice', 0.5], ['electric', 0.35]]) {
      if (s[kind] || S.opt[kind]) set(stormLayer(kind).gain, s[kind] ? lvl : 0, 0.25);
    }
    // low hp
    const danger = hp < 0.25 ? 0.4 + 0.6 * (1 - hp / 0.25) : 0;
    set(S.tenG.gain, danger * 0.35, 0.3);
    hb.level = danger;
    hb.bpm = 84 + 70 * danger;
    if (danger > 0 && !hb.on) { hb.on = true; hb.next = now + 0.05; }
    if (danger === 0) hb.on = false;
  }

  function scheduleHeartbeat(until) {
    if (!hb.on || !storm) return;
    const now = ctx.currentTime;
    if (hb.next < now + 0.01) hb.next = now + 0.03;
    while (hb.next < until) {
      const o = note(hb.next, storm.hbBus, 0.9 * hb.level);
      tone(o, { f: [[0, 78], [0.09, 42]], dur: 0.16, vol: 1 });
      tone(o, { f: [[0, 68], [0.09, 38]], t: 0.17, dur: 0.18, vol: 0.7 });
      tone(o, { type: 'triangle', f: 1480, dur: 0.05, vol: 0.05 * hb.level });
      done(o);
      hb.next += 60 / hb.bpm;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Music: instruments
  // -------------------------------------------------------------------------------------------
  function note(t, bus, vel) {
    const out = ctx.createGain();
    out.gain.value = vel;
    out.connect(bus);
    return { t, f: 1, ff: 1, ln: 1, out, end: t };
  }
  function done(o) { tails.push({ out: o.out, end: o.end + 0.1 }); }

  const I = {
    taiko(t, bus, vel, size = 0.6) {
      const o = note(t, bus, vel);
      const f = 160 - 80 * size;
      tone(o, { f: [[0, f], [0.1, f * 0.42]], dur: 0.3 + 0.45 * size, vol: 1 });
      tone(o, { type: 'triangle', f: [[0, f * 2.3], [0.05, f]], dur: 0.08, vol: 0.35 });
      noise(o, { kind: 'pink', f: 600 + 600 * (1 - size), dur: 0.1, vol: 1.6 });
      done(o);
    },
    clack(t, bus, vel) {
      const o = note(t, bus, vel);
      noise(o, { type: 'bandpass', f: 1900, q: 3, dur: 0.05, vol: 1.2 });
      tone(o, { type: 'triangle', f: 430, dur: 0.04, vol: 0.4 });
      done(o);
    },
    hat(t, bus, vel) {
      const o = note(t, bus, vel);
      noise(o, { type: 'highpass', f: 7000, dur: 0.035, vol: 0.5 });
      done(o);
    },
    cymbal(t, bus, vel, dur = 1.6) {
      const o = note(t, bus, vel);
      noise(o, { type: 'highpass', f: 5500, dur, vol: 0.4 });
      noise(o, { type: 'bandpass', f: 9000, q: 2, dur: dur * 0.6, vol: 0.4 });
      done(o);
    },
    bass(t, bus, midi, dur, vel) {
      const o = note(t, bus, vel);
      const f = mtof(midi);
      const lp = F(o, 'lowpass', f * 8, 1.5);
      env(lp.frequency, t, [[0, fq(f * 9)], [dur, fq(f * 2.5), 'e']]);
      const ev = [[0, 0], [0.006, 1], [dur * 0.6, 0.6], [dur, 0]];
      tone(o, { type: 'sawtooth', f, dur, ev, vol: 0.55, dest: lp });
      tone(o, { type: 'square', f: f * 2, dur, ev, vol: 0.18, dest: lp, det: 6 });
      tone(o, { f, dur, ev, vol: 0.6 });
      done(o);
    },
    stac(t, bus, midi, dur, vel) {
      const o = note(t, bus, vel);
      const f = mtof(midi);
      const lp = F(o, 'lowpass', Math.min(5200, f * 6 + 900), 0.8);
      tone(o, { type: 'sawtooth', f, dur, a: 0.008, vol: 0.4, dest: lp, det: -8 });
      tone(o, { type: 'sawtooth', f, dur, a: 0.008, vol: 0.4, dest: lp, det: 8 });
      done(o);
    },
    brass(t, bus, midis, dur, vel) {
      const o = note(t, bus, vel);
      brassChord(o, midis.map(mtof), 0, dur, 0.3, 1500 + 2200 * clamp(vel));
      done(o);
    },
    pad(t, bus, midis, dur, vel, choir) {
      const o = note(t, bus, vel);
      const dest = choir
        ? bank(o, [[650, 3, 1], [1100, 4, 0.6], [2700, 5, 0.25]]).in
        : F(o, 'lowpass', 1500, 0.6);
      const total = dur + 0.6;
      const ev = [[0, 0], [Math.min(0.6, dur * 0.35), 1], [dur, 0.8], [total, 0]];
      for (const m of midis) {
        const f = mtof(m);
        tone(o, { type: 'sawtooth', f, dur: total, ev, vol: choir ? 0.5 : 0.16, dest, det: -9 });
        tone(o, { type: 'sawtooth', f, dur: total, ev, vol: choir ? 0.5 : 0.16, dest, det: 9 });
      }
      done(o);
    },
    drone(t, bus, midi, dur, vel) {
      const o = note(t, bus, vel);
      const f = mtof(midi);
      const ev = [[0, 0], [0.4, 1], [dur, 0.8], [dur + 0.5, 0]];
      tone(o, { f, dur: dur + 0.5, ev, vol: 0.6 });
      tone(o, { type: 'sawtooth', f, dur: dur + 0.5, ev, vol: 0.3, dest: F(o, 'lowpass', 260, 0.8) });
      done(o);
    },
    pizz(t, bus, midi, vel) {
      const o = note(t, bus, vel);
      const f = mtof(midi);
      tone(o, { type: 'triangle', f, dur: 0.32, vol: 0.8 });
      tone(o, { type: 'square', f, dur: 0.1, vol: 0.1 });
      noise(o, { type: 'bandpass', f: f * 3, q: 1, dur: 0.015, vol: 0.2 });
      done(o);
    },
    clar(t, bus, midi, dur, vel) {
      const o = note(t, bus, vel);
      const f = mtof(midi);
      const lp = F(o, 'lowpass', Math.min(4000, f * 4), 0.7);
      const ev = [[0, 0], [0.03, 1], [dur, 0.8], [dur + 0.1, 0]];
      const x = tone(o, { type: 'square', f, dur: dur + 0.1, ev, vol: 0.3, dest: lp });
      tone(o, { f, dur: dur + 0.1, ev, vol: 0.3 });
      lfo(o, { f: 5.5, depth: f * 0.006, dur: dur + 0.1, target: x.osc.frequency });
      tone(o, { f: f * 2, dur: 0.5, vol: 0.12 }); // celesta glint
      done(o);
    },
    alarm(t, bus, midi, dur, vel) {
      const o = note(t, bus, vel);
      const f = mtof(midi);
      const bp = F(o, 'bandpass', f * 2, 1.4);
      const ev = [[0, 0], [0.01, 1], [dur - 0.02, 1], [dur, 0]];
      tone(o, { type: 'square', f: [[0, f], [dur, f * 1.03]], dur, ev, vol: 0.4, dest: bp });
      tone(o, { type: 'sawtooth', f: f * 1.006, dur, ev, vol: 0.25, dest: bp });
      done(o);
    },
    wah(t, bus, midi, dur, vel) {
      const o = note(t, bus, vel);
      const f = mtof(midi);
      const bp = F(o, 'bandpass', 1300, 2.5);
      env(bp.frequency, t, [[0, 1500], [dur, 420, 'e']]);
      const ev = [[0, 0], [0.04, 1], [dur * 0.8, 0.8], [dur, 0]];
      const x = tone(o, { type: 'sawtooth', f: [[0, f], [dur * 0.6, f], [dur, f * 0.955]], dur, ev, vol: 1.2, dest: bp });
      lfo(o, { f: 5.5, depth: f * 0.012, dur, target: x.osc.frequency });
      done(o);
    },
  };

  // -------------------------------------------------------------------------------------------
  // Music: states. step(t, bar, step, sd, intensity, bus)
  // -------------------------------------------------------------------------------------------
  const lay = (i, thr) => clamp((i - thr) / 0.12);
  const STATES = {
    menu: {
      bpm: 84, steps: 16,
      step(t, bar, s, sd, i, bus) {
        const b = bar % 8;
        const c = PROG[b];
        const barDur = sd * 16;
        if (s === 0) {
          I.pad(t, bus, c.ch, barDur, 0.5);
          I.pad(t, bus, [c.ch[0] + 12, c.ch[2]], barDur, 0.045 + 0.03 * i, true);
          I.drone(t, bus, c.r, barDur, 0.5);
          if (b % 2 === 0) I.taiko(t, bus, 0.75, 1);
        }
        if (s === 0 || s === 4 || s === 6 || s === 10 || s === 12) I.stac(t, bus, c.r + 12, 0.16, s === 0 ? 0.3 : 0.2);
        if (b % 2 === 1 && (s === 10 || s === 12)) I.taiko(t, bus, 0.3, 0.7);
        if (b === 7 && s >= 8) I.taiko(t, bus, 0.12 + 0.05 * (s - 8), 0.5);
        for (const [hs, m, len] of HOOK[b]) {
          if (hs === s) {
            I.clar(t, bus, m, len * sd * 0.92, 0.55);
            if (bar >= 8) I.pizz(t, bus, m + 12, 0.12);
          }
        }
      },
    },
    calm: {
      bpm: 126, steps: 16,
      step(t, bar, s, sd, i, bus) {
        const b = bar % 8;
        const c = PROG[b];
        if (s === 0) {
          I.pizz(t, bus, c.r + 12, 0.75);
          I.bass(t, bus, c.r, 0.3, 0.45);
          I.pad(t, bus, c.ch, sd * 16, 0.2 + 0.15 * i);
          if (b % 2 === 0) I.taiko(t, bus, 0.4, 0.9);
        }
        if (s === 10) I.pizz(t, bus, c.r + 19, 0.5);
        if (s === 6 && b % 2 === 1) I.pizz(t, bus, c.r + 24, 0.4);
        if (s === 4 || s === 12) I.hat(t, bus, 0.35);
        if (i > 0.5 && s % 2 === 0) I.hat(t, bus, 0.15);
        if (i > 0.3 && s === 8) I.taiko(t, bus, 0.25, 0.4);
        if (b >= 6 || (i > 0.5 && (b === 2 || b === 3))) {
          for (const [hs, m] of HOOK[b]) if (hs === s) I.pizz(t, bus, m, 0.6);
        }
      },
    },
    action: {
      bpm: 126, steps: 16,
      step(t, bar, s, sd, i, bus) {
        const b = bar % 8;
        const c = PROG[b];
        const third = c.ch[1] % 12 === (c.r + 4) % 12 ? 4 : 3;
        const k = 0.65 + 0.35 * i;
        // L1 percussion (always)
        if (s === 0 || s === 8) I.taiko(t, bus, 0.95 * k, 1);
        else if (s === 6) I.taiko(t, bus, 0.7 * k, 0.75);
        else if (s === 3 || s === 11 || s === 14) I.taiko(t, bus, 0.4 * k, 0.4);
        if (b % 4 === 3 && s >= 12) I.taiko(t, bus, (0.35 + 0.12 * (s - 12)) * k, 0.55);
        if (i > 0.1 && (s % 2 === 0 || i > 0.5)) I.hat(t, bus, s % 4 === 2 ? 0.4 : 0.22);
        if (i > 0.3 && (s === 4 || s === 12)) I.clack(t, bus, 0.5);
        // L2 bass ostinato
        const l2 = lay(i, 0.2);
        if (l2 > 0) {
          const iv = [0, third, 7, 12][OST[s]];
          I.bass(t, bus, c.r + iv, sd * 0.9, (s % 4 === 0 ? 0.6 : 0.42) * l2);
        }
        // L3 staccato strings
        const l3 = lay(i, 0.4);
        if (l3 > 0 && STR_STEPS[s]) {
          const m = c.ch[(s >> 1) % 3] + (s % 8 === 6 ? 12 : 0);
          I.stac(t, bus, m, 0.13, (s % 4 === 0 ? 0.42 : 0.28) * l3);
          if (s % 4 === 0) I.stac(t, bus, c.ch[0] - 12, 0.13, 0.3 * l3);
        }
        // L4 brass: stabs, then the hook
        const l4 = lay(i, 0.6);
        if (l4 > 0) {
          if (s === 0) I.brass(t, bus, [c.r + 12, c.r + 19, c.ch[1]], 0.4, 0.5 * l4);
          if (b % 2 === 1 && (s === 6 || s === 11)) I.brass(t, bus, [c.r + 12, c.ch[2]], 0.2, 0.4 * l4);
          const l4b = lay(i, 0.72);
          if (l4b > 0) {
            for (const [hs, m, len] of HOOK[b]) {
              if (hs === s) I.brass(t, bus, [m - 12, m], Math.max(0.14, len * sd * 0.9), 0.5 * l4b);
            }
          }
        }
        // L5 choir pad
        const l5 = lay(i, 0.82);
        if (l5 > 0 && s === 0) {
          I.pad(t, bus, [c.ch[0], c.ch[1], c.ch[2], c.ch[0] + 12], sd * 16, 0.11 * l5, true);
          if (b % 4 === 0) I.cymbal(t, bus, 0.3 * l5);
        }
      },
    },
    boss: {
      bpm: 152, steps: 14,
      step(t, bar, s, sd, i, bus) {
        const b = bar % 8;
        const c = BPROG[b];
        const k = 0.75 + 0.25 * i;
        // relentless riff
        I.bass(t, bus, c.r + RIFF[s], sd * 0.9, (s === 0 || s === 4 || s === 8 ? 0.62 : 0.45) * k);
        // drums 4+4+6
        if (s === 0 || s === 4 || s === 8) I.taiko(t, bus, 1.0 * k, 1);
        else if (s === 2 || s === 6 || s === 11) I.taiko(t, bus, 0.55 * k, 0.6);
        else if (i > 0.5 && (s === 12 || s === 13)) I.taiko(t, bus, 0.45 * k, 0.4);
        if (s === 6 || s === 11) I.clack(t, bus, 0.5);
        if (s % 2 === 0 || i > 0.3) I.hat(t, bus, s % 2 ? 0.2 : 0.35);
        // strings
        const l3 = lay(i, 0.25);
        if (l3 > 0 && (s % 2 === 0 || s === 11 || s === 13)) {
          I.stac(t, bus, c.ch[(s >> 1) % 3] + 12, 0.1, 0.3 * l3);
          if (s % 4 === 0) I.stac(t, bus, c.ch[0], 0.1, 0.3 * l3);
        }
        // alarm motif (tritone A - Eb), bars 3-4 of every 4
        if (b % 4 >= 2) {
          const av = 0.3 + 0.2 * i;
          if (s === 0) I.alarm(t, bus, 81, sd * 3.2, av);
          if (s === 4) I.alarm(t, bus, 75, sd * 3.2, av);
          if (s === 8) I.alarm(t, bus, 81, sd * 5, av);
        }
        // brass braams + answers
        if (s === 0 && b % 2 === 0) I.brass(t, bus, [c.r, c.r + 12, c.r + 19, c.r + 24], sd * 12, 0.55 + 0.25 * i);
        const l4 = lay(i, 0.45);
        if (l4 > 0 && b % 2 === 1 && (s === 8 || s === 11)) I.brass(t, bus, [c.r + 12, c.r + 13 + 12, c.ch[2]], 0.18, 0.45 * l4);
        // choir
        const l5 = lay(i, 0.7);
        if (l5 > 0 && s === 0) {
          I.pad(t, bus, [c.ch[0], c.ch[2], c.ch[0] + 12, c.ch[1] + 12], sd * 14, 0.11 * l5, true);
          if (b % 4 === 0) I.cymbal(t, bus, 0.3 * l5);
        }
      },
    },
    victory: {
      bpm: 126, steps: 16, oneShot: 4,
      step(t, bar, s, sd, i, bus) {
        const MEL = [
          [[0, 62, 2], [2, 62, 1], [3, 62, 1], [4, 66, 4], [8, 69, 4], [12, 66, 2], [14, 69, 2]],
          [[0, 74, 8], [8, 72, 4], [12, 72, 2], [14, 72, 2]],
          [[0, 70, 4], [4, 74, 4], [8, 72, 4], [12, 76, 4]],
          [[0, 78, 14]],
        ];
        const CH = [[50, 57, 62, 66], [50, 57, 62, 66], [46, 53, 58, 62], [50, 57, 62, 66, 69]];
        const DR = [[0, 8, 12, 14], [0, 8], [0, 4, 8, 12, 13, 14, 15], [0]];
        for (const [hs, m, len] of MEL[bar] || []) {
          if (hs === s) I.brass(t, bus, [m - 12, m], len * sd * 0.95, 0.65);
        }
        if (s === 0) {
          const c = CH[bar];
          I.pad(t, bus, c, sd * (bar === 3 ? 20 : 16), 0.4);
          I.bass(t, bus, c[0] - 12, sd * 8, 0.6);
          if (bar === 3) {
            I.pad(t, bus, [62, 66, 69, 74], sd * 20, 0.12, true);
            I.cymbal(t, bus, 0.5, 2.5);
            I.brass(t, bus, [50, 57, 62, 66], sd * 14, 0.6);
          }
        }
        if (bar === 1 && s === 8) I.bass(t, bus, 36, sd * 8, 0.6);
        if (bar === 2 && s === 8) I.bass(t, bus, 36, sd * 8, 0.6);
        if (DR[bar] && DR[bar].includes(s)) I.taiko(t, bus, bar === 3 ? 1 : 0.8, s % 8 === 0 ? 1 : 0.5);
        // the mischievous wink at the end
        if (bar === 3 && (s === 10 || s === 11 || s === 12)) I.pizz(t, bus, [86, 81, 86][s - 10] + (s === 12 ? 4 : 0), 0.5);
      },
    },
    defeat: {
      bpm: 84, steps: 16, oneShot: 3,
      step(t, bar, s, sd, i, bus) {
        const MEL = [[[0, 62, 6], [6, 60, 2], [8, 58, 8]], [[0, 57, 6], [6, 55, 2], [8, 57, 8]], []];
        const CH = [[50, 53, 57], [43, 46, 50], [50, 53, 57]];
        for (const [hs, m, len] of MEL[bar] || []) {
          if (hs === s) I.brass(t, bus, [m - 12, m], len * sd * 0.95, 0.4);
        }
        if (s === 0) {
          I.pad(t, bus, CH[bar], sd * 16, 0.4);
          I.drone(t, bus, CH[bar][0] - 12, sd * 16, 0.5);
          if (bar < 2) I.taiko(t, bus, 0.8, 1);
        }
        if (bar === 1 && s === 8) I.pad(t, bus, [45, 49, 52], sd * 8, 0.3);
        // sad-trombone-style chromatic slump
        if (bar === 2) {
          const k = [0, 3, 6, 9].indexOf(s);
          if (k >= 0) I.wah(t, bus, 65 - k, k === 3 ? sd * 7 : sd * 2.8, 0.55);
          if (s === 9) I.taiko(t, bus, 0.9, 1);
        }
      },
    },
  };

  // -------------------------------------------------------------------------------------------
  // Music: scheduler (audio-clock lookahead, bar-quantised transitions)
  // -------------------------------------------------------------------------------------------
  function switchTo(name, t) {
    const old = N.layer[M.bus].gain;
    const stinger = STATES[name] && STATES[name].oneShot;
    if (M.cur) {
      old.cancelScheduledValues(t);
      old.setTargetAtTime(0, t, name === 'none' ? 0.35 : stinger ? 0.08 : 0.16);
    }
    M.name = name;
    M.cur = STATES[name] || null;
    M.bar = 0;
    M.step = 0;
    if (M.cur) {
      M.bus ^= 1;
      const g = N.layer[M.bus].gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(1, t + 0.05);
      M.next = t;
    }
  }

  function scheduleMusic(until) {
    const now = ctx.currentTime;
    if (!M.cur) {
      if (M.want === 'none' || !STATES[M.want]) return;
      switchTo(M.want, now + 0.06);
    }
    // the tab stalled: drop the steps we missed instead of firing them late in a burst
    if (M.next < now + 0.005) {
      const sd = 60 / M.cur.bpm / 4;
      const skip = Math.ceil((now + 0.03 - M.next) / sd);
      M.next += skip * sd;
      const total = M.step + skip;
      M.bar += Math.floor(total / M.cur.steps);
      M.step = total % M.cur.steps;
    }
    while (M.cur && M.next < until) {
      if (M.cur.oneShot && M.bar >= M.cur.oneShot) {
        // stinger finished: let it ring out, then silence
        if (M.want === M.name) { M.want = 'none'; }
        const t = M.next + 1.2;
        N.layer[M.bus].gain.setTargetAtTime(0, t, 0.5);
        M.cur = null;
        M.name = 'none';
        if (M.want !== 'none') continue_start(M.next);
        break;
      }
      if (M.want !== M.name) {
        const stinger = STATES[M.want] && STATES[M.want].oneShot;
        if (M.step === 0 || (stinger && M.step % 4 === 0)) {
          switchTo(M.want, M.next);
          if (!M.cur) break;
        }
      }
      const sd = 60 / M.cur.bpm / 4;
      M.cur.step(M.next, M.bar, M.step, sd, M.inten, N.layer[M.bus]);
      M.next += sd;
      if (++M.step >= M.cur.steps) { M.step = 0; M.bar++; }
    }
  }
  function continue_start(t) {
    if (STATES[M.want]) switchTo(M.want, Math.max(t, ctx.currentTime + 0.06));
  }

  function setMusic(state, intensity) {
    if (intensity !== undefined) M.inten = clamp(num(intensity, M.inten));
    if (typeof state !== 'string' || !MUSIC_STATES.includes(state)) return;
    if (state === M.asked) return; // repeated calls (e.g. every frame) never retrigger stingers
    M.asked = state;
    M.want = state;
    if (!offline) tick();
  }

  function horizon() {
    return clamp(tickGap * 2.5, 0.3, 1.5);
  }
  function tick() {
    if (!ready || paused) return;
    const now = ctx.currentTime;
    if (lastTick) tickGap = tickGap * 0.5 + (now - lastTick) * 0.5; // adapts to timer throttling
    lastTick = now;
    const until = now + horizon();
    scheduleMusic(until);
    scheduleHeartbeat(until);
    sweep(now);
  }
  function pump(seconds) {
    const until = ctx.currentTime + Math.max(0, num(seconds, 0.3));
    scheduleMusic(until);
    scheduleHeartbeat(until);
    sweep(ctx.currentTime);
  }
  function startTimer() {
    if (offline || timer) return;
    lastTick = 0;
    timer = setInterval(() => {
      try { tick(); } catch (err) { if (strict) throw err; }
    }, 40);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }
  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  // -------------------------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------------------------
  function applyVolume() {
    const t = ctx.currentTime;
    N.master.gain.setTargetAtTime(vol.master, t, 0.03);
    N.musicBus.gain.setTargetAtTime(vol.music, t, 0.03);
    N.sfxBus.gain.setTargetAtTime(vol.sfx, t, 0.03);
    N.stormBus.gain.setTargetAtTime(vol.sfx, t, 0.03);
  }

  function init() {
    try {
      if (!ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC({ latencyHint: 'interactive' });
      }
      if (!ready) {
        offline = typeof ctx.startRendering === 'function';
        build();
        ready = true;
        startTimer();
      }
      if (!paused && !offline && ctx.state === 'suspended' && ctx.resume) {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
      return true;
    } catch (err) {
      if (strict) throw err;
      return false;
    }
  }

  return {
    init,
    isReady: () => ready,
    setVolume(v) {
      if (!v || typeof v !== 'object') return;
      for (const k of ['master', 'music', 'sfx']) {
        if (typeof v[k] === 'number' && Number.isFinite(v[k])) vol[k] = clamp(v[k]);
      }
      if (ready) { try { applyVolume(); } catch (err) { if (strict) throw err; } }
    },
    play: guard(play, false),
    setStorm: guard(setStorm),
    setMusic: guard(setMusic),
    suspend: guard(() => {
      paused = true;
      stopTimer();
      if (!offline && ctx.suspend) { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}); }
    }),
    resume: guard(() => {
      paused = false;
      if (!offline && ctx.resume) { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
      startTimer();
    }),
    // ---- extras for tools / tests (not needed by the game) ----
    pump: guard(pump),
    tick: guard(tick),
    getLevel: guard(() => {
      if (!N.analyser) return { peak: 0, rms: 0 };
      N.analyser.getFloatTimeDomainData(N.meterBuf);
      let peak = 0, sum = 0;
      for (let i = 0; i < N.meterBuf.length; i++) {
        const a = Math.abs(N.meterBuf[i]);
        if (a > peak) peak = a;
        sum += a * a;
      }
      return { peak, rms: Math.sqrt(sum / N.meterBuf.length) };
    }, { peak: 0, rms: 0 }),
    getStats: () => ({
      voices: voices.length, tails: tails.length, music: M.name, wanted: M.want, bar: M.bar, step: M.step,
    }),
    get context() { return ctx; },
  };
}

export default createAudio;
