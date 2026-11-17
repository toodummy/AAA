// Particles, lightning, telegraph decals, beams. All pooled, zero allocation per frame.
import * as THREE from 'three';

const PVERT = /* glsl */`
attribute vec4 pcolor; attribute float psize;
varying vec4 vC;
uniform float uScale;
void main(){
  vC = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(520.0, psize * uScale / max(1.0, -mv.z));
}`;
const PFRAG = /* glsl */`
varying vec4 vC; uniform float uSoft;
void main(){
  vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0;
  if (r > 1.0) discard;
  float a = mix(1.0 - r, (1.0 - r) * (1.0 - r), uSoft);
  gl_FragColor = vec4(vC.rgb, vC.a * a);
}`;

class Particles {
  constructor(max, additive) {
    this.max = max; this.n = 0; this.additive = additive;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    // sim arrays
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.swirl = new Float32Array(max);
    this.rgb = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({ vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uScale: { value: 600 }, uSoft: { value: additive ? 1 : 0.35 } } });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = additive ? 30 : 20;
    this.geo = g;
  }
  // o: x,y,z, vx,vy,vz, life, s0,s1, r,g,b,a, grav, drag, swirl
  spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, grav = 0, drag = 0, swirl = 0) {
    let i = this.n;
    if (i >= this.max) { i = (Math.random() * this.max) | 0; } else this.n++;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a;
    this.rgb[i3] = r; this.rgb[i3 + 1] = g; this.rgb[i3 + 2] = b;
    this.grav[i] = grav; this.drag[i] = drag; this.swirl[i] = swirl;
  }
  update(dt, cx, cz) {
    const { pos, vel, life, maxLife, s0, s1, a0, col, size, rgb, grav, drag, swirl } = this;
    let n = this.n;
    for (let i = 0; i < n; i++) {
      life[i] -= dt;
      if (life[i] <= 0) {
        n--;
        if (i !== n) {
          const i3 = i * 3, n3 = n * 3;
          pos[i3] = pos[n3]; pos[i3 + 1] = pos[n3 + 1]; pos[i3 + 2] = pos[n3 + 2];
          vel[i3] = vel[n3]; vel[i3 + 1] = vel[n3 + 1]; vel[i3 + 2] = vel[n3 + 2];
          rgb[i3] = rgb[n3]; rgb[i3 + 1] = rgb[n3 + 1]; rgb[i3 + 2] = rgb[n3 + 2];
          life[i] = life[n]; maxLife[i] = maxLife[n]; s0[i] = s0[n]; s1[i] = s1[n]; a0[i] = a0[n]; grav[i] = grav[n]; drag[i] = drag[n]; swirl[i] = swirl[n];
        }
        i--; continue;
      }
      const i3 = i * 3;
      if (swirl[i] !== 0) { // orbit around the storm axis
        const dx = pos[i3] - cx, dz = pos[i3 + 2] - cz, d = Math.sqrt(dx * dx + dz * dz) + 0.001;
        const w = swirl[i] / d;
        vel[i3] += (-dz * w - vel[i3] * 0.9 - dx / d * 2.0) * dt * 4;
        vel[i3 + 2] += (dx * w - vel[i3 + 2] * 0.9 - dz / d * 2.0) * dt * 4;
      }
      vel[i3 + 1] -= grav[i] * dt;
      if (drag[i] > 0) { const k = Math.max(0, 1 - drag[i] * dt); vel[i3] *= k; vel[i3 + 1] *= k; vel[i3 + 2] *= k; }
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      if (pos[i3 + 1] < 0.05 && grav[i] > 0) { pos[i3 + 1] = 0.05; vel[i3 + 1] *= -0.3; vel[i3] *= 0.6; vel[i3 + 2] *= 0.6; }
      const t = 1 - life[i] / maxLife[i];
      size[i] = s0[i] + (s1[i] - s0[i]) * t;
      const i4 = i * 4, fade = t < 0.1 ? t * 10 : 1 - (t - 0.1) / 0.9;
      col[i4] = rgb[i3]; col[i4 + 1] = rgb[i3 + 1]; col[i4 + 2] = rgb[i3 + 2]; col[i4 + 3] = a0[i] * fade;
    }
    this.n = n;
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.pcolor.needsUpdate = true; this.geo.attributes.psize.needsUpdate = true;
  }
}

