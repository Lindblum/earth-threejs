import * as THREE from 'three';

// A tile's look: its image, unlit, colour-matched, and while it's newly
// shown, faded in from what it replaced: the part of a coarser tile over it
// (it split out of that tile), or its four children (they joined back into
// it). Both the image and the ground's shape fade: each vertex starts at the
// height the old ground had there (`heightDelta` above its own, along the
// up there) and eases to its own. So the ground sharpens or softens over a
// moment instead of all at once.
//
// Colour matching: `gainMap`, gains at a GAIN_POINTS × GAIN_POINTS lattice over the
// tile, scales the image (linear RGB, stored halved) so its colours match its
// parent's over the same ground (see Globe.js grade).
//
// Each image is looked up through a 3 × 3 uv transform: a tile's own (for
// one showing part of a coarser image) and, for what it fades from, this
// tile's uvs carried into that tile's image (`fromTransform`) and into that
// tile itself (`fromTile`, for its gains).

export const FADE_S = 0.35; // how long a tile takes to fade in
export const GAIN_POINTS = 9; // (8 cells a side: its outer points on the tile's edges, shared with its neighbours')

const vertexShader = /* glsl */ `
attribute float heightDelta; // the old ground's height here, above this tile's (0 where absent)
uniform vec3 tileCenter; // the tile's centre (ECEF): the up at a vertex is roughly away from the Earth's centre
uniform float fade;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 up = normalize(tileCenter + position);
  vec3 p = position + up * heightDelta * (1.0 - fade);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D map;
uniform mat3 mapTransform;
uniform sampler2D gainMap;
uniform float fade; // 0: all what it replaced; 1: all its own
uniform int fromCount; // 1: a coarser tile's image; 4: its children's, by quadrant
uniform sampler2D from0;
uniform sampler2D from1;
uniform sampler2D from2;
uniform sampler2D from3;
uniform sampler2D fromGain0;
uniform sampler2D fromGain1;
uniform sampler2D fromGain2;
uniform sampler2D fromGain3;
uniform mat3 fromTransform0;
uniform mat3 fromTransform1;
uniform mat3 fromTransform2;
uniform mat3 fromTransform3;
uniform mat3 fromTile0;
uniform mat3 fromTile1;
uniform mat3 fromTile2;
uniform mat3 fromTile3;
varying vec2 vUv;
const float GAIN_POINTS = ${GAIN_POINTS}.0;

vec3 lookUp(sampler2D image, mat3 transform, sampler2D gains, mat3 tile) {
  vec3 uvw = vec3(vUv, 1.0);
  // (the lattice's points at texel centres: its edge points exactly on the tile's edges)
  vec2 g = ((tile * uvw).xy * (GAIN_POINTS - 1.0) + 0.5) / GAIN_POINTS;
  // (gains stored as log2: 128 is ×1, 32 steps a doubling)
  vec3 gain = exp2((texture2D(gains, g).rgb * 255.0 - 128.0) / 32.0);
  return texture2D(image, (transform * uvw).xy).rgb * gain;
}

void main() {
  vec3 color = lookUp(map, mapTransform, gainMap, mat3(1.0));
  if (fade < 1.0) {
    vec3 before;
    if (fromCount == 1) before = lookUp(from0, fromTransform0, fromGain0, fromTile0);
    else {
      // (children: x across, then y down)
      bool east = vUv.x >= 0.5;
      bool south = vUv.y >= 0.5;
      if (!east && !south) before = lookUp(from0, fromTransform0, fromGain0, fromTile0);
      else if (east && !south) before = lookUp(from1, fromTransform1, fromGain1, fromTile1);
      else if (!east) before = lookUp(from2, fromTransform2, fromGain2, fromTile2);
      else before = lookUp(from3, fromTransform3, fromGain3, fromTile3);
    }
    color = mix(before, color, fade);
  }
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

/** A GAIN_POINTS² gain texture, all 1 (stored as log2 in a byte: 128 + 32 log2(gain), ×1/16 to ×16). */
export function gainTexture() {
  const data = new Uint8Array(GAIN_POINTS * GAIN_POINTS * 4).fill(128);
  const texture = new THREE.DataTexture(data, GAIN_POINTS, GAIN_POINTS);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** `texture` (a gainTexture) showing `gains` (Float32Array, GAIN_POINTS² × RGB, rows from the north). */
export function setGains(texture, gains) {
  const data = texture.image.data;
  for (let i = 0; i < GAIN_POINTS * GAIN_POINTS; i++) {
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(THREE.MathUtils.clamp(128 + Math.log2(Math.max(1e-6, gains[i * 3 + c])) * 32, 0, 255));
    data[i * 4 + 3] = 255;
  }
  texture.needsUpdate = true;
}

/** A tile's material, showing `map` (a Texture, its offset / repeat its part of the image), scaled by `gainMap`; `center`: the tile's centre (ECEF). */
export function tileMaterial(map, gainMap, center) {
  map.updateMatrix();
  const uniforms = {
    map: { value: map },
    mapTransform: { value: map.matrix.clone() },
    gainMap: { value: gainMap },
    tileCenter: { value: center.clone() },
    fade: { value: 1 },
    fromCount: { value: 1 },
  };
  for (let i = 0; i < 4; i++) {
    uniforms[`from${i}`] = { value: map };
    uniforms[`fromGain${i}`] = { value: gainMap };
    uniforms[`fromTransform${i}`] = { value: new THREE.Matrix3() };
    uniforms[`fromTile${i}`] = { value: new THREE.Matrix3() };
  }
  return new THREE.ShaderMaterial({ name: 'TileMaterial', vertexShader, fragmentShader, uniforms });
}

/**
 * Starts `material` fading in from `sources`: [{ texture, gainMap, transform }]
 * (one, or four children in x-then-y order), `transform` taking this tile's
 * uvs into that source tile's (its image's own offset / repeat is added here).
 */
export function fadeFrom(material, sources) {
  const u = material.uniforms;
  u.fromCount.value = sources.length;
  sources.forEach(({ texture, gainMap, transform }, i) => {
    texture.updateMatrix();
    u[`from${i}`].value = texture;
    u[`fromGain${i}`].value = gainMap;
    u[`fromTransform${i}`].value.multiplyMatrices(texture.matrix, transform);
    u[`fromTile${i}`].value.copy(transform);
  });
  u.fade.value = 0;
}

/** Done fading: only its own image (the others let go). */
export function endFade(material) {
  const u = material.uniforms;
  u.fade.value = 1;
  for (let i = 0; i < 4; i++) {
    u[`from${i}`].value = u.map.value;
    u[`fromGain${i}`].value = u.gainMap.value;
  }
}
