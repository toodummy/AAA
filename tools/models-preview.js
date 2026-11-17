// STORMZILLA model viewer.  http://127.0.0.1:5201/tools/models.html
// URL params:
//   only=cow,car   show just these          tier=0..5|chunk|enemy   show one group
//   norm=1         scale every model to the same cell (contact sheet)   cols=N
//   az,el,zoom     camera azimuth/elevation (deg) and distance multiplier
//   glow=1.2  dusk=1  notint=1 (plain Mesh, tests white fallback)  tint=ff8800  spin=1  clean=1 (no HUD)  labels=0
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PROPS } from '../src/game/defs.js';
import { buildModel, MODEL_INFO } from '../src/render/models.js';
import { makePropMaterial } from '../src/render/propMaterial.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? parseFloat(q.get(k)) : d);
const dusk = q.get('dusk') === '1', norm = q.get('norm') === '1';
if (q.get('clean') === '1') document.body.classList.add('clean');

const groupOf = (d) => (d.kind === 'chunk' ? 'chunk' : d.kind === 'enemy' ? 'enemy' : String(d.tier));
const GROUPS = ['0', '1', '2', '3', '4', '5', 'chunk', 'enemy'];
let names = Object.keys(PROPS);
if (q.get('only')) names = q.get('only').split(',').filter((n) => PROPS[n]);
else if (q.get('tier')) names = names.filter((n) => groupOf(PROPS[n]) === q.get('tier'));

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = dusk ? 0.9 : 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const skyCol = new THREE.Color(dusk ? 0x39406b : 0xbfe0f4);
scene.background = skyCol;
const hemi = new THREE.HemisphereLight(dusk ? 0x6a78c0 : 0xdcefff, dusk ? 0x3a3550 : 0x9aa77c, dusk ? 0.75 : 1.25);
scene.add(hemi);
const sun = new THREE.DirectionalLight(dusk ? 0xffb080 : 0xfff2dc, dusk ? 0.9 : 2.6);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

const mat = makePropMaterial({ glow: num('glow', dusk ? 1.8 : 0.7) });

// ---------- tints (stand-in for the game's per-instance colours) ----------
const TINTS = {
  veh: [0xe2493b, 0x3f82d6, 0xf2f2f2, 0x35a99b, 0xf2b53a, 0x6b6f7a, 0x8a63c9],
  bld: [0xf4e3c1, 0xbfe0d8, 0xf6c9c0, 0xcfd9f2, 0xf7efb5, 0xe2d0f0, 0xffffff, 0xd9ead0],
  crit: [0xffffff, 0xf2dcc0, 0xd9a877, 0xfff4e0],
  prop: [0x3f82d6, 0xe2493b, 0x35a99b, 0xf2b53a, 0xffffff, 0xff86b4],
  enemy: [0xffffff], chunk: [0xf4e3c1, 0xbfe0d8, 0xf6c9c0],
};
const PERSON = [0xe2493b, 0x3f82d6, 0xf2b53a, 0x35a99b, 0xff86b4, 0xffffff];
function tintFor(name, i) {
  if (q.get('tint')) return new THREE.Color(parseInt(q.get('tint'), 16));
  const d = PROPS[name]; let pal = TINTS[d.kind] || TINTS.prop;
  if (name === 'person' || name === 'scarecrow') pal = PERSON;
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return new THREE.Color(pal[(h + i) % pal.length]);
}

// ---------- layout ----------
const root = new THREE.Group(); scene.add(root);
const labels = new THREE.Group(); scene.add(labels);
function label(text, sub, width) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 112;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(255,255,255,.86)'; c.beginPath(); c.roundRect(4, 4, 504, 104, 22); c.fill();
  c.fillStyle = '#1d2733'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = '700 50px system-ui, sans-serif'; c.fillText(text, 256, 42, 480);
  c.font = '500 28px system-ui, sans-serif'; c.fillStyle = '#5a6675'; c.fillText(sub, 256, 86, 480);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 112 / 512), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 2;
  return m;
}

