// Offline "listening" check for the STORMZILLA audio engine.
//   node tools/audio-check.mjs [--json out.json] [--only moo,baa]
// Renders every SFX, storm setting and music state through an OfflineAudioContext in headless
// Chrome (no server needed: the engine module is injected into about:blank) and analyses the
// buffers: peak, RMS, loudness, duration, spectral centroid, band energy, dropouts.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(root, 'src/audio/audio.js'), 'utf8');
const args = process.argv.slice(2);
const argOf = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const only = argOf('--only') ? argOf('--only').split(',') : null;

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
let results;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE', m.text()); else if (args.includes('--verbose')) console.error(m.text()); });
  await page.goto('about:blank');
  await page.addScriptTag({
    type: 'module',
    content: `${src}\nwindow.__audio = { createAudio, SFX_NAMES, MUSIC_STATES };`,
  });
  await page.waitForFunction(() => !!window.__audio);

  results = await page.evaluate(async (onlyNames) => {
    const { createAudio, SFX_NAMES } = window.__audio;
    const SR = 44100;
    let renderCount = 0;

    function fft(re, im) {
      const n = re.length;
      for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { const a = re[i]; re[i] = re[j]; re[j] = a; const b = im[i]; im[i] = im[j]; im[j] = b; }
      }
      for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        const wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
          let cr = 1, ci = 0;
          for (let k = 0; k < len / 2; k++) {
            const ur = re[i + k], ui = im[i + k];
            const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
            const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
            re[i + k] = ur + vr; im[i + k] = ui + vi;
            re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
            const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
          }
        }
      }
    }

    function analyse(buf) {
      const L = buf.getChannelData(0);
      const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
      const n = L.length;
      let peak = 0, last = 0, first = -1, nan = 0;
      const mono = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
        if (!(a === a)) nan++;
        if (a > peak) peak = a;
        if (a > 0.003) { last = i; if (first < 0) first = i; }
        mono[i] = (L[i] + R[i]) * 0.5;
      }
      const end = Math.max(last, 1);
      let sum = 0;
      for (let i = 0; i < end; i++) sum += (L[i] * L[i] + R[i] * R[i]) * 0.5;
      const rms = Math.sqrt(sum / end);
      // loudness: max 100 ms RMS; dropout: min 1 s RMS inside the active region
      const w = Math.floor(SR * 0.1);
      let loud = 0;
      const win = [];
      for (let i = 0; i + w <= n; i += w) {
        let s = 0;
        for (let k = i; k < i + w; k++) s += (L[k] * L[k] + R[k] * R[k]) * 0.5;
        const r = Math.sqrt(s / w);
        win.push(r);
        if (r > loud) loud = r;
      }
      let minSec = Infinity;
      for (let i = 5; i + 10 <= win.length - 5; i++) {
        let s = 0;
        for (let k = 0; k < 10; k++) s += win[i + k] * win[i + k];
        minSec = Math.min(minSec, Math.sqrt(s / 10));
      }
      // spectrum
      const N = 4096;
      const hann = new Float32Array(N);
      for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
      const pw = new Float64Array(N / 2);
      const re = new Float32Array(N), im = new Float32Array(N);
      for (let s = 0; s + N <= Math.max(end, N); s += N / 2) {
        for (let i = 0; i < N; i++) { re[i] = (mono[s + i] || 0) * hann[i]; im[i] = 0; }
        fft(re, im);
        for (let i = 0; i < N / 2; i++) pw[i] += re[i] * re[i] + im[i] * im[i];
      }
      let num = 0, den = 0, low = 0, sub = 0, high = 0, tot = 0;
      for (let i = 1; i < N / 2; i++) {
        const f = (i * SR) / N;
        const m = Math.sqrt(pw[i]);
        num += f * m; den += m;
        tot += pw[i];
        if (f < 80) sub += pw[i];
        if (f < 200) low += pw[i];
        if (f > 4000) high += pw[i];
      }
      const db = (x) => (x > 0 ? 20 * Math.log10(x) : -120);
      return {
        peak, rms, rmsDb: db(rms), loudDb: db(loud), dur: last / SR, start: Math.max(first, 0) / SR,
        centroid: den ? num / den : 0, sub: tot ? sub / tot : 0, low: tot ? low / tot : 0, high: tot ? high / tot : 0,
        minSecDb: db(minSec), nan,
      };
    }

    async function render(seconds, setup) {
      const t0 = performance.now(); renderCount++;
      const oc = new OfflineAudioContext(2, Math.floor(SR * seconds), SR);
      const audio = createAudio({ context: oc, strict: true });
      audio.init();
      await setup(audio, oc);
      // drive the scheduler like the realtime timer would (also exercises voice cleanup)
      const arm = (t) => {
        if (t < seconds - 0.05) oc.suspend(t).then(() => { audio.pump(0.45); arm(t + 0.2); oc.resume(); });
      };
      audio.pump(0.45);
      arm(0.2);
      const buf = await oc.startRendering();
      const t1 = performance.now();
      const res = analyse(buf);
      console.log('render #' + renderCount + ' ' + seconds + ' s audio: render ' + Math.round(t1 - t0) + ' ms, analyse ' + Math.round(performance.now() - t1) + ' ms');
      res.cpu = (t1 - t0) / (seconds * 1000);
      return res;
    }

    const out = { sfx: {}, storm: {}, music: {}, mix: {} };
    for (const name of SFX_NAMES) {
      if (onlyNames && !onlyNames.includes(name)) continue;
      out.sfx[name] = await render(9, (a) => { if (!a.play(name)) throw new Error('did not play ' + name); });
    }
    if (onlyNames) return out;
    // SFX option sanity: size and pitch must change weight/pitch
    out.mix.moo_small = await render(4, (a) => a.play('moo', { size: 0 }));
    out.mix.moo_big = await render(4, (a) => a.play('moo', { size: 1 }));
    out.mix.combo_lo = await render(2, (a) => a.play('combo_up', { pitch: 1 }));
    out.mix.combo_hi = await render(2, (a) => a.play('combo_up', { pitch: 2 }));
    out.mix.pan_left = await (async () => {
      const oc = new OfflineAudioContext(2, SR, SR);
      const a = createAudio({ context: oc, strict: true });
      a.init(); a.play('honk', { pan: -1 });
      const b = await oc.startRendering();
      const e = (c) => b.getChannelData(c).reduce((s, x) => s + x * x, 0);
      return { left: e(0), right: e(1) };
    })();

    const st = (o) => ({ size: 3, speed: 0.5, intensity: 0.5, hp: 1, ...o });
    for (let s = 0; s <= 6; s++) out.storm['size' + s] = await render(20, (a) => a.setStorm(st({ size: s })));
    out.storm.calm3 = await render(20, (a) => a.setStorm(st({ speed: 0, intensity: 0 })));
    out.storm.busy3 = await render(20, (a) => a.setStorm(st({ speed: 1, intensity: 1 })));
    out.storm.fire3 = await render(20, (a) => a.setStorm(st({ fire: true })));
    out.storm.ice3 = await render(20, (a) => a.setStorm(st({ ice: true })));
    out.storm.electric3 = await render(20, (a) => a.setStorm(st({ electric: true })));
    out.storm.lowhp3 = await render(20, (a) => { a.setStorm(st({ hp: 0.1 })); });
    out.storm.max6 = await render(20, (a) => {
      a.setStorm({ size: 6, speed: 1, intensity: 1, fire: true, ice: true, electric: true, hp: 0.05 });
     
    });

    const mus = (state, i, secs = 20) => render(secs, (a) => { a.setMusic(state, i); });
    out.music.menu = await mus('menu', 0.5, 24);
    out.music.calm_lo = await mus('calm', 0.1);
    out.music.calm_hi = await mus('calm', 0.9);
    for (const i of [0, 0.3, 0.5, 0.7, 1]) out.music['action_' + i] = await mus('action', i);
    out.music.boss_lo = await mus('boss', 0.2);
    out.music.boss_hi = await mus('boss', 1);
    out.music.victory = await mus('victory', 1);
    out.music.defeat = await mus('defeat', 1);

    // worst case: everything at once
    out.mix.apocalypse = await render(12, (a, oc) => {
      a.setStorm({ size: 6, speed: 1, intensity: 1, fire: true, ice: true, electric: true, hp: 0.05 });
      a.setMusic('boss', 1);
      for (const n of ['nuke', 'explode_big', 'collapse_big', 'boss_roar', 'thunder', 'tierup', 'explode', 'moo', 'scream',
        'shell_fire', 'missile_hit', 'lightning', 'crunch_concrete', 'crunch_metal', 'siren', 'warning']) {
        a.play(n, { vol: 2, size: 1 });
      }
    });
    // ducking: music level with and without a big explosion on top is covered by apocalypse peak;
    // typical gameplay mix:
    out.mix.gameplay = await render(12, (a) => {
      a.setStorm({ size: 3, speed: 0.6, intensity: 0.6, hp: 1 });
      a.setMusic('action', 0.7);
      a.play('crunch_wood'); a.play('moo'); a.play('explode');
    });
    return out;
  }, only);
} finally {
  await browser.close();
}

