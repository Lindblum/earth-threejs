import * as THREE from 'three';
import { CLOUDS } from './sources.js';
import { geodeticToEcef } from './geo.js';
import { sunUniform } from './sky.js';
import { sunlight } from './tileMaterial.js';

// Map → Clouds: the world's clouds as they are now, at their height.
//
// NOAA's hourly mosaic of the geostationary satellites' infrared is turned,
// in the tile worker, into each place's cloud cover and the height of its
// top (colder tops are higher: see tileWorker.js clouds). They're drawn as
// stacked shells, LAYERS_KM up: each shows the clouds whose tops reach it,
// so a cloud seen from above shows at its top's height, from below from
// its base, and tall storms have depth. A column's layers share its cover
// between them, so stacked they add up to it.
//
// One equirectangular image, so a shell's uvs are just longitude and
// latitude. Lit by the Sun as the ground is (see tileMaterial.js), seen
// from both sides, drawn after the ground without hiding it from the depth
// buffer.

const LAYERS_KM = [1, 2.5, 4, 5.5, 7, 8.5, 10, 11.5];
const SPACING_KM = 1.5;
const MAX_TOP_KM = 15; // (as the worker encodes heights: 0 to 255 for 0 to this)
const SEGMENTS = [256, 128]; // a shell's grid: around, and pole to pole
const OPACITY = 0.95;

const vertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vUp;
void main() {
  vUv = uv;
  vUp = position; // (ECEF: up is away from the centre, near enough)
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const GROUND_MAX_KM = 6; // (as the worker encodes the ground: 0 to 255 for 0 to this)
const GROUND_CLEARANCE_KM = [0.3, 1.5]; // a layer fades out as the ground (its highest nearby) comes within this of it

const fragmentShader = /* glsl */ `
uniform sampler2D map;
uniform sampler2D ground;
uniform float layerKm;
uniform vec3 sunDirection;
varying vec2 vUv;
varying vec3 vUp;
void main() {
  vec4 t = texture2D(map, vUv);
  float cover = t.r;
  float top = t.g * ${MAX_TOP_KM.toFixed(1)};
  // this layer shows where the cloud's top reaches it (softly, over a layer's spacing)...
  float here = smoothstep(layerKm - ${SPACING_KM.toFixed(2)}, layerKm, top);
  // ...sharing the column's cover with the layers below it (how many: smoothly, not in steps, so no bands)
  float layers = clamp((top - ${LAYERS_KM[0].toFixed(1)}) / ${SPACING_KM.toFixed(1)} + 1.0, 1.0, ${LAYERS_KM.length}.0);
  float a = (1.0 - pow(1.0 - cover * ${OPACITY}, 1.0 / layers)) * here;
  // ...and not where the ground rises into it (mountains through a cloud deck: no hard cut line)
  float groundKm = texture2D(ground, vUv).r * ${GROUND_MAX_KM.toFixed(1)};
  a *= smoothstep(groundKm + ${GROUND_CLEARANCE_KM[0].toFixed(2)}, groundKm + ${GROUND_CLEARANCE_KM[1].toFixed(2)}, layerKm);
  if (a < 0.002) discard;
  // lit as the ground is (day, dusk, night), but a little longer: their tops catch the Sun after it's set below
  float light = ${sunlight('vUp', 0.02)};
  gl_FragColor = vec4(vec3(0.96 * light), a);
  #include <colorspace_fragment>
}
`;

/** A shell `km` above the ellipsoid, uvs of longitude and latitude. */
function shell(km) {
  const [nu, nv] = SEGMENTS;
  const positions = new Float32Array((nu + 1) * (nv + 1) * 3);
  const uvs = new Float32Array((nu + 1) * (nv + 1) * 2);
  const p = [0, 0, 0];
  for (let j = 0; j <= nv; j++) {
    const lat = Math.PI / 2 - (j / nv) * Math.PI;
    for (let i = 0; i <= nu; i++) {
      geodeticToEcef(lat, (i / nu) * 2 * Math.PI - Math.PI, km * 1000, p);
      const k = j * (nu + 1) + i;
      positions.set(p, k * 3);
      uvs[k * 2] = i / nu;
      uvs[k * 2 + 1] = j / nv; // (rows from the north, as the data's are)
    }
  }
  const index = [];
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      index.push(a, a + nu + 1, a + 1, a + 1, a + nu + 1, a + nu + 2);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The clouds (ECEF: a child of the globe's root). `width`: the infrared
 * image's (4096, or 2048 on headsets); `analyse(url)`: the tile worker's
 * cloud analysis, resolving { clouds (RGBA bytes), width, height }.
 */
export function makeClouds(width, analyse) {
  const group = new THREE.Group();
  group.name = 'clouds';
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const materials = LAYERS_KM.map((km, i) => {
    const material = new THREE.ShaderMaterial({
      name: 'Clouds',
      vertexShader,
      fragmentShader,
      uniforms: { map: { value: texture }, ground: { value: texture }, layerKm: { value: km }, sunDirection: sunUniform },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(shell(km), material);
    mesh.renderOrder = 10 + i;
    mesh.raycast = () => {};
    mesh.visible = false; // (until the data's in)
    group.add(mesh);
    return material;
  });
  let current = null;
  let groundTexture = null;
  let gone = false;
  const load = () =>
    analyse(`${CLOUDS.url(width)}&_=${Math.floor(Date.now() / 1000 / CLOUDS.refreshS)}`).then(
      ({ clouds, width: w, height: h, ground, groundWidth }) => {
        if (gone) return;
        if (!groundTexture) {
          groundTexture = new THREE.DataTexture(ground, groundWidth, groundWidth / 2, THREE.RedFormat);
          groundTexture.magFilter = groundTexture.minFilter = THREE.LinearFilter;
          groundTexture.needsUpdate = true;
          for (const m of materials) m.uniforms.ground.value = groundTexture;
        }
        const next = new THREE.DataTexture(clouds, w, h);
        next.magFilter = THREE.LinearFilter;
        next.minFilter = THREE.LinearMipmapLinearFilter;
        next.generateMipmaps = true;
        next.wrapS = THREE.RepeatWrapping;
        next.needsUpdate = true;
        for (const m of materials) m.uniforms.map.value = next;
        current?.dispose();
        current = next;
        for (const mesh of group.children) mesh.visible = true;
      },
      (e) => console.warn('[earth] clouds unavailable:', e?.message ?? e),
    );
  load();
  const timer = setInterval(load, CLOUDS.refreshS * 1000);
  group.userData.dispose = () => {
    gone = true;
    clearInterval(timer);
    for (const mesh of group.children) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    current?.dispose();
    groundTexture?.dispose();
    texture.dispose();
  };
  return group;
}
