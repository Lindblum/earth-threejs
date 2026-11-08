import * as THREE from 'three';
import { CLOUDS } from './sources.js';
import { geodeticToEcef } from './geo.js';
import { ATMOSPHERE_GLSL, atmosphereUniforms } from './atmosphere.js';
import { EARTH_DEPTH, EARTH_DEPTH_PARS, EARTH_ORDER, OVER_BLENDING, earthDepthUniforms } from './earthDepth.js';

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
// Where the ground comes up into a layer, the layer fades out over its last
// few hundred metres above it: the ground as drawn round the viewer (see
// groundCapture.js), the world's coarse height map further off. And a layer
// fades out close round the eye (flying through it, it doesn't slice the view).
//
// One equirectangular image, so a shell's uvs are just longitude and
// latitude. Lit by the Sun as the ground is, reddening at sunrise and sunset,
// and seen through the air (see atmosphere.js). Drawn after the ground
// without hiding it from the depth buffer, pulled a little toward the eye in
// it (so a cloud deck lying on the ground wins, however coarse the depth);
// seen from outside (above it) only its near side, from inside only its
// underside.

const LAYERS_KM = [1, 2.5, 4, 5.5, 7, 8.5, 10, 11.5];
const SPACING_KM = 1.5;
const MAX_TOP_KM = 15; // (as the worker encodes heights: 0 to 255 for 0 to this)
const SEGMENTS = [256, 128]; // a shell's grid: around, and pole to pole
const OPACITY = 0.95;

const vertexShader = /* glsl */ `
${EARTH_DEPTH_PARS}
varying vec2 vUv;
varying vec3 vEcef;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vEcef = position;
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${EARTH_DEPTH}
}
`;
const GROUND_MAX_KM = 6; // (as the worker encodes the ground: 0 to 255 for 0 to this)
const COARSE_PEAKS = 1.4; // the coarse map's ground, raised: its peaks are averaged down (the Alps' by 2 km)
const CLEARANCE_KM = { coarse: [0.3, 1.5], local: [0.05, 0.6] }; // a layer fades out as the ground comes within this of it
const NEAR_KM = [0.2, 1.5]; // ...and as the eye does
const AIR_STEPS = 4;

const fragmentShader = /* glsl */ `
uniform sampler2D map;
uniform sampler2D ground;
uniform float layerKm;
uniform sampler2D localGround;
uniform vec3 localCenter;
uniform vec3 localEast;
uniform vec3 localNorth;
uniform float localHalf;
uniform float localOn;
varying vec2 vUv;
varying vec3 vEcef;
varying vec3 vWorld;
${ATMOSPHERE_GLSL}
void main() {
  vec4 t = texture2D(map, vUv);
  float cover = t.r;
  float top = t.g * ${MAX_TOP_KM.toFixed(1)};
  // this layer shows where the cloud's top reaches it (softly, over a layer's spacing)...
  float here = smoothstep(layerKm - ${SPACING_KM.toFixed(2)}, layerKm, top);
  // ...sharing the column's cover with the layers below it (how many: smoothly, not in steps, so no bands)
  float layers = clamp((top - ${LAYERS_KM[0].toFixed(1)}) / ${SPACING_KM.toFixed(1)} + 1.0, 1.0, ${LAYERS_KM.length}.0);
  float a = (1.0 - pow(1.0 - cover * ${OPACITY}, 1.0 / layers)) * here;
  // ...and not where the ground rises into it (mountains through a cloud deck: no hard cut line): the ground
  // as drawn round the viewer, or the world's coarse map
  vec3 p = atmoStretch(vEcef);
  float altitude = altitudeKm(p);
  float coarse = texture2D(ground, vUv).r * ${(GROUND_MAX_KM * COARSE_PEAKS).toFixed(2)};
  vec2 at = 0.5 + 0.5 * vec2(dot(vEcef - localCenter, localEast), dot(vEcef - localCenter, localNorth)) / localHalf;
  vec4 local = texture2D(localGround, clamp(at, 0.0, 1.0));
  float edge = max(abs(at.x - 0.5), abs(at.y - 0.5));
  float drawn = localOn * smoothstep(0.5, 0.95, local.a) * (1.0 - smoothstep(0.4, 0.49, edge));
  float groundKm = mix(coarse, local.r / max(local.a, 1e-3), drawn);
  a *= smoothstep(groundKm + mix(${CLEARANCE_KM.coarse[0].toFixed(2)}, ${CLEARANCE_KM.local[0].toFixed(2)}, drawn), groundKm + mix(${CLEARANCE_KM.coarse[1].toFixed(2)}, ${CLEARANCE_KM.local[1].toFixed(2)}, drawn), altitude);
  // the eye's way: from here, through the air
  vec3 toHere = mat3(ecefFromWorld) * (vWorld - cameraPosition) * (STRETCH / 1000.0);
  float distance = length(toHere);
  a *= smoothstep(${NEAR_KM[0].toFixed(2)}, ${NEAR_KM[1].toFixed(2)}, distance);
  if (a < 0.002) discard;
  // lit as the ground is (day, sunset, night), but a little longer: their tops catch the Sun after it's set below
  vec3 light = sunlightAt(p, 0.02);
  vec3 L, T;
  atmosphere(atmoCamera(), toHere / max(distance, 1e-9), distance, ${AIR_STEPS}, L, T);
  gl_FragColor = vec4(atmoOver(0.96 * light, L, T), a);
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
 * cloud analysis, resolving { clouds (RGBA bytes), width, height };
 * `localGround`: the ground round the viewer's uniforms (GroundCapture's).
 * group.userData.follow(viewerHeight) each frame (m): which sides show; it
 * returns how far off the nearest layer that shows is (m; Infinity if none).
 */
export function makeClouds(width, analyse, localGround) {
  const group = new THREE.Group();
  group.name = 'clouds';
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const materials = LAYERS_KM.map((km, i) => {
    const material = new THREE.ShaderMaterial({
      name: 'Clouds',
      vertexShader,
      fragmentShader,
      uniforms: { map: { value: texture }, ground: { value: texture }, layerKm: { value: km }, ...atmosphereUniforms, ...localGround, ...earthDepthUniforms },
      transparent: false, // (drawn with the Earth, before the rest: see earthDepth.js)
      ...OVER_BLENDING,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -8,
    });
    const mesh = new THREE.Mesh(shell(km), material);
    mesh.renderOrder = EARTH_ORDER.clouds + i;
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
  group.userData.follow = (viewerHeight) => {
    LAYERS_KM.forEach((km, i) => {
      materials[i].side = viewerHeight > km * 1000 ? THREE.FrontSide : THREE.BackSide;
    });
    if (!group.visible || !group.children[0].visible) return Infinity;
    // (a layer's gone within NEAR_KM[0] of the eye)
    return Math.max(NEAR_KM[0] * 1000, Math.min(...LAYERS_KM.map((km) => Math.abs(viewerHeight - km * 1000))));
  };
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