// ------------------------------------------------------------------------------------------------
const f = (x, d = 3) => (typeof x === 'number' ? x.toFixed(d) : String(x));
const pad = (s, n) => String(s).padEnd(n);
const row = (name, r) => `${pad(name, 17)} peak ${f(r.peak)}  rms ${f(r.rms)} (${f(r.rmsDb, 1).padStart(6)} dB)  `
  + `loud ${f(r.loudDb, 1).padStart(6)} dB  dur ${f(r.dur, 2).padStart(5)} s  centroid ${f(r.centroid, 0).padStart(5)} Hz  `
  + `<200Hz ${f(r.low * 100, 0).padStart(3)}%  >4k ${f(r.high * 100, 0).padStart(3)}%`
  + (r.minSecDb > -119 ? `  min1s ${f(r.minSecDb, 1)} dB` : '') + `  cpu ${f(r.cpu * 100, 1)}%`;
for (const group of ['sfx', 'storm', 'music', 'mix']) {
  console.log(`\n== ${group} ==`);
  for (const [k, r] of Object.entries(results[group])) {
    console.log(r.peak === undefined ? `${pad(k, 17)} ${JSON.stringify(r)}` : row(k, r));
  }
}
if (argOf('--json')) writeFileSync(argOf('--json'), JSON.stringify(results, null, 1));

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
const S = results.sfx;
for (const group of ['sfx', 'storm', 'music', 'mix']) {
  for (const [k, r] of Object.entries(results[group])) {
    if (r.peak === undefined) continue;
    check(r.nan === 0, `${k}: NaN samples`);
    check(r.peak <= 1.0, `${k}: clips (peak ${f(r.peak)})`);
    check(r.peak > 0.03, `${k}: silent (peak ${f(r.peak)})`);
  }
}
for (const [k, r] of Object.entries(S)) {
  check(r.loudDb > -24 && r.loudDb < -7, `${k}: loudness ${f(r.loudDb, 1)} dB outside -24..-7`);
  check(r.start < 0.05, `${k}: starts late (${f(r.start)} s)`);
  check(r.dur > 0.03 && r.dur < 8.9, `${k}: duration ${f(r.dur)} s`);
}
if (!only) {
  const lt = (a, b) => check(S[a].centroid < S[b].centroid, `centroid ${a} (${f(S[a].centroid, 0)}) should be below ${b} (${f(S[b].centroid, 0)})`);
  const below = (a, hz) => check(S[a].centroid < hz, `${a}: centroid ${f(S[a].centroid, 0)} should be < ${hz}`);
  const above = (a, hz) => check(S[a].centroid > hz, `${a}: centroid ${f(S[a].centroid, 0)} should be > ${hz}`);
  below('moo', 1000); below('nuke', 700); below('thunder', 700); below('boss_roar', 900); below('collapse_big', 1200);
  below('explode_big', 1500);
  above('crunch_glass', 3500); above('shatter', 3500); above('hail', 3000); above('ui_hover', 1500); above('freeze', 3500);
  above('cash', 2000); above('quack', 1200);
  lt('moo', 'baa'); lt('moo', 'cluck'); lt('moo', 'neigh'); lt('oink', 'cluck'); lt('crunch_concrete', 'crunch_glass');
  lt('crunch_wood', 'crunch_glass'); lt('explode_big', 'explode'); lt('thunder', 'lightning'); lt('suck_big', 'suck_small');
  check(S.nuke.dur > 4, 'nuke needs a long tail'); check(S.collapse_big.dur > 2.5, 'collapse_big should be long');
  check(S.news_jingle.dur > 1.7 && S.news_jingle.dur < 3.6, `news_jingle should be ~2 s (+reverb), is ${f(S.news_jingle.dur)}`);
  check(S.tierup.loudDb > S.ui_click.loudDb, 'tierup should be louder than ui_click');
  const X = results.mix;
  check(X.moo_big.centroid < X.moo_small.centroid, 'size=1 moo should be darker than size=0');
  check(X.moo_big.rms > X.moo_small.rms, 'size=1 moo should be heavier than size=0');
  check(X.combo_hi.centroid > X.combo_lo.centroid * 1.4, 'opts.pitch must raise combo_up');
  check(X.pan_left.left > X.pan_left.right * 20, 'pan=-1 should be left');
  const W = results.storm;
  for (let s = 1; s <= 6; s++) {
    check(W['size' + s].rms > W['size' + (s - 1)].rms * 0.98, `storm size ${s} should not be quieter than ${s - 1}`);
    check(W['size' + s].low >= W['size' + (s - 1)].low, `storm size ${s} should have more low end than ${s - 1}`);
  }
  check(W.size0.centroid > W.size6.centroid * 2, 'tiny storm should whistle, huge storm should roar');
  check(W.size6.rmsDb < -12, `storm bed too loud/fatiguing at F6 (${f(W.size6.rmsDb, 1)} dB)`);
  check(W.size0.rmsDb > -40, 'dust devil inaudible');
  check(W.busy3.rms > W.calm3.rms, 'speed/intensity should add energy');
  check(W.fire3.rms > W.size3.rms, 'fire adds a layer'); check(W.ice3.high > W.size3.high, 'ice adds shimmer');
  check(W.electric3.high > W.size3.high, 'electric adds buzz'); check(W.lowhp3.low > W.size3.low * 0.99, 'low hp adds heartbeat');
  for (const [k, r] of Object.entries(W)) check(r.minSecDb > r.rmsDb - 12, `storm ${k} has dropouts`);
  const Mu = results.music;
  for (const [k, r] of Object.entries(Mu)) {
    check(r.rmsDb > -32 && r.rmsDb < -12, `music ${k}: rms ${f(r.rmsDb, 1)} dB outside -32..-12`);
    if (k !== 'victory' && k !== 'defeat') check(r.minSecDb > -45, `music ${k} has a silent gap`);
  }
  check(Mu.action_1.rms > Mu.action_0.rms, 'action should grow with intensity');
  check(Mu.victory.dur >= 6 && Mu.victory.dur <= 11.5, `victory length ${f(Mu.victory.dur)} s`);
  check(Mu.defeat.dur >= 6 && Mu.defeat.dur <= 11.5, `defeat length ${f(Mu.defeat.dur)} s`);
}
console.log(fails.length ? `\nFAILED (${fails.length}):\n - ${fails.join('\n - ')}` : '\nALL AUDIO CHECKS PASSED');
process.exit(fails.length ? 1 : 0);
