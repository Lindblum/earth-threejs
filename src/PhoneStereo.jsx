import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CardboardLens } from './CardboardLens.js';

// Stereo on top of a phone's WebXR AR session. ARCore supplies full 6DoF
// tracking, so the model stays where it is in the room and you can walk
// around it, but a phone session has a single view. Here that view is split
// into two eyes for a Cardboard-style viewer, with the viewer's lens optics
// (see CardboardLens).
//
// three.js builds its XR camera from the session's views each frame and then
// calls renderer.xr.updateCamera(); while this component is mounted that call
// is replaced with one that derives two eye cameras from the tracked pose.
//
// Chrome keeps an AR session in the orientation it started in, so a session
// begun with the phone upright stays portrait after the phone goes sideways
// into a viewer. The eyes are then laid out along the screen's long side,
// rolled 90 degrees so they are upright for the person holding it.

/**
 * This frame's eye layout: `width` x `height` is the landscape side-by-side
 * image; `rotation` turns it onto the framebuffer (0 landscape, +1 / -1
 * portrait with the phone turned one way or the other).
 */
const layout = { width: 1, height: 1, rotation: 0 };
const _roll = new THREE.Matrix4();

function updateLayout(gl, framebufferWidth, framebufferHeight) {
  const portrait = framebufferHeight > framebufferWidth;
  if (!portrait) {
    layout.rotation = 0;
  } else {
    // which way the screen's x axis points in the room: up or down
    const screenRightUp = gl.xr.getCamera().matrix.elements[1];
    if (Math.abs(screenRightUp) > 0.3) layout.rotation = screenRightUp > 0 ? -1 : 1;
    else if (layout.rotation === 0) layout.rotation = 1; // held flat: keep a sideways layout
  }
  layout.width = portrait ? framebufferHeight : framebufferWidth;
  layout.height = portrait ? framebufferWidth : framebufferHeight;
}

/**
 * The phone AR session's options: the library's defaults plus raw camera
 * access, for passthrough in stereo, and a DOM overlay on `overlayRoot`, so
 * the single view (Phone AR) shows the page's own menu over the scene.
 */
export function phoneARSessionInit(overlayRoot) {
  return {
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['camera-access', 'dom-overlay', 'anchors', 'hit-test', 'plane-detection', 'mesh-detection', 'hand-tracking'],
    domOverlay: { root: overlayRoot },
  };
}

export function PhoneStereoXR() {
  const gl = useThree((s) => s.gl);
  const lens = useMemo(() => new CardboardLens(), []);
  useEffect(() => () => lens.dispose(), [lens]);

  // Render the two eyes (via the camera override below) into an offscreen
  // image the size of the XR framebuffer, then draw it through the lens warp
  // into that framebuffer. Priority > 0: R3F skips its own render.
  useFrame(({ scene, camera }) => {
    const xrTarget = gl.getRenderTarget(); // the session's framebuffer, bound by three for this frame
    if (!xrTarget) return;
    updateLayout(gl, xrTarget.width, xrTarget.height);
    lens.setLayout(layout.width, layout.height, layout.rotation);
    gl.setRenderTarget(lens.target);
    gl.render(scene, camera);
    // a plain full-screen pass: keep three from substituting the XR camera
    gl.xr.enabled = false;
    gl.setRenderTarget(xrTarget);
    lens.render(gl);
    gl.xr.enabled = true;
  }, 1);

  useEffect(() => {
    const xr = gl.xr;
    const original = xr.updateCamera;
    // three's own per-view cameras, put back when stereo is switched off
    const originalCameras = [...xr.getCamera().cameras];
    const head = new THREE.Matrix4();
    // a wide square frustum covers both eyes in either layout, for culling
    const culling = new THREE.PerspectiveCamera(150, 1, 0.05, 1000);
    const eyes = [0, 1].map((i) => {
      const eye = new THREE.PerspectiveCamera();
      eye.matrixAutoUpdate = false;
      eye.viewport = new THREE.Vector4();
      eye.layers.enable(i + 1);
      return eye;
    });
    const parentInverse = new THREE.Matrix4();

    xr.updateCamera = function updatePhoneStereoCamera(camera) {
      const cameraXR = xr.getCamera();
      if (!cameraXR.cameras[0]?.viewport) return original.call(xr, camera);

      const parent = camera.parent;
      cameraXR.matrixWorld.copy(cameraXR.matrix);
      if (parent) cameraXR.matrixWorld.premultiply(parent.matrixWorld);
      cameraXR.matrixWorldInverse.copy(cameraXR.matrixWorld).invert();

      // eyes side by side in the landscape layout (offscreen, from 0,0)
      const eyeWidth = layout.width / 2;
      const height = layout.height;
      culling.near = camera.near;
      culling.far = camera.far;
      // roll the head with the phone so the eyes sit along its long side
      head.copy(cameraXR.matrixWorld).multiply(_roll.makeRotationZ((layout.rotation * Math.PI) / 2));
      eyes.forEach((eye, i) => {
        lens.eyeCamera(i, head, camera.near, camera.far, eye);
        eye.viewport.set(i * eyeWidth, 0, eyeWidth, height);
      });
      cameraXR.cameras.length = 0;
      cameraXR.cameras.push(...eyes);

      culling.updateProjectionMatrix();
      cameraXR.projectionMatrix.copy(culling.projectionMatrix);
      cameraXR.projectionMatrixInverse.copy(culling.projectionMatrixInverse);

      // the app's camera follows the head (the gaze reticle reads it)
      if (parent) camera.matrix.copy(parentInverse.copy(parent.matrixWorld).invert()).multiply(cameraXR.matrixWorld);
      else camera.matrix.copy(cameraXR.matrixWorld);
      camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
      camera.updateMatrixWorld(true);
      camera.projectionMatrix.copy(cameraXR.projectionMatrix);
      camera.projectionMatrixInverse.copy(cameraXR.projectionMatrixInverse);
    };

    return () => {
      xr.updateCamera = original;
      const cameras = xr.getCamera().cameras;
      cameras.length = 0;
      cameras.push(...originalCameras);
    };
  }, [gl, lens]);

  return null;
}

