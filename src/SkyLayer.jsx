import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GALACTIC_FROM_SKYBOX, J2000_FROM_GALACTIC, MOON_RADIUS, SUN_ANGULAR_RADIUS, fromRaDec, sky, updateSky } from './sky.js';
import { LINES, NAMES } from './constellations.js';

// The sky in its place now (see sky.js): the stars (the skybox, turned to
// them), Map → Constellations (their figures and names), the Sun and the
// Moon. All of them at infinity: drawn round the viewer on a sphere far
// enough out that the eyes' separation doesn't show, then pushed to the far
// plane's depth, so the Earth and its clouds (always nearer) hide them, and
// they never need the far plane moved.

const DEG = Math.PI / 180;
const RADIUS = 1e5; // m: the sphere they're drawn on, round the viewer
const FAR_DEPTH = '0.999999'; // (in front of the background's 1.0; behind everything else)
const BASE = import.meta.env.BASE_URL;
const MOON_URL = `${BASE}img/moon.jpg`; // NASA SVS CGI Moon Kit (LRO), public domain

const LINE_COLOR = new THREE.Color('#7f9cc8');
const LINE_OPACITY = 0.45;
const LABEL_COLOR = '#a9bfe0';
const LABEL_DEG = 1.0; // a name's height (its letters') in the sky
const LABEL_FONT_PX = 34;
const LABEL_ROW_PX = 48;
const ATLAS = [1024, 2048]; // the names' texture: two columns
const GLOW_DEG = 9; // the Sun's glow reaches this far out
const EARTHSHINE = 0.025; // the Moon's dark side, lit faintly by the Earth

// rendered after the ground (opaque), before the clouds (renderOrder 10 and up); the Moon after the Sun, to hide it in an eclipse
const ORDER = { lines: -40, names: -39, sun: -30, moon: -20 };

/** A vertex shader's end: at the far plane. */
const AT_INFINITY = /* glsl */ `gl_Position.z = gl_Position.w * ${FAR_DEPTH};`;

const lineMaterial = () =>
  new THREE.ShaderMaterial({
    name: 'ConstellationLines',
    uniforms: { color: { value: LINE_COLOR }, opacity: { value: LINE_OPACITY } },
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position * ${RADIUS.toFixed(1)}, 1.0);
        ${AT_INFINITY}
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float opacity;
      void main() {
        gl_FragColor = vec4(color, opacity);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });

// Billboards (the names, the Sun): each vertex at a direction (`position`),
// put out by `corner` (rad, across and up the view), so they keep their size
// in the sky and stand upright on the screen.
const BILLBOARD_VERTEX = /* glsl */ `
  attribute vec2 corner;
  varying vec2 vUv;
  varying vec2 vCorner;
  void main() {
    vUv = uv;
    vCorner = corner;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position * ${RADIUS.toFixed(1)}, 1.0);
    gl_Position.xy += vec2(projectionMatrix[0][0], projectionMatrix[1][1]) * corner * gl_Position.w;
    ${AT_INFINITY}
  }`;

