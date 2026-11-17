// The hero visual: a layered, noise-driven funnel. Shape matches sim orbitPos():
// radius(h) = R * (0.5 + 1.25 * h^1.25), height = R*5.5 + 14.
import * as THREE from 'three';

const NOISE = /* glsl */`
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.03 + 7.1; a *= 0.5; } return s; }
`;

const VERT = /* glsl */`
uniform float uTime, uR, uH, uShell, uSeed;
uniform vec2 uLean;
varying vec2 vUv; varying float vH; varying vec3 vN; varying vec3 vView;
void main(){
  float h = position.y + 0.5;
  vH = h;
  float ang = atan(position.z, position.x);
  float rad = uR * (0.42 + 1.3 * pow(h, 1.25)) * uShell;
  // breathing bulges that travel upward
  rad *= 1.0 + 0.10 * sin(h * 9.0 - uTime * 3.0 + uSeed) + 0.06 * sin(ang * 3.0 + uTime * 2.0 + h * 5.0);
  // flare into the ground
  rad += uR * 0.35 * uShell * exp(-h * 14.0);
  vec3 p = vec3(cos(ang) * rad, h * uH, sin(ang) * rad);
  // snake: the top lags behind movement, plus a slow wobble
  float hh = pow(h, 1.4);
  p.xz += uLean * hh * uH * 0.5;
  p.x += sin(h * 3.2 + uTime * 1.1 + uSeed) * uR * 0.55 * h;
  p.z += cos(h * 2.6 + uTime * 0.9 + uSeed * 1.7) * uR * 0.55 * h;
  vUv = vec2(ang / 6.28318 + 0.5, h);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vN = normalize(vec3(cos(ang), -0.25, sin(ang)));
  vView = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */`
uniform float uTime, uAlpha, uShell, uSeed, uFire, uIce, uElec, uFlash, uSpin;
uniform vec3 uColA, uColB, uFog;
varying vec2 vUv; varying float vH; varying vec3 vN; varying vec3 vView;
${NOISE}
void main(){
  float spin = uTime * uSpin * (1.4 - uShell * 0.5);
  // seamless around the funnel: sample noise on a circle
  float a = vUv.x * 6.28318;
  vec2 q = vec2(cos(a), sin(a)) * 1.6;
  float twist = vH * 5.0;
  float n = fbm(vec2(q.x * cos(spin + twist) - q.y * sin(spin + twist), q.x * sin(spin + twist) + q.y * cos(spin + twist)) * 1.7 + vec2(uSeed, vH * 3.0 - uTime * 0.7));
  float streak = fbm(vec2((vUv.x + spin * 0.16 + vH * 0.8) * 22.0, vH * 3.0 - uTime * 1.2 + uSeed));
  float d = n * 0.65 + streak * 0.45;
  float fres = 1.0 - abs(dot(normalize(vN), vView));
  float alpha = smoothstep(0.28, 0.75, d + fres * 0.35) * uAlpha;
  alpha *= smoothstep(0.0, 0.14, vH) * (1.0 - smoothstep(0.8, 1.0, vH));
  alpha *= mix(0.75, 1.0, fres);
  vec3 col = mix(uColA, uColB, smoothstep(0.3, 0.9, d));
  // fake lighting: brighter on the sun side and toward the top
  float lit = 0.62 + 0.38 * dot(normalize(vN), normalize(vec3(0.5, 0.6, 0.3)));
  col *= lit * mix(0.8, 1.15, vH);
  // mutations
  vec3 fire = mix(vec3(1.0, 0.25, 0.02), vec3(1.0, 0.85, 0.3), streak) * (1.2 + 1.6 * streak * (1.0 - vH * 0.6));
  col = mix(col, fire, uFire * smoothstep(0.35, 0.8, d + (1.0 - vH) * 0.3));
  col = mix(col, vec3(0.78, 0.92, 1.0) * (0.9 + streak * 0.5), uIce * 0.6);
  col += vec3(0.5, 0.7, 1.0) * uElec * pow(streak, 6.0) * 5.0;
  col += vec3(0.8, 0.9, 1.0) * uFlash * (0.6 + n);
  gl_FragColor = vec4(col, alpha);
}`;

export function createTornado() {
  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(1, 1, 1, 56, 72, true);
  const shells = [];
  const SH = [[0.55, 0.8, 1.0], [0.82, 0.5, 2.3], [1.08, 0.3, 4.1], [1.4, 0.14, 6.3]];
  for (const [shell, alpha, seed] of SH) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 }, uR: { value: 3 }, uH: { value: 30 }, uShell: { value: shell }, uSeed: { value: seed }, uLean: { value: new THREE.Vector2() },
        uAlpha: { value: alpha }, uFire: { value: 0 }, uIce: { value: 0 }, uElec: { value: 0 }, uFlash: { value: 0 }, uSpin: { value: 2 },
        uColA: { value: new THREE.Color(0x4a4a52) }, uColB: { value: new THREE.Color(0xd8d2c4) }, uFog: { value: new THREE.Color(0xffffff) },
      },
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false; m.renderOrder = 10 + shell;
    group.add(m); shells.push(m);
  }
  const lean = new THREE.Vector2();
  const api = {
    group, shells,
    // st: { x, z, r, h, vx, vz, time, colA, colB, fire, ice, elec, flash, alpha }
    update(st, dt) {
      group.position.set(st.x, 0, st.z);
      lean.x += (-st.vx * 0.012 - lean.x) * Math.min(1, dt * 2);
      lean.y += (-st.vz * 0.012 - lean.y) * Math.min(1, dt * 2);
      for (const m of shells) {
        const u = m.material.uniforms;
        u.uTime.value = st.time; u.uR.value = st.r; u.uH.value = st.h; u.uLean.value.copy(lean);
        u.uFire.value = st.fire || 0; u.uIce.value = st.ice || 0; u.uElec.value = st.elec || 0; u.uFlash.value = st.flash || 0;
        u.uSpin.value = Math.min(4.5, 1.2 + 14 / (st.r + 4));
        if (st.colA) u.uColA.value.copy(st.colA);
        if (st.colB) u.uColB.value.copy(st.colB);
      }
    },
  };
  return api;
}