const ZVERT = /* glsl */`
attribute vec4 zdata; // progress, kind, alpha, seed
varying vec2 vUv; varying vec4 vD;
void main(){ vUv = uv; vD = zdata; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;
const ZFRAG = /* glsl */`
varying vec2 vUv; varying vec4 vD; uniform float uTime;
void main(){
  vec2 p = vUv * 2.0 - 1.0; float r = length(p);
  if (r > 1.0) discard;
  float prog = vD.x, kind = vD.y;
  vec3 col; float a;
  if (kind < 0.5) { // hostile shell / bomb: red ring that fills
    float ring = smoothstep(0.86, 0.93, r) * (1.0 - smoothstep(0.97, 1.0, r));
    float fill = (1.0 - smoothstep(prog - 0.04, prog, r)) * 0.38;
    float pulse = 0.75 + 0.25 * sin(uTime * 18.0);
    col = mix(vec3(1.0, 0.16, 0.08), vec3(1.0, 0.75, 0.2), fill * 1.5) * 1.6;
    a = (ring * pulse + fill + 0.07) * vD.z;
    float cross = (1.0 - smoothstep(0.0, 0.03, abs(p.x))) + (1.0 - smoothstep(0.0, 0.03, abs(p.y)));
    a += cross * 0.25 * step(r, 0.25) * vD.z;
  } else if (kind < 1.5) { // friendly hail zone: icy
    float ring = smoothstep(0.9, 0.95, r);
    col = vec3(0.6, 0.85, 1.0) * 1.3; a = (ring * 0.7 + 0.12 + 0.1 * sin(r * 30.0 - uTime * 8.0)) * vD.z;
  } else { // shock ring
    float ring = smoothstep(0.80, 0.93, r) * (1.0 - smoothstep(0.96, 1.0, r));
    col = vec3(1.0, 0.35, 0.1) * 2.2; a = ring * vD.z;
  }
  gl_FragColor = vec4(col, a);
}`;

export function createFx(scene) {
  const soft = new Particles(9000, false);
  const glow = new Particles(5000, true);
  scene.add(soft.points, glow.points);

  // ---- lightning ----
  const MAXSEG = 3000;
  const lpos = new Float32Array(MAXSEG * 6), lcol = new Float32Array(MAXSEG * 6);
  const lgeo = new THREE.BufferGeometry();
  lgeo.setAttribute('position', new THREE.BufferAttribute(lpos, 3).setUsage(THREE.DynamicDrawUsage));
  lgeo.setAttribute('color', new THREE.BufferAttribute(lcol, 3).setUsage(THREE.DynamicDrawUsage));
  const lines = new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  lines.frustumCulled = false; lines.renderOrder = 40; scene.add(lines);
  const bolts = []; // {pts: Float32Array, n, life, max, r,g,b}
  function bolt(x0, y0, z0, x1, y1, z1, opt = {}) {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const segs = Math.min(26, Math.max(6, Math.floor(len / 5)));
    const jit = (opt.jitter ?? 0.12) * len / Math.sqrt(segs);
    const copies = opt.thick ?? 3;
    for (let c = 0; c < copies; c++) {
      const pts = [];
      let px = x0, py = y0, pz = z0;
      for (let i = 1; i <= segs; i++) {
        const t = i / segs, e = i === segs ? 0 : 1;
        const nx = x0 + (x1 - x0) * t + (Math.random() - 0.5) * jit * e * 2, ny = y0 + (y1 - y0) * t + (Math.random() - 0.5) * jit * e, nz = z0 + (z1 - z0) * t + (Math.random() - 0.5) * jit * e * 2;
        pts.push(px, py, pz, nx, ny, nz);
        // branches
        if (c === 0 && e && Math.random() < 0.18) { const bl = len * 0.12; pts.push(nx, ny, nz, nx + (Math.random() - 0.5) * bl * 2, ny - Math.random() * bl, nz + (Math.random() - 0.5) * bl * 2); }
        px = nx; py = ny; pz = nz;
      }
      bolts.push({ pts, life: opt.life ?? 0.22, max: opt.life ?? 0.22, r: opt.r ?? 0.75, g: opt.g ?? 0.85, b: opt.b ?? 1.0 });
    }
  }

  // ---- telegraph decals ----
  const MAXZ = 96;
  const zgeo = new THREE.PlaneGeometry(2, 2); zgeo.rotateX(-Math.PI / 2);
  const zdata = new THREE.InstancedBufferAttribute(new Float32Array(MAXZ * 4), 4).setUsage(THREE.DynamicDrawUsage);
  zgeo.setAttribute('zdata', zdata);
  const zmat = new THREE.ShaderMaterial({ vertexShader: ZVERT, fragmentShader: ZFRAG, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 } } });
  const zmesh = new THREE.InstancedMesh(zgeo, zmat, MAXZ);
  zmesh.frustumCulled = false; zmesh.renderOrder = 5; zmesh.count = 0; scene.add(zmesh);
  // beams
  const beamGeo = new THREE.BoxGeometry(1, 1, 1); beamGeo.translate(0, 0, 0.5);
  const beams = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xff3a1a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.visible = false; m.frustumCulled = false; scene.add(m); beams.push(m);
  }
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), Sc = new THREE.Vector3();

  return {
    soft, glow, bolt,
    update(dt, time, cx, cz, zones) {
      soft.update(dt, cx, cz); glow.update(dt, cx, cz);
      // lightning
      let k = 0;
      for (let i = bolts.length - 1; i >= 0; i--) {
        const b = bolts[i]; b.life -= dt;
        if (b.life <= 0) { bolts[i] = bolts[bolts.length - 1]; bolts.pop(); continue; }
        const f = (b.life / b.max) * (Math.random() < 0.25 ? 0.4 : 1) * 2.2;
        for (let j = 0; j < b.pts.length && k < MAXSEG * 6; j += 3, k += 3) {
          lpos[k] = b.pts[j]; lpos[k + 1] = b.pts[j + 1]; lpos[k + 2] = b.pts[j + 2];
          lcol[k] = b.r * f; lcol[k + 1] = b.g * f; lcol[k + 2] = b.b * f;
        }
      }
      lgeo.setDrawRange(0, k / 3); lgeo.attributes.position.needsUpdate = true; lgeo.attributes.color.needsUpdate = true;
      // zones
      zmat.uniforms.uTime.value = time;
      let n = 0, nb = 0;
      for (const b of beams) b.visible = false;
      for (const z of zones) {
        if (z.kind === 'beam') {
          if (nb < beams.length) {
            const m = beams[nb++]; m.visible = true;
            const w = z.live ? z.w * (0.8 + 0.2 * Math.sin(time * 40)) : 1.2;
            m.position.set(z.x, z.live ? 26 : 30, z.z); m.rotation.set(z.live ? 0.035 : 0.04, z.ang, 0); m.scale.set(w, z.live ? w * 0.6 : 0.8, z.len);
            m.material.opacity = z.live ? 0.95 : 0.25 + 0.2 * Math.sin(time * 25);
            m.material.color.setHex(z.live ? 0xff6a3a : 0xff2a1a);
          }
          continue;
        }
        if (n >= MAXZ) break;
        let r = z.r, prog = 0, kind = 0, alpha = 1;
        if (z.kind === 'ring') { kind = 2; if (!z.live) { r = z.maxR * 0.2; alpha = 0.4; } }
        else if (z.kind === 'hail') { kind = 1; alpha = Math.min(1, z.t * 2); }
        else { prog = 1 - z.t / z.dur; }
        V.set(z.x, 0.4, z.z); Sc.set(r, 1, r); Q.identity(); M.compose(V, Q, Sc);
        zmesh.setMatrixAt(n, M);
        zdata.setXYZW(n, prog, kind, alpha, 0);
        n++;
      }
      zmesh.count = n; zmesh.instanceMatrix.needsUpdate = true; zdata.needsUpdate = true;
    },
    setScale(h) { soft.mat.uniforms.uScale.value = h * 0.9; glow.mat.uniforms.uScale.value = h * 0.9; },
    // ---- canned effects ----
    dustBurst(x, y, z, r, n, col = [0.62, 0.56, 0.48]) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * r, sp = (0.4 + Math.random()) * r * 0.8;
        soft.spawn(x + Math.cos(a) * d, y + Math.random() * r * 0.5, z + Math.sin(a) * d, Math.cos(a) * sp, Math.random() * r * 0.5 + 1, Math.sin(a) * sp, 1.2 + Math.random() * 1.6,
          r * 0.5 + 1, r * 1.6 + 3, col[0] * (0.8 + Math.random() * 0.3), col[1] * (0.8 + Math.random() * 0.3), col[2] * (0.8 + Math.random() * 0.3), 0.5, -0.5, 1.2);
      }
    },
    explosion(x, y, z, r, big, ice) {
      const n = Math.min(90, 14 + r * 1.2);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, e = Math.random() * 1.5, sp = (0.3 + Math.random()) * r * 1.5;
        const vx = Math.cos(a) * Math.cos(e) * sp, vy = Math.sin(e) * sp, vz = Math.sin(a) * Math.cos(e) * sp;
        if (ice) glow.spawn(x, y, z, vx, vy, vz, 0.5 + Math.random() * 0.5, r * 0.35, r * 0.1, 0.5, 0.8, 1.0, 0.9, 0, 2.5);
        else glow.spawn(x, y, z, vx, vy, vz, 0.35 + Math.random() * 0.45, r * 0.5, r * 0.15, 1.0, 0.45 + Math.random() * 0.35, 0.1, 0.9, 0, 2.5);
      }
      glow.spawn(x, y + r * 0.2, z, 0, 0, 0, 0.18, r * 3.2, r * 1.2, 1, 0.9, 0.7, 1);
      for (let i = 0; i < n * 0.6; i++) {
        const a = Math.random() * 6.283, sp = Math.random() * r * 0.5;
        soft.spawn(x + Math.cos(a) * r * 0.3, y + Math.random() * r * 0.4, z + Math.sin(a) * r * 0.3, Math.cos(a) * sp, r * (0.3 + Math.random() * 0.6), Math.sin(a) * sp, 1.5 + Math.random() * 2,
          r * 0.5, r * 1.5, 0.16, 0.15, 0.15, 0.6, -1, 0.8);
      }
      if (big >= 2) { // mushroom
        for (let i = 0; i < 160; i++) {
          const a = Math.random() * 6.283, h = Math.random();
          const rr = h > 0.7 ? r * 0.35 * Math.random() : r * 0.1;
          soft.spawn(x + Math.cos(a) * rr, y + h * r * 0.2, z + Math.sin(a) * rr, Math.cos(a) * rr * 0.3, r * (0.25 + h * 0.5), Math.sin(a) * rr * 0.3, 4 + Math.random() * 3, r * 0.3, r * 0.7, 0.25, 0.22, 0.2, 0.7, -0.3, 0.35);
          glow.spawn(x + Math.cos(a) * rr, y + h * r * 0.2, z + Math.sin(a) * rr, Math.cos(a) * rr * 0.3, r * (0.25 + h * 0.5), Math.sin(a) * rr * 0.3, 1.5 + Math.random() * 1.5, r * 0.35, r * 0.2, 1, 0.5, 0.15, 0.7, 0, 0.4);
        }
      }
    },
    sparks(x, y, z, n, r = 1, g = 0.8, b = 0.3, sp = 14) {
      for (let i = 0; i < n; i++) { const a = Math.random() * 6.283; glow.spawn(x, y, z, Math.cos(a) * sp * Math.random(), sp * (0.3 + Math.random()), Math.sin(a) * sp * Math.random(), 0.3 + Math.random() * 0.5, 1.4, 0.3, r, g, b, 1, 26, 0.5); }
    },
  };
}
