// STORMZILLA renderer: reads the sim every frame and draws it. No game logic here.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PROPS, PROP_NAMES, TIERS } from '../game/defs.js';
import { zoneAt } from '../game/world.js';
import { buildModel } from './models.js';
import { makePropMaterial } from './propMaterial.js';
import { createTornado } from './tornado.js';
import { createFx } from './fx.js';
import { createGround, createSky } from './ground.js';

const SECTOR = 250;
const SECT = [250, 250, 420, 900, 3000, 3000];
const ST = { REST: 0, SUCK: 1, ORBIT: 2, FLUNG: 3, DEAD: 4, COLLAPSE: 5, DIGEST: 6, LIVE: 7 };
const DYN_CAP = { chunk_plank: 420, chunk_brick: 420, chunk_roof: 300, chunk_wall: 300, chunk_concrete: 300, chunk_glass: 300, chunk_steel: 300, chunk_slab: 200, corn: 300, pumpkin: 200, person: 260, car: 200, fence: 160, cow: 160, missile: 120, shark: 80 };
const GRADE = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.9 }, uSat: { value: 1.08 }, uHurt: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uTime: { value: 0 }, uGrain: { value: 0.035 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uVig, uSat, uHurt, uTime, uGrain; uniform vec3 uTint; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r2 = dot(c, c);
      float ca = uHurt * 0.012 + r2 * 0.0025;
      vec3 col = vec3(texture2D(tDiffuse, vUv + c * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - c * ca).b);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSat) * uTint;
      col *= 1.0 - r2 * uVig;
      col = mix(col, vec3(0.9, 0.08, 0.05) * (l + 0.2), uHurt * smoothstep(0.08, 0.45, r2) * 0.8);
      col += (hash(vUv * 800.0 + uTime) - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

function fallbackGeo(def) {
  const g = new THREE.BoxGeometry(def.w, def.h, def.d).toNonIndexed(); g.translate(0, def.h / 2, 0);
  const n = g.attributes.position.count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(0.8), 3));
  g.setAttribute('tint', new THREE.Float32BufferAttribute(new Float32Array(n).fill(1), 1));
  g.setAttribute('glow', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  return g;
}

// crude far LOD: a box in the model's average colours (roof = average of the top quarter)
function lodGeo(src, def) {
  const p = src.attributes.position, c = src.attributes.color, t = src.attributes.tint, gl = src.attributes.glow;
  const a = [0, 0, 0, 0, 0, 0], b = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < p.count; i++) { const o = p.getY(i) > def.h * 0.72 ? b : a; o[0] += c.getX(i); o[1] += c.getY(i); o[2] += c.getZ(i); o[3] += t.getX(i); o[4] += gl.getX(i); o[5]++; }
  if (!b[5]) b.splice(0, 6, ...a);
  const g = new THREE.BoxGeometry(def.w * 0.92, def.h * 0.9, def.d * 0.92).toNonIndexed(); g.translate(0, def.h * 0.45, 0);
  const n = g.attributes.position.count, col = new Float32Array(n * 3), ti = new Float32Array(n), glo = new Float32Array(n);
  for (let i = 0; i < n; i++) { const top = g.attributes.normal.getY(i) > 0.5, o = top ? b : a, k = 1 / Math.max(1, o[5]); col[i * 3] = o[0] * k; col[i * 3 + 1] = o[1] * k; col[i * 3 + 2] = o[2] * k; ti[i] = o[3] * k; glo[i] = o[4] * k * 0.6; }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('tint', new THREE.Float32BufferAttribute(ti, 1)); g.setAttribute('glow', new THREE.Float32BufferAttribute(glo, 1));
  return g;
}