const bounds = new THREE.Box3();
let totalTris = 0; const perGroup = {};
function place(name, x, z, cell, scale) {
  const d = PROPS[name], geo = buildModel(name), info = MODEL_INFO[name];
  let mesh;
  if (q.get('notint') === '1') mesh = new THREE.Mesh(geo, mat);
  else { mesh = new THREE.InstancedMesh(geo, mat, 1); mesh.setMatrixAt(0, new THREE.Matrix4()); mesh.setColorAt(0, tintFor(name, 0)); mesh.instanceColor.needsUpdate = true; }
  mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
  mesh.position.set(x, 0, z); mesh.scale.setScalar(scale); mesh.name = name;
  root.add(mesh);
  if (q.get('labels') !== '0') {
    const l = label(name, `${info.tris} tris  ${d.w}x${d.h}x${d.d}m`, Math.min(cell * 0.92, Math.max(cell * 0.5, 1.2)));
    l.position.set(x, 0.01 * cell, z + cell * 0.5 - cell * 0.09); labels.add(l);
  }
  bounds.expandByPoint(new THREE.Vector3(x - d.w * scale / 2, 0, z - d.d * scale / 2));
  bounds.expandByPoint(new THREE.Vector3(x + d.w * scale / 2, d.h * scale, z + d.d * scale / 2 + cell * 0.2));
  totalTris += info.tris; const gk = groupOf(d); (perGroup[gk] ||= { n: 0, tris: 0 }); perGroup[gk].n++; perGroup[gk].tris += info.tris;
}

let zCursor = 0;
for (const gk of GROUPS) {
  const list = names.filter((n) => groupOf(PROPS[n]) === gk);
  if (!list.length) continue;
  if (norm) {
    const cols = num('cols', Math.ceil(Math.sqrt(list.length * 1.7)));
    list.forEach((n, i) => { const d = PROPS[n]; place(n, (i % cols) * 1.7, zCursor + Math.floor(i / cols) * 1.9, 1.5, 1 / Math.max(d.w, d.h * 0.85, d.d)); });
    zCursor += Math.ceil(list.length / cols) * 1.9 + 0.4;
  } else {
    const cells = list.map((n) => Math.max(PROPS[n].w, PROPS[n].d) * 1.25 + 0.6);
    const rowW = num('roww', Math.max(Math.max(...cells), Math.sqrt(cells.reduce((a, c) => a + c * c, 0)) * 1.45));
    let x = 0, rowD = 0;
    list.forEach((n, i) => {
      const c = cells[i];
      if (x > 0 && x + c > rowW) { x = 0; zCursor += rowD; rowD = 0; }
      place(n, x + c / 2, zCursor + c / 2, c, 1); x += c; rowD = Math.max(rowD, c);
    });
    zCursor += rowD * 1.25;
  }
}

// ---------- ground + camera framing ----------
const size = bounds.getSize(new THREE.Vector3()), centre = bounds.getCenter(new THREE.Vector3());
const R = Math.max(size.x, size.z, size.y) * 0.5 + 0.01;
const ground = new THREE.Mesh(new THREE.CircleGeometry(R * 6, 64), new THREE.MeshLambertMaterial({ color: dusk ? 0x56705a : 0x9fcf86 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
scene.fog = new THREE.Fog(skyCol, R * 5, R * 16);

sun.position.set(centre.x + R * 1.2, R * 2.4 + size.y, centre.z + R * 1.6); sun.target.position.copy(centre);
const sc = sun.shadow.camera, ext = Math.hypot(size.x, size.z) * 0.6 + size.y * 0.8;
sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 0.1; sc.far = R * 8 + size.y * 3; sc.updateProjectionMatrix();

const camera = new THREE.PerspectiveCamera(num('fov', 32), innerWidth / innerHeight, R * 0.02, R * 60);
const az = num('az', 32) * Math.PI / 180, el = num('el', 28) * Math.PI / 180;
const fitH = Math.max(size.y, size.z * Math.sin(el) + size.y * Math.cos(el)), fitW = Math.hypot(size.x, size.z) * 0.9;
const tanH = Math.tan(camera.fov * Math.PI / 360);
const dist = Math.max(fitH / 2 / tanH, fitW / 2 / (tanH * camera.aspect)) * 1.12 * num('zoom', 1);
const target = new THREE.Vector3(centre.x, size.y * num('ty', 0.42), centre.z);
camera.position.set(target.x + Math.sin(az) * Math.cos(el) * dist, target.y + Math.sin(el) * dist, target.z + Math.cos(az) * Math.cos(el) * dist);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(target); controls.enableDamping = true; controls.autoRotate = q.get('spin') === '1'; controls.update();

// ---------- HUD ----------
const hud = document.getElementById('hud');
hud.innerHTML = `<b>STORMZILLA models</b> &nbsp; ${names.length} models, ${totalTris.toLocaleString()} tris<br>` +
  GROUPS.map((g) => `<a href="?tier=${g}&norm=1">${g}</a>`).join('') + `<a href="?">all</a><a href="?norm=1">sheet</a><a href="${location.search ? location.search + '&' : '?'}dusk=1">dusk</a><br>` +
  Object.entries(perGroup).map(([k, v]) => `${k}: ${v.n} / ${v.tris.toLocaleString()}t`).join(' &nbsp; ');
window.__info = { names, totalTris, perGroup, MODEL_INFO };

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
let frames = 0;
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); if (++frames === 3) window.__ready = true; });
