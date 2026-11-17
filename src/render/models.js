// STORMZILLA - procedural low-poly model library.
// buildModel(name) -> non-indexed flat-shaded BufferGeometry with attributes
//   position(3) normal(3) color(3, linear) tint(1) glow(1)
// Origin = centre of base (y=0), model faces +Z, bbox == PROPS[name] w/h/d (auto-fitted).
// Everything is deterministic (seeded) and code-only: no textures, no external assets.
import * as THREE from 'three';
import { PROPS } from '../game/defs.js';
import { MILITARY } from './models-military.js';

// =====================================================================================
// 1. TOOLKIT
// =====================================================================================
const D2R = Math.PI / 180, TAU = Math.PI * 2;
const sin = Math.sin, cos = Math.cos, abs = Math.abs, max = Math.max, min = Math.min;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
// position-hash noise in [-1,1]; identical positions -> identical value (keeps tri-soup watertight)
function pnoise(x, y, z, s) {
  const h = sin(Math.round(x * 500) * 0.2543 + Math.round(y * 500) * 0.6231 + Math.round(z * 500) * 0.1497 + s * 19.19) * 43758.5453;
  return (h - Math.floor(h)) * 2 - 1;
}

const _col = new THREE.Color(), _lin = new Map();
function lin(hex) { let c = _lin.get(hex); if (!c) { _col.setHex(hex); c = [_col.r, _col.g, _col.b]; _lin.set(hex, c); } return c; }
const rc = (c) => (typeof c === 'number' ? lin(c) : c);                       // hex | [r,g,b] linear
function mixc(a, b, t) { a = rc(a); b = rc(b); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function shade(a, f) { a = rc(a); return [a[0] * f, a[1] * f, a[2] * f]; }

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _e = new THREE.Euler(), _q = new THREE.Quaternion();
const _Y = new THREE.Vector3(0, 1, 0);
const RX90 = new THREE.Matrix4().makeRotationX(Math.PI / 2);      // local +Y -> +Z
const RZM90 = new THREE.Matrix4().makeRotationZ(-Math.PI / 2);    // local +Y -> +X
const SWAP_XZ = new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1);
const SWAP_YZ = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
const FACE_RY = { '+z': 0, '+x': 90, '-z': 180, '-x': -90 };

class G {
  constructor(seed) {
    this.P = []; this.C = []; this.T = []; this.E = [];
    this.rnd = mulberry32(seed); this.seed = seed % 1000;
    this.M = new THREE.Matrix4(); this.eps = 0.03;
  }
  get n() { return this.P.length / 3; }

  // ---- transform stack -------------------------------------------------------------
  xf({ p = [0, 0, 0], r = null, s = null }, fn) {
    const old = this.M, m = new THREE.Matrix4();
    if (r) { _e.set(r[0] * D2R, r[1] * D2R, r[2] * D2R, 'YXZ'); m.makeRotationFromEuler(_e); }
    if (s) m.scale(_v.set(s[0], s[1], s[2]));
    m.setPosition(p[0], p[1], p[2]);
    this.M = old.clone().multiply(m); fn(); this.M = old; return this;
  }
  at(x, y, z, ry, fn) { return this.xf({ p: [x, y, z], r: [0, ry, 0] }, fn); }
  mirror(fn) { fn(1); return this.xf({ s: [-1, 1, 1] }, () => fn(-1)); }     // X mirror
  mirrorZ(fn) { fn(1); return this.xf({ s: [1, 1, -1] }, () => fn(-1)); }

  // ---- low level -------------------------------------------------------------------
  _x(x, y, z, r, pre) {
    const m = new THREE.Matrix4();
    if (r) { _e.set(r[0] * D2R, r[1] * D2R, r[2] * D2R, 'YXZ'); m.makeRotationFromEuler(_e); }
    m.setPosition(x, y, z);
    if (pre) m.multiply(pre);
    m.premultiply(this.M);
    m.neg = m.determinant() < 0;
    return m;
  }
  _tri(a, b, c, col, t, gl) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-12) return;
    this.P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.C.push(col[0], col[1], col[2], col[0], col[1], col[2], col[0], col[1], col[2]);
    this.T.push(t, t, t); this.E.push(gl, gl, gl);
  }
  _poly(m, pts, col, t = 0, gl = 0) {
    const c = rc(col), n = pts.length, w = new Array(n);
    for (let i = 0; i < n; i++) { _v.set(pts[i][0], pts[i][1], pts[i][2]).applyMatrix4(m); w[i] = [_v.x, _v.y, _v.z]; }
    for (let i = 1; i < n - 1; i++) { if (m.neg) this._tri(w[0], w[i + 1], w[i], c, t, gl); else this._tri(w[0], w[i], w[i + 1], c, t, gl); }
  }
  // free polygons (convex, CCW seen from outside). o.ds = double sided
  poly(pts, col, o = {}) {
    const m = this._x(0, 0, 0, null, null);
    this._poly(m, pts, col, o.t ? 1 : 0, o.g || 0);
    if (o.ds) this._poly(m, pts.slice().reverse(), o.cb ?? col, o.t ? 1 : 0, o.g || 0);
    return this;
  }
  quad(a, b, c, d, col, o) { return this.poly([a, b, c, d], col, o); }
  tri(a, b, c, col, o) { return this.poly([a, b, c], col, o); }

  // ---- box (anchor = centre of base). o: top[sx,sz] off[ox,oz] no:'tbfklr' ct cb cf ck cs t g r
  box(x, y, z, w, h, d, col, o = {}) {
    const m = this._x(x, y, z, o.r), hw = w / 2, hd = d / 2, tp = o.top || [1, 1], of = o.off || [0, 0];
    const tw = hw * tp[0], td = hd * tp[1], ox = of[0], oz = of[1], t = o.t ? 1 : 0, gl = o.g || 0, no = o.no || '';
    const v = [[-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd], [ox - tw, h, oz - td], [ox + tw, h, oz - td], [ox + tw, h, oz + td], [ox - tw, h, oz + td]];
    const F = (k, a, b, c, d2, oc) => { if (no.includes(k)) return; this._poly(m, [v[a], v[b], v[c], v[d2]], oc ?? col, oc != null && !o.ta ? 0 : t, oc != null ? 0 : gl); };
    F('f', 3, 2, 6, 7, o.cf); F('k', 1, 0, 4, 5, o.ck); F('r', 2, 1, 5, 6, o.cs); F('l', 0, 3, 7, 4, o.cs);
    F('t', 7, 6, 5, 4, o.ct); F('b', 0, 1, 2, 3, o.cb);
    return this;
  }
  // wedge: full height at -Z, zero at +Z
  wedge(x, y, z, w, h, d, col, o = {}) { return this.box(x, y, z, w, h, d, col, { ...o, top: [1, 0], off: [0, -d / 2] }); }

  // ---- generic ring tube used by cyl/beam/lathe
  _rings(m, prof, n, col, o, t, gl) {
    const ph = o.ph ?? 0.5, e = o.e || [1, 1], caps = o.caps ?? 'tb', R = [];
    for (const p of prof) { const ring = []; for (let i = 0; i < n; i++) { const a = (i + ph) / n * TAU; ring.push([sin(a) * p[0] * e[0], p[1], cos(a) * p[0] * e[1]]); } R.push(ring); }
    for (let k = 0; k < prof.length - 1; k++) {
      const bc = prof[k][2] ?? col, fl = prof[k][3], bt = fl ? (fl.t ? 1 : 0) : (prof[k][2] != null && typeof col !== 'function' && !o.ta ? 0 : t), bg = fl ? (fl.g || 0) : gl;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n; let c = typeof bc === 'function' ? bc(i, k) : bc, tt = bt, gg = bg;
        if (c && c.c !== undefined) { tt = c.t ? 1 : 0; gg = c.g || 0; c = c.c; }   // fn may return {c,t,g}
        this._poly(m, [R[k][i], R[k][j], R[k + 1][j], R[k + 1][i]], c, tt, gg);
      }
    }
    const L = prof.length - 1;
    const cap = (v) => (v && v.c !== undefined ? v.c : v);
    if (caps.includes('t') && prof[L][0] > 1e-6) this._poly(m, R[L], o.ct ?? cap(typeof col === 'function' ? col(0, L) : (prof[L - 1][2] ?? col)), o.ct != null ? 0 : t, o.gt ?? gl);
    if (caps.includes('b') && prof[0][0] > 1e-6) this._poly(m, R[0].slice().reverse(), o.cb ?? cap(typeof col === 'function' ? col(0, 0) : (prof[0][2] ?? col)), o.cb != null ? 0 : t, o.gb ?? gl);
  }
  _axm(x, y, z, o) { return this._x(x, y, z, o.r, o.ax === 'x' ? RZM90 : o.ax === 'z' ? RX90 : null); }
  // cylinder / prism / frustum. base-anchored along Y; with o.ax 'x'|'z' it is centred on the anchor.
  // o: r2 (top radius) caps ('tb') ph e[ex,ez] ct cb gt gb ax r t g
  cyl(x, y, z, r, h, n, col, o = {}) {
    const y0 = o.ax ? -h / 2 : 0;
    this._rings(this._axm(x, y, z, o), [[r, y0], [o.r2 ?? r, y0 + h]], n, col, o, o.t ? 1 : 0, o.g || 0);
    return this;
  }
  cone(x, y, z, r, h, n, col, o = {}) { return this.cyl(x, y, z, r, h, n, col, { ...o, r2: 0 }); }
  // lathe: prof = [[r, y, bandColour?, {t,g}?], ...] bottom -> top
  lathe(x, y, z, prof, n, col, o = {}) { this._rings(this._axm(x, y, z, o), prof, n, col, o, o.t ? 1 : 0, o.g || 0); return this; }
  // ellipsoid, centre anchored. o: seg rings
  sph(x, y, z, rx, ry, rz, col, o = {}) {
    const seg = o.seg || 6, rings = o.rings || 4, prof = [];
    for (let k = 0; k <= rings; k++) { const f = k / rings * Math.PI; prof.push([k === 0 || k === rings ? 0 : sin(f) * rx, -cos(f) * ry]); }
    this._rings(this._x(x, y, z, o.r, null), prof, seg, col, { ...o, e: [1, rz / rx], caps: '' }, o.t ? 1 : 0, o.g || 0);
    return this;
  }
  // lumpy ellipsoid (foliage, wool, rocks)
  blob(x, y, z, rx, ry, rz, col, o = {}) {
    const mk = this.n; this.sph(x, y, z, rx, ry, rz, col, o);
    _v2.set(x, y, z).applyMatrix4(this.M); const cx = _v2.x, cy = _v2.y, cz = _v2.z, a = o.a ?? 0.18, s = this.seed + (o.s || 0);
    return this.warp(mk, (p) => { const k = 1 + a * pnoise(p[0], p[1], p[2], s); p[0] = cx + (p[0] - cx) * k; p[1] = cy + (p[1] - cy) * k; p[2] = cz + (p[2] - cz) * k; });
  }
  // beam between two points. o: n(4) r2 caps('') e ph
  beam(a, b, r, col, o = {}) {
    _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const len = _v.length(); if (len < 1e-6) return this;
    _q.setFromUnitVectors(_Y, _v.multiplyScalar(1 / len));
    const m = new THREE.Matrix4().makeRotationFromQuaternion(_q); m.setPosition(a[0], a[1], a[2]); m.premultiply(this.M); m.neg = m.determinant() < 0;
    this._rings(m, [[r, 0], [o.r2 ?? r, len]], o.n || 4, col, { caps: '', ...o }, o.t ? 1 : 0, o.g || 0);
    return this;
  }
  // torus. axis Y by default (o.ax 'x'|'z'). o: arc[a0,a1] turns, e[radial,axial], col may be fn(i,j)
  torus(x, y, z, R, r, seg, tube, col, o = {}) {
    const m = this._axm(x, y, z, o), arc = o.arc || [0, 1], full = !o.arc, e = o.e || [1, 1], t = o.t ? 1 : 0, gl = o.g || 0, rows = [];
    for (let i = 0; i <= seg; i++) {
      const u = (arc[0] + (arc[1] - arc[0]) * i / seg) * TAU, row = [];
      for (let j = 0; j < tube; j++) { const v = (j + (o.ph ?? 0)) / tube * TAU, rr = R + r * e[0] * cos(v); row.push([rr * sin(u), r * e[1] * sin(v), rr * cos(u)]); }
      rows.push(row);
    }
    if (full) rows[seg] = rows[0];
    for (let i = 0; i < seg; i++) for (let j = 0; j < tube; j++) {
      const k = (j + 1) % tube, c = typeof col === 'function' ? col(i, j) : col;
      this._poly(m, [rows[i][j], rows[i + 1][j], rows[i + 1][k], rows[i][k]], c, t, typeof o.g === 'function' ? o.g(i, j) : gl);
    }
    return this;
  }
  // gable / hip roof prism. ridge along Z (o.ax:'x' -> along X). o: hip, cg (gable colour) tg (gable tint) b (bottom)
  roof(x, y, z, w, h, d, col, o = {}) {
    const alongX = o.ax === 'x', W = alongX ? d : w, Dp = alongX ? w : d, hw = W / 2, hd = Dp / 2, hip = o.hip || 0;
    const m = this._x(x, y, z, alongX ? [0, 90, 0] : null), t = o.t ? 1 : 0, gl = o.g || 0;
    const A = [-hw, 0, -hd], B = [hw, 0, -hd], Cc = [hw, 0, hd], Dd = [-hw, 0, hd], R0 = [0, h, -hd + hip], R1 = [0, h, hd - hip];
    this._poly(m, [Cc, B, R0, R1], col, t, gl); this._poly(m, [A, Dd, R1, R0], col, t, gl);
    const gc = o.cg ?? col, gt = o.cg != null ? (o.tg ? 1 : 0) : t;
    this._poly(m, [Dd, Cc, R1], gc, gt, 0); this._poly(m, [B, A, R0], gc, gt, 0);
    if (o.b) this._poly(m, [A, B, Cc, Dd], o.cb ?? col, 0, 0);
    return this;
  }
  // extrude a 2D polygon. plane 'zy' (pts=[z,y], extruded along X, centred), 'xy' (along Z, centred),
  // 'xz' (pts=[x,z], extruded up from 0..len). o: at[x,y,z] sc0 sc1 (scale of start/end outline) of0 of1 (offsets)
  //  cs (side colour) c0 c1 (cap colours) cap:false r t g
  ext(pts, len, col, o = {}) {
    let P = pts.map((p) => new THREE.Vector2(p[0], p[1]));
    if (THREE.ShapeUtils.area(P) < 0) P.reverse();
    const tris = o.cap === false ? [] : THREE.ShapeUtils.triangulateShape(P, []);
    const plane = o.plane || 'zy', at = o.at || [0, 0, 0], t = o.t ? 1 : 0, gl = o.g || 0;
    const s0 = plane === 'xz' ? 0 : -len / 2, s1 = plane === 'xz' ? len : len / 2;
    const m = this._x(at[0], at[1], at[2], o.r, plane === 'zy' ? SWAP_XZ : plane === 'xz' ? SWAP_YZ : null);
    const k0 = o.sc0 || [1, 1], k1 = o.sc1 || [1, 1], f0 = o.of0 || [0, 0], f1 = o.of1 || [0, 0];
    const A = P.map((p) => [p.x * k0[0] + f0[0], p.y * k0[1] + f0[1], s0]), B = P.map((p) => [p.x * k1[0] + f1[0], p.y * k1[1] + f1[1], s1]);
    const n = P.length, cs = o.cs ?? col, st = o.cs != null ? 0 : t;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this._poly(m, [A[i], A[j], B[j], B[i]], typeof cs === 'function' ? cs(i) : cs, st, gl); }
    for (const f of tris) {
      let [a, b, c] = f;
      const ar = (P[b].x - P[a].x) * (P[c].y - P[a].y) - (P[c].x - P[a].x) * (P[b].y - P[a].y);
      if (ar < 0) { const s = b; b = c; c = s; }
      if (!o.no1) this._poly(m, [B[a], B[b], B[c]], o.c1 ?? col, o.c1 != null ? 0 : t, gl);
      if (!o.no0) this._poly(m, [A[c], A[b], A[a]], o.c0 ?? col, o.c0 != null ? 0 : t, gl);
    }
    return this;
  }
  // chamfered box (edges parallel to o.ax (default 'z') are bevelled by ch)
  rbox(x, y, z, w, h, d, ch, col, o = {}) {
    const ax = o.ax || 'z';
    const oct = (a, b) => [[-a + ch, 0], [a - ch, 0], [a, ch], [a, b - ch], [a - ch, b], [-a + ch, b], [-a, b - ch], [-a, ch]];
    if (ax === 'z') return this.ext(oct(w / 2, h), d, col, { ...o, plane: 'xy', at: [x, y, z] });
    if (ax === 'x') return this.ext(oct(d / 2, h), w, col, { ...o, plane: 'zy', at: [x, y, z] });
    const a = w / 2, b = d / 2;
    return this.ext([[-a + ch, -b], [a - ch, -b], [a, -b + ch], [a, b - ch], [a - ch, b], [-a + ch, b], [-a, b - ch], [-a, -b + ch]], h, col, { ...o, plane: 'xz', at: [x, y, z] });
  }
  // thick slab from a quad (roof planes etc.): quad a,b,c,d CCW seen from above/outside, extruded by th along -normal
  slab(a, b, c, d, th, col, o = {}) {
    _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); _v2.set(d[0] - a[0], d[1] - a[1], d[2] - a[2]); _v.cross(_v2).normalize().multiplyScalar(-th);
    const dn = (p) => [p[0] + _v.x, p[1] + _v.y, p[2] + _v.z], a2 = dn(a), b2 = dn(b), c2 = dn(c), d2 = dn(d), cs = o.cs ?? col;
    this.poly([a, b, c, d], col, o); this.poly([d2, c2, b2, a2], o.cb ?? cs, o.cb != null ? {} : o);
    this.poly([a2, b2, b, a], cs, o); this.poly([b2, c2, c, b], cs, o); this.poly([c2, d2, d, c], cs, o); this.poly([d2, a2, a, d], cs, o);
    return this;
  }

  // ---- wall decals ------------------------------------------------------------------
  _fq(face, x, y, z, w, h) {
    const a = w / 2;
    if (face === '+z') return [[x - a, y, z], [x + a, y, z], [x + a, y + h, z], [x - a, y + h, z]];
    if (face === '-z') return [[x + a, y, z], [x - a, y, z], [x - a, y + h, z], [x + a, y + h, z]];
    if (face === '+x') return [[x, y, z + a], [x, y, z - a], [x, y + h, z - a], [x, y + h, z + a]];
    if (face === '-x') return [[x, y, z - a], [x, y, z + a], [x, y + h, z + a], [x, y + h, z - a]];
    // '+y': centred at x,z ; w along x, h along z
    return [[x - a, y, z + h / 2], [x + a, y, z + h / 2], [x + a, y, z - h / 2], [x - a, y, z - h / 2]];
  }
  // flat panel lying just proud of a wall. anchor = bottom-centre of the panel on the wall plane
  panel(face, x, y, z, w, h, col, o = {}) {
    const q = this._fq(face, x, y, z, w, h);
    return this.winsQ(q[0], q[1], q[2], q[3], 1, 1, { gx: 0, gy: 0, col, ...o });
  }
  wins(face, x, y, z, w, h, nx, ny, o = {}) {
    const q = this._fq(face, x, y, z, w, h);
    return this.winsQ(q[0], q[1], q[2], q[3], nx, ny, o);
  }
  // window grid on an arbitrary quad (a,b = bottom edge, c,d = top edge, CCW from outside).
  // o: gx gy (gap fraction) p (lit probability) lit dark eps col (fixed colour => plain panels) t g skip(i,j)
  winsQ(a, b, c, d, nx, ny, o = {}) {
    const gx = o.gx ?? 0.3, gy = o.gy ?? 0.35, p = o.p ?? 0.6, eps = o.eps ?? this.eps;
    _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); _v2.set(d[0] - a[0], d[1] - a[1], d[2] - a[2]); _v.cross(_v2).normalize().multiplyScalar(eps);
    const nx_ = _v.x, ny_ = _v.y, nz_ = _v.z, m = this._x(0, 0, 0, null, null);
    const P = (u, v) => { const k = (i) => (a[i] * (1 - u) + b[i] * u) * (1 - v) + (d[i] * (1 - u) + c[i] * u) * v; return [k(0) + nx_, k(1) + ny_, k(2) + nz_]; };
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (o.skip && o.skip(i, j)) continue;
      const u0 = (i + gx / 2) / nx, u1 = (i + 1 - gx / 2) / nx, v0 = (j + gy / 2) / ny, v1 = (j + 1 - gy / 2) / ny;
      let col, gl = 0, t = 0;
      if (o.col != null) { col = typeof o.col === 'function' ? o.col(i, j) : o.col; gl = typeof o.g === 'function' ? o.g(i, j) : (o.g || 0); t = o.t ? 1 : 0; }
      else {
        const r = this.rnd(), r2 = this.rnd();
        if (r < p) { col = r2 < 0.16 ? (o.lit2 ?? C.litCool) : (o.lit ?? C.lit); gl = 0.6 + 0.4 * r2; } else col = r2 < 0.5 ? (o.dark ?? C.glassD) : (o.dark2 ?? o.dark ?? C.glassD2);
      }
      this._poly(m, [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)], col, t, gl);
    }
    return this;
  }
  // flat disc / annulus facing +Z at z (use inside at() for other orientations). col may be fn(i)
  disc(x, y, z, r0, r1, n, col, o = {}) {
    const m = this._x(x, y, z, o.r, null), ph = o.ph ?? 0.5, arc = o.arc || [0, 1], e = o.e || [1, 1];
    for (let i = 0; i < n; i++) {
      const a0 = (arc[0] + (arc[1] - arc[0]) * (i + ph * (o.arc ? 0 : 1)) / n) * TAU, a1 = (arc[0] + (arc[1] - arc[0]) * (i + 1 + ph * (o.arc ? 0 : 1)) / n) * TAU;
      const p = (a, r) => [-sin(a) * r * e[0], cos(a) * r * e[1], 0];
      const c = typeof col === 'function' ? col(i) : col;
      const pts = r0 > 1e-6 ? [p(a0, r0), p(a0, r1), p(a1, r1), p(a1, r0)] : [[0, 0, 0], p(a0, r1), p(a1, r1)];
      this._poly(m, pts, c, o.t ? 1 : 0, o.g || 0);
      if (o.ds) this._poly(m, pts.slice().reverse(), c, o.t ? 1 : 0, o.g || 0);
    }
    return this;
  }

  // ---- post passes -------------------------------------------------------------------
  mark() { return this.n; }
  warp(mk, fn) { const P = this.P, p = [0, 0, 0]; for (let i = mk * 3; i < P.length; i += 3) { p[0] = P[i]; p[1] = P[i + 1]; p[2] = P[i + 2]; fn(p); P[i] = p[0]; P[i + 1] = p[1]; P[i + 2] = p[2]; } return this; }
  // painted highlight: lighten faces whose normal points at dir (fake gloss for the toy look)
  shine(mk, dir, amt = 0.5, pw = 6, to = 0xffffff) {
    const P = this.P, Cc = this.C, w = rc(to); _v.set(dir[0], dir[1], dir[2]).normalize(); const lx = _v.x, ly = _v.y, lz = _v.z;
    for (let i = mk * 3; i < P.length; i += 9) {
      const ux = P[i + 3] - P[i], uy = P[i + 4] - P[i + 1], uz = P[i + 5] - P[i + 2], vx = P[i + 6] - P[i], vy = P[i + 7] - P[i + 1], vz = P[i + 8] - P[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
      const k = Math.pow(max(0, (nx * lx + ny * ly + nz * lz) / l), pw) * amt;
      for (let j = 0; j < 9; j += 3) { Cc[i + j] += (w[0] - Cc[i + j]) * k; Cc[i + j + 1] += (w[1] - Cc[i + j + 1]) * k; Cc[i + j + 2] += (w[2] - Cc[i + j + 2]) * k; }
    }
    return this;
  }
  // multiply colour by a per-face seeded jitter (subtle hand-painted variation)
  jitter(mk, amt = 0.06) {
    const Cc = this.C;
    for (let i = mk * 3; i < Cc.length; i += 9) { const k = 1 + (this.rnd() * 2 - 1) * amt; for (let j = 0; j < 9; j++) Cc[i + j] *= k; }
    return this;
  }
}

// =====================================================================================
// 2. PALETTE (sRGB hex; converted to linear on use)
// =====================================================================================
const C = {
  white: 0xf6f3ec, paint: 0xf1f0ee, cream: 0xf3e7c9, marble: 0xeee9dc,
  wood: 0xa9794a, woodD: 0x74502f, woodL: 0xcda470, plank: 0xbd8c58,
  red: 0xd13b30, barn: 0xb8362c, brick: 0xb9583f, brickD: 0x8f4433, maroon: 0x7d2a2a,
  hay: 0xe8bf52, hayD: 0xc79a33, orange: 0xf28a25, yellow: 0xf8c734, gold: 0xe9b93a,
  leaf: 0x6fbd3f, leafD: 0x3f9444, leafL: 0x9ed450, pine: 0x2f7d55, pineD: 0x216243, grass: 0x7ec850,
  rock: 0x9c9e9a, rockD: 0x7b7f82, dirt: 0x8a6a4a,
  steel: 0x9ba7b3, steelL: 0xc3ccd4, steelD: 0x5f6a76, dark: 0x2c3139, tyre: 0x24262c, hub: 0xd2d6db, chrome: 0xdfe5ea,
  glass: 0x6db6d6, glassD: 0x2a5068, glassD2: 0x345f7a, glassT: 0x3d8ea3, lit: 0xffe09a, litCool: 0xd6ecff,
  pink: 0xff86b4, hot: 0xff4f9a, teal: 0x2fa7a2, tealD: 0x1f7280, blue: 0x3f82d6, navy: 0x27416d, sky: 0x8fd0f0, purple: 0x8a63c9,
  concrete: 0xc6c8c4, concD: 0x8f9597, concL: 0xdddcd6, asphalt: 0x4b4f57,
  olive: 0x6a7a3c, oliveD: 0x4a572c, oliveL: 0x86955a, khaki: 0xa39c69, gun: 0x3c434c, gunL: 0x566070,
  skin: 0xf1c49c, black: 0x1c1d22,
  roofR: 0xa64e3a, roofS: 0x56616f, roofT: 0x3f7f88, roofB: 0x6c4a3a, roofG: 0x4d5560,
  neonR: 0xff4a3d, neonC: 0x5ff2ff, neonP: 0xff5fb0, neonY: 0xffe45a, neonG: 0x7dff8a, head: 0xfff4c8, tail: 0xff3b30,
};

// =====================================================================================
// 3. REGISTRY + PUBLIC API
// =====================================================================================
const DEF = {};          // name -> (g) => void
const cache = new Map();
export const MODEL_INFO = {};

// Static hints for the integrator: where a model has a hub that could carry a spinning FX
// (blur disc etc.). Positions are in final model space (after fit). Geometry itself is static.
const SPIN_HINTS = {
  news_heli: { axis: 'y', pos: [0, 2.9, 0.9], r: 4.2 },
  gunship: { axis: 'y', pos: [0, 3.45, 1.2], r: 5.6 },
  windmill: { axis: 'z', pos: [0, 10.4, 0.9], r: 2.4 },
  wind_turbine: { axis: 'z', pos: [0, 31, 2.2], r: 18 },
  ferris: { axis: 'z', pos: [0, 19.4, 0], r: 15.5 },
};

function finalize(g, name) {
  const def = PROPS[name], P = g.P, n = P.length / 3;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) { x0 = min(x0, P[i]); x1 = max(x1, P[i]); y0 = min(y0, P[i + 1]); y1 = max(y1, P[i + 1]); z0 = min(z0, P[i + 2]); z1 = max(z1, P[i + 2]); }
  const fit = def ? [def.w / (x1 - x0), def.h / (y1 - y0), def.d / (z1 - z0)] : [1, 1, 1];
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, H = def ? def.h : y1 - y0;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const ao = !def || def.kind !== 'chunk';
  for (let i = 0; i < P.length; i += 3) {
    pos[i] = (P[i] - cx) * fit[0]; pos[i + 1] = (P[i + 1] - y0) * fit[1]; pos[i + 2] = (P[i + 2] - cz) * fit[2];
    // soft grounding gradient: darker toward the base, reads as baked AO
    let k = 1;
    if (ao && g.E[i / 3] === 0) { const f = min(1, pos[i + 1] / (H * 0.45)); k = 0.82 + 0.18 * f * (2 - f); }
    col[i] = min(1, g.C[i] * k); col[i + 1] = min(1, g.C[i + 1] * k); col[i + 2] = min(1, g.C[i + 2] * k);
  }
  for (let i = 0; i < pos.length; i += 9) {
    const ux = pos[i + 3] - pos[i], uy = pos[i + 4] - pos[i + 1], uz = pos[i + 5] - pos[i + 2], vx = pos[i + 6] - pos[i], vy = pos[i + 7] - pos[i + 1], vz = pos[i + 8] - pos[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let j = 0; j < 9; j += 3) { nor[i + j] = nx; nor[i + j + 1] = ny; nor[i + j + 2] = nz; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(g.T), 1));
  geo.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(g.E), 1));
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  geo.name = name;
  MODEL_INFO[name] = { tris: n / 3, tintable: g.T.some((t) => t > 0), glows: g.E.some((e) => e > 0), fit, ...(SPIN_HINTS[name] ? { spin: SPIN_HINTS[name] } : {}) };
  return geo;
}

