import * as THREE from 'three';

// Phone-in-a-viewer stereo, modelled on the Cardboard SDK / WebVR polyfill.
//
// Each eye looks through a lens at its half of the screen. From the viewer's
// geometry and the screen's physical size we know where each lens sits on
// the screen and how far away it is, so every screen point maps to a viewing
// direction (in tangent units). The lens bends that direction outward:
// tan_seen = r (1 + k1 r^2 + k2 r^4). Each eye is rendered with the exact
// asymmetric frustum it can see, then every screen pixel samples the rendered
// eye in the direction the lens sends it. Matching the real optics this way
// is what keeps the scene still as the head turns; any mismatch shows up as
// the world swimming.

/**
 * Google Cardboard v2 (2015), the profile most current viewers follow, with
 * the lenses 1 cm closer than its 64 mm: at 64 mm the eye images sat too far
 * apart to fuse in practice. Lengths in metres.
 */
export const VIEWER = {
  interLensDistance: 0.054,
  baselineLensDistance: 0.035, // lens centres above the bottom of the screen tray
  screenLensDistance: 0.039,
  distortion: [0.34, 0.55],
  maxFovDeg: 60, // each way from the lens centre
};

const BEVEL = 0.003; // phone bezel below the screen, metres
const METRES_PER_CSS_PX = 0.0254 / 160; // Android CSS pixels are density-independent (160 per inch)

function distort(r) {
  const [k1, k2] = VIEWER.distortion;
  const r2 = r * r;
  return r * (1 + k1 * r2 + k2 * r2 * r2);
}

/** The phone screen's physical size in landscape, estimated from its CSS pixel size. */
export function screenMetres() {
  const long = Math.max(window.screen.width, window.screen.height);
  const short = Math.min(window.screen.width, window.screen.height);
  return { width: long * METRES_PER_CSS_PX, height: short * METRES_PER_CSS_PX };
}

/**
 * Tangents of the left eye's view limits: outer (away from the nose), inner,
 * down, up, each capped at the lens's field of view. The right eye mirrors it.
 */
export function leftEyeTangents(screen = screenMetres()) {
  const d = VIEWER.screenLensDistance;
  const cap = Math.tan(THREE.MathUtils.degToRad(VIEWER.maxFovDeg));
  const lensY = VIEWER.baselineLensDistance - BEVEL;
  const outer = (screen.width - VIEWER.interLensDistance) / 2;
  const inner = VIEWER.interLensDistance / 2;
  return {
    outer: Math.min(distort(outer / d), cap),
    inner: Math.min(distort(inner / d), cap),
    down: Math.min(distort(lensY / d), cap),
    up: Math.min(distort((screen.height - lensY) / d), cap),
  };
}

const _offset = new THREE.Matrix4();

export class CardboardLens {
  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
    this.tangents = leftEyeTangents();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tEyes: { value: this.target.texture },
        screenSize: { value: new THREE.Vector2(1, 1) }, // metres, landscape
        lensY: { value: VIEWER.baselineLensDistance - BEVEL },
        interLens: { value: VIEWER.interLensDistance },
        lensDistance: { value: VIEWER.screenLensDistance },
        k: { value: new THREE.Vector2(...VIEWER.distortion) },
        tangents: { value: new THREE.Vector4() }, // left eye: outer, inner, down, up
        // 0: output as laid out; +1 / -1: the layout is landscape but the
        // output portrait (a phone turned sideways), so turn by 90 degrees
        rotation: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tEyes;
        uniform vec2 screenSize;
        uniform float lensY;
        uniform float interLens;
        uniform float lensDistance;
        uniform vec2 k;
        uniform vec4 tangents;
        uniform float rotation;
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          if (rotation > 0.5) uv = vec2(vUv.y, 1.0 - vUv.x);
          else if (rotation < -0.5) uv = vec2(1.0 - vUv.y, vUv.x);
          vec2 pos = uv * screenSize; // metres from the bottom-left of the screen
          float eye = pos.x < screenSize.x * 0.5 ? 0.0 : 1.0;
          float lensX = screenSize.x * 0.5 + (eye - 0.5) * interLens;
          vec2 s = (pos - vec2(lensX, lensY)) / lensDistance; // direction to this pixel, tangent units
          float r2 = dot(s, s);
          vec2 t = s * (1.0 + k.x * r2 + k.y * r2 * r2); // where the lens makes it appear
          // this eye's limits: the left eye's outer side is its left, the right eye's its right
          float left = eye < 0.5 ? tangents.x : tangents.y;
          float right = eye < 0.5 ? tangents.y : tangents.x;
          vec2 e = vec2((t.x + left) / (left + right), (t.y + tangents.z) / (tangents.z + tangents.w));
          if (e.x < 0.0 || e.x > 1.0 || e.y < 0.0 || e.y > 1.0) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          } else {
            gl_FragColor = texture2D(tEyes, vec2((e.x + eye) * 0.5, e.y));
          }
          #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  /**
   * Pixel size of the side-by-side eye image (landscape) and how it is
   * turned onto the output. The physical screen size is re-read each time,
   * so it follows the phone.
   */
  setLayout(width, height, rotation = 0) {
    if (this.target.width !== width || this.target.height !== height) this.target.setSize(width, height);
    const screen = screenMetres();
    this.tangents = leftEyeTangents(screen);
    const u = this.material.uniforms;
    u.screenSize.value.set(screen.width, screen.height);
    u.tangents.value.set(this.tangents.outer, this.tangents.inner, this.tangents.down, this.tangents.up);
    u.rotation.value = rotation;
  }

  /**
   * Point `eye` (0 left, 1 right) from the head: offset half the lens
   * spacing sideways, with the frustum that eye's lens can see. Sets the
   * eye's matrix, matrixWorld (+ inverse) and projection.
   */
  eyeCamera(index, headMatrixWorld, near, far, eye) {
    const side = index === 0 ? -1 : 1;
    eye.matrix.copy(headMatrixWorld).multiply(_offset.makeTranslation((side * VIEWER.interLensDistance) / 2, 0, 0));
    eye.matrixWorld.copy(eye.matrix);
    eye.matrixWorldInverse.copy(eye.matrixWorld).invert();
    const { outer, inner, down, up } = this.tangents;
    const left = index === 0 ? outer : inner;
    const right = index === 0 ? inner : outer;
    eye.projectionMatrix.makePerspective(-left * near, right * near, up * near, -down * near, near, far);
    eye.projectionMatrixInverse.copy(eye.projectionMatrix).invert();
  }

  /** Draw both eyes through the lens model to the current render target. */
  render(gl) {
    gl.render(this.scene, this.camera);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