export function createRenderer(canvas, settings = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: !!settings.preserve });
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcfe6f5, 200, 2600);
  const camera = new THREE.PerspectiveCamera(48, 1, 1, 9000);
  const sun = new THREE.DirectionalLight(0xfff1d6, 3.0);
  const sunDir = new THREE.Vector3(0.55, 0.72, 0.42).normalize();
  sun.castShadow = true; sun.shadow.autoUpdate = false; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x6a7a4a, 1.3); scene.add(hemi);
  const flashLight = new THREE.PointLight(0xbfd8ff, 0, 0, 1.2); scene.add(flashLight);
  const fireLight = new THREE.PointLight(0xff7a2a, 0, 0, 1.4); scene.add(fireLight);

  const sky = createSky(); scene.add(sky.mesh);
  const propMat = makePropMaterial({ glow: 0.2 });
  const geos = {};
  for (const n of PROP_NAMES) { try { geos[n] = buildModel(n); } catch (e) { geos[n] = null; } if (!geos[n] || !geos[n].attributes || !geos[n].attributes.position) geos[n] = fallbackGeo(PROPS[n]); }

  const lods = {};
  for (const n of PROP_NAMES) { const d = PROPS[n]; if ((d.tier === 1 || d.tier === 2) && d.kind !== 'crit' && d.kind !== 'chunk' && d.kind !== 'enemy') lods[n] = lodGeo(geos[n], d); }
  let frameNo = 0;
  const tornado = createTornado(); scene.add(tornado.group);
  const twinsFx = [];
  const fx = createFx(scene);
  const worldGroup = new THREE.Group(); scene.add(worldGroup);
  let ground = null;
  // boss shield bubble
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uA: { value: 1 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vP = position; vec4 wp = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }',
    fragmentShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; uniform float uTime, uA; void main(){ float f = pow(1.0 - abs(dot(normalize(vN), vV)), 2.5); float hex = 0.5 + 0.5 * sin(vP.y * 40.0 + uTime * 4.0) * sin(atan(vP.z, vP.x) * 24.0); gl_FragColor = vec4(vec3(0.25, 0.75, 1.0) * (f * 1.6 + hex * 0.12), (f + 0.06) * uA); }' }));
  shield.visible = false; shield.renderOrder = 15; scene.add(shield);

  // post
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.7, 0.9);
  const grade = new ShaderPass(GRADE);
  composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(grade); composer.addPass(new OutputPass());

  let G = null, statics = [], dynMeshes = {}, shaking = new Set();
  let W = 1, H = 1, quality = settings.quality || 'high', resScale = 1;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), Sc = new THREE.Vector3(), C = new THREE.Color();
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const cam = { x: 0, z: 0, r: 3, shake: 0, kick: 0, yaw: 0, menu: 0 };
  const state = { flash: 0, hurt: 0, storm: 0, time: 0, fireGlow: 0 };
  const colA = new THREE.Color(), colB = new THREE.Color();

  function setMat(e, y = e.y, s = e.s, rx = e.rx, rz = e.rz) { E.set(rx, e.ry, rz, 'YXZ'); Q.setFromEuler(E); V.set(e.x, y, e.z); Sc.set(s, s, s); M.compose(V, Q, Sc); }

  function buildWorld(sim) {
    // dispose old
    for (const m of statics) { worldGroup.remove(m); m.dispose(); }
    statics = []; shaking.clear();
    if (!ground) { ground = createGround(sim.world, quality); scene.add(ground.group); }
    const buckets = new Map();
    for (let i = 0; i < sim.staticCount; i++) {
      const e = sim.ents[i];
      const ss = SECT[e.def.tier];
      const k = e.t + '|' + Math.floor(e.x / ss) + '|' + Math.floor(e.z / ss);
      let b = buckets.get(k); if (!b) buckets.set(k, (b = []));
      b.push(e);
    }
    for (const [k, list] of buckets) {
      const def = list[0].def;
      const mesh = new THREE.InstancedMesh(geos[def.name], propMat, list.length);
      mesh.castShadow = def.tier >= 1; mesh.receiveShadow = def.kind === 'bld';
      let cx = 0, cz = 0;
      list.forEach((e, i) => { e.mesh = mesh; e.slot = i; setMat(e); mesh.setMatrixAt(i, M); mesh.setColorAt(i, C.setHex(e.c)); cx += e.x; cz += e.z; });
      cx /= list.length; cz /= list.length;
      mesh.userData = { tier: def.tier, cx, cz, kind: def.kind, hi: geos[def.name], lo: lods[def.name] || null };
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
      let br = 0; for (const e of list) br = Math.max(br, Math.hypot(e.x - cx, e.z - cz)); mesh.userData.br = br;
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, def.h / 2, cz), br + def.h + Math.max(def.w, def.d) + (def.kind === 'crit' || def.kind === 'veh' ? 120 : 4));
      worldGroup.add(mesh); statics.push(mesh);
    }
    // dynamic pools
    for (const n of PROP_NAMES) {
      if (dynMeshes[n]) continue;
      const cap = DYN_CAP[n] || (PROPS[n].tier >= 3 ? 24 : 96);
      const mesh = new THREE.InstancedMesh(geos[n], propMat, cap);
      mesh.frustumCulled = false; mesh.castShadow = true; mesh.count = 0; mesh.userData.cap = cap;
      mesh.setColorAt(0, C.set(0xffffff));
      scene.add(mesh); dynMeshes[n] = mesh;
    }
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    W = w; H = h;
    const dpr = Math.min(window.devicePixelRatio || 1, quality === 'ultra' ? 2 : quality === 'high' ? 1.5 : 1) * (quality === 'low' ? 0.75 : 1) * resScale;
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr); composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    fx.setScale(h * dpr);
  }
  function setQuality(q) {
    quality = q;
    renderer.shadowMap.enabled = q !== 'low'; sun.castShadow = q !== 'low';
    const sm = q === 'ultra' ? 4096 : 2048;
    if (sun.shadow.mapSize.x !== sm) { sun.shadow.mapSize.set(sm, sm); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    bloom.enabled = q !== 'low';
    propMat.needsUpdate = true; if (ground) ground.group.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    resize();
  }

  // ---------- events from the sim ----------
  function onEvent(e) {
    const S = G.S;
    switch (e.e) {
      case 'unrest': { const en = e.ent; if (en.mesh) { en.mesh.setMatrixAt(en.slot, ZERO); en.mesh.instanceMatrix.needsUpdate = true; shaking.delete(en); } break; }
      case 'eat': { const en = e.ent; if (en.def.tier >= S.tier - 1 && Math.random() < 0.5) fx.soft.spawn(en.x, en.y + 0.5, en.z, 0, 2, 0, 0.5, 1 + en.rad, 3 + en.rad * 2, 0.8, 0.75, 0.65, 0.35, 0, 1); break; }
      case 'crack': { const b = e.ent; fx.dustBurst(b.x, b.def.h * b.s * 0.3, b.z, b.rad * 0.6, 4 + b.def.tier * 2); break; }
      case 'collapse': { const b = e.ent; fx.dustBurst(b.x, 1, b.z, b.rad * 1.1, 14 + b.def.tier * 9); fx.dustBurst(b.x, b.def.h * b.s * 0.5, b.z, b.rad * 0.7, 6 + b.def.tier * 4, [0.75, 0.72, 0.68]); addShake(0.12 + b.def.tier * 0.1, b.x, b.z); if (b.def.fx === 'water') for (let i = 0; i < 60; i++) fx.soft.spawn(b.x, b.def.h * 0.7, b.z, (Math.random() - 0.5) * 14, 10 + Math.random() * 16, (Math.random() - 0.5) * 14, 1.5, 1.5, 3, 0.55, 0.75, 1, 0.7, 22, 0.2); break; }
      case 'explosion': { fx.explosion(e.x, e.y, e.z, e.r * (e.hostile ? 0.6 : 0.5), e.big, e.ice); addShake(e.big >= 2 ? 1.6 : e.big ? 0.6 : 0.25, e.x, e.z); if (e.big) { state.flash = Math.max(state.flash, e.big >= 2 ? 1.5 : 0.35); } fx.dustBurst(e.x, 0.5, e.z, e.r * 0.5, 6); break; }
      case 'impact': { fx.dustBurst(e.x, e.y, e.z, e.r * 0.5, 5); fx.sparks(e.x, e.y + 1, e.z, 6); break; }
      case 'bolt': { const hh = G.funnelH() + 120; fx.bolt(e.x + (Math.random() - 0.5) * 60, hh, e.z + (Math.random() - 0.5) * 60, e.x, 0, e.z, { thick: 4, life: 0.26 }); fx.sparks(e.x, 1, e.z, 8, 0.7, 0.85, 1, 18); state.flash = Math.max(state.flash, 0.5); flashLight.position.set(e.x, 30, e.z); flashLight.intensity = 9000; break; }
      case 'arc': fx.bolt(e.x, e.y, e.z, e.tx, e.ty, e.tz, { thick: 3, life: 0.2, jitter: 0.2 }); fx.sparks(e.tx, e.ty, e.tz, 8, 0.7, 0.85, 1, 16); state.flash = Math.max(state.flash, 0.25); break;
      case 'tracer': fx.bolt(e.x, e.y, e.z, e.tx, e.ty, e.tz, { thick: 1, life: 0.07, jitter: 0, r: 1, g: 0.85, b: 0.4 }); break;
      case 'hit': fx.sparks(e.x, e.y, e.z, 5); break;
      case 'kill': { const en = e.ent; if (e.frozen) fx.sparks(en.x, en.y + 2, en.z, 24, 0.6, 0.85, 1, 20); break; }
      case 'tier': { state.flash = 1.2; addShake(1.2); for (let i = 0; i < 90; i++) { const a = i / 90 * 6.283, sp = 20 + S.r * 3; fx.soft.spawn(S.x + Math.cos(a) * S.r, 1, S.z + Math.sin(a) * S.r, Math.cos(a) * sp, 3, Math.sin(a) * sp, 1.6, 4 + S.r * 0.5, 14 + S.r, 0.9, 0.88, 0.8, 0.6, 0, 1.2); } break; }
      case 'dash': addShake(0.3); cam.kick = 1; break;
      case 'ult': state.flash = 1.4; addShake(1); break;
      case 'hurt': state.hurt = Math.min(1, state.hurt + 0.25 + e.dmg * 0.02); addShake(Math.min(0.9, 0.2 + e.dmg * 0.02)); break;
      case 'ignite': fx.sparks(e.ent.x, e.ent.def.h * 0.5, e.ent.z, 6, 1, 0.5, 0.1, 8); break;
      case 'freeze': fx.sparks(e.ent.x, e.ent.y + 2, e.ent.z, 14, 0.6, 0.9, 1, 8); break;
      case 'shielded': fx.sparks(e.x, 40, e.z, 10, 0.3, 0.8, 1, 30); break;
      case 'pylon': state.flash = 0.8; break;
      case 'stomp': fx.dustBurst(e.x, 1, e.z, 60, 60); addShake(1.2); break;
      case 'shellfire': fx.glow.spawn(e.x, e.y, e.z, 0, 0, 0, 0.12, 14, 4, 1, 0.8, 0.4, 1); fx.dustBurst(e.x, 1, e.z, 3, 3); break;
      case 'missilefire': fx.glow.spawn(e.x, e.y, e.z, 0, 0, 0, 0.15, 12, 3, 1, 0.7, 0.3, 1); break;
      case 'block': fx.sparks(e.x ?? S.x, e.y ?? 10, e.z ?? S.z, 14, 1, 0.9, 0.5, 22); break;
      case 'chomp': fx.sparks(e.x, e.y, e.z, 8, 1, 0.3, 0.3, 12); break;
      case 'boss': state.flash = 1; addShake(1.5); break;
    }
  }
  function addShake(a, x, z) {
    if (x !== undefined && G) { const d = Math.hypot(x - G.S.x, z - G.S.z); a *= Math.max(0.15, 1 - d / (300 + G.S.r * 8)); }
    cam.shake = Math.min(2.2, cam.shake + a);
  }

  function dynPut(name, e, y, s, rx, rz, tint) {
    const mesh = dynMeshes[name]; if (!mesh) return;
    const i = mesh.count; if (i >= mesh.userData.cap) return;
    setMat(e, y, s, rx, rz);
    mesh.setMatrixAt(i, M); mesh.setColorAt(i, C.setHex(tint ?? e.c)); mesh.count = i + 1;
  }

  const legE = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1, c: 0xffffff };
  function frame(dt, time, opts = {}) {
    if (!G) return;
    const S = G.S, up = S.up;
    state.time = time;
    const R = S.rShow, FH = G.funnelH();
    // ---- drain sim-side change lists
    for (const b of G.shaken) shaking.add(b); G.shaken.length = 0;
    for (const b of shaking) {
      if (b.st !== ST.REST) { shaking.delete(b); continue; }
      const f = 1 - Math.max(0, b.hp) / b.hpMax, j = b.shake > 0 ? Math.min(0.6, b.rad * 0.04) : 0;
      b.shake -= dt;
      const hh = b.def.h * b.s;
      E.set(Math.sin(b.id * 1.7) * f * 0.14 + (Math.random() - 0.5) * j * 0.02, b.ry, Math.cos(b.id * 2.3) * f * 0.14 + (Math.random() - 0.5) * j * 0.02, 'YXZ'); Q.setFromEuler(E);
      V.set(b.x + (Math.random() - 0.5) * j, -f * hh * 0.28, b.z + (Math.random() - 0.5) * j); Sc.set(b.s, b.s, b.s); M.compose(V, Q, Sc);
      b.mesh.setMatrixAt(b.slot, M); b.mesh.instanceMatrix.needsUpdate = true;
      if (b.shake > 0 && Math.random() < 0.3) fx.soft.spawn(b.x + (Math.random() - 0.5) * b.def.w * b.s, Math.random() * hh * (1 - f * 0.3), b.z + (Math.random() - 0.5) * b.def.d * b.s, (Math.random() - 0.5) * 6, 1 + Math.random() * 3, (Math.random() - 0.5) * 6, 1.2, 2 + b.rad * 0.2, 5 + b.rad * 0.5, 0.7, 0.67, 0.62, 0.4, -0.5, 1);
      if (b.shake <= -0.5) shaking.delete(b);
    }
    for (const c of G.moved) { if (c.st !== ST.REST || !c.mesh) continue; const hop = c.def.kind === 'crit' ? Math.abs(Math.sin(time * 13 + c.id)) * 0.45 * c.def.h * 0.4 : 0; setMat(c, hop); c.mesh.setMatrixAt(c.slot, M); c.mesh.instanceMatrix.needsUpdate = true; }
    G.moved.length = 0;

    // ---- dynamic instances
    for (const n in dynMeshes) dynMeshes[n].count = 0;
    for (const e of G.dyn) {
      if (e.st === ST.DEAD) continue;
      if (e.st === ST.COLLAPSE) {
        const f = 0.28 + 0.72 * e.p * e.p, hh = e.def.h * e.s;
        E.set(Math.sin(e.id * 1.7) * (0.14 + e.p * 0.25), e.ry, Math.cos(e.id * 2.3) * (0.14 + e.p * 0.25), 'YXZ'); Q.setFromEuler(E);
        V.set(e.x + (Math.random() - 0.5) * 0.6, -f * hh, e.z + (Math.random() - 0.5) * 0.6); Sc.set(e.s * (1 + e.p * 0.08), e.s, e.s * (1 + e.p * 0.08)); M.compose(V, Q, Sc);
        const mesh = dynMeshes[e.t]; if (mesh.count < mesh.userData.cap) { mesh.setMatrixAt(mesh.count, M); mesh.setColorAt(mesh.count, C.setHex(e.c)); mesh.count++; }
        if (Math.random() < 0.6) fx.soft.spawn(e.x + (Math.random() - 0.5) * e.def.w, Math.random() * hh * (1 - f), e.z + (Math.random() - 0.5) * e.def.d, (Math.random() - 0.5) * e.rad, 2, (Math.random() - 0.5) * e.rad, 1.6, 3 + e.rad * 0.3, 8 + e.rad * 0.7, 0.68, 0.64, 0.58, 0.5, -0.6, 1);
        continue;
      }
      const s = e.st === ST.DIGEST ? e.s * Math.max(0, 1 - e.p) : e.s;
      dynPut(e.t, e, e.y, s, e.rx, e.rz);
    }
    shield.visible = false;
    for (const en of G.enemies) {
      if (en.dead) continue;
      const tint = en.hitT > 0 ? 0xff8866 : en.c;
      if (en.t === 'boss_core') {
        dynPut('boss_core', en, en.y, 1, Math.sin(time * 1.3) * 0.02, 0, tint);
        const B = G.boss;
        for (let i = 0; i < 4; i++) {
          const a = en.ry + Math.PI / 4 + i * Math.PI / 2, ph = (B ? B.walk * 0.18 : 0) + (i % 2) * Math.PI;
          legE.x = en.x + Math.sin(a) * 34 + Math.sin(en.ry) * Math.sin(ph) * 6; legE.z = en.z + Math.cos(a) * 34 + Math.cos(en.ry) * Math.sin(ph) * 6; legE.ry = a;
          dynPut('boss_leg', legE, Math.max(0, Math.cos(ph)) * 5, 1, 0, 0, 0xffffff);
        }
        if (B && B.shield > 0) { shield.visible = true; shield.position.set(en.x, en.y + 20, en.z); shield.scale.setScalar(78); shield.material.uniforms.uTime.value = time; shield.material.uniforms.uA.value = 0.5 + B.shield * 0.5; }
        if (Math.random() < 0.3) fx.glow.spawn(en.x + (Math.random() - 0.5) * 30, en.y + 20 + Math.random() * 30, en.z + (Math.random() - 0.5) * 30, 0, 8, 0, 0.6, 6, 1, 1, 0.3, 0.15, 0.8);
        continue;
      }
      if (en.t === 'boss_pylon') {
        dynPut('boss_pylon', en, 0, 1, 0, 0, tint);
        if (G.boss && Math.random() < 0.12) fx.bolt(en.x, 28, en.z, G.boss.ent.x, G.boss.ent.y + 30, G.boss.ent.z, { thick: 2, life: 0.12, jitter: 0.06, r: 0.3, g: 0.8, b: 1 });
        continue;
      }
      dynPut(en.t, en, en.y, 1, en.rx, en.rz, tint);
      if (en.burn > 0 && Math.random() < 0.5) fx.glow.spawn(en.x, en.y + en.def.h, en.z, 0, 5, 0, 0.4, 4, 1, 1, 0.5, 0.1, 0.9);
    }
    for (const s of G.shots) {
      dynPut(s.t, s, s.y, s.s, s.rx, s.rz, s.c);
      if (s.t === 'missile') { fx.soft.spawn(s.x, s.y, s.z, 0, 0.5, 0, 0.7, 1.6, 4.5, 0.85, 0.85, 0.85, 0.5, 0, 0.5); fx.glow.spawn(s.x - s.vx * 0.02, s.y - s.vy * 0.02, s.z - s.vz * 0.02, 0, 0, 0, 0.1, 4, 1.5, s.k === 'cryo' ? 0.4 : 1, 0.7, s.k === 'cryo' ? 1 : 0.3, 1); }
    }
    for (const z of G.zones) {
      if (z.kind === 'bomb' && z.t < 1.3 && z.t > 0) { legE.x = z.x; legE.z = z.z; legE.ry = 0; dynPut('bomb', legE, z.t * 130, 3, Math.PI, 0, 0x444444); }
      else if (z.kind === 'hail') { for (let i = 0; i < 5; i++) { const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * z.r; fx.soft.spawn(z.x + Math.cos(a) * d, 50 + Math.random() * 20, z.z + Math.sin(a) * d, 3, -95, 0, 0.6, 1.8, 1.8, 0.85, 0.95, 1, 0.9, 0, 0); } }
    }
    for (const n in dynMeshes) { const m = dynMeshes[n]; if (m.count) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; m.visible = true; } else m.visible = false; }

    // ---- storm look
    const prog = Math.min(1, (S.tier + G.tierFrac()) / 5.2);
    state.storm += (prog - state.storm) * Math.min(1, dt);
    const st = state.storm;
    const tc = TIERS[Math.min(6, S.tier)].color;
    colB.set(tc).lerp(C.set(0xffffff), 0.25); colA.set(tc).multiplyScalar(0.62);
    if (up.sharknado) { colA.lerp(C.set(0x1a4a6a), 0.5); colB.lerp(C.set(0x9fd8f0), 0.4); }
    if (up.moneynado) { colB.lerp(C.set(0xb8e89a), 0.35); }
    if (up.magnetar) { colA.lerp(C.set(0x30343c), 0.5); }
    const hurtFlash = S.hurtT > 0 ? 0.5 : 0;
    const elec = (up.thunder ? 1 : 0) + (S.ultT > 0 ? 1.5 : 0) + (up.lightning ? 0.3 : 0);
    tornado.update({ x: S.x, z: S.z, r: R, h: FH, vx: S.vx, vz: S.vz, time, colA, colB, fire: up.firenado ? 1 : 0, ice: up.blizzard ? 1 : 0, elec, flash: state.flash * 0.4 + hurtFlash }, dt);
    tornado.group.visible = !(G.over && !G.won);
    while (twinsFx.length < G.twins.length) { const t = createTornado(); scene.add(t.group); twinsFx.push(t); }
    twinsFx.forEach((t, i) => { const T = G.twins[i]; t.group.visible = !!T; if (T) t.update({ x: T.x, z: T.z, r: T.r, h: T.r * 5.5 + 8, vx: 0, vz: 0, time: time + i * 3, colA, colB, fire: up.firenado ? 1 : 0, ice: up.blizzard ? 1 : 0, elec: 0, flash: 0 }, dt); });

    // ---- ambient emitters
    const zone = zoneAt(S.x, S.z), city = zone !== 'farm' && zone !== 'fair';
    const dr = city ? 0.52 : 0.6, dg = city ? 0.5 : 0.5, db = city ? 0.48 : 0.36;
    const nDust = Math.min(14, 3 + R * 0.25) * (opts.lowFx ? 0.5 : 1);
    for (let i = 0; i < nDust; i++) {
      const a = Math.random() * 6.283, d = R * (0.7 + Math.random() * 1.1);
      fx.soft.spawn(S.x + Math.cos(a) * d, Math.random() * R * 0.5, S.z + Math.sin(a) * d, -Math.sin(a) * R * 2, R * (0.2 + Math.random() * 0.9) + 1, Math.cos(a) * R * 2, 1.1 + Math.random() * 1.2,
        R * 0.5 + 1, R * 1.5 + 2.5, dr * (0.85 + Math.random() * 0.3), dg * (0.85 + Math.random() * 0.3), db * (0.85 + Math.random() * 0.3), 0.3, -0.4, 0.4, R * 9 + 10);
    }
    if (S.dashT > 0) for (let i = 0; i < 6; i++) fx.soft.spawn(S.x + (Math.random() - 0.5) * R * 2, Math.random() * R, S.z + (Math.random() - 0.5) * R * 2, -S.vx * 0.2, 2, -S.vz * 0.2, 0.8, R, R * 2.5, 0.9, 0.9, 0.9, 0.4, 0, 1);
    if (up.firenado) { for (let i = 0; i < 5; i++) { const a = Math.random() * 6.283, hh = Math.random(), d = R * (0.5 + 1.25 * Math.pow(hh, 1.25)); fx.glow.spawn(S.x + Math.cos(a) * d, hh * FH * 0.8, S.z + Math.sin(a) * d, -Math.sin(a) * R, R * 0.8 + 4, Math.cos(a) * R, 0.6 + Math.random() * 0.4, R * 0.2 + 1.2, 0.4, 1, 0.42 + Math.random() * 0.3, 0.06, 0.5, 0, 0.2, R * 7); } fireLight.position.set(S.x, R * 2 + 6, S.z); fireLight.intensity = 1200 + R * R * 10; fireLight.distance = R * 12 + 60; } else fireLight.intensity = 0;
    if (up.blizzard) for (let i = 0; i < 4; i++) { const a = Math.random() * 6.283, d = Math.random() * (R * 2.2 + 20); fx.soft.spawn(S.x + Math.cos(a) * d, Math.random() * FH * 0.5, S.z + Math.sin(a) * d, -Math.sin(a) * 6, -4, Math.cos(a) * 6, 1.6, 1.2, 1.2, 0.95, 0.98, 1, 0.9, 0, 0, R * 4); }
    if (up.moneynado && Math.random() < 0.5) { const a = Math.random() * 6.283, d = R * (0.8 + Math.random()); fx.soft.spawn(S.x + Math.cos(a) * d, Math.random() * FH * 0.4, S.z + Math.sin(a) * d, 0, 6, 0, 1.6, 1.6, 1.6, 0.45, 0.85, 0.4, 1, 0, 0, R * 8); }
    if (elec > 0.9 && Math.random() < 0.25 * elec) { const a = Math.random() * 6.283, h0 = Math.random() * FH * 0.7, h1 = h0 + FH * 0.25; const r0 = R * (0.5 + 1.25 * Math.pow(h0 / FH, 1.25)), r1 = R * (0.5 + 1.25 * Math.pow(h1 / FH, 1.25)); fx.bolt(S.x + Math.cos(a) * r0, h0, S.z + Math.sin(a) * r0, S.x + Math.cos(a + 0.8) * r1, h1, S.z + Math.sin(a + 0.8) * r1, { thick: 2, life: 0.12, jitter: 0.25 }); }
    // burning buildings
    let nb = 0;
    for (const b of G.burning) { if (b.st !== ST.REST || nb++ > 50) continue; const hh = b.def.h * b.s; for (let i = 0; i < 2; i++) fx.glow.spawn(b.x + (Math.random() - 0.5) * b.def.w * b.s, hh * (0.3 + Math.random() * 0.7), b.z + (Math.random() - 0.5) * b.def.d * b.s, 0, 5 + Math.random() * 6, 0, 0.6 + Math.random() * 0.5, 3 + b.rad * 0.35, 0.8, 1, 0.4 + Math.random() * 0.3, 0.08, 0.9); if (Math.random() < 0.3) fx.soft.spawn(b.x, hh, b.z, 2, 9, 1, 2.5, 4 + b.rad * 0.3, 12 + b.rad, 0.12, 0.12, 0.12, 0.5, 0, 0.3); }
    // rain when the sky has turned
    if (st > 0.25 && !opts.lowFx) { const n = Math.floor(st * 16); for (let i = 0; i < n; i++) { const rx = cam.x + (Math.random() - 0.5) * (200 + R * 14), rz = cam.z - Math.random() * (260 + R * 16) + 60; fx.soft.spawn(rx, 60 + R * 3 + Math.random() * 40, rz, 8, -140 - R, 0, 0.7, 1.1 + R * 0.03, 1.1 + R * 0.03, 0.75, 0.82, 0.95, 0.5, 0, 0); } }

    fx.update(dt, time, S.x, S.z, G.zones);

    // ---- environment mood
    state.flash = Math.max(0, state.flash - dt * 3.2); state.hurt = Math.max(0, state.hurt - dt * 1.6);
    flashLight.intensity *= Math.max(0, 1 - dt * 12);
    sky.mat.uniforms.uStorm.value = st; sky.mat.uniforms.uTime.value = time; sky.mat.uniforms.uFlash.value = state.flash;
    sky.mat.uniforms.uTop.value.set(0x3d86d6).lerp(C.set(0x14161f), st);
    sky.mat.uniforms.uHor.value.set(0xcfe6f5).lerp(C.set(0x5d6f6b), st);
    scene.fog.color.copy(sky.mat.uniforms.uHor.value).lerp(C.set(0x8b97a0), st * 0.3);
    sun.intensity = 3.0 - st * 2.0 + state.flash * 2.5; sun.color.set(0xfff1d6).lerp(C.set(0xb9c6d8), st);
    hemi.intensity = 1.3 - st * 0.5 + state.flash * 1.5; hemi.color.set(0xbcd8ff).lerp(C.set(0x6f7f95), st);
    propMat.glow = 0.15 + st * 1.5;
    renderer.toneMappingExposure = 1.05 - st * 0.12;
    bloom.strength = 0.4 + st * 0.3 + state.flash * 0.25;
    grade.uniforms.uHurt.value = Math.min(1, state.hurt + (opts.lowHp ? 0.25 + 0.15 * Math.sin(time * 6) : 0));
    grade.uniforms.uTime.value = time % 100; grade.uniforms.uVig.value = 0.85 + st * 0.5; grade.uniforms.uSat.value = 1.1 - st * 0.12;

    // ---- camera
    cam.r += (R - cam.r) * Math.min(1, dt * 1.6);
    const cr = cam.r, kx = S.x + S.vx * 0.25, kz = S.z + S.vz * 0.25;
    cam.x += (kx - cam.x) * Math.min(1, dt * 5); cam.z += (kz - cam.z) * Math.min(1, dt * 5);
    let dist = 27 + cr * 5.0, height = 20 + cr * 3.5;
    cam.shake = Math.max(0, cam.shake - dt * 2.4); cam.kick = Math.max(0, cam.kick - dt * 2.5);
    const sh = cam.shake * cam.shake * (settings.shake ?? 1) * (1.2 + cr * 0.12);
    const sxo = (Math.random() - 0.5) * sh, syo = (Math.random() - 0.5) * sh;
    if (opts.menu) { cam.yaw += dt * 0.12; dist *= 0.85; height *= 0.55; }
    else cam.yaw += (0 - cam.yaw) * Math.min(1, dt * 3);
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    camera.position.set(cam.x + sy * dist + sxo, height + syo, cam.z + cy * dist);
    camera.lookAt(cam.x - sy * cr * 2.2 + sxo * 0.5, cr * (opts.menu ? 3.2 : 1.6) + syo * 0.5, cam.z - cy * cr * 2.2);
    const fov = 48 + cam.kick * 7 + (S.ultT > 0 ? 5 : 0);
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 8); camera.updateProjectionMatrix(); }
    scene.fog.near = dist * 1.6 + 120; scene.fog.far = dist * 7 + 1900 - st * 500;
    sky.mesh.position.copy(camera.position);
    // shadows follow the action
    const ss = Math.min(900, 80 + cr * 9);
    sun.target.position.set(cam.x, 0, cam.z - cr * 2); sun.position.copy(sun.target.position).addScaledVector(sunDir, 900);
    const sc = sun.shadow.camera; if (sc.right !== ss) { sc.left = -ss; sc.right = ss; sc.top = ss; sc.bottom = -ss; sc.near = 50; sc.far = 2200; sc.updateProjectionMatrix(); }
    // small-prop distance culling
    const visT = [190 + cr * 8, 380 + cr * 12, 650 + cr * 18], hide0 = cr > 28, hide1 = cr > 52, lodD = 240 + cr * 5, fx0 = cam.x - sy * dist * 0.5, fz0 = cam.z - cy * dist * 0.5;
    for (const m of statics) { const u = m.userData; if (u.tier > 2) { m.visible = true; continue; } const d = Math.hypot(u.cx - fx0, u.cz - fz0); m.visible = !(u.tier === 0 && hide0) && !(u.tier === 1 && hide1) && d < visT[u.tier] + u.br; m.castShadow = u.tier > 0 && d < 200 + cr * 10 + u.br; if (u.lo) { const g = d > lodD + u.br ? u.lo : u.hi; if (m.geometry !== g) m.geometry = g; } }
    frameNo++; sun.shadow.needsUpdate = frameNo % 2 === 0;

    composer.render();
  }

  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
  return {
    renderer, scene, camera, fx, state,
    setSim(sim) { G = sim; buildWorld(sim); cam.x = sim.S.x; cam.z = sim.S.z; cam.r = sim.S.r; state.storm = 0; },
    onEvent, frame, resize, setQuality, addShake,
    setShake(v) { settings.shake = v; },
    setResScale(v) { if (Math.abs(v - resScale) > 0.01) { resScale = v; resize(); } }, getResScale: () => resScale,
    aim(nx, ny, out) { ndc.set(nx * 2 - 1, -(ny * 2 - 1)); ray.setFromCamera(ndc, camera); if (ray.ray.intersectPlane(plane, hit)) { out.x = hit.x; out.z = hit.z; return true; } return false; },
    project(x, y, z, out) { V.set(x, y, z).project(camera); out.x = V.x * 0.5 + 0.5; out.y = -V.y * 0.5 + 0.5; out.vis = V.z < 1; return out; },
    info: () => renderer.info.render,
  };
}
