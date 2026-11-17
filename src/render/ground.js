// Ground (painted from world data), sky dome and the mountain ring.
import * as THREE from 'three';
import { WORLD } from '../game/defs.js';
import { GRID, ROAD_W, CITY_R, zoneAt } from '../game/world.js';
import { makeRng } from '../core/rng.js';

const EXT = 1500; // half-size of the painted area in meters

export function createGround(world, quality) {
  const SIZE = quality === 'low' ? 2048 : 4096;
  const cv = document.createElement('canvas'); cv.width = cv.height = SIZE;
  const g = cv.getContext('2d');
  const k = SIZE / (EXT * 2);
  const X = (x) => (x + EXT) * k, L = (l) => l * k;
  const rng = makeRng(77);
  // base grass
  g.fillStyle = '#86b25a'; g.fillRect(0, 0, SIZE, SIZE);
  // big soft colour variation
  for (let i = 0; i < 500; i++) {
    const x = rng() * SIZE, y = rng() * SIZE, r = L(40 + rng() * 140);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const c = rng.pick(['120,170,80', '150,185,95', '105,150,70', '170,180,100']);
    gr.addColorStop(0, `rgba(${c},0.35)`); gr.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const rect = (p, fill) => { g.save(); g.translate(X(p.x), X(p.z)); if (p.rot) g.rotate(p.rot); fill(L(p.w), L(p.d)); g.restore(); };
  // farmland fields first
  for (const p of world.paint) {
    if (p.k !== 'rect' || p.field === undefined) continue;
    rect(p, (w, d) => {
      g.fillStyle = p.color; g.fillRect(-w / 2, -d / 2, w, d);
      g.strokeStyle = 'rgba(60,70,30,0.22)'; g.lineWidth = Math.max(1, L(0.7));
      const step = L(p.field === 2 ? 5 : 3.2);
      g.beginPath(); for (let y = -d / 2 + step / 2; y < d / 2; y += step) { g.moveTo(-w / 2, y); g.lineTo(w / 2, y); } g.stroke();
      g.strokeStyle = 'rgba(70,80,40,0.5)'; g.lineWidth = L(1.2); g.strokeRect(-w / 2, -d / 2, w, d);
    });
  }
  // city asphalt base: every block cell inside the city
  g.fillStyle = '#44464c';
  const N = Math.ceil(CITY_R / GRID);
  for (let i = -N; i < N; i++) for (let j = -N; j < N; j++) {
    const cx = i * GRID + GRID / 2, cz = j * GRID + GRID / 2;
    if (Math.hypot(cx, cz) > CITY_R) continue;
    g.fillRect(X(cx - GRID / 2) - 1, X(cz - GRID / 2) - 1, L(GRID) + 2, L(GRID) + 2);
    const z = zoneAt(cx, cz);
    if (z === 'military' || z === 'fair' || z === 'airport' || z === 'nuclear') continue;
  }
  // lane markings on the grid
  g.strokeStyle = 'rgba(240,220,120,0.55)'; g.lineWidth = Math.max(1, L(0.5)); g.setLineDash([L(4), L(5)]);
  g.beginPath();
  for (let i = -N + 1; i < N; i++) {
    const half = Math.sqrt(Math.max(0, CITY_R * CITY_R - (i * GRID) ** 2)) - 30;
    if (half <= 0) continue;
    g.moveTo(X(i * GRID), X(-half)); g.lineTo(X(i * GRID), X(half));
    g.moveTo(X(-half), X(i * GRID)); g.lineTo(X(half), X(i * GRID));
  }
  g.stroke(); g.setLineDash([]);
  // everything else in order
  for (const p of world.paint) {
    if (p.field !== undefined) continue;
    if (p.k === 'circle') {
      g.fillStyle = p.color; g.beginPath(); g.arc(X(p.x), X(p.z), L(p.r), 0, Math.PI * 2); g.fill();
      if (p.water) { g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = L(2); g.stroke(); for (let i = 0; i < 40; i++) { const a = rng() * 6.28, d = rng() * p.r * 0.9; g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(X(p.x + Math.cos(a) * d), X(p.z + Math.sin(a) * d), L(6), L(0.8)); } }
    } else {
      rect(p, (w, d) => {
        g.fillStyle = p.color; g.fillRect(-w / 2, -d / 2, w, d);
        if (p.road || p.runway) { g.strokeStyle = p.runway ? 'rgba(255,255,255,0.8)' : 'rgba(240,220,120,0.6)'; g.lineWidth = L(p.runway ? 1.4 : 0.5); g.setLineDash([L(p.runway ? 12 : 4), L(p.runway ? 10 : 5)]); g.beginPath(); if (w > d) { g.moveTo(-w / 2, 0); g.lineTo(w / 2, 0); } else { g.moveTo(0, -d / 2); g.lineTo(0, d / 2); } g.stroke(); g.setLineDash([]); }
        else if (!p.rot) { // sidewalk rim on city lots
          g.strokeStyle = 'rgba(210,208,200,0.9)'; g.lineWidth = L(2.2); g.strokeRect(-w / 2 + L(1.1), -d / 2 + L(1.1), w - L(2.2), d - L(2.2));
        }
      });
    }
  }
  // speckle noise for texture
  const img = g.getImageData(0, 0, SIZE, SIZE), dd = img.data;
  for (let i = 0; i < dd.length; i += 4) { const n = (rng() - 0.5) * 16; dd[i] += n; dd[i + 1] += n; dd[i + 2] += n; }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;

  // tiling detail noise so the ground holds up when the camera is close (F0/F1)
  const dc = document.createElement('canvas'); dc.width = dc.height = 256; const dg = dc.getContext('2d');
  const di = dg.createImageData(256, 256);
  for (let i = 0; i < di.data.length; i += 4) { const v = 200 + rng() * 55; di.data[i] = di.data[i + 1] = di.data[i + 2] = v; di.data[i + 3] = 255; }
  dg.putImageData(di, 0, 0);
  dg.globalAlpha = 0.25; for (let i = 0; i < 300; i++) { dg.fillStyle = rng() < 0.5 ? '#fff' : '#888'; dg.fillRect(rng() * 256, rng() * 256, 1 + rng() * 2, 3 + rng() * 5); }
  const dtex = new THREE.CanvasTexture(dc); dtex.wrapS = dtex.wrapT = THREE.RepeatWrapping; dtex.anisotropy = 4;

  const mat = new THREE.MeshLambertMaterial({ map: tex });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: dtex };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb *= mix(vec3(1.0), texture2D(uDetail, vMapUv * 260.0).rgb * 1.12, 0.55) * mix(vec3(1.0), texture2D(uDetail, vMapUv * 37.0).rgb * 1.1, 0.35);');
  };
  const geo = new THREE.PlaneGeometry(EXT * 2, EXT * 2, 1, 1); geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true;
  // far skirt beyond the painted area
  const skirt = new THREE.Mesh(new THREE.RingGeometry(EXT * 0.98, 9000, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x7ea757 }));
  skirt.position.y = -0.5;
  const group = new THREE.Group(); group.add(mesh, skirt);

  // mountain ring
  const mrng = makeRng(5);
  const SEG = 180, pos = [], col = [], idx = [];
  const ring = (r, hFn) => { for (let i = 0; i <= SEG; i++) { const a = i / SEG * Math.PI * 2; const h = hFn(i); pos.push(Math.cos(a) * r, h, Math.sin(a) * r); const t = Math.min(1, h / 420); const c = t > 0.72 ? [0.93, 0.95, 0.98] : t > 0.3 ? [0.42 + t * 0.2, 0.44 + t * 0.15, 0.42 + t * 0.2] : [0.36, 0.52, 0.3]; col.push(...c); } };
  const hs = []; for (let i = 0; i <= SEG; i++) hs.push(140 + mrng() * 300 + Math.sin(i * 0.31) * 60);
  hs[SEG] = hs[0];
  ring(WORLD.radius + 60, () => 0); ring(WORLD.radius + 260, (i) => hs[i] * 0.55 + mrng() * 20); ring(WORLD.radius + 520, (i) => hs[i]); ring(WORLD.radius + 900, (i) => hs[(i + 7) % SEG] * 0.7); ring(WORLD.radius + 1500, () => 0);
  for (let r = 0; r < 4; r++) for (let i = 0; i < SEG; i++) { const a = r * (SEG + 1) + i, b = a + SEG + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  let mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); mg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); mg.setIndex(idx);
  mg = mg.toNonIndexed(); mg.computeVertexNormals();
  const mountains = new THREE.Mesh(mg, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  group.add(mountains);
  return { group, tex };
}

