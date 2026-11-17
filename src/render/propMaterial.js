// Shared material for every procedural prop/building/enemy model (see models.js).
// Vertex attributes: color (linear rgb), tint (0..1), glow (0..1).
//   final albedo = color * mix(white, instanceColor, tint)     (no instanceColor => white)
//   emissive    += albedo * glow * uGlow
import * as THREE from 'three';

/**
 * @param {object} [opts]
 * @param {number} [opts.glow=1]  initial uGlow (scale it up at dusk / for bloom)
 * @returns {THREE.MeshLambertMaterial} with `.uniforms.uGlow` and a `.glow` accessor
 */
export function makePropMaterial(opts = {}) {
  const { glow = 1, ...rest } = opts;
  const uniforms = { uGlow: { value: glow } };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false, ...rest });
  mat.uniforms = uniforms;
  Object.defineProperty(mat, 'glow', { get: () => uniforms.uGlow.value, set: (v) => { uniforms.uGlow.value = v; } });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = uniforms.uGlow;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float tint;\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <color_vertex>', /* glsl */`
        vColor = vec4( color.rgb, 1.0 );
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, tint );
        #endif
        vGlow = glow;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow;\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vColor.rgb * ( vGlow * uGlow );');
  };
  mat.customProgramCacheKey = () => 'stormzilla-prop-v1';
  return mat;
}
