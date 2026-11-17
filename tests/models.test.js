// node --test tests/models.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROPS } from '../src/game/defs.js';
import { buildModel, hasModel, MODEL_INFO } from '../src/render/models.js';

const BUDGET = (name, def) => {
  if (name === 'boss_core') return 6000;
  if (def.kind === 'chunk') return 60;
  return [180, 450, 1100, 2600, 4500, 4500][def.tier];
};
const TOL = 0.08;

for (const [name, def] of Object.entries(PROPS)) {
  test(`model ${name}`, () => {
    assert.ok(hasModel(name), 'has an authored model (not the placeholder)');
    const geo = buildModel(name);
    assert.ok(geo && geo.isBufferGeometry, 'geometry exists');
    assert.equal(geo.index, null, 'non-indexed');
    assert.equal(buildModel(name), geo, 'cached');
    const a = geo.attributes;
    for (const [k, size] of [['position', 3], ['normal', 3], ['color', 3], ['tint', 1], ['glow', 1]]) {
      assert.ok(a[k], `attribute ${k}`);
      assert.equal(a[k].itemSize, size, `${k} itemSize`);
      assert.equal(a[k].count, a.position.count, `${k} count`);
      for (let i = 0; i < a[k].array.length; i++) if (!Number.isFinite(a[k].array[i])) assert.fail(`${k}[${i}] is not finite`);
    }
    const n = a.position.count;
    assert.ok(n > 0 && n % 3 === 0, 'triangle soup');
    const tris = n / 3;
    assert.ok(tris <= BUDGET(name, def), `triangle budget: ${tris} > ${BUDGET(name, def)}`);
    assert.ok(tris >= 12, 'not trivially empty');
    // ranges + unit normals
    for (let i = 0; i < n; i++) {
      const c = a.color.array, t = a.tint.array[i], g = a.glow.array[i];
      assert.ok(c[i * 3] >= 0 && c[i * 3] <= 1 && c[i * 3 + 1] >= 0 && c[i * 3 + 1] <= 1 && c[i * 3 + 2] >= 0 && c[i * 3 + 2] <= 1, 'colour in 0..1');
      assert.ok(t === 0 || t === 1, 'tint is 0 or 1');
      assert.ok(g >= 0 && g <= 1, 'glow in 0..1');
      const nx = a.normal.array[i * 3], ny = a.normal.array[i * 3 + 1], nz = a.normal.array[i * 3 + 2];
      assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-3, 'unit normal');
    }
    // flat shading: the three normals of each triangle are identical
    for (let i = 0; i < n; i += 3) for (let k = 0; k < 3; k++) {
      assert.equal(a.normal.array[i * 3 + k], a.normal.array[(i + 1) * 3 + k]);
      assert.equal(a.normal.array[i * 3 + k], a.normal.array[(i + 2) * 3 + k]);
    }
    // tinted surfaces must be light so the instance tint shows
    for (let i = 0; i < n; i++) if (a.tint.array[i] === 1) {
      const c = a.color.array, lum = 0.2126 * c[i * 3] + 0.7152 * c[i * 3 + 1] + 0.0722 * c[i * 3 + 2];
      assert.ok(lum > 0.45, `tinted surface too dark (lum ${lum.toFixed(2)})`);
    }
    // bounding box vs defs
    geo.computeBoundingBox();
    const b = geo.boundingBox, sx = b.max.x - b.min.x, sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
    assert.ok(Math.abs(sx - def.w) <= def.w * TOL, `width ${sx.toFixed(2)} vs ${def.w}`);
    assert.ok(Math.abs(sy - def.h) <= def.h * TOL, `height ${sy.toFixed(2)} vs ${def.h}`);
    assert.ok(Math.abs(sz - def.d) <= def.d * TOL, `depth ${sz.toFixed(2)} vs ${def.d}`);
    assert.ok(Math.abs(b.min.y) <= Math.max(0.02, def.h * 0.01), `base at y=0 (${b.min.y.toFixed(3)})`);
    assert.ok(Math.abs((b.min.x + b.max.x) / 2) <= def.w * TOL, 'centred in x');
    assert.ok(Math.abs((b.min.z + b.max.z) / 2) <= def.d * TOL, 'centred in z');
    // authored proportions should already be close: auto-fit must not distort much
    const f = MODEL_INFO[name].fit;
    for (const k of f) assert.ok(k > 0.8 && k < 1.25, `auto-fit distortion too large: [${f.map((v) => v.toFixed(2))}]`);
  });
}

test('deterministic', async () => {
  const a = buildModel('house_a').attributes;
  const mod = await import('../src/render/models.js?again');
  const b = mod.buildModel('house_a').attributes;
  assert.deepEqual(Array.from(a.position.array), Array.from(b.position.array));
  assert.deepEqual(Array.from(a.glow.array), Array.from(b.glow.array));
});
