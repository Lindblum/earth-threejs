import * as THREE from 'three';
import { geodeticToEcef, surfaceNormal } from './geo.js';
import { RG, atmosphereUniforms } from './atmosphere.js';

// The ground round the viewer as a height map, for the clouds: so each cloud
// layer fades out softly just above the ground as drawn (a mountain rising
// into it), not cut by it in a hard line. The world's coarse height map (the
// tile worker's groundMap) does that everywhere else, but at its scale the
// peaks are averaged away (the Alps come out 2 km low).
//
// Now and then the tiles drawn (only they: CAPTURE_LAYER) are drawn again,
// from straight above the ground beneath the viewer, into a small texture of
// their heights (km; alpha 1 where there's ground).

export const CAPTURE_LAYER = 1;
const SIZE = 512; // texels a side
const EVERY_S = 0.4;
const REACH = [30, 400]; // km: the half-width covered, from low down to high up...
const REACH_PER_HEIGHT = 40; // ...this many times the viewer's height
const HIGHEST_VIEWER_KM = 600; // higher up, the clouds are too far off for it to matter
const ABOVE_M = 12000; // the capture's camera: this high over the ellipsoid
const BELOW_M = 1000; // ...seeing down to this far under it (and the Earth's curve)

const vertexShader = /* glsl */ `
uniform mat4 ecefFromWorld;
varying float vHeight;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 ecef = (ecefFromWorld * world).xyz;
  vHeight = length(ecef * vec3(1.0, 1.0, ${(6378137 / 6356752.314245).toFixed(9)}) / 1000.0) - ${RG.toFixed(3)};
  gl_Position = projectionMatrix * viewMatrix * world;
}`;
const fragmentShader = /* glsl */ `
varying float vHeight;
void main() { gl_FragColor = vec4(vHeight, 0.0, 0.0, 1.0); }`;

const _c = new THREE.Vector3();
const _up = new THREE.Vector3();
const _north = new THREE.Vector3();
const _east = new THREE.Vector3();
const _w = new THREE.Vector3();
const _clear = new THREE.Color();
const arr = [0, 0, 0];

export class GroundCapture {
  constructor() {
    this.target = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.camera = new THREE.OrthographicCamera();
    this.camera.layers.set(CAPTURE_LAYER);
    this.material = new THREE.ShaderMaterial({ name: 'GroundHeight', vertexShader, fragmentShader, uniforms: { ecefFromWorld: atmosphereUniforms.ecefFromWorld } });
    // for the clouds' shader: the map, its centre (ECEF, m), its east and north, its half-width (m); `on` 0 until there's one
    this.uniforms = {
      localGround: { value: this.target.texture },
      localCenter: { value: new THREE.Vector3() },
      localEast: { value: new THREE.Vector3(1, 0, 0) },
      localNorth: { value: new THREE.Vector3(0, 1, 0) },
      localHalf: { value: 1 },
      localOn: { value: 0 },
    };
    this.last = -Infinity;
  }

  /** Captures again if it's time: `viewer` the Globe's ({ lat, lon, h }), `pose` the Earth's, `scene` the one the tiles are in. */
  update(renderer, scene, viewer, pose, now) {
    if (viewer.h / 1000 > HIGHEST_VIEWER_KM) {
      this.uniforms.localOn.value = 0;
      return;
    }
    if (now - this.last < EVERY_S) return;
    this.last = now;
    const halfKm = THREE.MathUtils.clamp((Math.max(0, viewer.h) / 1000) * REACH_PER_HEIGHT, REACH[0], REACH[1]);
    const half = halfKm * 1000;
    // the ground beneath the viewer (ECEF), its up, north and east
    _c.fromArray(geodeticToEcef(viewer.lat, viewer.lon, 0, arr));
    _up.fromArray(surfaceNormal(viewer.lat, viewer.lon));
    _east.set(-Math.sin(viewer.lon), Math.cos(viewer.lon), 0);
    _north.crossVectors(_up, _east);
    // the camera: in the world, straight above it, north up the image (so east across)
    const s = pose.scale;
    const cam = this.camera;
    pose.toWorld(_w.copy(_up).multiplyScalar(ABOVE_M).add(_c), cam.position);
    cam.up.copy(_north).applyQuaternion(pose.q);
    cam.lookAt(pose.toWorld(_c, _w));
    cam.left = -half * s;
    cam.right = half * s;
    cam.top = half * s;
    cam.bottom = -half * s;
    cam.near = 0;
    cam.far = (ABOVE_M + BELOW_M + (half * half) / (2 * RG * 1000)) * s;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // drawn into the map: only the tiles, as heights, nothing behind (and not to the headset)
    const xr = renderer.xr.enabled;
    const target = renderer.getRenderTarget();
    const background = scene.background;
    const override = scene.overrideMaterial;
    renderer.getClearColor(_clear);
    const alpha = renderer.getClearAlpha();
    renderer.xr.enabled = false;
    scene.background = null;
    scene.overrideMaterial = this.material;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(target);
    renderer.setClearColor(_clear, alpha);
    scene.overrideMaterial = override;
    scene.background = background;
    renderer.xr.enabled = xr;

    const u = this.uniforms;
    u.localCenter.value.copy(_c);
    u.localEast.value.copy(_east);
    u.localNorth.value.copy(_north);
    u.localHalf.value = half;
    u.localOn.value = 1;
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
  }
}