/** Build (or fetch from cache) the geometry for a PROPS key. */
export function buildModel(name) {
  let geo = cache.get(name);
  if (geo) return geo;
  const g = new G(hashStr(name));
  const fn = DEF[name];
  if (fn) fn(g);
  else { const d = PROPS[name] || { w: 1, h: 1, d: 1 }; g.box(0, 0, 0, d.w, d.h, d.d, 0xff00ff); }   // loud placeholder
  geo = finalize(g, name);
  cache.set(name, geo);
  return geo;
}
export function hasModel(name) { return !!DEF[name]; }
export function buildAllModels() { const out = {}; for (const k of Object.keys(PROPS)) out[k] = buildModel(k); return out; }
export function disposeModels() { for (const g of cache.values()) g.dispose(); cache.clear(); }

// =====================================================================================
// 4. SHARED PARTS
// =====================================================================================
// wheel on the +X side (call inside g.mirror); hub faces +X
function wheel(g, x, y, z, r, w, n = 8, hub = C.hub) {
  g.cyl(x, y, z, r, w, n, C.tyre, { ax: 'x' });
  g.cyl(x + w / 2, y, z, r * 0.55, 0.06, 6, hub, { ax: 'x', caps: 't' });
}
// framed window on a wall (frame + glass + sill). lit decided by seeded rng
function hwin(g, face, x, y, z, w, h, o = {}) {
  const k = o.k ?? 1;
  g.panel(face, x, y - 0.1 * k, z, w + 0.28 * k, h + 0.24 * k, o.frame ?? C.white, { eps: g.eps });
  g.wins(face, x, y, z, w, h, o.nx ?? 2, o.ny ?? 1, { gx: 0.14, gy: o.ny > 1 ? 0.1 : 0, eps: g.eps * 2, p: o.p ?? 0.6 });
  if (o.sh != null) for (const s of [-1, 1]) { const [sx, sz] = SH(face, x, z, s * (w / 2 + 0.34 * k)); g.panel(face, sx, y, sz, 0.36 * k, h, o.sh, { eps: g.eps }); }
}
const SH = (face, x, z, du) => (face === '+z' || face === '-z' ? [x + du, z] : [x, z + du]);
function door(g, face, x, y, z, w, h, col, o = {}) {
  g.panel(face, x, y, z, w + 0.24, h + 0.14, o.frame ?? C.white, { eps: g.eps });
  g.panel(face, x, y, z, w, h, col, { eps: g.eps * 2 });
  g.panel(face, x + w * 0.3 * (o.side ?? 1), y + h * 0.45, z, 0.12, 0.12, C.gold, { eps: g.eps * 3 });
}

// =====================================================================================
// 5. TIER 0 - dust devil food (<=180 tris)
// =====================================================================================
DEF.fence = (g) => {
  for (let i = 0; i < 6; i++) {
    const x = -1.0 + i * 0.4;
    g.box(x, 0, 0.05, 0.27, 0.8, 0.08, C.white, { no: 't' });
    g.box(x, 0.8, 0.05, 0.27, 0.2, 0.08, C.white, { top: [0, 1], no: 'b' });
  }
  g.box(0, 0.2, -0.05, 2.4, 0.11, 0.1, C.concL); g.box(0, 0.56, -0.05, 2.4, 0.11, 0.1, C.concL);
};

DEF.mailbox = (g) => {
  g.box(0, 0, 0, 0.1, 0.92, 0.1, C.wood);
  g.ext([[-0.17, 0], [0.17, 0], [0.17, 0.16], [0.1, 0.27], [-0.1, 0.27], [-0.17, 0.16]], 0.4, C.paint, { plane: 'xy', at: [0, 0.9, 0], t: 1, c1: C.steelL });
  g.panel('+z', 0, 0.95, 0.2, 0.08, 0.05, C.dark, { eps: 0.01 });
  g.box(0.185, 0.98, 0.06, 0.03, 0.22, 0.05, C.red); g.box(0.185, 1.12, 0.0, 0.03, 0.09, 0.16, C.red);
};

DEF.crate = (g) => {
  g.box(0, 0.04, 0, 0.9, 0.92, 0.9, C.plank);
  const e = 0.1, a = 0.45;
  for (const [x, z] of [[-a, -a], [a, -a], [a, a], [-a, a]]) g.box(x, 0, z, e, 1, e, C.wood);
  for (const y of [0, 0.9]) { g.box(0, y, -a, 0.8, e, e, C.wood); g.box(0, y, a, 0.8, e, e, C.wood); g.box(-a, y, 0, e, e, 0.8, C.wood); g.box(a, y, 0, e, e, 0.8, C.wood); }
  for (let k = 0; k < 4; k++) g.at(0, 0, 0, k * 90, () => g.quad([-0.4, 0.1, 0.47], [-0.3, 0.1, 0.47], [0.4, 0.9, 0.47], [0.3, 0.9, 0.47], C.woodD));
};

DEF.barrel = (g) => {
  g.lathe(0, 0, 0, [[0.33, 0, C.wood], [0.39, 0.2, C.steelD], [0.405, 0.3, C.wood], [0.43, 0.55, C.woodL], [0.405, 0.8, C.steelD], [0.39, 0.9, C.wood], [0.33, 1.1]], 8, C.wood, { ct: C.woodD });
};

DEF.bush = (g) => {
  g.blob(0, 0.56, 0, 0.62, 0.56, 0.6, C.leaf, { seg: 7, rings: 4, a: 0.2 });
  g.blob(-0.42, 0.4, 0.25, 0.42, 0.38, 0.42, C.leafD, { seg: 6, rings: 3, s: 1 });
  g.blob(0.42, 0.42, -0.2, 0.44, 0.4, 0.44, C.leafL, { seg: 6, rings: 3, s: 2 });
  g.blob(0.12, 0.34, 0.48, 0.3, 0.3, 0.3, C.leafD, { seg: 5, rings: 3, s: 3 });
  for (const [x, y, z] of [[0.3, 0.9, 0.35], [-0.35, 0.75, 0.42], [0.62, 0.62, 0.1], [0.0, 1.05, 0.25], [-0.6, 0.55, 0.0]]) g.sph(x, y, z, 0.07, 0.07, 0.07, C.red, { seg: 4, rings: 2 });
};

DEF.haybale = (g) => {
  g.lathe(0, 0.65, 0, [[0.3, -0.8, C.hayD], [0.7, -0.78, C.hay], [0.7, -0.32, C.woodD], [0.7, -0.24, C.hay], [0.7, 0.24, C.woodD], [0.7, 0.32, C.hay], [0.7, 0.78, C.hayD], [0.3, 0.8]], 8, C.hay, { ax: 'x', ct: 0xf3d67e, cb: 0xf3d67e });
  g.box(0.1, 0, 0.66, 1.1, 0.12, 0.28, C.hayD, { top: [0.6, 0.3] }); g.box(-0.15, 0, -0.66, 1.0, 0.1, 0.28, C.hayD, { top: [0.6, 0.3] });
};

DEF.pumpkin = (g) => {
  g.sph(0, 0.27, 0, 0.38, 0.27, 0.38, (i) => (i % 2 ? 0xf2892a : 0xe4741a), { seg: 8, rings: 4 });
  g.cyl(0, 0.5, 0, 0.055, 0.12, 5, 0x5b7a2e, { r2: 0.035, r: [0, 0, 14] });
};

DEF.scarecrow = (g) => {
  g.box(0, 0, 0, 0.09, 1.95, 0.09, C.wood, { no: 'b' });
  g.box(0, 1.42, 0, 1.4, 0.08, 0.08, C.wood);
  g.box(0, 0.9, 0, 0.5, 0.68, 0.26, C.paint, { t: 1, top: [1.12, 1] });
  g.box(0, 0.78, 0, 0.56, 0.14, 0.3, C.hay, { no: 't' });
  g.mirror(() => { g.box(0.42, 1.34, 0, 0.36, 0.22, 0.2, C.paint, { t: 1 }); g.box(0.66, 1.37, 0, 0.1, 0.16, 0.14, C.hay, { top: [1.7, 1.7], r: [0, 0, -90] }); });
  g.box(0, 1.6, 0, 0.34, 0.36, 0.3, 0xead7a6);
  g.panel('+z', -0.08, 1.78, 0.15, 0.06, 0.07, C.black); g.panel('+z', 0.08, 1.78, 0.15, 0.06, 0.07, C.black); g.panel('+z', 0, 1.67, 0.15, 0.18, 0.03, C.maroon);
  g.cyl(0, 1.94, 0, 0.38, 0.04, 8, C.woodD, { e: [1, 0.55] }); g.cyl(0, 1.98, 0, 0.2, 0.22, 6, C.woodD, { r2: 0.13, e: [1, 0.8] });
};

DEF.sign = (g) => {
  g.box(0, 0, 0, 0.3, 0.04, 0.2, C.concD);
  g.box(0, 0, 0, 0.08, 1.4, 0.06, C.steel, { no: 'b' });
  g.cyl(0, 1.7, 0, 0.54, 0.07, 8, C.red, { ax: 'z', cb: C.steel });
  g.disc(0, 1.7, 0.04, 0.42, 0.48, 8, C.white);
  g.panel('+z', 0, 1.63, 0.036, 0.62, 0.14, C.white, { eps: 0.008 });
};

DEF.trashcan = (g) => {
  g.lathe(0, 0, 0, [[0.3, 0, 0x3f7d5a], [0.335, 0.4, 0x56a077], [0.345, 0.5, 0x3f7d5a], [0.365, 0.78, C.steelD], [0.385, 0.8, C.steel], [0.385, 0.86, C.steelL], [0.2, 0.95]], 8, C.steel, { ct: C.steel });
  g.box(0, 0.95, 0, 0.16, 0.05, 0.06, C.dark);
};

DEF.bench = (g) => {
  g.mirror(() => { g.box(0.8, 0, 0.2, 0.08, 0.45, 0.08, C.dark); g.box(0.8, 0, -0.22, 0.08, 0.9, 0.08, C.dark, { off: [0, -0.06] }); g.box(0.8, 0.4, 0, 0.08, 0.06, 0.5, C.dark); });
  for (let i = 0; i < 3; i++) g.box(0, 0.45, -0.12 + i * 0.17, 1.8, 0.05, 0.14, i === 1 ? C.woodL : C.plank);
  g.box(0, 0.58, -0.25, 1.8, 0.12, 0.05, C.plank, { r: [-8, 0, 0] }); g.box(0, 0.75, -0.275, 1.8, 0.12, 0.05, C.woodL, { r: [-8, 0, 0] });
};

DEF.hydrant = (g) => {
  g.lathe(0, 0, 0, [[0.2, 0, C.red], [0.2, 0.06], [0.135, 0.07], [0.135, 0.48], [0.165, 0.5, 0xe9b93a], [0.165, 0.56, C.red], [0.125, 0.58], [0.09, 0.7], [0.045, 0.73]], 6, C.red, { ta: 1 });
  g.cyl(0, 0.71, 0, 0.05, 0.09, 5, C.steelL);
  g.cyl(0, 0.38, 0, 0.07, 0.4, 5, C.red, { ax: 'x', ct: C.steelL, cb: C.steelL });
  g.cyl(0, 0.36, 0.15, 0.09, 0.14, 6, C.red, { ax: 'z', ct: C.steelL });
};

DEF.cone = (g) => {
  g.box(0, 0, 0, 0.4, 0.04, 0.4, 0xd96f1c);
  g.lathe(0, 0, 0, [[0.15, 0.04, C.orange], [0.115, 0.26, C.white], [0.09, 0.42, C.orange], [0.035, 0.7]], 8, C.orange, { caps: 't' });
};

DEF.corn = (g) => {
  const leaf = 0x7fb53e, leafD = 0x5f9a35;
  g.box(0, 0, 0, 0.07, 1.8, 0.07, leaf, { top: [0.5, 0.5] });
  for (let i = 0; i < 5; i++) g.at(0, 0.3 + i * 0.3, 0, i * 137, () => {
    g.quad([0, 0, -0.05], [0, 0, 0.05], [0.22, 0.3, 0.04], [0.22, 0.3, -0.04], leaf, { ds: 1, cb: leafD });
    g.tri([0.22, 0.3, -0.04], [0.22, 0.3, 0.04], [0.31, 0.12, 0], leafD, { ds: 1, cb: leaf });
  });
  g.cyl(0.07, 0.85, 0, 0.065, 0.32, 5, C.yellow, { r2: 0.03, r: [0, 0, -16] }); g.cyl(-0.06, 1.15, 0.04, 0.06, 0.3, 5, C.yellow, { r2: 0.03, r: [0, 0, 16] });
  g.cone(0, 1.72, 0, 0.08, 0.28, 4, C.hay);
};

DEF.rock = (g) => {
  g.blob(0, 0.34, 0, 0.6, 0.44, 0.5, C.rock, { seg: 7, rings: 4, a: 0.2 });
  g.blob(0.34, 0.2, 0.26, 0.3, 0.26, 0.28, C.rockD, { seg: 5, rings: 3, s: 4 });
  g.warp(0, (p) => { if (p[1] < 0) p[1] *= 0.05; });
  g.jitter(0, 0.07);
};

DEF.flamingo = (g) => {
  const pk = 0xff7fa8, pkD = 0xf0608f;
  g.sph(0, 0.62, -0.05, 0.19, 0.13, 0.22, pk, { seg: 6, rings: 3 });
  g.box(0, 0.6, -0.28, 0.1, 0.06, 0.14, pkD, { top: [0.3, 0.5], r: [20, 0, 0] });
  g.mirror(() => g.box(0.165, 0.56, -0.08, 0.04, 0.12, 0.24, pkD, { top: [1, 0.6] }));
  g.beam([0, 0.66, 0.1], [0, 0.93, 0.21], 0.04, pk); g.beam([0, 0.93, 0.21], [0, 1.02, 0.15], 0.036, pk);
  g.box(0, 0.98, 0.13, 0.09, 0.1, 0.12, pk);
  g.box(0, 0.975, 0.2, 0.06, 0.06, 0.1, C.black, { top: [0.5, 0.3], r: [40, 0, 0] });
  g.beam([0.05, 0, -0.03], [0.04, 0.54, -0.04], 0.014, pkD, { n: 3 });
  g.beam([-0.05, 0.3, 0.07], [-0.04, 0.54, -0.04], 0.014, pkD, { n: 3 }); g.beam([-0.05, 0.3, 0.07], [-0.05, 0.34, -0.1], 0.013, pkD, { n: 3 });
  g.box(0.05, 0, 0.01, 0.08, 0.015, 0.11, pkD);
};

DEF.gnome = (g) => {
  const coat = 0x3f6fc4;
  g.lathe(0, 0, 0, [[0.18, 0, 0x3c3f4a], [0.19, 0.06, coat], [0.2, 0.14, coat], [0.15, 0.34]], 6, coat, { ta: 1 });
  g.mirror(() => g.box(0.17, 0.14, 0.02, 0.07, 0.18, 0.09, coat));
  g.sph(0, 0.4, 0, 0.13, 0.11, 0.13, C.skin, { seg: 6, rings: 3 });
  g.box(0, 0.12, 0.13, 0.1, 0.26, 0.06, C.white, { top: [2.4, 1.6] });
  g.box(0, 0.37, 0.12, 0.06, 0.06, 0.07, 0xe8a07c);
  g.cone(0, 0.44, 0, 0.18, 0.27, 6, C.red, { cb: C.red });
};

DEF.chicken = (g) => {
  g.sph(0, 0.27, -0.03, 0.17, 0.15, 0.22, C.paint, { seg: 6, rings: 3, t: 1 });
  g.box(0, 0.3, -0.24, 0.12, 0.2, 0.1, C.paint, { t: 1, top: [0.4, 0.3], off: [0, -0.04] });
  g.box(0, 0.34, 0.12, 0.13, 0.19, 0.13, C.paint, { t: 1 });
  g.box(0, 0.53, 0.12, 0.035, 0.07, 0.1, C.red);
  g.box(0, 0.42, 0.185, 0.05, 0.04, 0.08, C.orange, { top: [0.4, 0.3], off: [0, 0.02] });
  g.box(0, 0.36, 0.19, 0.03, 0.06, 0.03, C.red);
  g.panel('+x', 0.065, 0.46, 0.14, 0.03, 0.03, C.black, { eps: 0.004 }); g.panel('-x', -0.065, 0.46, 0.14, 0.03, 0.03, C.black, { eps: 0.004 });
  g.mirror(() => { g.box(0.17, 0.2, -0.04, 0.04, 0.12, 0.22, C.cream); g.box(0.06, 0, 0, 0.02, 0.14, 0.02, C.orange, { no: 'tb' }); g.box(0.06, 0, 0.03, 0.07, 0.015, 0.09, C.orange); });
};

DEF.person = (g) => {
  const hair = 0x5a3b24;
  g.mirror(() => {
    g.box(0.1, 0.08, 0, 0.17, 0.74, 0.2, 0x3b4a6b, { no: 'tb' }); g.box(0.1, 0, 0.05, 0.17, 0.09, 0.36, C.dark);
    g.box(0.275, 0.98, 0, 0.1, 0.44, 0.14, C.paint, { t: 1 }); g.box(0.275, 0.8, 0, 0.09, 0.18, 0.12, C.skin, { no: 't' });
  });
  g.box(0, 0.82, 0, 0.44, 0.62, 0.24, C.paint, { t: 1 });
  g.box(0, 1.44, 0, 0.12, 0.06, 0.12, C.skin, { no: 'tb' });
  g.box(0, 1.49, 0, 0.26, 0.26, 0.26, C.skin);
  g.box(0, 1.67, -0.02, 0.29, 0.13, 0.3, hair, { no: 'b' });
  g.panel('+z', -0.06, 1.59, 0.13, 0.04, 0.05, C.black, { eps: 0.005 }); g.panel('+z', 0.06, 1.59, 0.13, 0.04, 0.05, C.black, { eps: 0.005 });
};

// =====================================================================================
// 6. TIER 1 (<=450 tris)
// =====================================================================================
DEF.cow = (g) => {
  const W = C.paint, sp = 0x2e2a2c, pk = 0xf3a9a6;
  g.rbox(0, 0.62, -0.1, 0.82, 0.72, 1.5, 0.14, W, { t: 1 });
  g.panel('+x', 0.41, 0.84, 0.1, 0.5, 0.32, sp, { eps: 0.012 }); g.panel('+x', 0.41, 0.95, -0.55, 0.3, 0.22, sp, { eps: 0.012 });
  g.panel('-x', -0.41, 0.8, -0.3, 0.55, 0.36, sp, { eps: 0.012 }); g.panel('-x', -0.41, 1.0, 0.36, 0.25, 0.18, sp, { eps: 0.012 });
  g.panel('+y', 0.06, 1.34, -0.25, 0.42, 0.5, sp, { eps: 0.012 }); g.panel('+y', -0.08, 1.34, 0.4, 0.3, 0.24, sp, { eps: 0.012 });
  g.mirror(() => {
    for (const z of [0.42, -0.62]) { g.box(0.27, 0.1, z, 0.2, 0.6, 0.22, W, { t: 1, no: 'tb' }); g.box(0.27, 0, z, 0.21, 0.1, 0.23, sp); }
    g.cone(0.2, 1.42, 0.82, 0.055, 0.2, 4, C.cream, { r: [0, 0, -35] });
    g.box(0.36, 1.25, 0.8, 0.26, 0.1, 0.06, sp, { top: [0.5, 1] });
    g.box(0.09, 0.44, -0.5, 0.05, 0.07, 0.05, pk);
  });
  g.box(0, 0.5, -0.5, 0.32, 0.14, 0.36, pk);
  g.box(0, 1.0, 0.9, 0.42, 0.44, 0.5, W, { t: 1 });
  g.panel('+y', 0.1, 1.44, 0.86, 0.22, 0.3, sp, { eps: 0.012 });
  g.box(0, 0.98, 1.12, 0.36, 0.26, 0.16, pk);
  g.panel('+z', -0.08, 1.07, 1.2, 0.05, 0.06, 0xc97f7c, { eps: 0.008 }); g.panel('+z', 0.08, 1.07, 1.2, 0.05, 0.06, 0xc97f7c, { eps: 0.008 });
  g.panel('+x', 0.21, 1.27, 0.98, 0.08, 0.09, C.black, { eps: 0.008 }); g.panel('-x', -0.21, 1.27, 0.98, 0.08, 0.09, C.black, { eps: 0.008 });
  g.box(0, 0.86, 0.7, 0.13, 0.13, 0.1, C.gold);
  g.beam([0, 1.25, -0.85], [0, 0.6, -0.98], 0.025, W, { n: 3, t: 1 }); g.box(0, 0.48, -0.98, 0.07, 0.14, 0.07, sp);
};

DEF.sheep = (g) => {
  const wool = 0xf5f0e3, dk = 0x3a3436;
  g.blob(0, 0.64, -0.06, 0.4, 0.34, 0.56, wool, { seg: 8, rings: 5, a: 0.13 });
  g.blob(0, 0.98, 0.42, 0.18, 0.13, 0.18, wool, { seg: 6, rings: 3, s: 2, a: 0.1 });
  g.blob(0, 0.72, -0.62, 0.12, 0.12, 0.1, wool, { seg: 5, rings: 3, s: 3 });
  g.box(0, 0.62, 0.52, 0.24, 0.3, 0.3, dk);
  g.panel('+z', -0.06, 0.8, 0.67, 0.045, 0.05, C.white, { eps: 0.006 }); g.panel('+z', 0.06, 0.8, 0.67, 0.045, 0.05, C.white, { eps: 0.006 });
  g.mirror(() => { g.box(0.18, 0.8, 0.5, 0.16, 0.06, 0.09, dk, { top: [0.5, 1] }); for (const z of [0.3, -0.36]) g.box(0.17, 0, z, 0.1, 0.42, 0.1, dk, { no: 't' }); });
};

DEF.pig = (g) => {
  const pk = 0xf7a8b8, pkD = 0xe58aa0;
  g.sph(0, 0.5, -0.08, 0.36, 0.3, 0.5, pk, { seg: 8, rings: 4 });
  g.box(0, 0.4, 0.42, 0.36, 0.34, 0.3, pk);
  g.cyl(0, 0.5, 0.6, 0.1, 0.1, 6, pkD, { ax: 'z' });
  g.panel('+z', -0.04, 0.48, 0.65, 0.03, 0.045, 0xb5607a, { eps: 0.005 }); g.panel('+z', 0.04, 0.48, 0.65, 0.03, 0.045, 0xb5607a, { eps: 0.005 });
  g.panel('+z', -0.11, 0.62, 0.57, 0.04, 0.05, C.black, { eps: 0.005 }); g.panel('+z', 0.11, 0.62, 0.57, 0.04, 0.05, C.black, { eps: 0.005 });
  g.mirror(() => { g.box(0.13, 0.72, 0.44, 0.13, 0.15, 0.04, pkD, { top: [0.2, 1], r: [20, 0, 0] }); for (const z of [0.25, -0.35]) g.box(0.18, 0, z, 0.12, 0.28, 0.12, pkD, { no: 't' }); });
  g.beam([0, 0.6, -0.56], [0.05, 0.69, -0.63], 0.02, pkD, { n: 3 }); g.beam([0.05, 0.69, -0.63], [-0.03, 0.75, -0.6], 0.02, pkD, { n: 3 });
};

DEF.horse = (g) => {
  const W = C.paint, dk = 0x4a3426;
  g.rbox(0, 0.95, -0.15, 0.6, 0.6, 1.45, 0.12, W, { t: 1 });
  g.mirror(() => {
    for (const z of [0.42, -0.72]) { g.box(0.2, 0.12, z, 0.15, 0.9, 0.17, W, { t: 1, top: [1.2, 1.3], no: 'tb' }); g.box(0.2, 0, z, 0.16, 0.12, 0.18, C.dark); }
    g.cone(0.07, 1.8, 0.86, 0.045, 0.13, 4, W, { t: 1 });
    g.box(0.34, 1.0, -0.2, 0.05, 0.5, 0.5, C.red, { no: 't' });
  });
  g.ext([[0.3, 1.52], [0.52, 1.12], [0.9, 1.45], [0.88, 1.8], [0.7, 1.72]], 0.28, W, { t: 1 });
  g.ext([[0.72, 1.72], [0.92, 1.84], [1.28, 1.42], [1.2, 1.3], [0.9, 1.42], [0.8, 1.4]], 0.24, W, { t: 1 });
  g.ext([[0.26, 1.56], [0.7, 1.76], [0.86, 1.84], [0.84, 1.91], [0.6, 1.85], [0.22, 1.62]], 0.08, dk);
  g.panel('+x', 0.12, 1.62, 0.96, 0.05, 0.06, C.black, { eps: 0.006 }); g.panel('-x', -0.12, 1.62, 0.96, 0.05, 0.06, C.black, { eps: 0.006 });
  g.box(0, 1.5, -0.2, 0.74, 0.06, 0.52, C.red); g.rbox(0, 1.56, -0.2, 0.4, 0.1, 0.5, 0.04, C.woodD);
  g.box(0, 0.75, -0.93, 0.13, 0.78, 0.13, dk, { off: [0, 0.07], top: [0.8, 0.8] });
};

DEF.tree_small = (g) => {
  g.cyl(0, 0, 0, 0.27, 2.4, 6, C.woodD, { r2: 0.16, caps: '' });
  g.blob(0, 3.5, 0, 1.4, 1.4, 1.4, C.leaf, { seg: 8, rings: 5, a: 0.13 });
  g.blob(-0.75, 2.9, 0.4, 0.88, 0.78, 0.88, C.leafD, { seg: 7, rings: 4, s: 1 });
  g.blob(0.8, 3.0, -0.3, 0.9, 0.8, 0.9, C.leafD, { seg: 7, rings: 4, s: 2 });
  g.blob(0.2, 4.25, 0.3, 0.82, 0.7, 0.82, C.leafL, { seg: 7, rings: 4, s: 3 });
  for (const [x, y, z] of [[0.9, 3.4, 1.0], [-0.6, 3.9, 1.1], [1.35, 3.6, 0.1], [-1.3, 3.1, 0.6], [0.2, 2.75, 1.2], [-0.2, 4.6, 0.9]]) g.sph(x, y, z, 0.11, 0.11, 0.11, C.red, { seg: 4, rings: 2 });
};

DEF.pine = (g) => {
  g.cyl(0, 0, 0, 0.2, 1.6, 6, C.woodD, { r2: 0.14, caps: '' });
  const cols = [C.pineD, C.pine, C.pineD, C.pine, 0x3f9366];
  for (let i = 0; i < 5; i++) g.cone(0, 1.1 + i * 1.15, 0, 1.34 - i * 0.25, 1.9 - i * 0.12, 8, cols[i], { ph: i * 0.37, cb: shade(cols[i], 0.7) });
};

function sedan(g, { body = C.paint, tint = 1, roof = null } = {}) {
  const t = tint;
  g.ext([[-2.08, 0.34], [2.06, 0.34], [2.12, 0.52], [2.04, 0.8], [0.95, 0.93], [-1.45, 0.93], [-2.02, 0.86], [-2.12, 0.55]], 1.78, body, { t });
  g.box(0, 0.93, -0.28, 1.62, 0.5, 2.25, C.glass, { top: [0.84, 0.62], off: [0, -0.06], no: 'tb' });
  g.box(0, 0.93, -0.3, 1.64, 0.48, 0.13, body, { t, top: [0.85, 1], no: 'tb' });
  g.box(0, 1.42, -0.34, 1.42, 0.08, 1.5, roof ?? body, { t: roof == null ? t : 0 });
  g.mirror(() => {
    wheel(g, 0.8, 0.34, 1.32, 0.34, 0.24); wheel(g, 0.8, 0.34, -1.32, 0.34, 0.24);
    g.box(0.62, 0.58, 2.07, 0.36, 0.15, 0.08, C.head, { g: 0.9, no: 'k' });
    g.box(0.66, 0.66, -2.1, 0.36, 0.13, 0.06, C.tail, { g: 0.6, no: 'f' });
    g.box(0.9, 0.95, 0.5, 0.14, 0.1, 0.1, body, { t });
    g.panel('+x', 0.89, 0.45, -0.3, 0.03, 0.46, C.dark, { eps: 0.006 }); g.panel('+x', 0.89, 0.76, 0.05, 0.14, 0.035, C.dark, { eps: 0.006 });
  });
  g.box(0, 0.3, 2.06, 1.84, 0.2, 0.14, C.dark); g.box(0, 0.3, -2.08, 1.84, 0.2, 0.14, C.dark);
  g.box(0, 0.56, 2.09, 0.7, 0.16, 0.05, C.dark, { no: 'k' });
  g.panel('-z', 0, 0.42, -2.13, 0.4, 0.14, C.white, { eps: 0.03 });
}
DEF.car = (g) => sedan(g);
DEF.taxi = (g) => {
  sedan(g, { body: C.yellow, tint: 0 });
  g.box(0, 1.5, -0.34, 0.6, 0.14, 0.24, C.lit, { g: 0.9, top: [0.8, 0.8] });
  g.mirror(() => g.wins('+x', 0.89, 0.6, -0.25, 2.4, 0.1, 12, 1, { gx: 0, gy: 0, col: (i) => (i % 2 ? C.black : C.white), eps: 0.008 }));
};