/** The constellations' names: one quad each, their letters from one canvas. */
function namesMesh() {
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = ATLAS;
  const ctx = canvas.getContext('2d');
  ctx.font = `500 ${LABEL_FONT_PX}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillStyle = LABEL_COLOR;
  ctx.textBaseline = 'middle';
  const columnW = ATLAS[0] / 2;
  const positions = [];
  const corners = [];
  const uvs = [];
  const index = [];
  const dir = new THREE.Vector3();
  const perPx = (LABEL_DEG * DEG) / LABEL_FONT_PX; // (radians a canvas pixel)
  NAMES.forEach(([name, ra, dec], i) => {
    const column = i % 2;
    const row = Math.floor(i / 2);
    const x0 = column * columnW + 8;
    const y0 = row * LABEL_ROW_PX;
    const w = Math.min(columnW - 16, Math.ceil(ctx.measureText(name).width) + 4);
    ctx.fillText(name, x0 + 2, y0 + LABEL_ROW_PX / 2, columnW - 20);
    fromRaDec(ra * DEG, dec * DEG, dir);
    const hw = (w / 2) * perPx;
    const hh = (LABEL_ROW_PX / 2) * perPx;
    const base = positions.length / 3;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      positions.push(dir.x, dir.y, dir.z);
      corners.push(sx * hw, sy * hh);
      uvs.push((x0 + (sx > 0 ? w : 0)) / ATLAS[0], 1 - (y0 + (sy > 0 ? 0 : LABEL_ROW_PX)) / ATLAS[1]);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('corner', new THREE.Float32BufferAttribute(corners, 2));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.ShaderMaterial({
    name: 'ConstellationNames',
    uniforms: { map: { value: texture } },
    vertexShader: BILLBOARD_VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      void main() {
        vec4 t = texture2D(map, vUv);
        if (t.a < 0.01) discard;
        gl_FragColor = vec4(t.rgb, t.a * 0.85);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = ORDER.names;
  return mesh;
}

/** The constellations' figures and names, in the stars' frame (J2000). */
function constellationsGroup() {
  const group = new THREE.Group();
  group.name = 'constellations';
  const positions = new Float32Array((LINES.length / 2) * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < LINES.length / 2; i++) {
    fromRaDec(LINES[i * 2] * DEG, LINES[i * 2 + 1] * DEG, v);
    positions.set([v.x, v.y, v.z], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const lines = new THREE.LineSegments(geometry, lineMaterial());
  lines.frustumCulled = false;
  lines.renderOrder = ORDER.lines;
  group.add(lines, namesMesh());
  return group;
}

/** The Sun: a disc its true size, and a glow round it (added to what's behind). */
function sunMesh() {
  const g = GLOW_DEG * DEG;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Array(12).fill(0), 3));
  geometry.setAttribute('corner', new THREE.Float32BufferAttribute([-g, -g, g, -g, g, g, -g, g], 2));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const material = new THREE.ShaderMaterial({
    name: 'Sun',
    vertexShader: BILLBOARD_VERTEX,
    fragmentShader: /* glsl */ `
      varying vec2 vCorner;
      void main() {
        float r = length(vCorner) / ${DEG.toFixed(8)}; // degrees from its centre
        float disc = 1.0 - smoothstep(${(SUN_ANGULAR_RADIUS / DEG) * 0.92}, ${(SUN_ANGULAR_RADIUS / DEG) * 1.06}, r);
        float glow = 0.55 * exp(-r / 0.35) + 0.14 * exp(-r / 1.6) + 0.04 * exp(-r / 4.5);
        glow *= 1.0 - smoothstep(${GLOW_DEG * 0.7}, ${GLOW_DEG}.0, r);
        vec3 color = vec3(1.0, 0.97, 0.9) * disc * 1.6 + vec3(1.0, 0.86, 0.62) * glow;
        gl_FragColor = vec4(color, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = ORDER.sun;
  return mesh;
}

/** The Moon: a sphere (its near side, lon 0, toward the Earth), lit by the Sun, so in its phase. */
function moonMesh() {
  const texture = new THREE.TextureLoader().load(MOON_URL);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.ShaderMaterial({
    name: 'Moon',
    uniforms: { map: { value: texture }, sun: { value: new THREE.Vector3(1, 0, 0) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        ${AT_INFINITY}
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 sun; // (world)
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vec3 albedo = texture2D(map, vUv).rgb;
        float light = max(dot(normalize(vNormal), sun), 0.0);
        gl_FragColor = vec4(albedo * (1.25 * light + ${EARTHSHINE}), 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true, // (drawn among the sky's things, in order: after the Sun)
    depthWrite: false,
  });
  // (three's sphere: u = 0.5 along +X, the map's longitude 0; +Y north)
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = ORDER.moon;
  return mesh;
}

const _cam = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _sun = new THREE.Vector3();
const _toEarth = new THREE.Vector3();
const _north = new THREE.Vector3();
const _west = new THREE.Vector3();
const _bg = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _viewer = new THREE.Vector3();
const _moon = new THREE.Vector3();
const SKYBOX_TO_J2000 = J2000_FROM_GALACTIC.clone().multiply(GALACTIC_FROM_SKYBOX);
const EARTH_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * `pose`: the Earth's (EarthPose); `stars`: the starry background shows
 * (turn the constellations off with it); `constellations`: Map →
 * Constellations; `bodies`: the Sun and the Moon show (not over passthrough).
 */
export function SkyLayer({ pose, stars, constellations, bodies }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const things = useMemo(() => ({ constellations: constellationsGroup(), sun: sunMesh(), moon: moonMesh() }), []);
  const root = useRef(null);

  useEffect(
    () => () => {
      things.constellations.traverse((o) => {
        o.geometry?.dispose();
        o.material?.uniforms?.map?.value?.dispose();
        o.material?.dispose();
      });
      for (const mesh of [things.sun, things.moon]) {
        mesh.geometry.dispose();
        mesh.material.uniforms?.map?.value?.dispose();
        mesh.material.dispose();
      }
    },
    [things],
  );

  useFrame((state) => {
    updateSky();
    // the stars' frame (J2000) in the world: the Earth's turn, after the sky's turn into the Earth's frame now
    const starsToWorld = _q.multiplyQuaternions(pose.q, sky.stars);
    // the skybox behind (three.js looks a world direction up as the background's rotation, transposed: so, the texture's frame into the world's)
    scene.backgroundRotation.setFromQuaternion(_bg.multiplyQuaternions(starsToWorld, SKYBOX_TO_J2000));
    const camera = gl.xr.isPresenting ? gl.xr.getCamera() : state.camera;
    camera.getWorldPosition(_cam);
    root.current?.position.copy(_cam);

    const c = things.constellations;
    c.visible = stars && constellations;
    c.quaternion.copy(starsToWorld);

    _sun.copy(sky.sun).applyQuaternion(pose.q); // (world)
    things.sun.visible = bodies;
    // (the quad's four corners all at the Sun's direction; `corner` spreads them)
    const p = things.sun.geometry.attributes.position;
    for (let i = 0; i < 4; i++) p.setXYZ(i, _sun.x, _sun.y, _sun.z);
    p.needsUpdate = true;

    // the Moon, seen from where you are (it's near enough that that matters: up to a degree)
    const moon = things.moon;
    moon.visible = bodies;
    pose.toEcef(_cam, _viewer);
    _moon.copy(sky.moon).sub(_viewer); // (ECEF, m)
    const distance = _moon.length();
    _moon.divideScalar(distance).applyQuaternion(pose.q); // (world, a unit vector)
    moon.position.copy(_moon).multiplyScalar(RADIUS);
    moon.scale.setScalar(RADIUS * Math.tan(Math.asin(Math.min(1, MOON_RADIUS / distance))));
    // its near side toward the Earth's centre, its north the Earth's (near enough: they're 1.5° apart)
    _toEarth.copy(sky.moon).negate().normalize().applyQuaternion(pose.q);
    _north.copy(EARTH_AXIS).applyQuaternion(pose.q);
    _north.addScaledVector(_toEarth, -_north.dot(_toEarth)).normalize();
    // (three's sphere: longitude 0 along +X, north +Y, so +Z is longitude -90°: west)
    _west.crossVectors(_toEarth, _north);
    moon.quaternion.setFromRotationMatrix(_m.makeBasis(_toEarth, _north, _west));
    moon.material.uniforms.sun.value.copy(_sun);
  });

  return (
    <group ref={root}>
      <primitive object={things.constellations} />
      <primitive object={things.sun} />
      <primitive object={things.moon} />
    </group>
  );
}

/** The Sun's direction in the world (a unit vector), into `out`: for lights. */
export const sunInWorld = (pose, out = new THREE.Vector3()) => out.copy(sky.sun).applyQuaternion(pose.q);