/**
 * Passthrough for the split view: draws the AR camera frame (WebXR raw
 * camera access) behind the scene in each eye, centre-cropped to the eye.
 * Without it the browser composites one full-screen camera image that
 * would not line up with the two eyes.
 */
export function PhoneStereoCameraFeed({ onUnavailable }) {
  const gl = useThree((s) => s.gl);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { map: { value: null }, uvScale: { value: new THREE.Vector2(1, 1) }, rotation: { value: 0 } },
        // a full-viewport quad at the far plane, independent of the camera
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 1.0, 1.0);
          }`,
        // the camera image is sRGB; the scene is drawn in linear light into the
        // lens-correction image, which converts back to sRGB on output
        fragmentShader: /* glsl */ `
          uniform sampler2D map;
          uniform vec2 uvScale;
          uniform float rotation;
          varying vec2 vUv;
          vec3 srgbToLinear(vec3 c) {
            return mix(c * 0.0773993808, pow(c * 0.9478672986 + 0.0521327014, vec3(2.4)), step(vec3(0.04045), c));
          }
          void main() {
            // eye position -> screen orientation (the camera image is screen-aligned)
            vec2 s = vUv;
            if (rotation > 0.5) s = vec2(1.0 - vUv.y, vUv.x);
            else if (rotation < -0.5) s = vec2(vUv.y, 1.0 - vUv.x);
            vec4 c = texture2D(map, (s - 0.5) * uvScale + 0.5);
            gl_FragColor = vec4(srgbToLinear(c.rgb), 1.0);
          }`,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );
  const geometry = useMemo(() => new THREE.PlaneGeometry(2, 2), []);
  useEffect(
    () => () => {
      material.dispose();
      geometry.dispose();
    },
    [material, geometry],
  );

  const mesh = useRef(null);
  // give the camera a moment to deliver its first frame before giving up
  const watch = useMemo(() => ({ waited: 0, gotFrame: false, reported: false }), []);
  useFrame((_, dt) => {
    const frame = gl.xr.getFrame();
    const session = gl.xr.getSession();
    if (!frame || !session) return;
    const xrCamera = frame.getViewerPose(gl.xr.getReferenceSpace())?.views[0]?.camera;
    const texture = xrCamera && gl.xr.getCameraTexture(xrCamera);
    if (texture?.sourceTexture) watch.gotFrame = true;
    watch.waited += dt;
    const unsupported = !session.enabledFeatures?.includes('camera-access');
    if (!watch.reported && !watch.gotFrame && (unsupported || watch.waited > 2)) {
      watch.reported = true;
      onUnavailable?.(unsupported ? 'camera-access not granted' : 'no camera frames');
    }
    material.uniforms.map.value = texture ?? null;
    mesh.current.visible = Boolean(texture?.sourceTexture);
    material.uniforms.rotation.value = layout.rotation;
    if (xrCamera?.width && xrCamera?.height) {
      // cover each eye with the camera image; measured as the eye sits on the screen
      const eyeAspect = layout.rotation === 0 ? layout.width / 2 / layout.height : layout.height / (layout.width / 2);
      const imageAspect = xrCamera.width / xrCamera.height;
      if (imageAspect > eyeAspect) material.uniforms.uvScale.value.set(eyeAspect / imageAspect, 1);
      else material.uniforms.uvScale.value.set(1, imageAspect / eyeAspect);
    }
  });

  return <mesh ref={mesh} visible={false} geometry={geometry} material={material} frustumCulled={false} renderOrder={-1000} />;
}