DEF.pickup = (g) => {
  const b = C.paint;
  g.ext([[-2.45, 0.45], [2.4, 0.45], [2.47, 0.7], [2.4, 1.02], [1.1, 1.1], [-2.45, 1.1]], 1.84, b, { t: 1 });
  g.panel('+y', 0, 1.1, -1.42, 1.6, 1.9, 0x3f444d, { eps: 0.012 });
  g.box(0, 1.1, 0.15, 1.7, 0.62, 1.5, C.glass, { top: [0.86, 0.7], off: [0, -0.08], no: 'tb' });
  g.box(0, 1.1, 0.1, 1.72, 0.6, 0.14, b, { t: 1, top: [0.87, 1], no: 'tb' });
  g.box(0, 1.72, 0.07, 1.5, 0.08, 1.12, b, { t: 1 });
  g.mirror(() => {
    wheel(g, 0.82, 0.44, 1.5, 0.44, 0.3); wheel(g, 0.82, 0.44, -1.45, 0.44, 0.3);
    g.box(0.72, 0.74, 2.43, 0.3, 0.2, 0.08, C.head, { g: 0.9, no: 'k' }); g.box(0.8, 0.8, -2.46, 0.16, 0.26, 0.05, C.tail, { g: 0.6, no: 'f' });
    g.box(0.94, 1.14, 0.75, 0.14, 0.12, 0.1, b, { t: 1 });
    g.box(0.86, 1.1, -1.42, 0.08, 0.1, 2.0, b, { t: 1, no: 'b' });
  });
  g.box(0, 1.1, -2.41, 1.8, 0.1, 0.08, b, { t: 1, no: 'b' });
  g.box(0, 0.4, 2.42, 1.96, 0.22, 0.16, C.chrome); g.box(0, 0.4, -2.44, 1.96, 0.2, 0.14, C.chrome);
  g.box(0, 0.72, 2.44, 1.1, 0.26, 0.06, C.dark, { no: 'k' });
  g.cyl(0, 1.53, -1.2, 0.42, 1.1, 8, C.hay, { ax: 'x', ct: 0xf3d67e, cb: 0xf3d67e });
  g.box(-0.4, 1.12, -2.0, 0.5, 0.45, 0.5, C.plank, { no: 'b' });
};

DEF.shed = (g) => {
  g.box(0, 0, 0, 3.6, 2.0, 3.5, C.paint, { t: 1, no: 'tb' });
  g.box(0, 1.94, 0, 4.0, 0.08, 4.0, C.white);
  g.roof(0, 2.02, 0, 4.0, 0.98, 4.0, C.roofG, { cg: C.paint, tg: 1 });
  g.panel('+z', 0, 0, 1.75, 1.7, 1.75, C.white); g.panel('+z', -0.4, 0.05, 1.75, 0.74, 1.62, C.barn, { eps: 0.06 }); g.panel('+z', 0.4, 0.05, 1.75, 0.74, 1.62, C.barn, { eps: 0.06 });
  g.panel('+z', -0.4, 0.8, 1.75, 0.74, 0.08, C.white, { eps: 0.09 }); g.panel('+z', 0.4, 0.8, 1.75, 0.74, 0.08, C.white, { eps: 0.09 });
  hwin(g, '+x', 1.8, 0.95, 0, 0.9, 0.7); hwin(g, '-x', -1.8, 0.95, 0.3, 0.9, 0.7);
  g.panel('+z', 0, 2.25, 2.0, 0.4, 0.4, C.white); g.panel('+z', 0, 2.3, 2.0, 0.28, 0.28, C.glassD, { eps: 0.06 });
  g.box(-1.3, 0, 1.95, 0.5, 0.5, 0.5, C.plank, { no: 'b' });
};

DEF.outhouse = (g) => {
  g.box(0, 0, 0, 1.15, 2.05, 1.15, C.plank, { no: 'b' });
  g.wedge(0, 2.0, 0, 1.4, 0.4, 1.4, C.woodD, { r: [0, 180, 0] });
  g.panel('+z', 0, 0.05, 0.575, 0.8, 1.75, C.wood, { eps: 0.02 });
  g.at(0, 1.45, 0.6, 0, () => { g.disc(0, 0, 0.01, 0, 0.14, 6, C.lit, { g: 0.5 }); g.disc(0.07, 0.03, 0.02, 0, 0.12, 6, C.wood); });
  g.panel('+z', 0.3, 0.85, 0.575, 0.07, 0.07, C.gold, { eps: 0.04 });
  for (const f of ['+x', '-x', '-z']) for (const u of [-0.2, 0.2]) { const s = f === '-x' ? -1 : 1; if (f === '-z') g.panel(f, u, 0, -0.575, 0.03, 2.0, C.woodD, { eps: 0.01 }); else g.panel(f, s * 0.575, 0, u, 0.03, 2.0, C.woodD, { eps: 0.01 }); }
  g.cyl(0.4, 2.0, -0.4, 0.05, 0.42, 5, C.steelD);
};

DEF.tractor = (g) => {
  const b = C.paint;
  g.mirror(() => {
    g.cyl(0.85, 0.85, -0.85, 0.85, 0.46, 10, C.tyre, { ax: 'x' }); g.cyl(1.08, 0.85, -0.85, 0.5, 0.06, 8, C.yellow, { ax: 'x', caps: 't' });
    wheel(g, 0.72, 0.45, 1.4, 0.45, 0.28, 8, C.yellow);
    g.box(0.85, 1.72, -0.85, 0.5, 0.08, 1.5, b, { t: 1 });
    g.box(0.25, 1.2, 1.87, 0.16, 0.16, 0.06, C.head, { g: 0.8, no: 'k' });
    g.beam([0.5, 1.3, -0.2], [0.5, 2.45, -0.3], 0.04, C.dark); g.beam([0.5, 1.3, -1.5], [0.5, 2.45, -1.4], 0.04, C.dark);
  });
  g.box(0, 0.75, 0.85, 0.8, 0.7, 2.0, b, { t: 1 });
  g.box(0, 0.78, 1.86, 0.7, 0.6, 0.06, C.dark, { no: 'k' });
  g.box(0, 0.5, -0.6, 0.9, 0.8, 1.4, C.gun);
  g.box(0, 1.3, -0.9, 0.6, 0.12, 0.6, C.dark); g.box(0, 1.4, -1.18, 0.6, 0.5, 0.1, C.dark);
  g.box(0, 2.45, -0.85, 1.25, 0.1, 1.4, b, { t: 1 });
  g.cyl(0.25, 1.45, 1.2, 0.06, 1.15, 5, C.steelD);
  g.beam([0, 1.45, 0.0], [0, 1.75, -0.25], 0.03, C.dark, { n: 3 }); g.cyl(0, 1.75, -0.25, 0.2, 0.04, 6, C.dark, { r: [60, 0, 0] });
  g.box(0, 0.4, 1.4, 1.4, 0.12, 0.12, C.gun);
};

DEF.powerpole = (g) => {
  g.cyl(0, 0, 0, 0.17, 8, 6, C.woodD, { r2: 0.11 });
  g.box(0, 7.2, 0, 2.4, 0.14, 0.14, C.wood); g.box(0, 6.4, 0, 1.7, 0.12, 0.12, C.wood);
  g.mirror(() => {
    g.beam([0.1, 6.7, 0], [0.75, 7.2, 0], 0.03, C.steelD, { n: 3 });
    for (const x of [0.6, 1.1]) g.cyl(x, 7.34, 0, 0.06, 0.18, 5, 0x7fc7c0);
    g.cyl(0.75, 6.52, 0, 0.06, 0.18, 5, 0x7fc7c0);
  });
  g.cyl(0.38, 5.2, 0, 0.21, 0.7, 8, C.steel, { ct: C.steelD }); g.cyl(0.38, 5.9, 0, 0.06, 0.2, 5, 0x7fc7c0);
  g.box(0.18, 5.5, 0, 0.2, 0.08, 0.08, C.steelD);
};

DEF.streetlight = (g) => {
  g.cyl(0, 0, -0.5, 0.25, 0.5, 6, C.steelD, { r2: 0.12 }); g.cyl(0, 0.5, -0.5, 0.08, 5.0, 6, C.steel, { r2: 0.06, caps: '' });
  g.beam([0, 5.5, -0.5], [0, 5.9, -0.1], 0.05, C.steel); g.beam([0, 5.9, -0.1], [0, 5.92, 0.7], 0.05, C.steel);
  g.box(0, 5.83, 0.72, 0.36, 0.15, 0.62, C.steelD, { top: [0.7, 0.9] });
  g.box(0, 5.78, 0.75, 0.28, 0.05, 0.48, C.lit, { g: 1 });
};

DEF.busstop = (g) => {
  g.box(0, 0.3, -0.6, 3.0, 1.9, 0.05, C.glass);
  g.box(1.47, 0.3, -0.2, 0.05, 1.9, 0.8, C.glass);
  g.box(-1.47, 0.3, -0.2, 0.12, 1.9, 0.8, C.lit, { g: 0.7, cf: C.dark, ck: C.dark, ct: C.dark, cb: C.dark });
  g.mirror(() => { g.box(1.47, 0, -0.6, 0.08, 2.3, 0.08, C.dark); g.box(1.47, 0, 0.2, 0.08, 2.3, 0.08, C.dark); g.box(0.9, 0, -0.4, 0.06, 0.45, 0.3, C.dark); });
  g.box(0, 2.3, -0.15, 3.2, 0.12, 1.3, C.paint, { t: 1, r: [4, 0, 0] });
  g.box(0, 0.45, -0.4, 2.2, 0.06, 0.35, C.plank);
  g.cyl(1.5, 0, 0.6, 0.04, 2.3, 5, C.steel, { caps: '' }); g.cyl(1.5, 2.3, 0.6, 0.24, 0.05, 8, C.blue, { ax: 'z' });
  g.panel('+z', 1.5, 2.22, 0.63, 0.22, 0.14, C.white, { eps: 0.005 });
};

DEF.boat = (g) => {
  const P = [[-1, -2.7], [1, -2.7], [1.1, 0.4], [0.7, 1.9], [0, 2.8], [-0.7, 1.9], [-1.1, 0.4]];
  g.ext(P, 0.4, 0x2d5d9b, { plane: 'xz', at: [0, 0, 0], sc0: [0.5, 0.86], sc1: [0.85, 0.97] });
  g.ext(P, 0.5, C.paint, { plane: 'xz', at: [0, 0.4, 0], sc0: [0.85, 0.97], t: 1, c1: C.plank });
  g.panel('+y', 0, 0.9, -1.0, 1.5, 2.5, 0x6b7078, { eps: 0.012 });
  g.box(0, 0.9, 0.55, 1.6, 0.52, 0.5, C.glass, { top: [0.85, 0.2], off: [0, -0.2], no: 'b' });
  g.mirror(() => g.box(0.4, 0.9, -0.5, 0.5, 0.42, 0.5, C.white, { no: 'b' }));
  g.box(0, 0.9, -2.1, 1.6, 0.32, 0.5, C.white, { no: 'b' });
  g.box(0, 0.35, -2.85, 0.36, 0.75, 0.36, C.dark); g.box(0, 1.1, -2.85, 0.42, 0.22, 0.5, C.red);
  g.cyl(0, 0.9, 2.2, 0.03, 0.4, 4, C.steel); g.cyl(-0.8, 0.9, -2.5, 0.025, 0.7, 4, C.steel);
  g.quad([-0.8, 1.6, -2.5], [-0.8, 1.35, -2.5], [-0.8, 1.35, -2.95], [-0.8, 1.6, -2.95], C.red, { ds: 1 });
};

DEF.tent = (g) => {
  g.roof(0, 0, 0, 3.0, 1.95, 3.2, C.paint, { t: 1, b: 1, cb: 0x6b7078 });
  g.tri([-0.6, 0, 1.63], [0.6, 0, 1.63], [0, 1.4, 1.63], 0x343a46);
  g.tri([-0.6, 0, 1.66], [-0.2, 0, 1.66], [-0.02, 1.36, 1.66], 0xdadada, { t: 1 });
  g.tri([0.6, 0, 1.66], [0.02, 1.36, 1.66], [0.36, 0, 1.66], 0xdadada, { t: 1 });
  const sl = (f, z, s) => [s * (1.5 * (1 - f) + 0.03), 1.95 * f + 0.025, z];
  g.quad(sl(0, 1.6, 1), sl(0, -1.6, 1), sl(0.2, -1.6, 1), sl(0.2, 1.6, 1), C.orange);
  g.quad(sl(0, -1.6, -1), sl(0, 1.6, -1), sl(0.2, 1.6, -1), sl(0.2, -1.6, -1), C.orange);
  g.cyl(0, 0, 1.64, 0.035, 2.02, 4, C.wood); g.cyl(0, 0, -1.64, 0.035, 2.02, 4, C.wood);
  g.tri([0, 2.02, 1.64], [0, 1.82, 1.64], [0.35, 1.92, 1.64], C.red, { ds: 1 });
};

DEF.trampoline = (g) => {
  g.cyl(0, 0.74, 0, 1.36, 0.04, 12, 0x2a2d34);
  g.lathe(0, 0, 0, [[1.3, 0.72], [1.62, 0.72], [1.62, 0.86], [1.3, 0.86]], 12, (i) => (i % 3 === 0 ? C.yellow : C.blue), { caps: '' });
  for (let k = 0; k < 3; k++) g.at(0, 0, 0, k * 120, () => {
    const a = 22 * D2R, x = sin(a) * 1.5, z = cos(a) * 1.5;
    g.beam([x, 0.03, z], [x, 0.74, z], 0.04, C.steel); g.beam([-x, 0.03, z], [-x, 0.74, z], 0.04, C.steel); g.beam([-x, 0.04, z], [x, 0.04, z], 0.04, C.steel);
  });
};

DEF.portapotty = (g) => {
  g.box(0, 0, 0, 1.2, 0.1, 1.2, C.dark);
  g.box(0, 0.1, 0, 1.12, 1.9, 1.12, C.paint, { t: 1, no: 'b' });
  g.box(0, 2.0, 0, 1.18, 0.22, 1.18, C.white, { top: [0.8, 0.8] });
  g.cyl(-0.35, 2.0, -0.35, 0.06, 0.3, 5, C.steelD);
  g.panel('+z', 0, 0.18, 0.56, 0.84, 1.7, C.concL, { eps: 0.02 });
  g.panel('+z', 0.3, 1.0, 0.56, 0.1, 0.1, C.neonG, { eps: 0.05, g: 0.4 }); g.panel('+z', 0.3, 0.86, 0.56, 0.06, 0.12, C.steelD, { eps: 0.05 });
  g.panel('+z', -0.05, 1.3, 0.56, 0.16, 0.26, C.blue, { eps: 0.05 }); g.panel('+z', -0.05, 1.58, 0.56, 0.1, 0.1, C.blue, { eps: 0.05 });
  g.panel('+x', 0.56, 1.6, 0, 0.7, 0.2, C.steelD); g.panel('-x', -0.56, 1.6, 0, 0.7, 0.2, C.steelD);
};

DEF.dumpster = (g) => {
  const gr = 0x3f7d5a;
  g.ext([[-0.55, 0.15], [0.5, 0.15], [0.6, 1.2], [-0.55, 1.3]], 1.8, gr, { c1: 0x346a4c, c0: 0x346a4c });
  g.box(-0.45, 1.22, 0.02, 0.88, 0.06, 1.2, C.dark, { r: [5, 0, 0] });
  g.box(0.45, 1.42, -0.03, 0.88, 0.06, 1.1, C.dark, { r: [-16, 0, 0] });
  g.blob(0.45, 1.3, 0.22, 0.3, 0.22, 0.3, 0x3a3d45, { seg: 5, rings: 3 }); g.blob(0.25, 1.28, -0.15, 0.24, 0.2, 0.24, 0x596070, { seg: 5, rings: 3, s: 2 });
  g.mirror(() => { g.box(0.93, 0.7, 0, 0.08, 0.2, 0.9, 0x346a4c); for (const z of [0.4, -0.4]) g.cyl(0.75, 0.1, z, 0.1, 0.08, 6, C.tyre, { ax: 'x' }); });
  g.box(0, 0.5, 0.57, 1.5, 0.12, 0.03, C.yellow, { r: [-5.4, 0, 0] });
};

DEF.foodcart = (g) => {
  g.box(0, 0.5, 0, 1.1, 0.75, 1.8, C.paint, { t: 1 });
  g.box(0, 1.25, 0, 1.2, 0.06, 1.9, C.steelL);
  g.mirror(() => {
    g.cyl(0.62, 0.42, -0.3, 0.42, 0.08, 10, C.dark, { ax: 'x' }); g.cyl(0.67, 0.42, -0.3, 0.3, 0.03, 8, C.steelL, { ax: 'x', caps: 't' });
    g.beam([0.4, 1.0, 0.9], [0.4, 1.05, 1.3], 0.03, C.dark);
    g.panel('+x', 0.55, 0.75, 0.3, 1.0, 0.3, C.red, { eps: 0.01 });
  });
  g.box(0, 1.03, 1.3, 0.86, 0.05, 0.05, C.dark);
  g.box(0, 0, 0.75, 0.08, 0.5, 0.08, C.dark, { no: 't' });
  g.cyl(0, 1.3, -0.2, 0.03, 0.62, 4, C.steel, { caps: '' });
  g.cone(0, 1.9, -0.2, 0.86, 0.32, 8, (i) => (i % 2 ? C.red : C.white), { cb: C.cream });
  g.cyl(0.3, 1.31, 0.55, 0.05, 0.2, 5, C.red); g.cyl(0.15, 1.31, 0.55, 0.05, 0.2, 5, C.yellow);
  g.box(-0.2, 1.31, 0.45, 0.16, 0.06, 0.44, 0xe9c58a); g.cyl(-0.2, 1.4, 0.45, 0.055, 0.5, 5, 0xc9563c, { ax: 'z' });
};

// =====================================================================================
// 7. TIER 2 (<=1100 tris)
// =====================================================================================
DEF.tree_big = (g) => {
  g.lathe(0, 0, 0, [[1.15, 0], [0.72, 0.9], [0.52, 3], [0.42, 5.4]], 7, C.woodD, { caps: '' });
  g.beam([0, 4.6, 0], [1.7, 6.8, 0.5], 0.24, C.woodD, { n: 5, r2: 0.12 }); g.beam([0, 4.8, 0], [-1.7, 6.9, -0.6], 0.24, C.woodD, { n: 5, r2: 0.12 }); g.beam([0, 5, 0], [0.2, 7.2, -1.6], 0.22, C.woodD, { n: 5, r2: 0.12 });
  const o = { seg: 8, rings: 5, a: 0.14 };
  g.blob(0, 8.1, 0, 2.7, 2.6, 2.7, C.leaf, o);
  g.blob(1.6, 7.0, 0.7, 1.9, 1.7, 1.9, C.leafD, { ...o, s: 1 }); g.blob(-1.6, 7.2, -0.7, 1.9, 1.8, 1.9, C.leafD, { ...o, s: 2 });
  g.blob(0.3, 7.3, -1.7, 1.8, 1.7, 1.8, 0x4fa446, { ...o, s: 3 }); g.blob(-0.5, 6.9, 1.7, 1.8, 1.6, 1.8, 0x58b040, { ...o, s: 4 });
  g.blob(0.3, 9.2, 0.3, 1.9, 1.8, 1.9, C.leafL, { ...o, s: 5 });
  g.beam([1.3, 6.2, 0.4], [1.3, 1.9, 0.4], 0.03, C.cream, { n: 3 });
  g.torus(1.3, 1.5, 0.4, 0.4, 0.15, 8, 4, C.tyre, { ax: 'x' });
};

DEF.house_a = (g) => {
  g.eps = 0.05; const W = C.paint, sh = 0x3f6f7a;
  g.box(0, 0, -0.3, 9.6, 0.3, 7.6, C.concD, { no: 'b' });
  g.box(0, 0.3, -0.3, 9.4, 3.0, 7.4, W, { t: 1, no: 'tb' });
  g.box(0, 3.24, -0.3, 10, 0.12, 8.4, C.white);
  g.roof(0, 3.36, -0.3, 10, 2.6, 8.4, C.roofR, { ax: 'x', cg: W, tg: 1 });
  g.box(0, 5.9, -0.3, 10.04, 0.1, 0.3, 0x8a3f2f);
  // porch
  g.box(-1.5, 0, 3.95, 3.6, 0.3, 1.2, C.concL, { no: 'b' }); g.box(-1.5, 0, 4.65, 1.6, 0.15, 0.3, C.concL, { no: 'b' });
  g.roof(-1.5, 2.9, 3.9, 3.9, 1.2, 1.7, C.roofR, { cg: C.white, b: 1, cb: C.white });
  g.box(-3.1, 0.3, 4.45, 0.16, 2.6, 0.16, C.white, { no: 'tb' }); g.box(0.1, 0.3, 4.45, 0.16, 2.6, 0.16, C.white, { no: 'tb' });
  door(g, '+z', -1.5, 0.3, 3.4, 1.0, 2.1, 0x9c3b30);
  g.box(-0.6, 2.35, 3.5, 0.16, 0.2, 0.16, C.lit, { g: 1 });
  hwin(g, '+z', 2.4, 1.2, 3.4, 1.7, 1.3, { sh }); hwin(g, '+z', -3.75, 1.3, 3.4, 0.8, 1.2, { nx: 1 });
  for (const f of ['+x', '-x']) { const x = f === '+x' ? 4.7 : -4.7; hwin(g, f, x, 1.2, -2.0, 1.4, 1.3, { sh }); hwin(g, f, x, 1.2, 1.3, 1.4, 1.3, { sh }); g.panel(f, x + (f === '+x' ? 0.3 : -0.3), 4.2, -0.3, 0.9, 0.9, C.white); g.panel(f, x + (f === '+x' ? 0.3 : -0.3), 4.3, -0.3, 0.7, 0.7, C.glassD, { eps: 0.1 }); }
  hwin(g, '-z', -2.4, 1.2, -4.0, 1.6, 1.3); hwin(g, '-z', 2.2, 1.2, -4.0, 1.6, 1.3); door(g, '-z', 0, 0.3, -4.0, 0.9, 2.0, C.woodD);
  g.box(2.8, 3.6, -1.6, 0.9, 3.25, 0.9, C.brick, { no: 'b' }); g.box(2.8, 6.85, -1.6, 1.1, 0.15, 1.1, C.concD);
  g.box(2.4, 0.95, 3.5, 2.0, 0.22, 0.26, C.wood); for (const x of [1.7, 2.4, 3.1]) g.sph(x, 1.27, 3.52, 0.2, 0.18, 0.16, x === 2.4 ? C.yellow : C.hot, { seg: 4, rings: 2 });
  g.blob(3.9, 0.45, 4.0, 0.7, 0.55, 0.6, C.leafD, { seg: 6, rings: 3 }); g.blob(-4.0, 0.4, 3.9, 0.6, 0.5, 0.55, C.leaf, { seg: 6, rings: 3, s: 2 });
};

DEF.house_b = (g) => {
  g.eps = 0.05; const W = C.paint, sh = 0x5a4a7a;
  // main two-storey wing (ridge along x)
  g.box(-2, 0, -2, 8.0, 0.3, 6.0, C.concD, { no: 'b' });
  g.box(-2, 0.3, -2, 7.8, 5.0, 5.8, W, { t: 1, no: 'tb' });
  g.box(-2, 5.26, -2, 8.4, 0.12, 6.6, C.white);
  g.roof(-2, 5.38, -2, 8.4, 2.2, 6.6, C.roofS, { ax: 'x', cg: W, tg: 1 });
  // front garage wing (gable faces front)
  g.box(3.6, 0, 0.6, 4.8, 0.2, 8.4, C.concD, { no: 'b' });
  g.box(3.6, 0.2, 0.6, 4.6, 2.9, 8.2, W, { t: 1, no: 'tb' });
  g.box(3.6, 3.06, 0.6, 5.2, 0.12, 8.8, C.white);
  g.roof(3.6, 3.18, 0.6, 5.2, 1.9, 8.8, C.roofS, { cg: W, tg: 1 });
  g.panel('+z', 3.6, 0.2, 4.7, 3.5, 2.3, C.white); g.wins('+z', 3.6, 0.25, 4.7, 3.3, 2.2, 1, 4, { gx: 0, gy: 0.08, col: 0xe3e6ea, eps: 0.1 });
  g.wins('+z', 3.6, 1.95, 4.7, 3.0, 0.4, 4, 1, { gx: 0.15, gy: 0, eps: 0.14, p: 0.5 });
  g.panel('+z', 3.6, 3.7, 5.0, 0.9, 0.7, C.white); g.panel('+z', 3.6, 3.8, 5.0, 0.6, 0.5, C.glassD, { eps: 0.1 });
  // entrance
  door(g, '+z', -0.2, 0.3, 0.9, 1.0, 2.1, 0x2f6f86);
  g.box(-0.2, 2.75, 1.4, 2.2, 0.14, 1.1, C.roofS, { r: [8, 0, 0] }); g.box(-1.2, 0.3, 1.85, 0.14, 2.5, 0.14, C.white, { no: 'tb' });
  g.box(-0.2, 0, 1.5, 2.2, 0.3, 1.2, C.concL, { no: 'b' });
  g.box(-0.9, 2.3, 1.0, 0.16, 0.2, 0.16, C.lit, { g: 1 });
  hwin(g, '+z', -3.6, 1.1, 0.9, 2.2, 1.4, { nx: 3, sh });
  hwin(g, '+z', -4.3, 3.5, 0.9, 1.2, 1.2, { sh }); hwin(g, '+z', -1.7, 3.5, 0.9, 1.2, 1.2, { sh }); hwin(g, '+z', 0.6, 3.5, 0.9, 0.8, 1.2, { nx: 1 });
  for (const zz of [-3.4, -0.6]) { hwin(g, '-x', -5.9, 1.1, zz, 1.2, 1.3, { sh }); hwin(g, '-x', -5.9, 3.5, zz, 1.2, 1.2, { sh }); }
  hwin(g, '+x', 5.9, 1.1, -1.0, 1.4, 1.2); hwin(g, '+x', 5.9, 1.1, 2.4, 1.4, 1.2);
  for (const x of [-4.4, -1.8, 0.4]) { hwin(g, '-z', x, 1.1, -4.9, 1.3, 1.3); hwin(g, '-z', x, 3.5, -4.9, 1.3, 1.2); }
  g.box(-4.6, 5.8, -3.0, 1.0, 2.05, 1.0, C.brick, { no: 'b' }); g.box(-4.6, 7.85, -3.0, 1.2, 0.15, 1.2, C.concD);
  g.blob(-3.6, 0.5, 1.6, 0.8, 0.6, 0.6, C.leafD, { seg: 6, rings: 3 }); g.blob(-5.2, 0.45, 1.5, 0.6, 0.5, 0.5, C.leaf, { seg: 6, rings: 3, s: 2 });
};

