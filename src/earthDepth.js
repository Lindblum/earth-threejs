import * as THREE from 'three';

// The Earth's own depth range. The camera's near plane stays a few centimetres
// off (hands, controllers and panels are close), so with the ground kilometres
// away, the depth buffer has next to no precision left out there: far tiles'
// skirts showed through the ground in front of them, and surfaces fought.
//
// So when nothing of the Earth (ground or clouds) is within reach, it's drawn
// as if the near plane were out near it (a share of the way to its nearest
// tile: each Earth shader sets its clip z from its depth with that near
// plane, so precision goes where the Earth is). Then the depth buffer is cleared,
// and everything else (hands, panels) is drawn over it: none of it can be
// behind any ground then. Up close, the Earth is drawn with the camera's own
// range, and in the same depth buffer as the rest.
//
// (Drawing order: the sky first (SkyLayer), then the Earth, then the clear,
// then all the rest, in the opaque list by renderOrder: so the Earth's things,
// clouds included, are opaque materials with their own blending.)

export const EARTH_ORDER = { base: -130, tiles: -120, clouds: -110, clear: -50 };

const REACH = 4; // world m: the Earth's nearest further than this, and it's drawn in its own range
const SHARE = 0.3; // its near plane this share of the way to the nearest of it

export const earthDepthUniforms = { earthDepth: { value: new THREE.Vector2(1, 0) } };

/** For an Earth material's vertex shader: its uniform, and the line after gl_Position is set. */
export const EARTH_DEPTH_PARS = 'uniform vec2 earthDepth;';
export const EARTH_DEPTH = 'gl_Position.z = earthDepth.x * gl_Position.w + earthDepth.y;';

/** Blending as three's normal (for the clouds, opaque materials). */
export const OVER_BLENDING = { blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor };

const state = { apart: false };
const _viewport = new THREE.Vector4();

/**
 * Sets the Earth's depth range for this frame: `nearest` (world m) the
 * nearest of the Earth to the eye, `near` and `far` the camera's planes.
 */
export function setEarthDepth(nearest, near, far) {
  state.apart = nearest > REACH;
  const n = state.apart ? Math.min(Math.max(near, nearest * SHARE), far * 0.5) : near;
  // clip z = a w + b: OpenGL's perspective projection, its near plane at n
  earthDepthUniforms.earthDepth.value.set((far + n) / (far - n), (-2 * far * n) / (far - n));
}

/** Whether the Earth's drawn in its own range (for tests). */
export const earthApart = () => state.apart;

/** The clear between the Earth and the rest: drawn (as nothing) in the opaque list after the Earth. */
export function depthClear() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }));
  mesh.name = 'earth-depth-clear';
  mesh.frustumCulled = false;
  mesh.renderOrder = EARTH_ORDER.clear;
  mesh.raycast = () => {};
  mesh.onBeforeRender = (renderer) => {
    if (!state.apart) return;
    // only this view's (each eye's drawn in turn into one buffer, or both at once)
    const target = renderer.getRenderTarget();
    const scissored = target ? target.scissorTest : renderer.getScissorTest();
    if (scissored) return renderer.clearDepth();
    renderer.getCurrentViewport(_viewport);
    renderer.state.scissor(_viewport);
    renderer.state.setScissorTest(true);
    renderer.clearDepth();
    renderer.state.setScissorTest(false);
  };
  return mesh;
}
