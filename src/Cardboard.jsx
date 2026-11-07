import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CardboardLens } from './CardboardLens.js';

// Handheld XR for phones whose browser has no stereo WebXR session
// (immersive-vr): split-screen stereo for a Cardboard-style viewer, or a
// single full-screen view, both steered by the motion sensors. Passthrough
// here is the rear camera feed drawn behind the scene.

const EYE_HEIGHT = 1.6;
export const STEREO_FOV = 80;

/** Phones and tablets with motion sensors can use the Cardboard fallback. */
export function canUseCardboard() {
  return (
    typeof window !== 'undefined' &&
    'DeviceOrientationEvent' in window &&
    window.matchMedia?.('(pointer: coarse)').matches === true
  );
}

/**
 * Call from the click handler, before anything async: motion-sensor
 * permission (iOS), fullscreen and the orientation lock all need the tap.
 */
export function enterCardboard({ landscape = true } = {}) {
  const permission = window.DeviceOrientationEvent?.requestPermission?.();
  const root = document.documentElement;
  const fullscreen = root.requestFullscreen?.({ navigationUI: 'hide' });
  Promise.resolve(fullscreen)
    .then(() => landscape && screen.orientation?.lock?.('landscape'))
    .catch(() => {}); // fullscreen and orientation lock are best effort
  return Promise.resolve(permission).then((state) => state === undefined || state === 'granted');
}

export function exitCardboard() {
  screen.orientation?.unlock?.();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

const _zee = new THREE.Vector3(0, 0, 1);
const _euler = new THREE.Euler();
const _screenTilt = new THREE.Quaternion();
const _cameraFromDevice = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° about X
const _yAxis = new THREE.Vector3(0, 1, 0);

/** Device orientation (degrees) to a camera quaternion, three.js conventions. */
function orientationToQuaternion(target, { alpha, beta, gamma }, screenAngle) {
  const d = THREE.MathUtils.DEG2RAD;
  _euler.set(beta * d, alpha * d, -gamma * d, 'YXZ');
  target.setFromEuler(_euler);
  target.multiply(_cameraFromDevice);
  target.multiply(_screenTilt.setFromAxisAngle(_zee, -screenAngle * d));
  return target;
}

/** Takes over rendering and drives the camera from the phone's motion sensors. */
export function CardboardRig({ split = true }) {
  const camera = useThree((s) => s.camera);
  const getState = useThree((s) => s.get);
  const eyes = useMemo(
    () =>
      [0, 1].map(() => {
        const eye = new THREE.PerspectiveCamera();
        eye.matrixAutoUpdate = false; // set by the lens model each frame
        eye.matrixWorldAutoUpdate = false;
        return eye;
      }),
    [],
  );
  const latest = useRef(null);
  const yawOffset = useRef(null);
  const device = useMemo(() => new THREE.Quaternion(), []);
  const yaw = useMemo(() => new THREE.Quaternion(), []);
  const lens = useMemo(() => new CardboardLens(), []);
  useEffect(() => () => lens.dispose(), [lens]);
  const drawingBuffer = useMemo(() => new THREE.Vector2(), []);

  useEffect(() => {
    const saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov };
    camera.position.set(0, EYE_HEIGHT, 0);
    camera.quaternion.identity();
    camera.fov = STEREO_FOV;
    const onOrientation = (e) => {
      if (e.alpha != null) latest.current = e;
    };
    window.addEventListener('deviceorientation', onOrientation);
    return () => {
      window.removeEventListener('deviceorientation', onOrientation);
      camera.position.copy(saved.position);
      camera.quaternion.copy(saved.quaternion);
      camera.fov = saved.fov;
      const { width, height } = getState().size;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
  }, [camera, getState]);

  useFrame(({ gl, scene, size }) => {
    const sample = latest.current;
    if (sample) {
      orientationToQuaternion(device, sample, screen.orientation?.angle ?? window.orientation ?? 0);
      if (yawOffset.current == null) {
        // the heading the phone faced on entry becomes "forward" (-Z)
        _euler.setFromQuaternion(device, 'YXZ');
        yawOffset.current = -_euler.y;
      }
      camera.quaternion.copy(yaw.setFromAxisAngle(_yAxis, yawOffset.current)).multiply(device);
    }

    camera.updateMatrixWorld();
    if (!split) {
      camera.fov = STEREO_FOV;
      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();
      gl.render(scene, camera);
      return;
    }

    // both eyes, each with its lens's view, side by side into an offscreen
    // image, then through the lens model onto the screen
    gl.getDrawingBufferSize(drawingBuffer);
    const { x: width, y: height } = drawingBuffer;
    lens.setLayout(width, height);
    const target = lens.target;
    target.scissorTest = true;
    eyes.forEach((eye, i) => {
      lens.eyeCamera(i, camera.matrixWorld, camera.near, camera.far, eye);
      target.viewport.set((i * width) / 2, 0, width / 2, height);
      target.scissor.copy(target.viewport);
      gl.setRenderTarget(target); // applies the target's viewport and scissor
      gl.render(scene, eye);
    });
    gl.setRenderTarget(null);
    lens.render(gl);
  }, 1); // priority > 0: R3F skips its own render while this runs

  return null;
}

/** Divider for the viewer, and a way out. */
export function CardboardOverlay({ split, onTap, onExit }) {
  return (
    <div className="cardboard" onClick={onTap}>
      {split && <div className="cardboard-divider" />}
      <button
        className="cardboard-exit"
        aria-label="Exit XR view"
        onClick={(e) => {
          e.stopPropagation();
          onExit();
        }}
      >
        ✕
      </button>
    </div>
  );
}

/**
 * Rear camera feed as the scene background, centre-cropped to each view so
 * it isn't stretched. Calls `onError` if the camera is unavailable or denied.
 */
export function CameraBackground({ split, onError }) {
  const scene = useThree((s) => s.scene);
  const texture = useRef(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let stream;
    let cancelled = false;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    const openCamera = (attempt = 0) =>
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).catch((e) =>
        // still held by a just-ended AR session: retry a few times
        e?.name === 'NotReadableError' && attempt < 4 && !cancelled
          ? new Promise((r) => setTimeout(r, 600)).then(() => openCamera(attempt + 1))
          : Promise.reject(e),
      );
    (navigator.mediaDevices ? openCamera() : null)
      ?.then((s) => {
        stream = s;
        if (cancelled) return;
        video.srcObject = s;
        return video.play();
      })
      .then(() => {
        if (cancelled) return;
        const t = new THREE.VideoTexture(video);
        t.colorSpace = THREE.SRGBColorSpace;
        texture.current = t;
        scene.background = t;
      })
      .catch((e) => {
        if (!cancelled) onErrorRef.current?.(e);
      }) ?? onErrorRef.current?.(new Error('Camera API unavailable'));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (texture.current && scene.background === texture.current) scene.background = null;
      texture.current?.dispose();
      texture.current = null;
    };
  }, [scene]);

  useFrame(({ size }) => {
    const t = texture.current;
    const video = t?.image;
    if (!video?.videoWidth) return;
    const viewAspect = (split ? size.width / 2 : size.width) / size.height;
    const videoAspect = video.videoWidth / video.videoHeight;
    // cover: crop whichever dimension overflows
    if (videoAspect > viewAspect) t.repeat.set(viewAspect / videoAspect, 1);
    else t.repeat.set(1, videoAspect / viewAspect);
    t.offset.set((1 - t.repeat.x) / 2, (1 - t.repeat.y) / 2);
  });

  return null;
}