DEF.house_c = (g) => {
  g.eps = 0.05; const W = C.paint, sh = 0x7a3b4a, rf = C.roofT;
  g.box(-0.9, 0, -0.9, 6.9, 0.4, 6.9, C.concD, { no: 'b' });
  g.box(-0.9, 0.4, -0.9, 6.6, 5.2, 6.6, W, { t: 1, no: 'tb' });         // x -4.2..2.4  z -4.2..2.4
  g.box(-0.9, 5.56, -0.9, 7.3, 0.12, 7.3, C.white);
  g.roof(-0.9, 5.68, -0.9, 7.3, 2.9, 7.3, rf, { cg: W, tg: 1 });
  // turret
  g.lathe(2.5, 0, 2.5, [[1.75, 0, C.concD], [1.75, 0.4, W, { t: 1 }], [1.75, 6.3, C.white], [2.0, 6.3, C.white], [2.0, 6.5, rf], [0, 9.0]], 8, W, { caps: '' });
  g.cyl(2.5, 8.9, 2.5, 0.05, 0.5, 4, C.gold);
  for (const a of [0, 90, 45]) g.at(2.5, 0, 2.5, a, () => { for (const y of [1.3, 3.8]) { g.panel('+z', 0, y - 0.1, 1.62, 0.9, 1.5, C.white); g.wins('+z', 0, y, 1.62, 0.66, 1.3, 1, 2, { gx: 0.1, gy: 0.1, eps: 0.1 }); } });
  // porch
  g.box(-1.6, 0, 3.2, 5.0, 0.4, 1.7, C.concL, { no: 'b' }); g.box(-2.2, 0, 4.25, 1.8, 0.2, 0.4, C.concL, { no: 'b' });
  g.box(-1.75, 2.9, 3.2, 5.3, 0.14, 1.9, rf, { r: [7, 0, 0] });
  for (const x of [-4.1, -3.0, -1.4, 0.4]) g.box(x, 0.4, 3.9, 0.15, 2.45, 0.15, C.white, { no: 'tb' });
  g.box(-1.8, 0.95, 3.9, 4.7, 0.08, 0.08, C.white);
  door(g, '+z', -2.2, 0.4, 2.4, 1.0, 2.1, 0x7a3b4a);
  hwin(g, '+z', -0.2, 1.2, 2.4, 1.0, 1.4, { nx: 1, ny: 2 }); hwin(g, '+z', -3.6, 1.2, 2.4, 0.8, 1.4, { nx: 1, ny: 2 });
  hwin(g, '+z', -2.9, 3.6, 2.4, 0.9, 1.5, { nx: 1, ny: 2, sh }); hwin(g, '+z', -0.5, 3.6, 2.4, 0.9, 1.5, { nx: 1, ny: 2, sh });
  g.panel('+z', -0.9, 6.3, 2.78, 1.0, 1.1, C.white); g.wins('+z', -0.9, 6.4, 2.78, 0.75, 0.9, 1, 1, { gx: 0, gy: 0, eps: 0.1, p: 0.7 });
  for (const zz of [-2.8, 0.2]) for (const y of [1.2, 3.6]) { hwin(g, '-x', -4.2, y, zz, 0.9, 1.5, { nx: 1, ny: 2, sh }); hwin(g, '+x', 2.4, y, zz - 0.6, 0.9, 1.5, { nx: 1, ny: 2, sh }); }
  for (const x of [-2.8, 0.6]) for (const y of [1.2, 3.6]) hwin(g, '-z', x, y, -4.2, 0.9, 1.5, { nx: 1, ny: 2 });
  g.box(-3.0, 6.2, -2.6, 0.9, 2.6, 0.9, C.brick, { no: 'b' }); g.box(-3.0, 8.8, -2.6, 1.1, 0.15, 1.1, C.concD);
};

DEF.trailer = (g) => {
  g.eps = 0.04; const W = C.paint;
  g.box(0, 0, 0, 3.0, 0.6, 10.0, C.concD, { no: 'b' });
  g.wins('+x', 1.5, 0.05, 0, 10, 0.5, 20, 1, { gx: 0.4, gy: 0, col: 0x74797c, eps: 0.02 }); g.wins('-x', -1.5, 0.05, 0, 10, 0.5, 20, 1, { gx: 0.4, gy: 0, col: 0x74797c, eps: 0.02 });
  g.box(0, 0.6, 0, 3.1, 2.25, 10.2, W, { t: 1 });
  g.box(0, 2.85, 0, 3.3, 0.2, 10.4, C.white, { top: [0.9, 0.99] });
  for (const f of ['+x', '-x']) { const x = f === '+x' ? 1.55 : -1.55; g.panel(f, x, 1.05, 0, 10.2, 0.28, C.teal, { eps: 0.02 }); }
  // +x side: door + steps + windows with awnings
  door(g, '+x', 1.55, 0.6, 1.4, 0.9, 1.95, C.white, { frame: C.steelL });
  g.box(1.9, 0, 1.4, 0.7, 0.6, 1.3, C.plank, { no: 'b' }); g.box(2.45, 0, 1.4, 0.4, 0.3, 1.3, C.plank, { no: 'b' });
  for (const [zz, w] of [[-3.2, 1.6], [-0.6, 1.0], [3.6, 1.6]]) {
    hwin(g, '+x', 1.55, 1.5, zz, w, 0.9, { nx: w > 1.2 ? 2 : 1 });
    for (let i = 0; i < 4; i++) g.at(1.55, 2.4, zz - w / 2 - 0.1 + (i + 0.5) * (w + 0.2) / 4, 90, () => g.wedge(0, 0, 0.28, (w + 0.2) / 4, 0.3, 0.56, i % 2 ? C.teal : C.white));
  }
  for (const zz of [-3.0, 0.5, 3.4]) hwin(g, '-x', -1.55, 1.5, zz, 1.3, 0.9);
  hwin(g, '+z', 0, 1.4, 5.1, 1.8, 1.0, { nx: 3 }); hwin(g, '-z', 0, 1.5, -5.1, 1.0, 0.8);
  g.box(-1.75, 1.3, -1.4, 0.4, 0.6, 0.9, C.steel); g.panel('-x', -1.95, 1.38, -1.4, 0.6, 0.44, C.steelD, { eps: 0.01 });
  g.beam([-0.5, 0.5, 5.1], [0, 0.45, 5.85], 0.06, C.steelD); g.beam([0.5, 0.5, 5.1], [0, 0.45, 5.85], 0.06, C.steelD); g.box(0, 0, 5.8, 0.12, 0.45, 0.12, C.steelD);
  g.cyl(0.9, 0.0, -5.5, 0.32, 1.1, 8, C.white, { r2: 0.32 }); g.sph(0.9, 1.1, -5.5, 0.32, 0.2, 0.32, C.white, { seg: 8, rings: 2 });
  g.at(-0.6, 3.05, -3.5, 30, () => { g.cyl(0, 0, 0, 0.04, 0.25, 4, C.steelD); g.lathe(0, 0.3, 0, [[0.05, -0.12], [0.3, 0], [0.34, 0.06]], 8, C.steelL, { r: [55, 0, 0], caps: 'b', ct: C.steel }); });
};

DEF.barn = (g) => {
  g.eps = 0.06; const R = C.barn, Wt = C.white;
  g.box(0, 0, 0, 11.5, 0.5, 15.7, C.rock, { no: 'b' });
  g.ext([[-5.6, 0.4], [5.6, 0.4], [5.6, 4.6], [3.5, 6.9], [0, 7.9], [-3.5, 6.9], [-5.6, 4.6]], 15.4, R, { plane: 'xy' });
  g.mirror(() => {
    g.slab([5.9, 4.34, 8], [5.9, 4.34, -8], [3.5, 7.02, -8], [3.5, 7.02, 8], 0.2, C.roofG, { cs: Wt });
    g.slab([3.5, 7.02, 8], [3.5, 7.02, -8], [0, 8.02, -8], [0, 8.02, 8], 0.2, 0x59626e, { cs: Wt });
    g.panel('+z', 5.42, 0.4, 7.7, 0.36, 4.3, Wt); g.panel('-z', 5.42, 0.4, -7.7, 0.36, 4.3, Wt);
    for (const zz of [-5.4, -1.8, 1.8, 5.4]) hwin(g, '+x', 5.6, 1.7, zz, 1.0, 1.0);
    g.panel('+z', 0.88, 0.5, 7.7, 1.6, 3.3, 0xa02e26, { eps: 0.12 });
    g.quad([0.14, 0.56, 7.9], [0.34, 0.56, 7.9], [1.62, 3.74, 7.9], [1.42, 3.74, 7.9], Wt); g.quad([1.42, 0.56, 7.9], [1.62, 0.56, 7.9], [0.34, 3.74, 7.9], [0.14, 3.74, 7.9], Wt);
  });
  g.panel('+z', 0, 0.4, 7.7, 3.7, 3.6, Wt);
  g.panel('+z', 0, 4.75, 7.7, 1.9, 1.75, Wt); g.panel('+z', 0, 4.9, 7.7, 1.5, 1.45, 0x4a2420, { eps: 0.12 });
  g.box(0, 4.92, 7.55, 1.3, 0.75, 0.5, C.hay);
  g.box(0, 7.55, 7.95, 0.22, 0.22, 1.0, C.woodD);
  g.panel('-z', 0, 0.4, -7.7, 3.7, 3.6, Wt); g.panel('-z', 0, 0.5, -7.7, 3.3, 3.3, 0xa02e26, { eps: 0.12 });
  g.at(0, 6.85, -7.7, 180, () => g.disc(0, 0, 0.07, 0, 0.5, 8, Wt)); g.at(0, 6.9, 7.7, 0, () => { g.disc(0, 0, 0.07, 0, 0.5, 8, Wt); g.disc(0, 0, 0.13, 0, 0.36, 8, C.glassD); });
  // cupola + weathervane
  g.box(0, 7.7, 0, 1.6, 0.7, 1.6, Wt, { no: 'b' });
  for (const f of ['+z', '-z']) g.panel(f, 0, 7.95, f === '+z' ? 0.8 : -0.8, 1.1, 0.35, C.steelD); for (const f of ['+x', '-x']) g.panel(f, f === '+x' ? 0.8 : -0.8, 7.95, 0, 1.1, 0.35, C.steelD);
  g.cyl(0, 8.4, 0, 1.35, 0.5, 4, C.roofG, { r2: 0 });
  g.cyl(0, 8.8, 0, 0.03, 0.5, 4, C.dark); g.box(0, 9.15, 0, 0.04, 0.12, 0.8, C.dark); g.tri([0, 9.33, 0.4], [0, 9.09, 0.4], [0, 9.21, 0.62], C.dark, { ds: 1 });
};

DEF.silo = (g) => {
  const c1 = C.concL, c2 = 0xcfcdc4, prof = [];
  for (let i = 0; i < 6; i++) prof.push([2.5, i * 1.9, i === 4 ? C.barn : i % 2 ? c2 : c1]);
  prof.push([2.5, 11.4, C.steel], [2.62, 11.4, C.steel], [2.62, 11.6, C.steelL], [2.3, 12.5, C.steelL], [1.5, 13.3, C.steel], [0.5, 13.8, C.steel], [0.15, 13.9]);
  g.lathe(0, 0, 0, prof, 12, c1, { ta: 1 });
  g.cyl(0, 13.85, 0, 0.1, 0.35, 4, C.steelD);
  g.box(0, 0, 2.55, 0.6, 11.6, 0.34, C.steelD, { no: 'bk' });
  g.wins('+z', 0, 0.4, 2.72, 0.36, 10.8, 1, 9, { gx: 0, gy: 0.5, col: C.dark, eps: 0.01 });
  g.wins('+x', 0, 7.72, 0, 0, 0, 0, 0);
  for (let k = 0; k < 6; k++) g.at(0, 7.72, 0, k * 60 + 30, () => g.panel('+z', 0, 0, 2.42, 0.5, 0.5, C.white, { eps: 0.01 }));
  g.beam([-1.6, 12.9, 0.8], [-2.9, 12.0, 0.8], 0.16, C.steelD, { n: 5 }); g.beam([-2.9, 12.0, 0.8], [-2.9, 0, 0.8], 0.16, C.steelD, { n: 5 });
};

DEF.windmill = (g) => {
  const st = C.steelD, P = (k, sx, sz) => [sx * (2.2 - 1.92 * k), 10.2 * k, sz * (2.2 - 1.92 * k)];
  const cn = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = cn[i], [bx, bz] = cn[(i + 1) % 4];
    g.beam(P(0, ax, az), P(1, ax, az), 0.09, st);
    for (let l = 0; l < 4; l++) {
      const k0 = l / 4, k1 = (l + 1) / 4;
      g.beam(P(k1, ax, az), P(k1, bx, bz), 0.05, st, { n: 3 });
      g.beam(P(k0, ax, az), P(k1, bx, bz), 0.035, C.steel, { n: 3 }); g.beam(P(k0, bx, bz), P(k1, ax, az), 0.035, C.steel, { n: 3 });
    }
  }
  g.box(0, 9.55, 0, 1.7, 0.08, 1.7, C.wood);
  g.box(0, 10.15, 0, 0.5, 0.55, 1.0, st); g.cyl(0, 10.42, 0.72, 0.22, 0.44, 6, st, { ax: 'z' });
  for (let i = 0; i < 12; i++) g.xf({ p: [0, 10.42, 0.9], r: [0, 0, i * 30] }, () => g.quad([-0.1, 0.45, 0.03], [0.12, 0.45, -0.03], [0.36, 2.3, -0.08], [-0.28, 2.3, 0.08], i % 2 ? C.steelL : C.white, { ds: 1, cb: C.steel }));
  g.disc(0, 10.42, 0.9, 2.26, 2.36, 12, st, { ds: 1 }); g.disc(0, 10.42, 0.9, 1.2, 1.28, 12, st, { ds: 1 });
  g.beam([0, 10.42, -0.4], [0, 10.42, -2.0], 0.05, st);
  g.quad([0, 9.9, -1.5], [0, 9.6, -2.5], [0, 11.25, -2.5], [0, 10.95, -1.5], C.red, { ds: 1 });
  g.quad([0.01, 10.25, -1.5], [0.01, 10.1, -2.5], [0.01, 10.75, -2.5], [0.01, 10.6, -1.5], C.white); g.quad([-0.01, 10.25, -1.5], [-0.01, 10.6, -1.5], [-0.01, 10.75, -2.5], [-0.01, 10.1, -2.5], C.white);
  g.cyl(0, 0, 0, 1.25, 0.65, 10, C.steel, { ct: 0x4f9fd0 });
  g.cyl(0, 0, 0, 0.07, 9.6, 4, C.steel, { caps: '' });
};

DEF.semi = (g) => {
  const W = C.paint;
  // trailer
  g.box(0, 1.3, -1.9, 2.6, 2.7, 10.2, C.white);
  g.box(0, 1.0, -1.9, 2.3, 0.3, 10, C.gun, { no: 't' });
  g.mirror(() => {
    g.panel('+x', 1.3, 1.7, -1.9, 10.2, 0.5, C.orange, { eps: 0.02 }); g.panel('+x', 1.3, 2.3, -1.9, 10.2, 0.14, C.red, { eps: 0.02 });
    g.at(1.33, 2.9, -4.2, 90, () => { g.disc(0, 0, 0, 0, 0.75, 10, C.orange); g.disc(0, 0, 0.01, 0, 0.45, 10, C.yellow); });
    g.box(0.8, 0, 1.6, 0.12, 1.0, 0.12, C.steelD, { no: 't' });
    for (const zz of [-5.9, -4.7]) wheel(g, 1.0, 0.52, zz, 0.52, 0.5);
    g.box(1.0, 1.05, -7.02, 0.4, 0.16, 0.06, C.tail, { g: 0.6, no: 'f' });
    g.panel('-z', 0.65, 1.4, -7.0, 0.05, 2.5, C.steelD, { eps: 0.03 });
    // tractor parts
    wheel(g, 1.02, 0.52, 6.1, 0.52, 0.34); for (const zz of [2.2, 3.4]) wheel(g, 1.0, 0.52, zz, 0.52, 0.5);
    g.cyl(1.16, 1.2, 3.85, 0.1, 2.8, 6, C.chrome);
    g.cyl(1.0, 0.85, 4.75, 0.32, 1.3, 8, C.chrome, { ax: 'z' });
    g.box(0.85, 1.3, 6.95, 0.32, 0.25, 0.08, C.head, { g: 0.9, no: 'k' });
    g.panel('+x', 1.25, 2.3, 5.1, 0.9, 0.7, C.glass, { eps: 0.02 });
    g.box(1.42, 2.4, 5.55, 0.08, 0.5, 0.2, C.dark);
    g.box(1.0, 1.12, 6.2, 0.5, 0.1, 1.2, W, { t: 1 });
  });
  g.panel('-z', 0, 1.4, -7.0, 0.05, 2.5, C.steelD, { eps: 0.03 }); g.box(0, 0.5, -6.95, 2.4, 0.14, 0.12, C.steelD);
  g.box(0, 0.6, 4.2, 2.2, 0.5, 5.8, C.gun);
  g.box(0, 1.1, 4.7, 2.5, 2.2, 1.9, W, { t: 1 });
  g.box(0, 3.3, 4.6, 2.4, 0.62, 1.7, W, { t: 1, top: [0.9, 0.4], off: [0, -0.5] });
  g.box(0, 1.1, 6.25, 2.0, 1.1, 1.3, W, { t: 1, top: [0.9, 0.95] });
  g.box(0, 1.15, 6.9, 1.5, 0.95, 0.1, C.chrome); g.wins('+z', 0, 1.2, 6.95, 1.3, 0.85, 5, 1, { gx: 0.5, gy: 0, col: C.steelD, eps: 0.01 });
  g.box(0, 0.5, 6.95, 2.6, 0.4, 0.2, C.chrome);
  g.panel('+z', 0, 2.3, 5.65, 2.1, 0.8, C.glass, { eps: 0.02 });
};

DEF.bus = (g) => {
  g.eps = 0.03; const W = C.paint;
  g.rbox(0, 0.45, 0, 2.6, 2.7, 10.8, 0.25, W, { t: 1 });
  g.mirror(() => {
    g.panel('+x', 1.3, 0.72, 0, 10.8, 0.5, C.blue); g.panel('+x', 1.3, 1.26, 0, 10.8, 0.1, C.sky);
    g.wins('+x', 1.3, 1.6, -0.6, 9.2, 1.05, 8, 1, { gx: 0.07, gy: 0, col: C.glassD2 });
    for (const zz of [3.5, -3.3]) { wheel(g, 1.06, 0.5, zz, 0.5, 0.3); g.panel('+x', 1.3, 0.72, zz, 1.3, 0.45, C.dark, { eps: 0.045 }); }
    g.box(0.85, 0.75, 5.4, 0.4, 0.2, 0.06, C.head, { g: 0.9, no: 'k' }); g.box(0.95, 0.9, -5.4, 0.3, 0.4, 0.06, C.tail, { g: 0.6, no: 'f' });
    g.box(1.42, 2.2, 5.2, 0.1, 0.4, 0.2, C.dark);
  });
  g.panel('+x', 1.3, 0.72, 4.45, 1.0, 2.1, C.glass, { eps: 0.06 }); g.panel('+x', 1.3, 0.72, 4.45, 0.05, 2.1, C.dark, { eps: 0.07 });
  g.panel('+x', 1.3, 0.72, -0.6, 1.1, 2.1, C.glass, { eps: 0.06 }); g.panel('+x', 1.3, 0.72, -0.6, 0.05, 2.1, C.dark, { eps: 0.07 });
  g.panel('+z', 0, 1.35, 5.4, 2.2, 1.35, C.glass); g.panel('+z', 0, 2.78, 5.4, 1.6, 0.28, 0xffb347, { g: 0.9 });
  g.panel('-z', 0, 1.7, -5.4, 2.0, 0.9, C.glassD2); g.wins('-z', 0, 0.8, -5.4, 1.4, 0.6, 1, 4, { gx: 0, gy: 0.4, col: C.dark });
  g.box(0, 0.38, 5.4, 2.6, 0.3, 0.16, C.dark); g.box(0, 0.38, -5.4, 2.6, 0.3, 0.16, C.dark);
  g.box(0, 3.15, -1.8, 1.8, 0.2, 2.6, C.steelL, { top: [0.9, 0.9] }); g.box(0, 3.15, 2.6, 1.4, 0.14, 1.2, C.steelL);
};

DEF.schoolbus = (g) => {
  g.eps = 0.03; const Y = 0xf6b619;
  g.rbox(0, 0.6, -0.9, 2.5, 2.45, 7.8, 0.2, Y);
  g.box(0, 3.05, -0.9, 1.9, 0.1, 7.2, 0xfad25a, { no: 'b' });
  g.box(0, 0.6, 3.9, 2.1, 1.1, 1.9, Y, { top: [0.9, 0.95] });
  g.box(0, 0.7, 4.85, 1.5, 0.8, 0.08, C.dark); g.box(0, 0.4, 4.95, 2.6, 0.3, 0.2, C.dark); g.box(0, 0.4, -4.85, 2.6, 0.3, 0.2, C.dark);
  g.panel('+z', 0, 1.8, 3.0, 2.1, 0.95, C.glass); g.panel('+z', 0, 2.82, 3.0, 1.3, 0.17, C.black);
  g.mirror(() => {
    g.wins('+x', 1.25, 1.85, -1.2, 6.6, 0.75, 7, 1, { gx: 0.14, gy: 0, col: C.glassD2 });
    g.panel('+x', 1.25, 1.5, -0.9, 7.8, 0.1, C.black); g.panel('+x', 1.25, 1.1, -0.9, 7.8, 0.1, C.black);
    wheel(g, 1.05, 0.5, 3.6, 0.5, 0.3); wheel(g, 1.05, 0.5, -2.8, 0.5, 0.3);
    g.box(0.8, 2.82, 3.02, 0.22, 0.18, 0.06, C.neonR, { g: 0.8, no: 'k' }); g.box(0.5, 2.82, 3.02, 0.22, 0.18, 0.06, 0xffb347, { g: 0.8, no: 'k' });
    g.box(0.75, 1.2, 4.86, 0.3, 0.25, 0.06, C.head, { g: 0.9, no: 'k' });
    g.box(0.9, 1.0, -4.82, 0.3, 0.3, 0.06, C.tail, { g: 0.6, no: 'f' }); g.box(0.8, 2.75, -4.82, 0.22, 0.18, 0.06, C.neonR, { g: 0.8, no: 'f' });
    g.box(1.3, 2.0, 3.3, 0.12, 0.35, 0.15, C.dark);
  });
  g.panel('+x', 1.25, 0.75, 2.35, 0.9, 2.0, C.glassD, { eps: 0.05 });
  g.panel('-z', 0, 0.9, -4.8, 1.0, 1.7, 0xe0a514); g.panel('-z', 0, 1.8, -4.8, 0.7, 0.6, C.glassD2, { eps: 0.06 });
  g.cyl(-1.33, 1.9, 1.6, 0.32, 0.05, 8, C.red, { ax: 'x', cb: C.red }); g.panel('-x', -1.36, 1.84, 1.6, 0.36, 0.1, C.white, { eps: 0.005 });
};

DEF.gas_station = (g) => {
  g.eps = 0.05;
  // shop
  g.box(-1, 0, -4, 13, 3.6, 4, C.white, { no: 'b' });
  g.box(-1, 3.6, -4, 13.3, 0.5, 4.3, C.red, { no: 'b' });
  g.wins('+z', -1, 0.4, -2, 11.6, 2.5, 6, 1, { gx: 0.06, gy: 0, p: 0.9 });
  g.panel('+z', -1, 0, -2, 1.5, 2.6, C.steelD, { eps: 0.12 }); g.panel('+z', -1, 0.1, -2, 1.2, 2.4, C.glass, { eps: 0.16 });
  g.box(-1, 3.75, -1.85, 5, 0.75, 0.16, C.yellow, { g: 0.45 });
  g.box(2.5, 4.1, -4.3, 1.6, 0.7, 1.2, C.steel); g.box(-4.5, 4.1, -4.4, 1.0, 0.5, 1.0, C.steelD);
  g.box(4.5, 0, -1.6, 1.4, 1.7, 0.8, C.white); g.panel('+z', 4.5, 0.2, -1.2, 1.2, 1.3, C.sky); g.box(-6.8, 0, -1.6, 0.8, 1.1, 0.8, 0x3f7d5a);
  // canopy
  for (const x of [-6, 3]) for (const zz of [0.4, 4.1]) g.box(x, 0, zz, 0.5, 4.4, 0.5, C.white, { no: 'tb' });
  g.box(-1.5, 4.4, 2.25, 12, 0.8, 6.5, C.white, { cs: C.red, cf: C.red, ck: C.red, cb: C.concL });
  g.panel('+z', -1.5, 4.5, 5.5, 12, 0.2, C.yellow, { g: 0.6 }); g.panel('+x', 4.5, 4.5, 2.25, 6.5, 0.2, C.yellow, { g: 0.6 }); g.panel('-x', -7.5, 4.5, 2.25, 6.5, 0.2, C.yellow, { g: 0.6 });
  for (const x of [-4.5, 1.5]) for (const zz of [1.2, 3.3]) g.box(x, 4.36, zz, 1.2, 0.05, 0.8, C.lit, { g: 1, no: 't' });
  for (const x of [-4.5, 1.5]) {
    g.box(x, 0, 2.25, 1.2, 0.2, 4.8, C.concD, { no: 'b' });
    for (const zz of [1.2, 3.3]) {
      g.box(x, 0.2, zz, 0.8, 1.7, 0.6, C.red, { no: 'b' }); g.box(x, 1.9, zz, 0.9, 0.25, 0.7, C.white);
      g.panel('+x', x + 0.4, 1.2, zz, 0.42, 0.4, C.litCool, { g: 0.8 }); g.panel('-x', x - 0.4, 1.2, zz, 0.42, 0.4, C.litCool, { g: 0.8 });
      g.beam([x + 0.42, 1.0, zz + 0.2], [x + 0.5, 0.5, zz + 0.25], 0.03, C.dark, { n: 3 });
    }
    for (const zz of [-0.3, 4.8]) g.cyl(x, 0, zz, 0.13, 0.95, 5, C.yellow);
  }
  // price totem
  g.box(7.2, 0, 4.5, 0.4, 3.2, 0.4, C.steelD, { no: 'b' }); g.box(7.2, 3.1, 4.5, 1.7, 2.9, 0.44, C.red);
  for (const f of ['+z', '-z']) g.wins(f, 7.2, 3.3, f === '+z' ? 4.72 : 4.28, 1.4, 2.5, 1, 3, { gx: 0.05, gy: 0.2, col: (i, j) => [C.white, C.neonY, C.white][j], g: 0.8, eps: 0.02 });
};

DEF.water_tower = (g) => {
  const W = C.paint, T = { t: 1 };
  g.lathe(0, 0, 0, [[0.5, 9.2, W, T], [2.5, 9.9, W, T], [3.55, 11.2, W, T], [3.65, 12.3, C.teal], [3.65, 13.3, W, T], [3.65, 14.9, C.white], [3.75, 14.9, C.white], [3.75, 15.1, C.roofR], [2.0, 16.6, C.roofR], [0.3, 17.1]], 12, W, { caps: 't' });
  g.cyl(0, 17.0, 0, 0.1, 0.8, 4, C.steelD); g.sph(0, 17.85, 0, 0.16, 0.16, 0.16, C.neonR, { g: 1, seg: 4, rings: 2 });
  g.cyl(0, 0, 0, 0.5, 9.4, 8, C.steel, { caps: '' });
  const L = (k, y) => { const a = (k * 60 + 30) * D2R, r = 3.9 - 0.6 * y / 11; return [sin(a) * r, y, cos(a) * r]; };
  for (let k = 0; k < 6; k++) {
    g.beam(L(k, 0), L(k, 11.1), 0.16, C.steelL);
    for (const y of [3.6, 7.4]) g.beam(L(k, y), L(k + 1, y), 0.09, C.steelL, { n: 3 });
    g.beam(L(k, 0.1), L(k + 1, 3.6), 0.045, C.steel, { n: 3 }); g.beam(L(k + 1, 3.6), L(k, 7.4), 0.045, C.steel, { n: 3 }); g.beam(L(k, 7.4), L(k + 1, 10.6), 0.045, C.steel, { n: 3 });
    g.box(L(k, 0)[0], 0, L(k, 0)[2], 0.7, 0.3, 0.7, C.concD, { no: 'b' });
  }
  g.lathe(0, 0, 0, [[3.5, 10.9], [4.1, 10.9], [4.1, 11.0], [3.5, 11.0]], 12, C.steelD, { caps: '' });
  g.lathe(0, 0, 0, [[4.04, 11.8], [4.1, 11.8], [4.1, 11.88], [4.04, 11.88], [4.04, 11.8]], 12, C.steelD, { caps: '' });
  for (let k = 0; k < 12; k++) { const a = (k * 30 + 15) * D2R; g.beam([sin(a) * 4.07, 11, cos(a) * 4.07], [sin(a) * 4.07, 11.82, cos(a) * 4.07], 0.035, C.steelD, { n: 3 }); }
  g.at(0, 13.9, 3.65 * cos(15 * D2R), 0, () => { g.disc(0, 0, 0.03, 0, 0.8, 10, C.yellow); g.disc(-0.27, 0.2, 0.05, 0, 0.11, 5, C.dark); g.disc(0.27, 0.2, 0.05, 0, 0.11, 5, C.dark); g.disc(0, -0.05, 0.05, 0.42, 0.52, 6, C.dark, { arc: [0.3, 0.7] }); });
  g.box(0, 0, 3.4, 0.5, 11, 0.08, C.steelD, { r: [-2.8, 0, 0], no: 'tb' });
};