const SKY_V = /* glsl */`varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0); gl_Position = p.xyww; }`;
const SKY_F = /* glsl */`
varying vec3 vDir; uniform vec3 uTop, uHor, uSun; uniform float uStorm, uTime, uFlash; uniform vec2 uCenter;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*vnoise(p); p = p*2.02 + 3.1; a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = mix(uHor, uTop, pow(h, 0.55));
  // cloud deck
  vec2 uv = d.xz / (d.y + 0.18) * 1.4;
  float ang = uTime * 0.03 * (1.0 + uStorm * 3.0);
  uv = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * uv;
  float c = fbm(uv * 1.3 + vec2(uTime * 0.01, 0.0));
  float cover = mix(0.62, 0.22, uStorm);
  float cl = smoothstep(cover, cover + 0.3, c) * smoothstep(-0.02, 0.2, d.y);
  vec3 cloudCol = mix(vec3(1.0, 0.98, 0.95), vec3(0.16, 0.17, 0.22), uStorm) * (0.75 + 0.5 * fbm(uv * 3.0));
  col = mix(col, cloudCol, cl * mix(0.85, 0.97, uStorm));
  float sun = pow(max(dot(d, normalize(uSun)), 0.0), 180.0) * (1.0 - uStorm);
  col += vec3(1.0, 0.9, 0.7) * sun * 2.0;
  col += vec3(0.7, 0.8, 1.0) * uFlash * (0.3 + cl);
  gl_FragColor = vec4(col, 1.0);
}`;
export function createSky() {
  const mat = new THREE.ShaderMaterial({ vertexShader: SKY_V, fragmentShader: SKY_F, side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: { uTop: { value: new THREE.Color(0x3d86d6) }, uHor: { value: new THREE.Color(0xcfe6f5) }, uSun: { value: new THREE.Vector3(0.5, 0.6, 0.3) }, uStorm: { value: 0 }, uTime: { value: 0 }, uFlash: { value: 0 }, uCenter: { value: new THREE.Vector2() } } });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -100;
  return { mesh, mat };
}