DEF.billboard = (g) => {
  g.eps = 0.04;
  g.mirror(() => { g.box(3.5, 0, -0.25, 0.45, 4.4, 0.45, C.steelD, { no: 'b' }); g.beam([3.5, 4.4, -0.5], [3.5, 8.2, -0.2], 0.08, C.steelD); g.beam([3.5, 0.2, -0.3], [0, 4.2, -0.3], 0.06, C.steelD, { n: 3 }); });
  g.box(0, 4.2, 0, 12, 4.7, 0.3, C.steelD);
  g.panel('+z', 0, 4.4, 0.15, 11.6, 4.3, C.cream);
  g.panel('+z', 0, 4.4, 0.15, 11.6, 0.9, C.teal, { eps: 0.07 });
  g.at(-2.9, 6.75, 0.15, 0, () => {
    g.disc(0, 0, 0.08, 0.5, 1.6, 12, 0xd9a15c); g.disc(0, 0, 0.11, 0.62, 1.42, 12, (i) => (i === 3 ? 0xd9a15c : C.pink));
    for (let i = 0; i < 9; i++) { const a = i * 0.71 + 0.2, r = 0.85 + (i % 3) * 0.2; g.at(sin(a) * r, cos(a) * r, 0.13, 0, () => g.quad([-0.1, -0.035, 0], [0.1, -0.035, 0], [0.1, 0.035, 0], [-0.1, 0.035, 0], [C.white, C.yellow, C.neonC, C.purple][i % 4])); }
  });
  g.panel('+z', 2.3, 7.3, 0.15, 5.6, 0.75, C.hot, { eps: 0.07 }); g.panel('+z', 1.8, 6.4, 0.15, 4.6, 0.45, C.navy, { eps: 0.07 }); g.panel('+z', 1.3, 5.7, 0.15, 3.6, 0.35, C.navy, { eps: 0.07 });
  g.at(4.6, 4.85, 0.15, 0, () => g.disc(0, 0, 0.1, 0, 0.6, 10, C.yellow));
  g.panel('-z', 0, 4.4, -0.15, 11.6, 4.3, C.steel);
  g.box(0, 4.0, 0.45, 12, 0.1, 0.6, C.steelD);
  for (const x of [-4, 0, 4]) { g.beam([x, 4.05, 0.72], [x, 4.3, 0.74], 0.03, C.dark, { n: 3 }); g.box(x, 4.12, 0.6, 0.6, 0.14, 0.2, C.lit, { g: 1 }); }
};

DEF.container = (g) => {
  g.eps = 0.03; const W = C.paint, D = shade(C.paint, 0.84);
  g.box(0, 0, 0, 2.44, 2.6, 12, W, { t: 1 });
  g.mirror(() => {
    g.wins('+x', 1.22, 0.16, 0, 11.6, 2.28, 24, 1, { gx: 0.5, gy: 0, col: D, t: 1, eps: 0.02 });
    g.box(1.2, 0, 0, 0.14, 0.14, 12.04, C.gun); g.box(1.2, 2.47, 0, 0.14, 0.14, 12.04, C.gun);
    g.mirrorZ(() => g.box(1.2, 0, 5.95, 0.16, 2.6, 0.16, C.gun));
    g.panel('+x', 1.22, 1.5, -3.5, 2.6, 0.7, C.white, { eps: 0.045 });
    for (const x of [0.25, 0.75]) g.box(x, 0.15, 6.02, 0.06, 2.3, 0.06, C.steelL, { no: 'tb' });
    g.box(0.5, 1.1, 6.05, 0.5, 0.06, 0.05, C.steelL);
  });
  g.wins('+y', 0, 2.6, 0, 2.2, 11.6, 1, 12, { gx: 0, gy: 0.5, col: D, t: 1, eps: 0.02 });
  g.panel('+z', 0, 0.1, 6.0, 0.04, 2.4, C.gun, { eps: 0.02 });
};

DEF.diner = (g) => {
  g.eps = 0.05; const S = C.steelL;
  g.rbox(0, 0, -1, 13.8, 0.4, 6.6, 1.0, C.dark, { ax: 'y', no0: 1 });
  g.rbox(0, 0.4, -1, 13.6, 3.0, 6.4, 1.0, S, { ax: 'y', cap: false });
  g.rbox(0, 3.4, -1, 13.9, 0.35, 6.7, 1.0, C.red, { ax: 'y' });
  g.wins('+z', 0, 0.02, 2.3, 11.6, 0.38, 24, 1, { gx: 0, gy: 0, col: (i) => (i % 2 ? C.white : C.black), eps: 0.02 });
  g.panel('+z', 0, 0.85, 2.2, 11.6, 0.22, C.red); g.panel('+z', 0, 2.85, 2.2, 11.6, 0.26, C.red);
  g.wins('+z', 0, 1.3, 2.2, 11.6, 1.35, 9, 1, { gx: 0.08, gy: 0, p: 0.85, skip: (i) => i === 4 });
  for (const f of ['+x', '-x']) { const x = f === '+x' ? 6.8 : -6.8; g.wins(f, x, 1.3, -1, 4.2, 1.35, 3, 1, { gx: 0.08, gy: 0, p: 0.85 }); g.panel(f, x, 0.85, -1, 4.3, 0.22, C.red); g.panel(f, x, 2.85, -1, 4.3, 0.26, C.red); }
  g.wins('-z', 0, 1.5, -4.2, 11, 1.0, 5, 1, { gx: 0.5, gy: 0, p: 0.5 });
  g.box(0, 0, 2.9, 2.6, 3.0, 1.6, S, { no: 'bk' }); g.box(0, 3.0, 2.9, 2.9, 0.22, 1.9, C.red);
  door(g, '+z', 0, 0.3, 3.7, 1.1, 2.1, C.red, { frame: C.white }); g.panel('+z', 0, 1.5, 3.7, 0.7, 0.7, C.lit, { g: 0.8, eps: 0.12 });
  g.box(0, 0, 4.0, 2.0, 0.3, 0.6, C.concD, { no: 'b' });
  g.box(0, 3.5, 2.37, 11.8, 0.1, 0.06, C.neonP, { g: 1 });
  g.box(0, 3.75, -0.3, 7, 1.2, 0.4, C.red);
  for (const f of ['+z', '-z']) g.wins(f, 0, 3.92, f === '+z' ? -0.1 : -0.5, 6.4, 0.86, 5, 1, { gx: 0.25, gy: 0, col: C.neonY, g: 1, eps: 0.02 });
  g.cyl(4.6, 3.75, -2.4, 0.42, 0.6, 6, C.steel); g.box(-4.5, 3.75, -2.6, 1.6, 0.6, 1.2, C.steel);
  g.mirror(() => g.box(4.2, 0, 2.5, 1.0, 0.5, 0.5, C.brick, { ct: C.leaf, no: 'b' }));
};

DEF.donut_shop = (g) => {
  g.eps = 0.05; const W = C.paint;
  g.box(0, 0, -0.3, 9.6, 4.2, 8.8, W, { t: 1, no: 'tb' });
  g.box(0, 0, -0.3, 9.72, 0.5, 8.92, C.hot, { no: 'tb' });
  g.box(0, 4.2, -0.3, 10, 0.4, 9.2, C.white);
  g.wins('+z', -1.5, 0.6, 4.1, 5.8, 2.2, 3, 1, { gx: 0.07, gy: 0, p: 1 });
  door(g, '+z', 3.0, 0.1, 4.1, 1.2, 2.3, C.glass, { frame: C.hot });
  for (let i = 0; i < 8; i++) g.wedge(-4.2 + i * 1.2, 3.0, 4.65, 1.2, 0.55, 1.1, i % 2 ? C.hot : C.white);
  g.panel('+z', 0, 3.55, 4.1, 7.4, 0.55, C.hot, { g: 0.35 });
  for (const f of ['+x', '-x']) { const x = f === '+x' ? 4.8 : -4.8; hwin(g, f, x, 1.3, 1.6, 1.8, 1.5); hwin(g, f, x, 1.3, -2.2, 1.8, 1.5); }
  door(g, '-z', 2, 0, -4.7, 1.0, 2.1, C.steelD);
  g.box(-3, 4.6, -3, 1.6, 0.7, 1.3, C.steel); g.cyl(3.2, 4.6, -3.2, 0.35, 0.8, 6, C.steelD);
  // the giant donut
  g.box(0, 4.6, 0, 1.8, 0.45, 0.9, C.steelD); g.beam([0, 4.7, -1.6], [0, 6.6, -0.5], 0.1, C.steelD);
  const R = 1.45, r = 0.74, cy = 7.2, mk = g.mark();
  g.torus(0, cy, 0, R, r, 14, 8, (i, j) => ((j < 4 || (j === 7 && i % 3 !== 1) || (j === 4 && i % 2 === 0)) ? C.pink : 0xd9a15c), { ax: 'z' });
  g.shine(mk, [-0.5, 0.8, 0.6], 0.3, 4);
  const sc = [C.white, C.yellow, C.neonC, C.purple, 0x7ddc6a, C.red];
  for (let i = 0; i < 22; i++) {
    const u = (i / 22 + g.rnd() * 0.02) * TAU, v = (0.12 + g.rnd() * 0.26) * TAU, rr = R + r * cos(v);
    g.box(rr * sin(u), cy + rr * cos(u), r * sin(v) + 0.0, 0.3, 0.1, 0.1, sc[i % 6], { r: [g.rnd() * 60 - 30, g.rnd() * 180, g.rnd() * 180], no: 'b' });
  }
};

DEF.playground = (g) => {
  g.box(0, 0, 0, 7, 0.06, 7, 0xcfa873, { no: 'b' });
  // swing set
  g.mirror(() => { g.beam([3.2, 0, -3.3], [3.0, 3.2, -2.4], 0.07, C.blue); g.beam([3.2, 0, -1.5], [3.0, 3.2, -2.4], 0.07, C.blue); });
  g.beam([-3.05, 3.2, -2.4], [3.05, 3.2, -2.4], 0.08, C.blue);
  for (const [x, dz, c] of [[-1.3, 0, C.red], [0.9, 0.7, C.yellow]]) { g.beam([x - 0.25, 3.2, -2.4], [x - 0.25, 0.7 + dz * 0.3, -2.4 + dz], 0.02, C.steelD, { n: 3 }); g.beam([x + 0.25, 3.2, -2.4], [x + 0.25, 0.7 + dz * 0.3, -2.4 + dz], 0.02, C.steelD, { n: 3 }); g.box(x, 0.64 + dz * 0.3, -2.4 + dz, 0.62, 0.07, 0.26, c); }
  // slide tower
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box(2.2 + sx * 0.65, 0, 2.2 + sz * 0.65, 0.14, 2.5, 0.14, C.wood, { no: 'b' });
  g.box(2.2, 1.5, 2.2, 1.5, 0.1, 1.5, C.plank); g.cyl(2.2, 2.5, 2.2, 1.3, 0.95, 4, C.yellow, { r2: 0 });
  g.slab([-1.4, 0.2, 2.6], [1.5, 1.6, 2.6], [1.5, 1.6, 1.8], [-1.4, 0.2, 1.8], 0.08, C.red);
  g.slab([-1.4, 0.45, 2.68], [1.5, 1.85, 2.68], [1.5, 1.85, 2.6], [-1.4, 0.45, 2.6], 0.3, 0xb52d25); g.slab([-1.4, 0.45, 1.8], [1.5, 1.85, 1.8], [1.5, 1.85, 1.72], [-1.4, 0.45, 1.72], 0.3, 0xb52d25);
  g.beam([3.3, 0, 1.9], [2.95, 1.5, 1.9], 0.04, C.steelD); g.beam([3.3, 0, 2.5], [2.95, 1.5, 2.5], 0.04, C.steelD);
  for (let i = 1; i < 4; i++) g.beam([3.3 - i * 0.09, i * 0.38, 1.9], [3.3 - i * 0.09, i * 0.38, 2.5], 0.03, C.steelD, { n: 3 });
  // sandbox
  g.box(-1.9, 0.06, -0.1, 2.6, 0.3, 2.6, C.wood, { ct: 0xedd9a3, no: 'b' });
  g.box(-2.3, 0.36, 0.2, 0.3, 0.3, 0.3, C.red, { top: [0.7, 0.7] }); g.cone(-1.4, 0.36, -0.5, 0.3, 0.35, 5, 0xe2c88a);
  // see-saw
  g.box(1.6, 0.06, -0.3, 0.3, 0.5, 0.5, C.blue, { top: [0.5, 1] }); g.box(1.6, 0.52, -0.3, 0.28, 0.08, 3.0, C.teal, { r: [12, 0, 0] });
  g.box(1.6, 0.9, 1.0, 0.5, 0.05, 0.05, C.dark); g.box(1.6, 0.34, -1.6, 0.5, 0.05, 0.05, C.dark);
  // spring rider
  g.cyl(-0.4, 0.06, 2.6, 0.08, 0.4, 5, C.steelD); g.box(-0.4, 0.46, 2.6, 0.24, 0.3, 0.8, C.purple, { top: [1, 0.7] }); g.box(-0.4, 0.7, 2.9, 0.5, 0.05, 0.05, C.dark);
};

DEF.yacht = (g) => {
  g.eps = 0.04; const Wt = C.white;
  const P = [[-2.3, -8], [2.3, -8], [2.5, -2], [2.3, 2.5], [1.4, 6], [0, 8], [-1.4, 6], [-2.3, 2.5], [-2.5, -2]];
  g.ext(P, 1.0, C.navy, { plane: 'xz', sc0: [0.45, 0.9], sc1: [0.9, 0.97] });
  g.ext(P, 0.25, C.gold, { plane: 'xz', at: [0, 1.0, 0], sc0: [0.9, 0.97], sc1: [0.925, 0.978], cap: false });
  g.ext(P, 0.95, Wt, { plane: 'xz', at: [0, 1.25, 0], sc0: [0.925, 0.978], c1: C.plank });
  g.box(0, 2.2, -1.5, 3.8, 1.3, 6.6, Wt, { no: 'b' }); g.wedge(0, 2.2, 2.5, 3.8, 1.3, 1.4, C.glassD, { cs: Wt });
  g.mirror(() => {
    g.wins('+x', 1.9, 2.62, -1.5, 6.0, 0.58, 6, 1, { gx: 0.1, gy: 0, p: 0.5 });
    g.wins('+x', 1.5, 3.95, -1.2, 3.2, 0.5, 3, 1, { gx: 0.1, gy: 0, p: 0.5 });
    g.beam([1.4, 4.8, -2.6], [1.0, 5.5, -3.0], 0.1, Wt);
    for (const zz of [3.4, 4.8, 6.0]) { const x = zz < 4 ? 2.05 : zz < 5.5 ? 1.75 : 1.2; g.beam([x, 2.2, zz], [x, 2.75, zz], 0.03, C.steelL, { n: 3 }); }
    g.beam([2.05, 2.75, 3.4], [1.75, 2.75, 4.8], 0.03, C.steelL, { n: 3 }); g.beam([1.75, 2.75, 4.8], [1.2, 2.75, 6.0], 0.03, C.steelL, { n: 3 }); g.beam([1.2, 2.75, 6.0], [0, 2.75, 7.5], 0.03, C.steelL, { n: 3 });
    g.box(1.0, 2.2, -6.3, 0.7, 0.25, 1.8, C.orange, { no: 'b' });
  });
  g.box(0, 3.5, -1.8, 4.0, 0.12, 7.0, Wt);
  g.box(0, 3.62, -1.2, 3.0, 1.1, 3.6, Wt, { no: 'b' }); g.wedge(0, 3.62, 1.1, 3.0, 1.1, 1.0, C.glassD, { cs: Wt });
  g.box(0, 4.72, -1.4, 3.3, 0.1, 4.2, Wt);
  g.box(0, 5.5, -3.0, 2.2, 0.12, 0.5, Wt); g.sph(0, 5.8, -3.0, 0.32, 0.26, 0.32, Wt, { seg: 6, rings: 3 }); g.cyl(0.6, 5.6, -3, 0.03, 0.55, 4, C.steelD);
  g.cyl(0, 2.2, -5.0, 0.8, 0.3, 8, Wt, { ct: 0x4fc3e8 });
  g.cyl(0, 2.2, 7.3, 0.03, 0.9, 4, C.steelL); g.cyl(-1.6, 2.2, -7.6, 0.03, 1.3, 4, C.steelL);
  g.quad([-1.6, 3.5, -7.6], [-1.6, 3.05, -7.6], [-1.6, 3.05, -8.3], [-1.6, 3.5, -8.3], C.red, { ds: 1 });
};

DEF.small_plane = (g) => {
  const W = C.white, A = C.paint, T = { t: 1 };
  g.lathe(0, 1.35, 0, [[0.1, -4.6, A, T], [0.3, -3.2, W], [0.55, -1.2, W], [0.74, 0.6, W], [0.72, 2.2, A, T], [0.5, 3.2, C.steelD], [0.27, 3.6]], 8, W, { ax: 'z', e: [0.95, 1.1] });
  g.cyl(0, 1.35, 3.8, 0.25, 0.4, 6, C.red, { ax: 'z', r2: 0.03 });
  g.box(0, 0.3, 3.75, 0.18, 2.1, 0.04, C.dark);
  g.box(0, 2.05, 0.9, 10.0, 0.15, 1.5, W, { top: [1, 0.9] });
  g.mirror(() => {
    g.box(5.25, 2.04, 0.9, 0.5, 0.17, 1.52, A, { t: 1, top: [0.7, 0.8] });
    g.beam([0.6, 0.9, 0.8], [2.6, 2.05, 0.9], 0.04, C.steel);
    g.beam([0.5, 0.9, 0.6], [1.15, 0.3, 0.5], 0.05, C.steel); wheel(g, 1.15, 0.3, 0.5, 0.3, 0.14);
    g.panel('+x', 0.5, 1.5, 0.5, 0.9, 0.4, C.glassD, { eps: 0.2 });
  });
  g.box(0, 1.72, 1.5, 1.1, 0.42, 1.5, C.glass, { top: [0.8, 0.7], no: 'b' });
  g.ext([[-4.6, 1.4], [-3.5, 1.5], [-3.95, 2.95], [-4.6, 3.02]], 0.09, A, T);
  g.box(0, 1.45, -4.0, 3.4, 0.07, 0.8, A, { t: 1, top: [1, 0.8] });
  g.beam([0, 0.9, 2.5], [0, 0.28, 2.7], 0.04, C.steel); g.cyl(0, 0.26, 2.7, 0.26, 0.12, 8, C.tyre, { ax: 'x' });
};

// =====================================================================================
// 8. TIER 3 (<=2600 tris)
// =====================================================================================
const RAINBOW = [0xd13b30, 0xf28a25, 0xf8c734, 0x6fbd3f, 0x2fa7a2, 0x3f82d6, 0x8a63c9, 0xff4f9a];
function acUnit(g, x, y, z, w = 1.8, h = 0.9, d = 1.4) { g.box(x, y, z, w, h, d, C.steel, { no: 'b', ct: C.steelD }); g.panel('+y', x, y + h, z, w * 0.5, d * 0.5, C.dark, { eps: 0.02 }); }
function palm(g, x, z, h = 5) {
  g.cyl(x, 0, z, 0.22, h, 5, 0xa98a5c, { r2: 0.14, caps: '' });
  for (let i = 0; i < 6; i++) g.at(x, h, z, i * 60 + 15, () => { g.tri([0, 0, 0], [0.45, 0.25, 1.2], [-0.45, 0.25, 1.2], C.leaf, { ds: 1, cb: C.leafD }); g.tri([0.45, 0.25, 1.2], [0, -0.7, 2.3], [-0.45, 0.25, 1.2], C.leafD, { ds: 1, cb: C.leaf }); });
}

DEF.store = (g) => {
  g.eps = 0.08; const W = C.paint;
  g.box(0, 0, -0.5, 26, 6.6, 19, W, { t: 1, no: 'tb' });
  g.box(0, 6.6, -0.5, 26.2, 0.5, 19.2, C.white, { no: 'b', ct: C.concD });
  for (const f of ['+x', '-x']) g.panel(f, f === '+x' ? 13 : -13, 4.6, -0.5, 19, 0.8, C.red);
  g.panel('-z', 0, 4.6, -10, 26, 0.8, C.red);
  // facade
  g.box(0, 0, 9.2, 15, 8.6, 1.2, C.red, { no: 'bk' });
  g.box(0, 8.6, 9.2, 6.5, 0.4, 1.2, C.white);
  g.panel('+z', 0, 6.1, 9.8, 11, 1.7, C.white, { g: 0.6 });
  g.wins('+z', 0, 6.35, 9.8, 9.6, 1.2, 6, 1, { gx: 0.28, gy: 0, col: C.red, eps: 0.16 });
  g.wins('+z', -10, 0.4, 9.0, 5.4, 3.2, 3, 1, { gx: 0.07, gy: 0, p: 0.85 }); g.wins('+z', 10, 0.4, 9.0, 5.4, 3.2, 3, 1, { gx: 0.07, gy: 0, p: 0.85 });
  g.wins('+z', 0, 0.2, 9.8, 13, 3.6, 6, 1, { gx: 0.05, gy: 0, p: 0.9 });
  g.box(0, 3.95, 10.4, 9, 0.3, 1.6, C.steelD); g.mirror(() => g.box(4.1, 0, 11.0, 0.3, 3.95, 0.3, C.white, { no: 'tb' }));
  g.panel('+z', 0, 0, 9.8, 3.4, 3.0, C.steelD, { eps: 0.2 }); g.wins('+z', 0, 0.1, 9.8, 3.0, 2.8, 2, 1, { gx: 0.06, gy: 0, col: C.glass, eps: 0.26 });
  // roof
  g.wins('+y', 0, 7.1, -3, 18, 9, 4, 2, { gx: 0.6, gy: 0.6, p: 0.5, eps: 0.04 });
  for (const [x, z] of [[-9, -7], [-3, -8], [4, -7.5], [10, -8], [10, 4]]) acUnit(g, x, 7.1, z, 2.2, 1.0, 1.8);
  // back dock + carts
  g.box(-6, 0, -10.4, 7, 1.2, 0.8, C.concD, { no: 'b' });
  for (const x of [-7.6, -4.4]) { g.panel('-z', x, 1.2, -10, 2.6, 3.0, C.steelL); g.wins('-z', x, 1.2, -10, 2.4, 3.0, 1, 5, { gx: 0, gy: 0.15, col: C.steel, eps: 0.14 }); }
  g.box(10.5, 0, 10.1, 3, 0.9, 1.2, C.steelD, { no: 'bt' }); for (let i = 0; i < 3; i++) g.box(9.7 + i * 0.8, 0.2, 10.1, 0.6, 0.6, 0.9, C.steelL, { no: 'b' });
  for (const x of [-8, -6, 6]) g.cyl(x, 0, 10.6, 0.14, 0.9, 5, C.yellow);
};

DEF.warehouse = (g) => {
  g.eps = 0.08; const W = C.paint, D = shade(C.paint, 0.86);
  g.box(0, 0, 0, 29, 7.5, 21, W, { t: 1, no: 'tb' });
  g.roof(0, 7.5, 0, 30, 2.6, 21.6, C.steel, { ax: 'x', cg: W, tg: 1 });
  const ry = (z) => 7.5 + 2.6 * (1 - abs(z) / 10.8) + 0.02;
  g.winsQ([-12, ry(8.6), 8.6], [12, ry(8.6), 8.6], [12, ry(3.6), 3.6], [-12, ry(3.6), 3.6], 6, 1, { gx: 0.62, gy: 0, p: 0.55 });
  g.winsQ([12, ry(8.6), -8.6], [-12, ry(8.6), -8.6], [-12, ry(3.6), -3.6], [12, ry(3.6), -3.6], 6, 1, { gx: 0.62, gy: 0, p: 0.55 });
  for (const x of [-10, -5, 0, 5, 10]) { g.cyl(x, 9.9, 0, 0.55, 0.6, 8, C.steelL, { caps: '' }); g.sph(x, 10.5, 0, 0.75, 0.5, 0.75, C.steelL, { seg: 8, rings: 3 }); }
  g.wins('+z', 0, 0.2, 10.5, 28.6, 7.1, 36, 1, { gx: 0.5, gy: 0, col: D, t: 1, eps: 0.03 }); g.wins('-z', 0, 0.2, -10.5, 28.6, 7.1, 36, 1, { gx: 0.5, gy: 0, col: D, t: 1, eps: 0.03 });
  for (const f of ['+x', '-x']) { const x = f === '+x' ? 14.5 : -14.5; g.wins(f, x, 0.2, 0, 20.6, 7.1, 26, 1, { gx: 0.5, gy: 0, col: D, t: 1, eps: 0.03 }); g.panel(f, x, 5.9, 0, 21, 0.9, C.blue); }
  g.panel('+z', 0, 5.9, 10.5, 29, 0.9, C.blue); g.panel('-z', 0, 5.9, -10.5, 29, 0.9, C.blue);
  // docks
  g.box(-3.5, 0, 11.0, 21, 1.1, 1.0, C.concD, { no: 'b' });
  for (const x of [-11, -6, -1, 4]) {
    g.panel('+z', x, 1.1, 10.5, 3.6, 3.9, C.white, { eps: 0.12 }); g.wins('+z', x, 1.1, 10.5, 3.2, 3.6, 1, 6, { gx: 0, gy: 0.14, col: C.steelL, eps: 0.18 });
    g.box(x - 1.5, 0.5, 11.5, 0.3, 0.6, 0.16, C.dark); g.box(x + 1.5, 0.5, 11.5, 0.3, 0.6, 0.16, C.dark);
  }
  g.box(11.2, 0, 11.3, 5.6, 3.4, 1.8, C.white, { no: 'bk', ct: C.concD }); g.wins('+z', 10.4, 1.2, 12.2, 2.8, 1.4, 2, 1, { gx: 0.1, gy: 0, p: 0.9 }); door(g, '+z', 13, 0, 12.2, 1.0, 2.2, C.blue);
  g.box(7.6, 1.1, 11.0, 1.2, 1.2, 0.9, C.plank, { no: 'b' }); g.box(7.6, 2.3, 11.0, 1.0, 1.0, 0.8, C.woodL, { no: 'b' }); g.box(6.3, 1.1, 11.0, 1.0, 1.0, 0.9, C.wood, { no: 'b' });
  g.panel('+z', 9, 3.4, 10.5, 2.2, 2.2, C.white, { eps: 0.12 }); g.at(9, 4.5, 10.66, 0, () => g.disc(0, 0, 0, 0.5, 0.85, 10, C.blue));
};

DEF.apartment = (g) => {
  g.eps = 0.07; const W = C.paint;
  g.box(0, 0, 0, 17, 19.5, 13, W, { t: 1, no: 'tb' });
  g.box(0, 0, 0, 17.2, 3.4, 13.2, 0x7c5a4a, { no: 'tb' });
  g.box(0, 3.4, 0, 17.4, 0.25, 13.4, C.cream, { no: 'tb' });
  g.box(0, 19.5, 0, 18, 0.6, 14, C.cream, { ct: C.concD });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box(sx * 8.4, 3.6, sz * 6.4, 0.7, 15.9, 0.7, C.cream, { no: 'tb' });
  const wo = { gx: 0.48, gy: 0.45 };
  g.wins('+z', 0, 3.9, 6.5, 15.2, 15.4, 6, 5, wo); g.wins('-z', 0, 3.9, -6.5, 15.2, 15.4, 6, 5, wo);
  g.wins('+x', 8.5, 3.9, 0, 11.4, 15.4, 4, 5, wo); g.wins('-x', -8.5, 3.9, 0, 11.4, 15.4, 4, 5, wo);
  for (let f = 0; f < 5; f++) for (const x of [-3.8, 3.8]) { const y = 4.2 + f * 3.08; g.box(x, y, 6.95, 2.9, 0.14, 0.9, C.concL); g.box(x, y + 0.14, 7.36, 2.9, 0.8, 0.06, C.dark, { no: 'b' }); }
  // shops
  g.wins('+z', -5.2, 0.5, 6.6, 5.6, 2.2, 2, 1, { gx: 0.08, gy: 0, p: 0.95 }); g.wins('+z', 5.2, 0.5, 6.6, 5.6, 2.2, 2, 1, { gx: 0.08, gy: 0, p: 0.95 });
  for (let i = 0; i < 5; i++) { g.wedge(-7.6 + i * 1.2, 2.8, 7.05, 1.2, 0.5, 0.9, i % 2 ? C.white : C.leafD); g.wedge(2.8 + i * 1.2, 2.8, 7.05, 1.2, 0.5, 0.9, i % 2 ? C.white : C.red); }
  door(g, '+z', 0, 0, 6.6, 1.6, 2.6, C.woodD, { frame: C.cream }); g.box(0, 2.9, 7.0, 2.6, 0.2, 0.8, C.cream);
  // fire escape (+x)
  for (let f = 0; f < 5; f++) {
    const y = 4.2 + f * 3.08;
    g.box(9.0, y, 0, 1.0, 0.1, 5.0, C.dark); g.box(9.47, y + 0.1, 0, 0.05, 0.9, 5.0, C.dark, { no: 'tb' });
    if (f > 0) g.beam([9.0, y - 3.08 + 0.1, f % 2 ? -2 : 2], [9.0, y, f % 2 ? 2 : -2], 0.07, C.dark, { e: [3, 1] });
  }
  g.beam([9.0, 0.6, 2], [9.0, 4.2, 2], 0.05, C.dark, { n: 3 });
  // roof
  g.box(-4, 20.1, -2, 3, 1.6, 3, 0x8f6a58, { no: 'b', ct: C.concD }); g.panel('+z', -4, 20.1, -0.5, 0.9, 1.4, C.steelD);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.beam([4 + sx * 1.0, 20.1, 1 + sz * 1.0], [4 + sx * 0.8, 20.7, 1 + sz * 0.8], 0.07, C.dark);
  g.cyl(4, 20.7, 1, 1.25, 1.0, 8, C.wood, { cb: C.woodD }); g.cone(4, 21.7, 1, 1.4, 0.55, 8, C.steelD);
  acUnit(g, 2, 20.1, -4, 1.6, 0.7, 1.3); acUnit(g, -1, 20.1, 3.5, 1.4, 0.6, 1.2);
  g.cyl(-6.5, 20.1, 4, 0.04, 1.9, 4, C.dark, { caps: '' }); g.box(-6.5, 21.6, 4, 0.9, 0.04, 0.04, C.dark); g.box(-6.5, 21.2, 4, 0.6, 0.04, 0.04, C.dark);
};

DEF.church = (g) => {
  g.eps = 0.07; const W = C.paint, rf = C.roofS;
  g.box(0, 0, -2.1, 10, 8, 14.6, W, { t: 1, no: 'tb' });
  g.box(0, 7.9, -2.1, 11, 0.14, 15.2, C.white);
  g.roof(0, 8.04, -2.1, 11, 5.4, 15.2, rf, { cg: W, tg: 1 });
  // apse
  g.cyl(0, 0, -9.4, 2.5, 6.5, 8, W, { t: 1, caps: '' }); g.cone(0, 6.5, -9.4, 2.8, 2.6, 8, rf);
  // tower
  g.box(0, 0, 8, 5.6, 15, 5.6, W, { t: 1, no: 'tb' });
  g.box(0, 15, 8, 6.0, 0.3, 6.0, C.white);
  g.box(0, 15.3, 8, 5.0, 2.9, 5.0, W, { t: 1, no: 'b' });
  for (let k = 0; k < 4; k++) g.at(0, 0, 8, k * 90, () => { g.panel('+z', 0, 15.7, 2.5, 1.5, 1.5, 0x39404c); g.tri([-0.75, 17.2, 2.57], [0.75, 17.2, 2.57], [0, 17.9, 2.57], 0x39404c); g.wins('+z', 0, 9.5, 2.8, 1.0, 3.2, 1, 1, { gx: 0, gy: 0, p: k === 0 ? 0 : 0.7 }); });
  g.box(0, 18.2, 8, 5.6, 0.25, 5.6, C.white);
  g.cyl(0, 18.45, 8, 3.7, 4.8, 4, rf, { r2: 0 });
  g.box(0, 22.9, 8, 0.14, 1.2, 0.14, C.gold); g.box(0, 23.5, 8, 0.7, 0.14, 0.14, C.gold);
  // entrance
  g.box(0, 0, 11.1, 4.2, 0.4, 0.8, C.concL, { no: 'b' });
  g.panel('+z', 0, 0.4, 10.8, 2.7, 3.3, C.white); g.panel('+z', -0.6, 0.4, 10.8, 1.1, 3.1, C.woodD, { eps: 0.13 }); g.panel('+z', 0.6, 0.4, 10.8, 1.1, 3.1, C.wood, { eps: 0.13 });
  g.at(0, 3.6, 10.8, 0, () => { g.disc(0, 0, 0.07, 0, 1.35, 10, C.white, { arc: [-0.25, 0.25] }); g.disc(0, 0, 0.13, 0, 1.1, 8, C.woodD, { arc: [-0.25, 0.25] }); });
  g.at(0, 11.1, 10.8, 0, () => { g.disc(0, 0, 0.07, 0, 1.5, 12, C.white); g.disc(0, 0, 0.14, 0.3, 1.25, 12, (i) => [C.neonC, C.hot, C.neonY, C.purple][i % 4], { g: 0.8 }); g.disc(0, 0, 0.14, 0, 0.3, 6, C.gold, { g: 0.6 }); });
  // nave windows + buttresses
  const sg = [0x4f8fe0, 0xe0503f, 0xf2c744, 0x4fb07a];
  g.mirror((s) => {
    for (let i = 0; i < 4; i++) {
      const z = -7.4 + i * 3.4;
      g.panel('+x', 5, 2.0, z, 1.3, 4.3, C.white); g.wins('+x', 5, 2.2, z, 0.95, 3.9, 1, 3, { gx: 0, gy: 0.08, col: (a, j) => sg[(i + j + (s > 0 ? 0 : 2)) % 4], g: 0.7, eps: 0.13 });
      g.box(5.3, 0, z + 1.7, 0.7, 6.4, 0.8, C.concL, { top: [0.4, 1], off: [-0.2, 0], no: 'b' });
    }
  });
  g.box(-2.4, 0, 11.6, 0.8, 1.0, 0.8, C.brick, { ct: C.leaf, no: 'b' }); g.box(2.4, 0, 11.6, 0.8, 1.0, 0.8, C.brick, { ct: C.leaf, no: 'b' });
};

DEF.factory = (g) => {
  g.eps = 0.08; const B = C.brick, BD = C.brickD;
  g.box(-3, 0, 0, 25, 8, 22, B, { no: 'tb' });
  g.box(-3, 7.6, 0, 25.3, 0.4, 22.3, C.concL, { no: 'tb' });
  for (let j = 0; j < 4; j++) {
    const z0 = -11 + j * 5.5;
    g.ext([[z0, 8], [z0 + 5.5, 8], [z0 + 5.5, 10.6]], 25, 0x77818c, { at: [-3, 0, 0], c0: B, c1: B });
    g.wins('+z', -3, 8.35, z0 + 5.5, 24.2, 2.0, 10, 1, { gx: 0.08, gy: 0, p: 0.65, dark: C.glassT, dark2: 0x4f9fb0 });
  }
  const wi = { gx: 0.25, gy: 0.2, dark: C.glassT, dark2: 0x4f9fb0, p: 0.45 };
  g.wins('+z', -0.6, 2.2, 11, 19, 4.4, 7, 2, wi); g.wins('-z', -3, 2.2, -11, 23, 4.4, 8, 2, wi); g.wins('-x', -15.5, 2.2, 0, 20, 4.4, 7, 2, wi);
  for (const x of [-15.2, -10.2, -5, 0.2, 4.6, 9.2]) g.box(x, 0, 11.05, 0.7, 7.6, 0.3, BD, { no: 'bk' });
  g.panel('+z', -12.7, 0, 11, 4.0, 5.2, C.concL); g.wins('+z', -12.7, 0, 11, 3.6, 5.0, 1, 7, { gx: 0, gy: 0.14, col: C.steelD, eps: 0.14 });
  // boiler house + stacks
  g.box(12.5, 0, 3, 6, 6, 10, BD, { no: 'b', ct: C.concD });
  g.wins('+x', 15.5, 1.6, 3, 8.4, 3, 4, 1, wi); g.wins('+z', 12.5, 1.6, 8, 4.6, 3, 2, 1, wi);
  acUnit(g, 12.5, 6, 5.5, 2.4, 1.0, 2.0);
  const stack = (x, z, r, h) => g.lathe(x, 0, z, [[r * 1.3, 0, B], [r * 1.1, h * 0.55, B], [r, h * 0.68, C.white], [r * 0.96, h * 0.78, C.red], [r * 0.92, h * 0.88, C.white], [r * 0.9, h * 0.96, C.red], [r * 0.9, h, C.red]], 8, B, { ct: C.black, ta: 1 });
  stack(12, -6.2, 1.25, 16); stack(14.4, -9.6, 1.0, 13);
  // tanks + pipes
  g.cyl(12.5, 2.3, 10.2, 1.3, 5.2, 10, C.steelL, { ax: 'x' }); g.mirror(() => 0);
  for (const x of [11, 14]) g.box(x, 0, 10.2, 0.5, 1.2, 2.0, C.concD, { no: 'b' });
  g.beam([10.5, 3.6, 10.2], [10.5, 7, 10.2], 0.16, C.orange, { n: 5 }); g.beam([10.5, 7, 10.2], [10.5, 7, 8], 0.16, C.orange, { n: 5 });
  g.lathe(12.2, 0, -1.2, [[1.4, 6], [1.4, 9.4], [1.0, 10.2], [0.2, 10.5]], 8, C.steelL, { caps: '' });
  g.beam([12, 9, -2.4], [12, 9, -5.2], 0.14, C.orange, { n: 5 });
};

DEF.fuel_tank = (g) => {
  g.eps = 0.07; const Wt = C.white;
  g.box(0, 0, 0, 13.6, 0.15, 13.6, C.concrete, { no: 'b' });
  for (let k = 0; k < 4; k++) g.at(0, 0, 0, k * 90, () => g.box(0, 0, 6.8, 14, 0.9, 0.4, C.concD, { no: 'b' }));
  g.lathe(0, 0, 0, [[5.6, 0.15, Wt], [5.6, 2.4, C.paint, { t: 1 }], [5.6, 3.5, Wt], [5.6, 9.0, C.steelD], [5.75, 9.0, C.steelD], [5.75, 9.25, Wt], [4, 9.9, C.concL], [0.6, 10.3]], 16, Wt, { ct: C.steel });
  g.cyl(0, 10.3, 0, 0.5, 0.5, 6, C.steel);
  // spiral stair
  let prev = null;
  for (let i = 0; i <= 20; i++) {
    const a = (-40 + i * 11) * D2R, y = 0.5 + i * 0.44, p = [sin(a) * 6.55, y + 1.0, cos(a) * 6.55];
    g.at(0, y, 0, -40 + i * 11, () => g.box(0, 0, 6.12, 1.25, 0.1, 0.95, C.steelD));
    if (prev) g.beam(prev, p, 0.045, C.yellow, { n: 3 });
    if (i % 4 === 0) g.beam([p[0], y, p[2]], p, 0.04, C.yellow, { n: 3 });
    prev = p;
  }
  for (let k = 0; k < 16; k++) { const a = (k + 0.5) / 16 * TAU, a2 = (k + 1.5) / 16 * TAU; g.beam([sin(a) * 5.7, 9.25, cos(a) * 5.7], [sin(a) * 5.7, 10.1, cos(a) * 5.7], 0.04, C.yellow, { n: 3 }); g.beam([sin(a) * 5.7, 10.1, cos(a) * 5.7], [sin(a2) * 5.7, 10.1, cos(a2) * 5.7], 0.04, C.yellow, { n: 3 }); }
  // hazard diamond + pipework
  g.at(0, 6.2, 5.6 * cos(Math.PI / 16), 0, () => { g.disc(0, 0, 0.05, 0, 1.5, 4, C.white, { ph: 0 }); g.disc(0, 0, 0.1, 0, 1.3, 4, C.orange, { ph: 0 }); g.tri([-0.45, -0.5, 0.15], [0.45, -0.5, 0.15], [0, 0.6, 0.15], C.red); g.tri([-0.2, -0.5, 0.18], [0.2, -0.5, 0.18], [0, 0.1, 0.18], C.yellow); });
  g.beam([4.4, 0.8, 3.8], [5.2, 0.8, 5.9], 0.28, C.red, { n: 6 }); g.beam([5.2, 0.8, 5.9], [2.5, 0.8, 5.9], 0.28, C.red, { n: 6, caps: 'tb' });
  g.cyl(5.2, 1.1, 5.9, 0.5, 0.08, 8, C.red); g.cyl(5.2, 0.8, 5.9, 0.06, 0.34, 4, C.steelD);
  g.box(1.6, 0.15, 5.9, 1.6, 1.2, 0.9, C.steel, { no: 'b' });
};

DEF.crane = (g) => {
  const Y = 0xf4b61a, YD = 0xd99a12, Z0 = -4;
  g.box(0, 0, Z0, 8, 0.5, 1.6, C.concD, { no: 'b' }); g.box(0, 0, Z0, 1.6, 0.5, 8, C.concD, { no: 'b' });
  for (const [x, z] of [[2.9, 0], [-2.9, 0], [0, 2.9], [0, -2.9]]) g.box(x, 0.5, Z0 + z, 2, 1.0, 2, C.concrete, { no: 'b' });
  const cn = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = cn[i], [bx, bz] = cn[(i + 1) % 4];
    g.beam([ax, 0.5, Z0 + az], [ax, 36, Z0 + az], 0.13, Y);
    for (let s = 0; s < 12; s++) {
      const y0 = 0.5 + s * 2.96, y1 = y0 + 2.96;
      g.beam([ax, y1, Z0 + az], [bx, y1, Z0 + bz], 0.07, Y, { n: 3 });
      if (s % 2) g.beam([ax, y0, Z0 + az], [bx, y1, Z0 + bz], 0.06, YD, { n: 3 }); else g.beam([bx, y0, Z0 + bz], [ax, y1, Z0 + az], 0.06, YD, { n: 3 });
    }
  }
  g.cyl(0, 36, Z0, 1.6, 0.8, 10, C.dark); g.box(0, 36.8, Z0, 2.2, 1.6, 2.6, Y);
  g.box(1.9, 36.6, Z0 + 1.0, 1.6, 2.0, 2.2, C.white); g.panel('+z', 1.9, 37.2, Z0 + 2.1, 1.3, 1.1, C.lit, { g: 0.8, eps: 0.03 }); g.panel('+x', 2.7, 37.2, Z0 + 1.0, 1.9, 1.1, C.glass, { eps: 0.03 });
  // jib
  const jy = 37.7, jt = 39.3, zs = Z0 + 1.3, ze = 19;
  g.mirror(() => g.beam([0.8, jy, zs], [0.8, jy, ze], 0.1, Y)); g.beam([0, jt, zs], [0, jt - 0.6, ze], 0.1, Y);
  const nb = 11, dz = (ze - zs) / nb;
  for (let i = 0; i < nb; i++) {
    const z0 = zs + i * dz, z1 = z0 + dz, t0 = jt - 0.6 * i / nb, t1 = jt - 0.6 * (i + 1) / nb;
    g.beam([0.8, jy, z0], [0, t1, z1], 0.05, YD, { n: 3 }); g.beam([-0.8, jy, z0], [0, t1, z1], 0.05, YD, { n: 3 }); g.beam([-0.8, jy, z1], [0.8, jy, z1], 0.05, YD, { n: 3 });
    if (i === 0) { g.beam([0.8, jy, z0], [0, t0, z0], 0.05, YD, { n: 3 }); g.beam([-0.8, jy, z0], [0, t0, z0], 0.05, YD, { n: 3 }); }
  }
  // counter jib
  g.box(0, 37.5, -7.6, 1.9, 0.25, 6.8, Y); g.mirror(() => g.box(0.9, 37.75, -7.6, 0.08, 0.7, 6.8, YD, { no: 'b' }));
  for (const z of [-10.4, -9.6, -8.8]) g.box(0, 35.8, z, 1.7, 1.7, 0.65, C.concrete);
  g.box(0, 37.75, -6.4, 1.2, 0.9, 1.4, C.steelD);
  // cat head + ties
  const ap = [0, 43.3, Z0];
  for (const [x, z] of cn) g.beam([x * 0.9, 38.4, Z0 + z * 1.1], ap, 0.09, Y);
  g.beam(ap, [0, jt - 0.25, 9], 0.04, C.dark, { n: 3 }); g.beam(ap, [0, jt - 0.52, 17], 0.04, C.dark, { n: 3 }); g.beam(ap, [0, 37.9, -10.6], 0.04, C.dark, { n: 3 });
  g.sph(0, 43.6, Z0, 0.3, 0.3, 0.3, C.neonR, { g: 1, seg: 5, rings: 3 });
  // trolley + load (an unlucky portapotty)
  g.box(0, 37.25, 12, 1.5, 0.35, 1.3, C.dark);
  g.beam([0, 37.25, 12], [0, 26.2, 12], 0.035, C.dark, { n: 3 });
  g.box(0, 25.6, 12, 0.5, 0.6, 0.3, Y);
  for (const [x, z] of cn) g.beam([0, 25.6, 12], [x * 0.55, 24.3, 12 + z * 0.55], 0.025, C.dark, { n: 3 });
  g.box(0, 22.0, 12, 1.2, 2.0, 1.2, C.sky); g.box(0, 24.0, 12, 1.26, 0.3, 1.26, C.white, { top: [0.8, 0.8] }); g.panel('+z', 0, 22.1, 12.6, 0.8, 1.7, C.concL, { eps: 0.03 }); g.box(0, 21.9, 12, 1.3, 0.1, 1.3, C.dark);
};

DEF.ferris = (g) => {
  const CY = 19.4, R = 15, N = 16, Wt = C.white;
  const P = (i, r = R) => { const a = i / N * TAU; return [sin(a) * r, CY + cos(a) * r]; };
  g.box(0, 0, 0, 22, 0.8, 6, 0xb89572, { no: 'b' }); g.box(0, 0, 3.4, 6, 0.4, 0.8, 0xa5825f, { no: 'b' });
  for (const s of [1, -1]) {
    const z = s * 1.0;
    for (let i = 0; i < N; i++) {
      const [x0, y0] = P(i), [x1, y1] = P(i + 1), [u0, v0] = P(i, 9), [u1, v1] = P(i + 1, 9);
      g.beam([x0, y0, z], [x1, y1, z], 0.16, Wt, { n: 3 });
      g.beam([u0, v0, z], [u1, v1, z], 0.1, Wt, { n: 3 });
      g.beam([0, CY, z * 1.3], [x0, y0, z], 0.09, [C.hot, C.teal, C.yellow][i % 3], { n: 3 });
      g.panel(s > 0 ? '+z' : '-z', x0, y0 - 0.2, z + s * 0.17, 0.4, 0.4, C.lit, { g: 1, eps: 0.01 });
    }
    g.beam([-7.5, 0.8, s * 2.8], [0, CY, s * 1.75], 0.36, Wt); g.beam([7.5, 0.8, s * 2.8], [0, CY, s * 1.75], 0.36, Wt);
    g.beam([-3.9, 10.4, s * 2.25], [3.9, 10.4, s * 2.25], 0.2, Wt);
    g.at(0, CY, s * 1.76, s > 0 ? 0 : 180, () => g.disc(0, 0, 0, 0, 1.0, 5, C.yellow, { g: 0.7, ph: 0 }));
  }
  g.cyl(0, CY, 0, 1.25, 3.5, 10, C.hot, { ax: 'z' });
  for (let i = 0; i < N; i++) {
    const [x, y] = P(i), c = RAINBOW[i % 8];
    g.beam([x, y, -1.0], [x, y, 1.0], 0.08, C.steelD, { n: 3 });
    g.box(x, y - 0.75, 0, 0.1, 0.75, 0.1, C.dark, { no: 'tb' });
    g.box(x, y - 2.1, 0, 1.5, 1.3, 1.5, c, { top: [1.12, 1.12] });
    g.box(x, y - 0.8, 0, 1.75, 0.3, 1.75, C.white, { top: [0.45, 0.45], no: 'b' });
    g.panel('+z', x, y - 1.5, 0.8, 1.25, 0.5, C.glassD, { eps: 0.03 }); g.panel('-z', x, y - 1.5, -0.8, 1.25, 0.5, C.glassD, { eps: 0.03 });
  }
  // booth + fence
  g.box(-8.6, 0.8, 1.6, 2.2, 2.4, 1.8, C.hot, { no: 'b' }); g.cyl(-8.6, 3.2, 1.6, 1.9, 1.0, 4, C.yellow, { r2: 0 }); g.panel('+z', -8.6, 1.8, 2.5, 1.4, 0.9, C.lit, { g: 0.8, eps: 0.03 });
  g.mirror(() => { for (const x of [4, 6.5, 9, 10.8]) g.box(x, 0.8, 2.85, 0.1, 1.0, 0.1, Wt, { no: 'b' }); g.box(7.4, 1.6, 2.85, 6.9, 0.1, 0.1, Wt); });
};

DEF.coaster = (g) => {
  const pts = [[-12, 2, 10], [-2, 2, 10], [6, 5, 10], [13, 13.2, 10], [17.6, 16.4, 6.6], [18.2, 13.5, 0], [15.5, 5, -7], [9, 2.5, -10], [1, 10, -10.5], [-7, 3, -10], [-14, 5, -9.5], [-18.6, 7, -4], [-18.6, 4, 3], [-17, 2.3, 8.6]];
  const n = pts.length, SUB = 5, S = [];
  for (let i = 0; i < n; i++) for (let s = 0; s < SUB; s++) {
    const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n], t = s / SUB, t2 = t * t, t3 = t2 * t;
    S.push([0, 1, 2].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
  }
  const M = S.length, red = 0xd9382e, redD = 0xa82a24, side = [], tan = [];
  for (let i = 0; i < M; i++) {
    const a = S[(i + M - 1) % M], b = S[(i + 1) % M]; let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const l = Math.hypot(tx, ty, tz); tx /= l; ty /= l; tz /= l;
    let sx = -tz, sz = tx; const sl = Math.hypot(sx, sz) || 1; side.push([sx / sl * 0.62, 0, sz / sl * 0.62]); tan.push([tx, ty, tz]);
  }
  for (let i = 0; i < M; i++) {
    const j = (i + 1) % M, a = S[i], b = S[j], sa = side[i], sb = side[j];
    g.beam([a[0] + sa[0], a[1], a[2] + sa[2]], [b[0] + sb[0], b[1], b[2] + sb[2]], 0.12, red, { n: 3 });
    g.beam([a[0] - sa[0], a[1], a[2] - sa[2]], [b[0] - sb[0], b[1], b[2] - sb[2]], 0.12, red, { n: 3 });
    g.beam([a[0], a[1] - 0.45, a[2]], [b[0], b[1] - 0.45, b[2]], 0.2, redD, { n: 3 });
    if (i % 2 === 0) { g.beam([a[0] + sa[0], a[1], a[2] + sa[2]], [a[0], a[1] - 0.45, a[2]], 0.06, redD, { n: 3 }); g.beam([a[0] - sa[0], a[1], a[2] - sa[2]], [a[0], a[1] - 0.45, a[2]], 0.06, redD, { n: 3 }); }
    if (i % 3 === 1 && a[1] > 2.6) {
      const tall = a[1] > 8;
      if (tall) { g.beam([a[0] + sa[0] * 3.2, 0, a[2] + sa[2] * 3.2], [a[0], a[1] - 0.6, a[2]], 0.18, C.white); g.beam([a[0] - sa[0] * 3.2, 0, a[2] - sa[2] * 3.2], [a[0], a[1] - 0.6, a[2]], 0.18, C.white); }
      else g.beam([a[0], 0, a[2]], [a[0], a[1] - 0.6, a[2]], 0.18, C.white);
    }
  }
  // train on the lift hill
  for (let c = 0; c < 4; c++) {
    const i = 2 * SUB + 1 + c * 2, p = S[i], t = tan[i], yaw = Math.atan2(t[0], t[2]) / D2R, pitch = -Math.asin(t[1]) / D2R;
    g.xf({ p: [p[0], p[1] + 0.15, p[2]], r: [pitch, yaw, 0] }, () => {
      g.box(0, 0, 0, 1.5, 0.75, 2.0, c === 3 ? C.yellow : C.teal, { top: [1, 0.9] });
      g.mirror(() => { g.box(0.33, 0.75, -0.1, 0.36, 0.5, 0.3, [C.hot, C.blue, C.orange, C.purple][c], { no: 'b' }); g.box(0.33, 1.25, -0.1, 0.3, 0.3, 0.3, C.skin, { no: 'b' }); g.box(0.62, 1.1, -0.1, 0.1, 0.6, 0.1, C.skin, { no: 'b' }); });
    });
  }
  // station
  g.box(-7, 0, 10, 12.6, 1.5, 4.2, 0xb89572, { no: 'b' });
  for (const x of [-12.6, -1.4]) for (const z of [8.2, 11.8]) g.box(x, 1.5, z, 0.25, 3.3, 0.25, C.white, { no: 'tb' });
  g.roof(-7, 4.8, 10, 13, 1.3, 4.8, C.teal, { ax: 'x', cg: C.white, b: 1, cb: C.white });
  g.box(-7, 5.4, 12.3, 5, 1.0, 0.2, C.yellow, { g: 0.5 });
  g.box(-0.4, 0, 12.3, 1.2, 0.75, 1.0, 0xa5825f, { no: 'b' }); g.box(-0.4, 0, 13.0, 1.2, 0.38, 0.6, 0xa5825f, { no: 'b' });
  g.cyl(17.6, 16.6, 6.6, 0.06, 1.6, 4, C.steelD); g.tri([17.6, 18.2, 6.6], [17.6, 17.5, 6.6], [18.8, 17.85, 6.6], C.yellow, { ds: 1 });
};

DEF.wind_turbine = (g) => {
  const Wt = C.white, HY = 31, HZ = 2.6;
  g.box(0, 0, 0, 6, 0.35, 6, C.concD, { no: 'b' });
  g.lathe(0, 0, 0, [[2.3, 0.35, C.steel], [2.3, 0.9, Wt], [1.9, 0.9, Wt], [1.75, 8, C.concL], [1.5, 16, Wt], [1.25, 24, C.concL], [1.1, 30]], 10, Wt, { caps: '', ta: 1 });
  g.panel('+z', 0, 0.9, 1.9 * cos(18 * D2R), 0.9, 2.0, C.steelD, { eps: 0.05 });
  g.box(2.2, 0.35, -1.6, 1.4, 1.6, 1.8, 0x5d8a66, { no: 'b' });
  g.rbox(0, 29.8, -0.5, 2.5, 2.6, 5.4, 0.6, Wt);
  g.panel('+y', 0, 32.4, -1.4, 0.9, 1.6, C.steelD, { eps: 0.03 });
  g.box(0, 32.4, -2.6, 0.2, 0.5, 0.2, C.neonR, { g: 1 });
  g.lathe(0, HY, HZ - 0.2, [[1.0, -0.2], [0.95, 0.5], [0.5, 1.0], [0.05, 1.2]], 8, C.concL, { ax: 'z', caps: 'b' });
  for (const rot of [0, 180]) g.xf({ p: [0, HY, HZ], r: [0, 0, rot] }, () => {
    g.cyl(0, 0.6, 0, 0.5, 1.6, 6, Wt, { caps: '' });
    g.ext([[-0.6, 2.2], [0.9, 2.6], [1.1, 6], [0.35, 17.6], [0.05, 18.4], [-0.3, 9], [-0.55, 4]], 0.36, Wt, { plane: 'xy', sc1: [1, 1], c0: C.concL });
    g.ext([[0.43, 16.4], [0.35, 17.6], [0.05, 18.4], [-0.02, 16.4]], 0.4, C.red, { plane: 'xy' });
  });
};

DEF.school = (g) => {
  g.eps = 0.08; const B = C.brick, Cr = C.cream;
  g.box(0, 0, -3, 34, 7, 10, B, { no: 'b', ct: C.concD });
  g.box(0, 7, -3, 34.3, 0.4, 10.3, Cr, { no: 'b', ct: C.concD });
  g.box(0, 0, -3, 34.2, 0.8, 10.2, C.concD, { no: 'tb' });
  // entrance block
  g.box(0, 0, 2.5, 9, 8.6, 3, B, { no: 'bk' });
  g.box(0, 8.5, 2.5, 9.6, 0.2, 3.5, Cr); g.roof(0, 8.7, 2.5, 9.6, 1.3, 3.5, C.roofS, { cg: Cr });
  g.at(0, 7.3, 4.0, 0, () => { g.disc(0, 0, 0.08, 0, 0.8, 12, C.white, { g: 0.3 }); g.disc(0, 0, 0.12, 0.68, 0.8, 12, C.dark); g.quad([-0.04, 0, 0.14], [0.04, 0, 0.14], [0.04, 0.55, 0.14], [-0.04, 0.55, 0.14], C.dark); g.quad([0, -0.04, 0.14], [0.4, -0.04, 0.14], [0.4, 0.04, 0.14], [0, 0.04, 0.14], C.dark); });
  g.box(0, 0, 4.7, 8, 0.9, 1.4, C.concL, { no: 'b' }); g.box(0, 0, 5.7, 6, 0.45, 0.7, C.concL, { no: 'b' });
  for (const x of [-3.3, -1.1, 1.1, 3.3]) g.cyl(x, 0.9, 5.0, 0.3, 4.3, 6, C.white, { caps: '' });
  g.box(0, 5.2, 4.6, 8.2, 0.5, 1.5, Cr);
  g.panel('+z', 0, 0.9, 4.0, 3.0, 3.2, Cr); g.wins('+z', 0, 0.9, 4.0, 2.6, 3.0, 2, 1, { gx: 0.08, gy: 0, col: 0x2f5f86, eps: 0.14 });
  g.panel('+z', 0, 5.75, 4.0, 5.2, 0.7, C.yellow, { eps: 0.1 });
  const wo = { gx: 0.3, gy: 0.4, p: 0.5 };
  for (const s of [-1, 1]) { g.wins('+z', s * 10.75, 1.3, 2, 11.4, 5.2, 5, 2, wo); g.panel('+z', s * 10.75, 3.7, 2, 12.4, 0.3, Cr); }
  g.wins('-z', 0, 1.3, -8, 30, 5.2, 12, 2, wo);
  for (const f of ['+x', '-x']) g.wins(f, f === '+x' ? 17 : -17, 1.3, -3, 8, 5.2, 3, 2, wo);
  // wings
  g.box(-13, 0, -10.5, 8, 7, 7, B, { no: 'b', ct: C.concD }); g.wins('-x', -17, 1.3, -10.5, 6, 5.2, 3, 2, wo); g.wins('-z', -13, 1.3, -14, 6.6, 5.2, 3, 2, wo);
  g.box(11, 0, -10, 12, 7.2, 8, C.concL, { no: 'b' });
  g.cyl(11, 7.2, -10, 4.0, 12, 10, C.steel, { ax: 'x', e: [0.5, 1], ct: C.concL, cb: C.concL });
  g.wins('+x', 17, 3.5, -10, 6.4, 2.4, 4, 1, { gx: 0.3, gy: 0, p: 0.6 }); g.panel('+x', 17, 0, -10, 2.4, 2.6, C.blue);
  g.panel('-z', 11, 1.0, -14, 9, 1.2, C.blue);
  acUnit(g, -8, 7.4, -4, 2, 0.9, 1.6); acUnit(g, 7, 7.4, -5, 2, 0.9, 1.6); acUnit(g, -13, 7, -10, 2, 0.9, 1.6);
  // flag + bike rack
  g.cyl(-6.5, 0, 5.4, 0.08, 9.6, 5, C.steelL, { caps: 't' });
  g.wins('+z', -5.4, 8.2, 5.4, 2.1, 1.3, 1, 5, { gx: 0, gy: 0, col: (i, j) => (j % 2 ? C.white : C.red), eps: 0 }); g.wins('-z', -5.4, 8.2, 5.4, 2.1, 1.3, 1, 5, { gx: 0, gy: 0, col: (i, j) => (j % 2 ? C.white : C.red), eps: 0 });
  g.panel('+z', -6.0, 8.85, 5.4, 0.9, 0.65, C.navy, { eps: 0.02 }); g.panel('-z', -6.0, 8.85, 5.4, 0.9, 0.65, C.navy, { eps: 0.02 });
  palm; for (const x of [8, 12]) { g.cyl(x, 0, 4.2, 0.2, 1.6, 5, C.woodD, { caps: '' }); g.blob(x, 2.6, 4.2, 1.3, 1.3, 1.3, C.leaf, { seg: 6, rings: 4, s: x }); }
};

DEF.mall = (g) => {
  g.eps = 0.1; const W = C.paint;
  g.box(0, 0, 0, 40, 8, 30, W, { t: 1, no: 'b', ct: C.concD });
  g.box(0, 7.0, 0, 40.2, 0.9, 30.2, C.teal, { no: 'tb' }); g.box(0, 8, 0, 40.3, 0.3, 30.3, C.white, { no: 'tb' });
  // anchors
  g.box(-17, 0, -3, 10, 10.2, 22, C.tealD, { no: 'b', ct: C.concD }); g.box(-17, 9.2, -3, 10.2, 1.0, 22.2, C.white, { no: 'tb' });
  g.box(17, 0, 2, 10, 9.6, 24, 0xc9785a, { no: 'b', ct: C.concD }); g.box(17, 8.6, 2, 10.2, 1.0, 24.2, C.cream, { no: 'tb' });
  g.panel('+z', -17, 5.6, 8, 7, 1.8, C.white, { g: 0.6 }); g.wins('+z', -17, 5.85, 8, 6, 1.3, 5, 1, { gx: 0.3, gy: 0, col: C.tealD, eps: 0.2 });
  g.wins('+z', -17, 0.4, 8, 8, 3.6, 4, 1, { gx: 0.08, gy: 0, p: 0.9 });
  g.panel('+z', 17, 5.2, 14, 7, 1.8, C.yellow, { g: 0.6 }); g.wins('+z', 17, 5.45, 14, 6, 1.3, 4, 1, { gx: 0.3, gy: 0, col: 0xa8502f, eps: 0.2 });
  g.wins('+z', 17, 0.4, 14, 8, 3.4, 4, 1, { gx: 0.08, gy: 0, p: 0.9 });
  g.wins('+x', 22, 2, 2, 20, 4, 5, 1, { gx: 0.6, gy: 0, p: 0.7 }); g.wins('-x', -22, 2, -3, 18, 4, 5, 1, { gx: 0.6, gy: 0, p: 0.7 });
  // main entrance portal
  g.box(0, 0, 15.9, 12, 9.6, 2.2, C.white, { no: 'bk' });
  g.wins('+z', 0, 0.4, 17, 8.4, 6.6, 5, 3, { gx: 0.07, gy: 0.07, p: 0.85 });
  g.mirror(() => { g.box(5.3, 0, 17.3, 1.0, 10.8, 0.9, C.hot, { no: 'b' }); g.box(6.6, 0, 17.0, 0.8, 9.0, 0.7, C.yellow, { no: 'b' }); g.wins('+z', 9.4, 0.5, 15, 4.6, 3.2, 2, 1, { gx: 0.1, gy: 0, p: 0.9 }); palm(g, 9.5, 17.2, 5.2); palm(g, 3.2, 18.6, 4.2); });
  g.box(0, 9.6, 16.2, 8.6, 1.7, 0.7, C.hot, { g: 0.45 }); g.wins('+z', 0, 9.95, 16.55, 7.6, 1.0, 4, 1, { gx: 0.3, gy: 0, col: C.white, g: 1, eps: 0.03 });
  g.box(0, 7.2, 17.6, 9.6, 0.3, 1.6, C.steelD);
  // atrium
  g.lathe(0, 8, 0, [[7.2, 0, C.white], [7.2, 0.6], [6.4, 2.0], [3.6, 3.5], [0, 4.0]], 8, (i, k) => ({ c: (i + k) % 2 ? C.glassT : C.glass, g: (i * 3 + k) % 4 === 0 ? 0.5 : 0.15 }), { caps: '' });
  g.wins('+y', -9, 8.3, -3, 6, 16, 2, 4, { gx: 0.5, gy: 0.4, p: 0.5, eps: 0.03 }); g.wins('+y', 9, 8.3, -8, 4, 10, 1, 3, { gx: 0.4, gy: 0.4, p: 0.5, eps: 0.03 });
  for (const [x, z] of [[-9, 10], [4, -11], [9, 6], [-17, -10], [17, -6], [17, 6], [-17, 2]]) acUnit(g, x, Math.abs(x) > 12 ? (x < 0 ? 10.2 : 9.6) : 8.3, z, 2.6, 1.1, 2.0);
  // back docks
  g.box(0, 0, -15.5, 18, 1.2, 1.0, C.concD, { no: 'b' });
  for (const x of [-6, -2, 2, 6]) { g.panel('-z', x, 1.2, -15, 3, 3.4, C.white); g.wins('-z', x, 1.2, -15, 2.7, 3.2, 1, 5, { gx: 0, gy: 0.15, col: C.steelL, eps: 0.16 }); }
};

DEF.airliner = (g) => {
  const Wt = C.white, A = C.paint, CY = 4.0, belly = 0xb9c0c8;
  const fc = (i, k) => {
    if (k === 0) return { c: A, t: 1 };
    if (k === 5 && i >= 3 && i <= 6) return { c: C.glassD };
    if (i === 0 || i === 9) return { c: belly };
    if ((i === 1 || i === 8) && k < 6) return { c: A, t: 1 };
    return { c: Wt };
  };
  g.lathe(0, CY, 0, [[0.25, -18.6], [0.9, -15], [1.6, -10.5], [1.9, -6], [1.9, 11], [1.6, 14.5], [1.0, 17], [0.3, 18.4]], 10, fc, { ax: 'z' });
  g.mirror(() => {
    g.wins('+x', 1.81, CY + 0.15, 1.5, 22, 0.42, 26, 1, { gx: 0.5, gy: 0, col: C.glassD, eps: 0.04 });
    g.panel('+x', 1.81, CY - 0.75, 12, 0.9, 1.8, belly, { eps: 0.04 }); g.panel('+x', 1.81, CY - 0.75, -8, 0.9, 1.8, belly, { eps: 0.04 });
    g.xf({ p: [1.5, 2.9, 0], r: [0, 0, 5] }, () => {
      g.ext([[0, 4.2], [15, -4.4], [15, -6.4], [5, -3.6], [0, -3.6]], 0.5, C.steelL, { plane: 'xz', sc1: [1, 1] });
      g.box(15, 0.2, -5.5, 0.16, 1.9, 1.7, A, { t: 1, top: [1, 0.55], off: [0, -0.5] });
      g.box(5, -0.75, 0.3, 0.3, 0.85, 2.4, Wt, { top: [1, 0.7] });
      g.lathe(5, -1.2, 1.2, [[0.7, -1.9, Wt], [1.0, -1.2, Wt], [1.02, 1.3, A, { t: 1 }], [0.9, 1.9]], 8, Wt, { ax: 'z', ct: C.dark, cb: C.dark });
    });
    g.ext([[0.8, -13.8], [6.2, -17.4], [6.2, -18.7], [0.8, -17.6]], 0.25, C.steelL, { plane: 'xz', at: [0, 4.5, 0] });
    g.box(2.6, 0.9, -1.6, 0.25, 2.0, 0.25, C.steelD, { no: 'tb' });
    for (const z of [-2.3, -0.9]) g.cyl(2.6, 0.62, z, 0.62, 0.9, 8, C.tyre, { ax: 'x' });
  });
  g.ext([[-18.2, 5.2], [-13.2, 5.5], [-16.6, 11], [-18.8, 11]], 0.36, A, { t: 1 });
  g.box(0, 0.8, 14, 0.2, 1.6, 0.2, C.steelD, { no: 'tb' }); g.cyl(0, 0.45, 14, 0.45, 0.7, 8, C.tyre, { ax: 'x' });
};

DEF.cargo_ship = (g) => {
  g.eps = 0.1; const Wt = C.white, hull = 0x1f3352;
  const P = [[-8.6, -40], [8.6, -40], [9, -30], [9, 22], [6.5, 32], [0, 40], [-6.5, 32], [-9, 22], [-9, -30]];
  g.ext(P, 3, 0x9c2f2a, { plane: 'xz', sc0: [0.8, 0.96], sc1: [0.97, 0.99] });
  g.ext(P, 0.35, Wt, { plane: 'xz', at: [0, 3, 0], sc0: [0.97, 0.99], sc1: [0.975, 0.991], cap: false });
  g.ext(P, 4.65, hull, { plane: 'xz', at: [0, 3.35, 0], sc0: [0.975, 0.991], c1: 0x7a4a3a });
  g.ext([[-6.5, 30], [6.5, 30], [6.5, 32], [0, 40], [-6.5, 32]], 1.3, hull, { plane: 'xz', at: [0, 8, 0], c1: 0x7a4a3a });
  // containers
  const cc = [0xc8372d, 0x2f6fb0, 0x3f9a6a, 0xf2a531, 0x8a8f98, 0x7a4fb0, 0xe8e4da, 0x1f7f8a, 0xd9652f];
  for (let b = 0; b < 8; b++) {
    const z = -19.5 + b * 6.25, across = b >= 7 ? 4 : 6;
    for (let i = 0; i < across; i++) {
      const x = (i - (across - 1) / 2) * 2.62, hgt = 2 + Math.floor(g.rnd() * 2.6) - (b === 7 ? 1 : 0);
      for (let k = 0; k < hgt; k++) g.box(x, 8 + k * 2.6, z, 2.5, 2.55, 6.0, cc[Math.floor(g.rnd() * cc.length)], { no: k ? 'b' : 'b' });
    }
  }
  // superstructure
  g.box(0, 8, -31, 16.6, 3, 11, Wt, { no: 'b' });
  g.box(0, 11, -31.5, 13, 5, 6, Wt, { no: 'b' });
  g.box(0, 16, -31, 17.6, 2.0, 5, Wt, { cb: Wt });
  g.wins('+z', 0, 16.6, -28.5, 16.8, 0.95, 12, 1, { gx: 0.12, gy: 0, p: 0.7 });
  g.wins('+z', 0, 11.5, -28.5, 12, 4.2, 8, 3, { gx: 0.4, gy: 0.5 }); g.wins('-z', 0, 11.5, -34.5, 12, 4.2, 8, 3, { gx: 0.4, gy: 0.5 });
  g.mirror(() => { g.wins('+x', 6.5, 11.5, -31.5, 5, 4.2, 3, 3, { gx: 0.4, gy: 0.5 }); g.wins('+x', 8.3, 8.8, -31, 10, 1.4, 6, 1, { gx: 0.5, gy: 0 }); g.box(7.3, 11, -33.5, 1.5, 1.3, 4.2, C.orange, { top: [0.8, 0.9] }); });
  g.box(0, 18, -34.2, 3.2, 1.3, 2.8, hull, { top: [0.85, 0.85], no: 'b' }); g.box(0, 17.4, -34.2, 3.3, 0.6, 2.9, C.red, { no: 'tb' }); g.cyl(0, 19.3, -34.2, 0.8, 0.35, 6, C.dark);
  g.cyl(0, 18, -30.5, 0.14, 2.0, 4, Wt); g.box(0, 19.3, -30.5, 3.0, 0.14, 0.14, Wt); g.box(0, 19.55, -30.5, 1.4, 0.2, 0.4, Wt);
  g.cyl(0, 9.3, 35.5, 0.2, 4.2, 5, Wt); g.box(0, 9.3, 33, 2.4, 0.9, 1.6, C.steelD, { no: 'b' });
  g.box(0, 8, -38.4, 14, 1.0, 0.3, Wt, { no: 'b' });
};

// =====================================================================================
// 9. TIER 4 - downtown (<=4500 tris)
// =====================================================================================
// box with a window grid on all four sides
function block(g, x, y, z, w, h, d, col, o = {}) {
  g.box(x, y, z, w, h, d, col, { t: o.t, no: o.no ?? 'b', ct: o.ct ?? C.concD });
  if (!o.nx) return;
  const m = o.m ?? 0.6, wy = o.wy ?? 0.5, wh = h - wy - (o.wt ?? wy), wo = o.wo || {}, nz = o.nz ?? max(1, Math.round(o.nx * d / w));
  g.wins('+z', x, y + wy, z + d / 2, w - m * 2, wh, o.nx, o.ny, wo); g.wins('-z', x, y + wy, z - d / 2, w - m * 2, wh, o.nx, o.ny, wo);
  g.wins('+x', x + w / 2, y + wy, z, d - m * 2, wh, nz, o.ny, wo); g.wins('-x', x - w / 2, y + wy, z, d - m * 2, wh, nz, o.ny, wo);
}
// tapered glass block (square plan) with ribbon windows following the taper
function taperBlock(g, y0, y1, w0, w1, col, nx, ny, wo = {}) {
  g.box(0, y0, 0, w0, y1 - y0, w0, col, { top: [w1 / w0, w1 / w0], no: 'b', ct: C.concD });
  const a = w0 / 2, b = w1 / 2, m = 0.92, e = 0.02 * (y1 - y0);
  for (let k = 0; k < 4; k++) g.at(0, 0, 0, k * 90, () => g.winsQ([-a * m, y0 + e, a], [a * m, y0 + e, a], [b * m, y1 - e, b], [-b * m, y1 - e, b], nx, ny, wo));
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) g.beam([sx * a, y0, sz * a], [sx * b, y1, sz * b], 0.55, C.steelL, { ph: 0 });
}

DEF.office = (g) => {
  g.eps = 0.12; const W = C.paint;
  block(g, 0, 0, 0, 23, 7, 23, 0x6f7780, { nx: 6, ny: 1, wy: 0.8, wt: 1.6, m: 1.0, wo: { gx: 0.08, gy: 0, p: 0.9 } });
  g.box(0, 7, 0, 24, 0.6, 24, C.concL, { no: 'b' });
  g.box(0, 4.0, 12.0, 9, 0.4, 1.6, C.steelD); g.panel('+z', 0, 0, 11.5, 4, 3.6, C.glass, { eps: 0.2 });
  block(g, 0, 7.6, 0, 21, 45.4, 21, W, { t: 1, nx: 7, ny: 13, wy: 0.9, m: 1.2, wo: { gx: 0.22, gy: 0.4 } });
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) g.box(sx * 10.4, 7.6, sz * 10.4, 1.3, 45.4, 1.3, C.white, { no: 'tb' });
  g.box(0, 53, 0, 22.4, 1.2, 22.4, C.white, { ct: C.concD });
  block(g, -2, 54.2, -2, 12, 3.6, 12, C.steelD, { nx: 4, ny: 1, wo: { gx: 0.3, gy: 0, col: C.gun } });
  g.box(0, 54.2, 9.6, 9, 2.6, 0.5, C.dark); g.wins('+z', 0, 54.5, 9.85, 8.2, 2.0, 5, 1, { gx: 0.25, gy: 0, col: C.neonC, g: 1, eps: 0.02 });
  acUnit(g, 7.5, 54.2, -6, 3, 1.4, 3); acUnit(g, 7.5, 54.2, 2, 3, 1.4, 3); acUnit(g, -8.5, 54.2, 6.5, 2.4, 1.2, 2.4);
  g.cyl(-2, 57.8, -2, 0.18, 2.2, 5, C.steelL, { caps: '' }); g.sph(-2, 60, -2, 0.3, 0.3, 0.3, C.neonR, { g: 1, seg: 4, rings: 2 });
};

DEF.tower_a = (g) => {
  g.eps = 0.14; const S = C.paint, trim = 0xcdb98a, T = { t: 1 };
  const wo = { gx: 0.5, gy: 0.22, dark: 0x27465a, dark2: 0x2f5670 };
  const tier = (y0, y1, w, nx, ny) => {
    block(g, 0, y0, 0, w, y1 - y0, w, S, { t: 1, nx, ny, wy: 1.2, m: 1.0, wo });
    g.box(0, y1, 0, w + 0.6, 0.8, w + 0.6, trim, { ct: C.concD });
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) { g.box(sx * (w / 2 - 0.9), y1 + 0.8, sz * (w / 2 - 0.9), 1.8, 2.4, 1.8, S, { t: 1, no: 'b' }); g.cyl(sx * (w / 2 - 0.9), y1 + 3.2, sz * (w / 2 - 0.9), 1.3, 1.6, 4, trim, { r2: 0 }); }
  };
  tier(0, 26, 27.4, 8, 6); tier(26.8, 66, 22, 6, 11); tier(66.8, 86, 16, 4, 6); tier(86.8, 94, 10, 3, 2);
  for (let k = 0; k < 4; k++) g.at(0, 0, 0, k * 90, () => { g.tri([-3.4, 94.8, 5.02], [3.4, 94.8, 5.02], [0, 98.6, 3.2], C.gold, { g: 0.3 }); });
  g.lathe(0, 94.8, 0, [[2.9, 0, S, T], [2.6, 3.4, trim], [2.9, 3.4, trim], [2.3, 4.4, C.steelL], [0.9, 6.4, C.steelL], [0.3, 9.4]], 8, C.steelL, { caps: 't' });
  g.sph(0, 104.5, 0, 0.5, 0.5, 0.5, C.neonR, { g: 1, seg: 5, rings: 3 });
  // entrance
  g.box(0, 0, 13.9, 9, 10, 0.9, trim, { no: 'bk' }); g.panel('+z', 0, 0, 14.35, 5, 7.6, 0x3a2f28, { eps: 0.03 }); g.wins('+z', 0, 0.3, 14.35, 4.2, 7, 3, 2, { gx: 0.12, gy: 0.1, p: 1, eps: 0.08 });
  for (const f of ['+x', '-x']) g.panel(f, f === '+x' ? 13.7 : -13.7, 0, 0, 27.4, 1.2, trim);
  g.panel('-z', 0, 0, -13.7, 27.4, 1.2, trim);
};

DEF.tower_b = (g) => {
  g.eps = 0.14; const G0 = 0x2b5d72, wo = { gx: 0.05, gy: 0.5, dark: 0x3d86a0, dark2: 0x4696b0, p: 0.5 };
  block(g, 0, 0, 0, 34, 6, 34, 0x4a5560, { nx: 8, ny: 1, wy: 0.8, wt: 1.2, m: 1.5, wo: { gx: 0.08, gy: 0, p: 0.9 } });
  g.box(0, 3.8, 17.4, 10, 0.4, 1.2, C.steelL, { no: 'k' });
  taperBlock(g, 6, 62, 32.4, 28.6, G0, 6, 14, wo);
  g.box(0, 62, 0, 29.4, 1, 29.4, C.steelL, { ct: C.concD });
  taperBlock(g, 63, 112, 27, 23, G0, 5, 12, wo);
  g.box(0, 112, 0, 23.8, 1, 23.8, C.steelL, { ct: C.concD });
  taperBlock(g, 113, 128, 19, 15.4, G0, 3, 4, wo);
  // sliced crown
  g.box(0, 128, 0, 15.4, 7.5, 15.4, G0, { top: [1, 0.04], off: [0, -7.38], no: 'b', ct: C.steelL });
  g.quad([-7.2, 128.3, 7.75], [7.2, 128.3, 7.75], [7.2, 135.2, -6.95], [-7.2, 135.2, -6.95], 0x7fd4e8, { g: 0.55 });
  g.box(0, 128, -7.5, 15.8, 7.9, 0.5, C.steelL, { no: 'b' });
  g.cyl(4.5, 135.5, -7.3, 0.28, 4.2, 5, C.steelL, { caps: '' }); g.sph(4.5, 139.75, -7.3, 0.4, 0.4, 0.4, C.neonR, { g: 1, seg: 4, rings: 2 });
  g.cyl(-4.5, 135.5, -7.3, 0.2, 2.4, 5, C.steelL, { caps: 't' });
};

DEF.hotel = (g) => {
  g.eps = 0.14; const W = C.paint, cr = 0xeadcc2;
  g.box(0, 0, -1, 40, 8, 20, cr, { no: 'b', ct: C.concD });
  g.wins('+z', 0, 0.6, 9, 36, 5.2, 12, 1, { gx: 0.1, gy: 0, p: 0.92 });
  for (const f of ['+x', '-x']) g.wins(f, f === '+x' ? 20 : -20, 1.5, -1, 16, 4.2, 5, 1, { gx: 0.4, gy: 0, p: 0.7 });
  g.box(0, 7.2, -1, 40.4, 0.8, 20.4, C.maroon, { no: 'tb' });
  g.box(0, 5.6, 10, 14, 0.5, 2.0, C.maroon); g.mirror(() => { g.cyl(6, 0, 10.6, 0.3, 5.6, 6, C.gold, { caps: '' }); palm(g, 10.5, 10, 5); palm(g, 15.5, 10.2, 4.2); });
  g.panel('+z', 0, 0, 9, 5, 4.4, C.dark, { eps: 0.2 }); g.wins('+z', 0, 0.2, 9, 4.4, 4, 2, 1, { gx: 0.08, gy: 0, col: C.lit, g: 0.9, eps: 0.26 });
  // slab
  const Z = -1.5, F = 16, fh = 3.5;
  g.box(0, 8, Z, 36, 56, 16, W, { t: 1, no: 'b', ct: C.concD });
  for (const s of [1, -1]) {
    const f = s > 0 ? '+z' : '-z', zf = Z + s * 8;
    g.wins(f, 0, 8.6, zf, 34.6, 55.4, 12, F, { gx: 0.26, gy: 0.52 });
    for (let i = 0; i < F; i++) g.box(0, 8 + i * fh, zf + s * 0.5, 36, 0.3, 1.0, C.white, { no: s > 0 ? 'k' : 'f' });
    for (const x of [-18, -11.5, -5.75, 0, 5.75, 11.5, 18]) g.box(x, 8, zf + s * 0.5, 0.35, 56, 1.0, C.white, { no: 'tb' + (s > 0 ? 'k' : 'f') });
  }
  for (const f of ['+x', '-x']) g.wins(f, f === '+x' ? 18 : -18, 8.6, Z, 3, 55.4, 1, F, { gx: 0.2, gy: 0.52 });
  // roof
  g.box(0, 64, Z, 36.6, 0.8, 17.4, C.white, { ct: C.concD });
  g.box(-6, 64.8, Z - 2, 18, 2.4, 8, cr, { no: 'b', ct: C.concD });
  g.panel('+y', 10, 64.8, Z, 8, 5, 0x4fc3e8, { g: 0.25, eps: 0.03 }); g.box(10, 64.8, Z, 9, 0.25, 6, C.white, { no: 'tb' });
  acUnit(g, -12, 67.2, Z - 2, 3, 1.2, 3);
  g.mirror(() => g.beam([10.6, 64.8, Z + 6.5], [10.6, 69.6, Z + 6.5], 0.2, C.dark)); g.box(0, 65.6, Z + 6.5, 22, 0.25, 0.3, C.dark); g.box(0, 69.4, Z + 6.5, 22, 0.25, 0.3, C.dark);
  for (const f of ['+z', '-z']) g.wins(f, 0, 66.1, Z + 6.5 + (f === '+z' ? 0.2 : -0.2), 20, 3.1, 5, 1, { gx: 0.3, gy: 0, col: C.neonP, g: 1, eps: 0.02 });
};

DEF.radio_tower = (g) => {
  const R = 0xe2452f, Wt = C.white;
  const ys = [0, 10, 20, 31, 42, 54, 66, 78, 88, 96], hw = (y) => (y < 20 ? 5.8 - 2.6 * y / 20 : y < 45 ? 3.2 - 1.4 * (y - 20) / 25 : y < 80 ? 1.8 - 0.7 * (y - 45) / 35 : 1.1 - 0.55 * (y - 80) / 16);
  const cn = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (let s = 0; s < ys.length - 1; s++) {
    const y0 = ys[s], y1 = ys[s + 1], a = hw(y0), b = hw(y1), col = s % 2 ? Wt : R, th = 0.12 + a * 0.05;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = cn[i], [bx, bz] = cn[(i + 1) % 4];
      g.beam([ax * a, y0, az * a], [ax * b, y1, az * b], th, col);
      g.beam([ax * b, y1, az * b], [bx * b, y1, bz * b], th * 0.7, col, { n: 3 });
      g.beam([ax * a, y0, az * a], [bx * b, y1, bz * b], th * 0.5, col, { n: 3 }); g.beam([bx * a, y0, bz * a], [ax * b, y1, az * b], th * 0.5, col, { n: 3 });
    }
  }
  for (const [x, z] of cn) g.box(x * 5.6, 0, z * 5.6, 0.8, 1.0, 0.8, C.concD, { no: 'b' });
  g.box(0, 0, 0, 4, 3, 4, C.concL, { no: 'b', ct: C.concD }); g.panel('+z', 0, 0, 2, 1.2, 2.2, R, { eps: 0.05 });
  // observation deck
  g.rbox(0, 31, 0, 8, 0.5, 8, 1.5, Wt, { ax: 'y' }); block(g, 0, 31.5, 0, 6.6, 2.4, 6.6, C.steelD, { nx: 5, ny: 1, wy: 0.4, m: 0.3, wo: { gx: 0.1, gy: 0, p: 0.9, eps: 0.06 } }); g.rbox(0, 33.9, 0, 7.4, 0.5, 7.4, 1.4, R, { ax: 'y' });
  g.box(0, 54, 0, 5, 0.4, 5, Wt);
  for (let k = 0; k < 4; k++) g.at(0, 0, 0, k * 90 + 45, () => { g.lathe(0, 57, 2.6, [[0.2, -0.3], [1.0, 0.1], [1.15, 0.35]], 8, Wt, { ax: 'z', caps: 'b', ct: C.steel }); g.cyl(0, 62, 1.9, 0.5, 0.5, 6, Wt, { ax: 'z' }); });
  g.box(0, 78, 0, 3.4, 0.3, 3.4, Wt);
  g.lathe(0, 96, 0, [[0.34, 0, R], [0.3, 3.5, Wt], [0.26, 7, R], [0.2, 10.5, Wt], [0.12, 13.6]], 6, R, { ta: 1 });
  for (const [y, r] of [[109.7, 0.32], [96.3, 0.4], [66.2, 0.4]]) g.sph(y > 100 ? 0 : hw(y) + 0.3, y, y > 100 ? 0 : hw(y) + 0.3, r, r, r, C.neonR, { g: 1, seg: 4, rings: 2 });
  g.mirror(() => g.box(0.9, 88, 0, 0.3, 6, 0.3, Wt));
};

DEF.stadium = (g) => {
  const N = 28, E = [1, 100 / 120], seat = (i) => [0x3f82d6, 0x3f82d6, 0xf1f0ee, 0xd13b30, 0xd13b30, 0xf1f0ee, 0xf8c734][i % 7];
  const lit = (i) => ((i * 7) % 5 < 3 ? { c: C.lit, g: 0.8 } : { c: C.glassD });
  g.lathe(0, 0, 0, [
    [59.6, 0, (i) => (i % 3 === 0 ? C.dark : C.concD)], [60.4, 5, (i) => (i % 2 ? C.white : C.concL)], [60.4, 13.5, lit], [60.4, 16, (i) => (i % 2 ? C.white : C.concL)],
    [60.4, 20, C.blue], [60.4, 22.4, C.white], [59, 24, C.concL], [57.5, 24, seat], [46, 13, C.concD], [43.6, 13, (i) => seat(i + 3)], [34, 3.2, C.white], [34, 0.6],
  ], N, C.concL, { e: E, caps: '' });
  g.cyl(0, 0, 0, 34.1, 0.62, N, 0xc9664a, { e: E, caps: 't' });
  // pitch
  g.wins('+y', 0, 0.62, 0, 46, 28, 10, 1, { gx: 0, gy: 0, col: (i) => (i % 2 ? 0x5fae45 : 0x6fbd4f), eps: 0.05 });
  g.panel('+y', -25.5, 0.62, 0, 5, 28, C.blue, { eps: 0.05 }); g.panel('+y', 25.5, 0.62, 0, 5, 28, C.red, { eps: 0.05 });
  for (const z of [-14, 14]) g.panel('+y', 0, 0.62, z, 56, 0.5, C.white, { eps: 0.1 });
  for (const x of [-28, -23, 0, 23, 28]) g.panel('+y', x, 0.62, 0, 0.5, 28, C.white, { eps: 0.1 });
  g.xf({ p: [0, 0.74, 0], r: [-90, 0, 0] }, () => g.disc(0, 0, 0, 3.6, 4.1, 14, C.white));
  g.mirror(() => { g.beam([28.5, 0.6, -2.4], [28.5, 5, -2.4], 0.15, C.yellow, { n: 3 }); g.beam([28.5, 0.6, 2.4], [28.5, 5, 2.4], 0.15, C.yellow, { n: 3 }); g.beam([28.5, 2.6, -2.4], [28.5, 2.6, 2.4], 0.15, C.yellow, { n: 3 }); });
  // canopy
  g.lathe(0, 0, 0, [[59.9, 25.4, C.white], [59.9, 26.4, (i) => (i % 2 ? C.white : 0xe6ecf0)], [46.5, 29.4, C.steelD], [46.5, 29.0, 0x8f9aa6], [59.7, 25.4]], N, C.white, { e: E, caps: '' });
  for (let i = 0; i < N; i += 2) { const a = (i + 0.5) / N * TAU, x = sin(a), z = cos(a) * E[1]; g.beam([x * 59.6, 23.5, z * 59.6], [x * 59.9, 26, z * 59.9], 0.35, C.steelD, { n: 3 }); g.beam([x * 59.6, 24, z * 59.6], [x * 50, 29.6, z * 50], 0.16, C.steelD, { n: 3 }); }
  // floodlights
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    const x = sx * 53.5, z = sz * 44.5, yaw = Math.atan2(-x, -z) / D2R;
    g.box(x, 0, z, 3, 1.2, 3, C.concD, { no: 'b' }); g.beam([x, 1.2, z], [x, 26, z], 0.75, C.steelL, { r2: 0.45 });
    g.xf({ p: [x, 25.4, z], r: [18, yaw, 0] }, () => { g.box(0, 0, 0, 9, 4.6, 0.8, C.steelD); g.wins('+z', 0, 0.3, 0.4, 8.4, 4, 6, 3, { gx: 0.2, gy: 0.2, col: C.head, g: 1, eps: 0.03 }); });
  }
  // jumbotron
  g.box(0, 24, -47.5, 28, 5.6, 1.6, C.dark); g.mirror(() => g.box(11, 20, -47.5, 1, 4, 1.2, C.steelD, { no: 'tb' }));
  g.wins('+z', 0, 24.4, -46.7, 27, 4.8, 9, 3, { gx: 0.04, gy: 0.06, col: (i, j) => [C.neonC, C.hot, C.neonY, C.blue, C.white][(i * 2 + j * 3) % 5], g: 0.9, eps: 0.03 });
};

DEF.hospital = (g) => {
  g.eps = 0.14; const Wt = 0xf4f6f6, wo = { gx: 0.14, gy: 0.5, p: 0.55 };
  const cross = (f, x, y, z, s, e = 0.2) => { g.panel(f, x, y + s * 0.33, z, s, s * 0.34, C.neonR, { g: 0.85, eps: e }); g.panel(f, x, y, z, s * 0.34, s, C.neonR, { g: 0.85, eps: e }); };
  // podium
  g.box(0, 0, 4, 46, 9, 22, Wt, { no: 'b', ct: C.concD });
  g.box(0, 7.6, 4, 46.3, 1.0, 22.3, C.teal, { no: 'tb' });
  g.wins('+z', 6, 1.0, 15, 30, 5.6, 9, 2, { gx: 0.2, gy: 0.3, p: 0.8 });
  for (const f of ['+x', '-x']) g.wins(f, f === '+x' ? 23 : -23, 1.0, 4, 20, 5.6, 6, 2, { gx: 0.2, gy: 0.3, p: 0.7 });
  // tower
  g.box(0, 0, -7, 30, 36, 16, Wt, { no: 'b', ct: C.concD });
  for (let i = 0; i < 3; i++) g.box(0, 9.5 + i * 12, -7, 30.3, 0.9, 16.3, C.teal, { no: 'tb' });
  g.wins('+z', 0, 10.8, 1, 28, 24, 10, 6, wo); g.wins('-z', 0, 2, -15, 28, 33, 10, 8, wo);
  for (const f of ['+x', '-x']) g.wins(f, f === '+x' ? 15 : -15, 10.8, -7, 14, 24, 4, 6, wo);
  // front T wing
  g.box(0, 0, 7, 14, 28, 12, Wt, { no: 'b', ct: C.concD });
  for (const f of ['+x', '-x']) g.wins(f, f === '+x' ? 7 : -7, 10.5, 7, 10, 16, 3, 4, wo);
  g.wins('+z', 0, 9.6, 13, 12, 9.4, 4, 3, wo);
  g.panel('+z', 0, 19.6, 13, 9, 7.6, C.white, { eps: 0.1 }); cross('+z', 0, 20.6, 13, 5.6);
  g.box(0, 28, 7, 14.3, 0.8, 12.3, C.teal, { ct: C.concD });
  // emergency entrance + ambulance
  g.box(-14, 4.4, 15.6, 14, 0.5, 2.6, C.red); g.panel('+z', -14, 4.5, 16.9, 10, 0.3, C.white, { g: 0.8, eps: 0.02 });
  g.mirror(() => 0); for (const x of [-20.4, -7.6]) g.box(x, 0, 16.5, 0.4, 4.4, 0.4, Wt, { no: 'tb' });
  g.panel('+z', -14, 0, 15, 6, 3.6, C.dark, { eps: 0.2 }); g.wins('+z', -14, 0.2, 15, 5.4, 3.2, 3, 1, { gx: 0.06, gy: 0, col: C.lit, g: 0.9, eps: 0.26 });
  g.at(-17, 0, 16.2, 90, () => {
    g.box(0, 0.5, 0, 2.2, 2.3, 5.2, Wt); g.box(0, 0.5, 2.3, 2.2, 1.3, 1.4, Wt, { top: [0.9, 0.5], off: [0, -0.35] });
    g.mirror(() => { g.panel('+x', 1.1, 1.3, -0.4, 4.2, 0.4, C.red, { eps: 0.03 }); g.cyl(1.0, 0.45, 1.7, 0.45, 0.3, 6, C.tyre, { ax: 'x' }); g.cyl(1.0, 0.45, -1.6, 0.45, 0.3, 6, C.tyre, { ax: 'x' }); });
    g.box(0, 2.8, 0.8, 1.2, 0.25, 0.4, C.blue, { g: 1 });
  });
  g.box(13, 4.2, 15.5, 9, 0.4, 2.2, C.teal); g.panel('+z', 13, 0, 15, 5, 3.6, C.glass, { eps: 0.2 });
  // roof: helipad + mech + cross cube
  g.cyl(-7, 36.8, -7, 6.4, 0.6, 14, C.concD, { ct: 0x6a7078 }); for (const [x, z] of [[-11, -11], [-3, -11], [-11, -3], [-3, -3]]) g.box(x, 36, z, 0.5, 0.8, 0.5, C.steelD, { no: 'tb' });
  g.xf({ p: [-7, 37.45, -7], r: [-90, 0, 0] }, () => { g.disc(0, 0, 0, 4.6, 5.3, 14, C.yellow); g.disc(0, 0, 0, 0, 3.4, 12, C.white); g.quad([-1.6, -1.9, 0.03], [-0.9, -1.9, 0.03], [-0.9, 1.9, 0.03], [-1.6, 1.9, 0.03], C.red); g.quad([0.9, -1.9, 0.03], [1.6, -1.9, 0.03], [1.6, 1.9, 0.03], [0.9, 1.9, 0.03], C.red); g.quad([-0.9, -0.35, 0.03], [0.9, -0.35, 0.03], [0.9, 0.35, 0.03], [-0.9, 0.35, 0.03], C.red); });
  g.box(9, 36, -8, 7, 4, 7, Wt, { no: 'b', ct: C.concD });
  for (const [f, x, z] of [['+z', 9, -4.5], ['-z', 9, -11.5], ['+x', 12.5, -8], ['-x', 5.5, -8]]) cross(f, x, 36.5, z, 3, 0.05);
  acUnit(g, 3, 36, -12, 3, 1.3, 2.4); acUnit(g, 2, 36, -3, 2.4, 1.1, 2);
  acUnit(g, -17, 9, 8, 3, 1.3, 3); acUnit(g, 17, 9, 0, 3, 1.3, 3);
};

DEF.bridge_tower = (g) => {
  g.eps = 0.12; const O = 0xd9482b, OD = 0xb53a22, LZ = 11.5;
  g.mirrorZ(() => {
    g.box(0, 0, LZ, 8, 5, 7, C.concL, { top: [0.85, 0.85], no: 'b' });
    let y = 5;
    for (const [w, h] of [[5.2, 17], [4.6, 22], [3.8, 18], [3.2, 6]]) {
      g.box(0, y, LZ, w, h, w, O, { no: 'b' });
      for (let k = 0; k < 4; k++) g.at(0, 0, LZ, k * 90, () => g.panel('+z', 0, y + 1, w / 2, w * 0.5, h - 2, OD));
      y += h; g.box(0, y - 0.6, LZ, w + 0.5, 0.6, w + 0.5, OD);
    }
    g.box(0, 68, LZ, 4.2, 0.9, 2.2, OD); g.sph(0, 69.4, LZ, 0.55, 0.55, 0.55, C.neonR, { g: 1, seg: 5, rings: 3 });
    // main cable + suspenders
    g.mirror(() => { g.beam([0, 68.6, LZ], [5, 65.4, LZ], 0.38, OD, { n: 5 }); g.beam([3.6, 66.3, LZ - 2.4], [3.6, 18.4, LZ - 2.4], 0.07, C.steelD, { n: 3 }); g.beam([3.6, 66.3, LZ], [3.6, 66.3, LZ - 2.4], 0.07, C.steelD, { n: 3 }); });
    // deck side truss
    g.box(0, 18.3, 8.6, 10, 1.3, 0.3, O, { no: 'b' });
    g.mirror(() => { g.beam([0, 16.7, 8.75], [5, 18.3, 8.75], 0.14, OD, { n: 3 }); });
    for (const x of [-3.5, 0, 3.5]) g.box(x, 19.6, 8.5, 0.25, 0.3, 0.25, C.lit, { g: 1 });
    // under-deck X brace
    g.beam([0, 5.5, LZ - 2.6], [0, 15.5, 0], 0.4, OD);
  });
  g.box(0, 16.6, 0, 10, 1.8, 17.8, OD);
  g.panel('+y', 0, 18.4, 0, 10, 16.4, C.asphalt, { eps: 0.03 });
  g.wins('+y', 0, 18.4, 0, 10, 0.3, 5, 1, { gx: 0.5, gy: 0, col: C.yellow, eps: 0.06 }); for (const z of [-4, 4]) g.wins('+y', 0, 18.4, z, 10, 0.2, 5, 1, { gx: 0.5, gy: 0, col: C.white, eps: 0.06 });
  for (const [y, h] of [[32, 3.4], [47, 3], [61, 2.6]]) {
    g.box(0, y, 0, 2.6, h, 2 * LZ - 3, O);
    for (const f of ['+x', '-x']) g.wins(f, f === '+x' ? 1.3 : -1.3, y + 0.5, 0, 2 * LZ - 5.5, h - 1, 5, 1, { gx: 0.35, gy: 0, col: OD });
  }
};

// =====================================================================================
// 10. TIER 5 - landmarks (<=4500 tris)
// =====================================================================================
DEF.mega_tower = (g) => {
  g.eps = 0.2; const G0 = 0x2f6680, G1 = 0x4f9db8, cap = C.steelL;
  g.rbox(0, 0, 0, 46, 8, 46, 9, 0x56616f, { ax: 'y', c1: C.concD });
  for (let k = 0; k < 4; k++) g.at(0, 0, 0, k * 90, () => g.wins('+z', 0, 1, 23, 26, 5.4, 9, 1, { gx: 0.08, gy: 0, p: 0.9 }));
  // core with ribbon floors
  const prof = [], rAt = (y) => (y < 150 ? 9 : y < 190 ? 7.5 : y < 215 ? 5.6 : 3.6);
  for (let y = 8; y < 228; y += 5.5) { const r = rAt(y), r2 = rAt(y + 5.5), lit = g.rnd() < 0.55; prof.push([r, y, G0], [r, y + 3.2, lit ? C.lit : G1, lit ? { g: 0.75 } : {}]); if (r2 !== r) prof.push([r, y + 5.5, cap], [r2, y + 5.5, G0]); }
  prof.push([3.6, 228, cap], [1.5, 237, cap], [0.5, 249.2]);
  g.lathe(0, 0, 0, prof, 6, G0, { caps: 't' });
  g.sph(0, 249.4, 0, 0.9, 0.9, 0.9, C.neonR, { g: 1, seg: 5, rings: 3 });
  // three buttress wings with spiralling setbacks
  const wo = { gx: 0.06, gy: 0.5, dark: G1, dark2: 0x4592ad, p: 0.5 };
  for (let k = 0; k < 3; k++) g.at(0, 0, 0, k * 120, () => {
    const segs = [[22, 13, 62 + k * 13], [18, 11.5, 106 + k * 13], [14, 10, 146 + k * 11], [10.5, 8.5, 180 + k * 9]];
    let y0 = 8;
    for (const [L, Wd, yT] of segs) {
      const zc = (5 + L) / 2, dp = L - 5;
      g.box(0, 8, zc, Wd, yT - 8, dp, G0, { no: 'bk', ct: C.concD });
      g.box(0, yT, zc, Wd + 0.5, 0.9, dp + 0.5, cap, { no: 'b' });
      const ny = max(1, Math.round((yT - y0) / 7));
      g.wins('+x', Wd / 2, y0 + 1, zc, dp - 1, yT - y0 - 2, 2, ny, wo); g.wins('-x', -Wd / 2, y0 + 1, zc, dp - 1, yT - y0 - 2, 2, ny, wo);
      g.wins('+z', 0, y0 + 1, L, Wd - 1, yT - y0 - 2, 2, ny, wo);
      g.box(0, y0, L + 0.1, 0.9, yT - y0, 0.5, cap, { no: 'tbk' });
      y0 = yT + 0.9;
    }
  });
};

DEF.cooling_tower = (g) => {
  g.eps = 0.2; const TX = -4.6, TZ = -4.6, N = 20, c1 = 0xd9d6cc, c2 = 0xcfccc1;
  const band = (i) => (i % 2 ? c1 : c2);
  g.cyl(TX, 0, TZ, 27.4, 1.0, N, C.concD, { ct: 0x79bcd6, caps: 't' });
  g.lathe(TX, 0, TZ, [
    [26.6, 7, c2], [26.6, 8.2, band], [24, 18, c1], [20.6, 34, band], [18.1, 50, c1], [17.3, 58, band], [17.7, 68, c1], [18.6, 75, C.red], [19, 78, C.white], [19.4, 81, C.red], [19.8, 84.2, C.concL],
    [19.8, 85, C.concL], [18.5, 85, 0x6a7078], [18.2, 78, 0x555b63], [16.4, 60, () => ({ c: 0x9dffb0, g: 0.45 })], [16.8, 50],
  ], N, c1, { caps: '' });
  for (let i = 0; i < N; i++) {
    const a = i / N * TAU, b = (i + 0.5) / N * TAU, c = (i + 1) / N * TAU;
    g.beam([TX + sin(a) * 27, 0.8, TZ + cos(a) * 27], [TX + sin(b) * 26.2, 7.2, TZ + cos(b) * 26.2], 0.42, C.concD, { n: 3 });
    g.beam([TX + sin(c) * 27, 0.8, TZ + cos(c) * 27], [TX + sin(b) * 26.2, 7.2, TZ + cos(b) * 26.2], 0.42, C.concD, { n: 3 });
  }
  // reactor containment
  g.lathe(24, 0, 24, [[8, 0, C.concD], [8, 1.5, C.concL], [8, 12, 0xe6e3da], [8.3, 12, 0xe6e3da], [8.3, 13, C.concL], [7.4, 16.5, 0xe6e3da], [5.2, 19.4, C.concL], [2.2, 21, 0xe6e3da], [0, 21.5]], 12, C.concL, { caps: '' });
  g.at(24, 7.2, 24 + 8 * cos(15 * D2R), 0, () => {
    g.disc(0, 0, 0.12, 0, 2.6, 12, C.yellow, { g: 0.35 });
    for (let k = 0; k < 3; k++) g.disc(0, 0, 0.2, 0.7, 2.2, 3, C.black, { arc: [k / 3 - 0.083, k / 3 + 0.083] });
    g.disc(0, 0, 0.2, 0, 0.42, 8, C.black);
  });
  g.beam([19, 3.5, 19], [11, 3.5, 11], 1.3, C.steel, { n: 6 }); g.beam([20, 9, 18], [12.5, 9, 10.5], 0.7, C.orange, { n: 6 });
  // turbine hall + vent stack
  g.box(27.4, 0, -21, 9, 9, 20, 0x8fa3b5, { no: 'b', ct: C.steelD });
  g.wins('+x', 31.9, 4.6, -21, 18, 2.6, 7, 1, { gx: 0.3, gy: 0, p: 0.7 }); g.wins('+z', 27.4, 4.6, -11, 7, 2.6, 3, 1, { gx: 0.3, gy: 0, p: 0.7 }); g.panel('+z', 27.4, 0, -11, 3, 3.6, C.steelD);
  for (const z of [-27, -21, -15]) { g.cyl(27.4, 9, z, 1.2, 1.2, 8, C.steelL, { ct: C.dark }); }
  g.lathe(27.5, 0, -6.5, [[1.6, 0, C.concL], [1.3, 14, C.white], [1.2, 22, C.red], [1.1, 28, C.white], [1.05, 33, C.red], [1.0, 38]], 8, C.concL, { ct: C.black, ta: 1 });
  g.sph(27.5, 38.6, -6.5, 0.5, 0.5, 0.5, C.neonR, { g: 1, seg: 4, rings: 2 });
  g.box(5, 0, 27, 14, 5, 8, C.concL, { no: 'b', ct: C.concD }); g.wins('+z', 5, 1.4, 31, 12, 2.4, 5, 1, { gx: 0.3, gy: 0, p: 0.7 });
  g.box(-28, 0, 27.5, 7, 3.4, 8, 0x8fa3b5, { no: 'b', ct: C.steelD });
};

DEF.capitol = (g) => {
  g.eps = 0.2; const M = C.marble, M2 = 0xddd6c6, ZC = -1, wo = { gx: 0.5, gy: 0.4, p: 0.65 };
  g.box(0, 0, ZC, 90, 3, 56, M2, { no: 'b' });
  for (let i = 0; i < 4; i++) g.box(0, 0, 27 + i * 0.9 - 1.5 + 0.45, 30, 3 - i * 0.75, 0.9 + 3, M2, { no: 'bk' });
  // central block, wings, end pavilions
  g.box(0, 3, ZC, 34, 16, 34, M, { no: 'b', ct: M2 });
  g.box(0, 18.2, ZC, 35, 0.8, 35, M2, { no: 'tb' });
  for (const f of ['+x', '-x']) g.wins(f, f === '+x' ? 17 : -17, 12.5, ZC, 30, 4.4, 8, 1, wo);
  g.wins('-z', 0, 5, ZC - 17, 30, 12, 8, 2, wo);
  g.mirror(() => {
    g.box(30, 3, ZC, 26, 12, 22, M, { no: 'b', ct: M2 }); g.box(30, 14.4, ZC, 26.6, 0.8, 22.6, M2, { no: 'tb' });
    g.wins('+z', 29, 5, ZC + 11, 22, 8.4, 7, 2, wo); g.wins('-z', 29, 5, ZC - 11, 22, 8.4, 7, 2, wo);
    for (let i = 0; i < 8; i++) g.cyl(18.6 + i * 2.95, 3, ZC + 12.4, 0.6, 9.4, 6, M, { caps: '' });
    g.box(29, 12.4, ZC + 12.2, 23, 1.2, 1.9, M2);
    g.box(41, 3, ZC, 8, 14, 27, M, { no: 'b', ct: M2 }); g.box(41, 16.4, ZC, 8.6, 0.8, 27.6, M2, { no: 'tb' });
    g.wins('+z', 41, 5, ZC + 13.5, 6, 9.4, 2, 2, wo); g.wins('+x', 45, 5, ZC, 23, 9.4, 7, 2, wo); g.wins('-z', 41, 5, ZC - 13.5, 6, 9.4, 2, 2, wo);
    g.lathe(41, 17, ZC, [[3.4, 0, M2], [3.4, 1.2, M], [2.4, 2.8, M2], [0.8, 3.5, C.gold], [0, 4.2]], 8, M, { caps: '' });
  });
  // portico
  g.box(0, 3, ZC + 20.5, 30, 0.6, 7, M2, { no: 'b' });
  for (let i = 0; i < 8; i++) g.cyl(-12.25 + i * 3.5, 3.6, ZC + 22.4, 0.95, 11.6, 6, M, { caps: '' });
  g.box(0, 15.2, ZC + 20.3, 28.6, 1.8, 6.6, M2);
  g.roof(0, 17, ZC + 20.3, 28.6, 4.2, 6.6, M2, { cg: M });
  g.at(0, 18.4, ZC + 23.6, 0, () => g.disc(0, 0, 0.25, 0, 1.2, 10, C.gold, { g: 0.3 }));
  g.panel('+z', 0, 3.6, ZC + 17, 5, 8, 0x4a3a2c, { eps: 0.2 }); g.wins('+z', -9, 5, ZC + 17, 9, 8, 3, 2, wo); g.wins('+z', 9, 5, ZC + 17, 9, 8, 3, 2, wo);
  // dome
  const K = 1.14, dl = (i, k) => ((i * 5 + 1) % 3 ? { c: C.lit, g: 0.75 } : { c: C.glassD });
  g.box(0, 19, ZC, 25, 2, 25, M, { no: 'b', ct: M2 });
  g.lathe(0, 21, ZC, [
    [11, 0, M2], [11, 1 * K, M2], [9.6, 1 * K, dl], [9.6, 9 * K, M2], [11.2, 9 * K, M2], [11.2, 10.6 * K, M], [10.2, 10.6 * K, (i) => (i % 2 ? M : 0xe2dccd)], [9.8, 13.5 * K, (i) => (i % 2 ? M : 0xe2dccd)],
    [8.6, 17.5 * K, (i) => (i % 2 ? M : 0xe2dccd)], [6.4, 21 * K, (i) => (i % 2 ? M : 0xe2dccd)], [3.4, 23.4 * K, M2], [1.9, 24.2 * K, M2], [1.7, 24.2 * K, dl], [1.7, 27.6 * K, M2], [2.3, 27.6 * K, M2], [2.3, 28.2 * K, M], [1.2, 29.8 * K, M], [0.35, 31 * K],
  ], 16, M, { caps: '' });
  for (let i = 0; i < 16; i++) { const a = (i + 0.5) / 16 * TAU; g.cyl(sin(a) * 10.5, 21 + K, ZC + cos(a) * 10.5, 0.48, 8 * K, 5, M, { caps: '' }); }
  g.box(0, 21 + 31 * K, ZC, 0.5, 2.6, 0.5, C.gold, { g: 0.3, top: [0.4, 0.4] }); g.sph(0, 21 + 31 * K + 2.9, ZC, 0.5, 0.5, 0.5, C.gold, { g: 0.3, seg: 4, rings: 2 });
  // flags + lamps
  g.mirror(() => { g.cyl(30, 15.2, ZC, 0.14, 8, 4, C.steelL, { caps: '' }); g.quad([30, 23, ZC], [30, 21, ZC], [33, 21, ZC], [33, 23, ZC], C.red, { ds: 1 }); g.box(17, 0, 30.4, 1.4, 3.6, 1.4, M2, { no: 'b' }); g.sph(17, 4.3, 30.4, 0.7, 0.7, 0.7, C.lit, { g: 1, seg: 5, rings: 3 }); });
};

DEF.giant_duck = (g) => {
  const Y = 0xffd21f, YD = 0xf7b90c, OR = 0xff8a1f, st = 0xbfb8a8;
  g.rbox(0, 0, 0, 40, 2, 50, 5, st, { ax: 'y', no0: 1 });
  g.rbox(0, 2, 0, 35, 3, 45, 5, C.marble, { ax: 'y', no0: 1 });
  g.panel('+z', 0, 2.5, 22.5, 9, 2, C.gold, { g: 0.3, eps: 0.1 }); g.panel('+z', 0, 2.9, 22.5, 7, 0.3, 0x7a5a1a, { eps: 0.2 }); g.panel('+z', 0, 3.6, 22.5, 5, 0.3, 0x7a5a1a, { eps: 0.2 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { g.box(sx * 17.6, 2, sz * 20, 1.8, 1.2, 1.8, C.dark, { no: 'b' }); g.panel('+y', sx * 17.6, 3.2, sz * 20, 1.3, 1.3, C.lit, { g: 1, eps: 0.03 }); }
  g.box(0, 0, 24.2, 8, 1, 1.6, st, { no: 'b' });
  const mk = g.mark();
  // body
  const mb = g.mark();
  g.sph(0, 15.8, -3, 16, 11.3, 20, Y, { seg: 18, rings: 10 });
  g.warp(mb, (p) => {
    const z = p[2] + 3, y = p[1] - 15.8;
    if (z < -6) { const k = (-z - 6) / 14; p[1] += k * k * 9; p[0] *= 1 - 0.45 * k * k; }       // tail sweeps up and pinches
    if (y < -6) p[1] = 15.8 - 6 + (y + 6) * 0.55;                                              // flatter belly
    if (z > 8) p[0] *= 1 - 0.012 * (z - 8);
  });
  g.mirror(() => { const mw = g.mark(); g.sph(14.2, 17.5, -4.5, 3.0, 5.8, 10.5, YD, { seg: 10, rings: 6 }); g.warp(mw, (p) => { const z = p[2] + 4.5; if (z < 0) p[1] += z * z * 0.045; }); });
  // head
  const HY = 34.6, HZ = 10;
  g.sph(0, HY, HZ, 9.7, 9.3, 9.7, Y, { seg: 16, rings: 9 });
  // beak
  const bp = [[-3.5, 0], [3.5, 0], [4.4, 3], [3.3, 6.4], [0, 7.2], [-3.3, 6.4], [-4.4, 3]];
  g.ext(bp, 1.6, OR, { plane: 'xz', at: [0, HY - 1.9, HZ + 8.2], sc0: [1, 1], sc1: [0.82, 0.86] });
  g.ext(bp, 1.1, 0xf2700f, { plane: 'xz', at: [0, HY - 3.3, HZ + 8.0], sc0: [0.7, 0.75], sc1: [0.88, 0.9] });
  g.shine(mk, [-0.4, 0.75, 0.5], 0.5, 7);
  g.mirror(() => { g.sph(5.3, HY + 2.7, HZ + 7.4, 1.55, 2.0, 1.1, C.black, { seg: 8, rings: 5 }); g.sph(5.75, HY + 3.5, HZ + 8.25, 0.55, 0.6, 0.4, C.white, { seg: 5, rings: 3 }); });
};

// military, debris and boss models live in models-military.js
for (const k in MILITARY) if (!DEF[k]) DEF[k] = (g) => MILITARY[k](g, { C, wheel, sedan });
