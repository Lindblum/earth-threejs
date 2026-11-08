import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Globe } from './Globe.js';
import { WGS84_A } from './geo.js';
import { menuPointer } from './menu.js';

// The globe in the scene: placed each frame by the Earth's pose (after the
// controls have moved it), its tiles picked for the camera (the headset's in
// XR), and the camera's near and far planes fitted round it.
//
// Depth: the near plane stays a few centimetres off (hands and panels are
// close; in the window, high up, further), the far one just past the horizon (or the far side of the globe),
// in powers of two so it seldom changes (in XR each change goes to the
// headset).

const NEAR = 0.05; // m
const MIN_FAR = 16; // m
const PEAKS = 9000; // m: no ground's higher
const NEAR_SHARE = 0.3;
const HORIZON_PEAKS = Math.sqrt((WGS84_A + PEAKS) ** 2 - WGS84_A ** 2); // m: mountains this far past the horizon still show
const REPORT_S = 0.5; // how often the status (where you are, the tiles) is told

/**
 * `pose`: the Earth's (EarthPose); `globeRef`: set to the Globe; `options`:
 * { imagery, terrain, detail, maxTiles }; `onStatus({ lat, lon, scale,
 * clearance, stats })`, now and then.
 */
export function Earth({ pose, globeRef, options, onStatus }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  const viewport = useThree((s) => s.viewport);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const told = useRef(0);

  // (made and disposed in the one effect: StrictMode runs effects twice)
  useEffect(() => {
    const globe = new Globe(gl);
    globe.setOptions(optionsRef.current);
    scene.add(globe.root);
    globeRef.current = globe;
    if (import.meta.env.DEV) Object.assign(window, { __globe: globe, __THREE: THREE, __camera: () => gl.xr.isPresenting ? gl.xr.getCamera() : null }); // (for tests)
    return () => {
      scene.remove(globe.root);
      globe.dispose();
      if (globeRef.current === globe) globeRef.current = null;
    };
  }, [gl, scene, globeRef]);

  useEffect(() => {
    globeRef.current?.setOptions(options);
  }, [options, globeRef]);

  useFrame((state, delta) => {
    const globe = globeRef.current;
    if (!globe) return;
    const xr = gl.xr.isPresenting;
    const camera = xr ? gl.xr.getCamera() : state.camera;
    const head = camera.getWorldPosition(new THREE.Vector3());
    pose.follow(head, (lat, lon) => globe.heightAt(lat, lon), Math.min(delta, 0.1), xr, (lat, lon) => globe.surfaceAt(lat, lon)); // (in XR, the Earth's centre kept straight below you)
    // an eye's height in pixels
    const eye = xr ? camera.cameras?.[0]?.viewport?.w : null;
    globe.update(camera, pose, eye || size.height * viewport.dpr);
    globe.captureGround(scene, pose);

    // near and far round what's to be seen
    const d = globe.viewer.ecef.length();
    const horizon = d > WGS84_A ? Math.sqrt(d * d - WGS84_A * WGS84_A) + HORIZON_PEAKS : HORIZON_PEAKS;
    const reach = Math.min(horizon, d + WGS84_A) * pose.scale * 1.1;
    const far = 2 ** Math.ceil(Math.log2(Math.max(MIN_FAR, reach)));
    // in the window, nothing's near the camera but the ground: high up, the near plane goes out too
    // (a third of the way to the highest ground could be), so the depth buffer's precision is where the Earth is
    const clear = (globe.viewer.h - PEAKS) * pose.scale * NEAR_SHARE;
    const near = xr || clear <= NEAR ? NEAR : 2 ** Math.floor(Math.log2(clear));
    const cam = state.camera;
    if (cam.far !== far || cam.near !== near) {
      cam.near = near;
      cam.far = far;
      cam.updateProjectionMatrix();
    }

    const now = state.clock.elapsedTime;
    if (onStatus && now - told.current > REPORT_S) {
      told.current = now;
      onStatus({ lat: pose.beneath.lat, lon: pose.beneath.lon, scale: pose.scale, clearance: pose.clearance, heading: pose.heading, stats: { ...globe.stats } });
    }
  });

  return null;
}

const EYE = 1.6; // m: the window's camera stands this high over the floor
const PITCH = { start: -0.55, min: -1.55, max: 0.35 }; // rad: looking down / up
const ZOOM_RATE = 0.0015; // per wheel unit
const ROTATE_RATE = 0.005; // rad per px
const KEY_SPEED = 1.5; // world m/s, standing; and...
const KEY_PER_HEIGHT = 1; // ...this many times the height over the ground a second, higher up
const KEY_TURN = 1.2; // rad/s
const KEY_ZOOM = 1.5; // per second, ×e

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

/** The nearest t ≥ 0 at which ray (o + t d) meets the sphere of `radius` round the origin, or null. */
function intersectSphere(o, d, radius) {
  const b = o.dot(d);
  const c = o.lengthSq() - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  if (-b - s >= 0) return -b - s;
  if (-b + s >= 0) return -b + s;
  return null;
}

/**
 * The window's controls (not in XR), as in Google Earth: drag to pan (the
 * point taken follows the mouse round the globe), the wheel zooms toward the
 * point under the mouse, right-drag (or Ctrl-drag) turns the view where the
 * camera stands, as turning your head, and tilts it. WASD / arrows move, Q / E turn,
 * R / F (or + / -) zoom in and out.
 */
export function DesktopControls({ pose, globeRef, onScale }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const pitch = useRef(PITCH.start);
  if (import.meta.env.DEV) window.__pitch = pitch; // (for tests)
  const keys = useRef(new Set());

  useEffect(() => {
    const canvas = gl.domElement;
    const rayAt = (e) => {
      const r = canvas.getBoundingClientRect();
      _ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      camera.updateMatrixWorld();
      _ray.setFromCamera(_ndc, camera);
      return _ray.ray;
    };
    const hitAt = (e) => globeRef.current?.raycast(rayAt(e), pose) ?? null;
    const centreHit = () => {
      _ndc.set(0, 0);
      camera.updateMatrixWorld();
      _ray.setFromCamera(_ndc, camera);
      return globeRef.current?.raycast(_ray.ray, pose) ?? null;
    };
    let drag = null; // { mode: 'pan', point (ECEF), radius } | { mode: 'turn', x, y, pivot (world) }
    const onDown = (e) => {
      if (gl.xr.isPresenting) return;
      if (e.button === 0 && !e.ctrlKey) {
        const hit = hitAt(e);
        if (!hit) return;
        drag = { mode: 'pan', id: e.pointerId, point: hit.ecef.clone().normalize(), radius: hit.ecef.length() };
      } else if (e.button === 2 || (e.button === 0 && e.ctrlKey)) {
        drag = { mode: 'turn', id: e.pointerId, x: e.clientX, y: e.clientY, pivot: camera.position.clone() }; // (turning on the spot, as Q / E do)
      } else return;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = drag.mode === 'pan' ? 'grabbing' : 'move';
    };
    const onMove = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.mode === 'pan') {
        // the Earth turned about its centre so the point taken comes under the mouse
        const ray = rayAt(e);
        _o.copy(ray.origin).applyMatrix4(pose.inverse);
        _d.copy(ray.direction).transformDirection(pose.inverse);
        const t = intersectSphere(_o, _d, drag.radius);
        if (t == null) return;
        const now = _o.addScaledVector(_d, t).normalize();
        if (now.distanceToSquared(drag.point) < 1e-18) return;
        pose.rotateEarth(new THREE.Quaternion().setFromUnitVectors(now, drag.point));
        return;
      }
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      pose.turnAbout(drag.pivot, dx * ROTATE_RATE); // (dragged right: the ground swings left, as if taking hold of it)
      pitch.current = THREE.MathUtils.clamp(pitch.current - dy * ROTATE_RATE * 0.8, PITCH.min, PITCH.max);
    };
    const onUp = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      canvas.style.cursor = '';
    };
    const onWheel = (e) => {
      if (gl.xr.isPresenting) return;
      e.preventDefault();
      const pivot = hitAt(e)?.world ?? centreHit()?.world ?? pose.anchor.clone();
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      pose.scaleAbout(pivot, Math.exp(-e.deltaY * unit * ZOOM_RATE));
      onScale?.(pose.scale);
    };
    const onContext = (e) => e.preventDefault();
    const onKey = (e) => {
      if (e.target.closest?.('input, select, textarea')) return;
      if (e.type === 'keydown') {
        if (!menuPointer.over) keys.current.add(e.code); // (over a panel, the keys work it: see useMenuKeys in App.jsx)
      }
      else keys.current.delete(e.code);
    };
    const onBlur = () => keys.current.clear();
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [gl, camera, pose, globeRef, onScale]);

  useFrame((_, delta) => {
    if (gl.xr.isPresenting) return;
    const dt = Math.min(delta, 0.1);
    // the camera stands at eye height over the floor, tilted; turning is the world's
    camera.position.set(0, EYE, 0);
    camera.rotation.set(pitch.current, 0, 0, 'YXZ');
    camera.updateMatrixWorld();
    const k = keys.current;
    if (!k.size) return;
    if (menuPointer.over) return k.clear(); // (the mouse moved onto a panel: the keys are its now)
    const held = (...codes) => codes.some((c) => k.has(c));
    const forward = (held('KeyW', 'ArrowUp') ? 1 : 0) - (held('KeyS', 'ArrowDown') ? 1 : 0);
    const right = (held('KeyD', 'ArrowRight') ? 1 : 0) - (held('KeyA', 'ArrowLeft') ? 1 : 0);
    if (forward || right) {
      const speed = Math.max(KEY_SPEED, KEY_PER_HEIGHT * pose.clearance) * dt;
      pose.travel(new THREE.Vector3(right * speed, 0, -forward * speed));
    }
    const turn = (held('KeyQ') ? 1 : 0) - (held('KeyE') ? 1 : 0);
    if (turn) pose.turnAbout(camera.position, turn * KEY_TURN * dt);
    const zoom = (held('KeyR', 'Equal', 'NumpadAdd') ? 1 : 0) - (held('KeyF', 'Minus', 'NumpadSubtract') ? 1 : 0);
    if (zoom) {
      _ndc.set(0, 0);
      _ray.setFromCamera(_ndc, camera);
      const pivot = globeRef.current?.raycast(_ray.ray, pose)?.world ?? pose.anchor.clone();
      pose.scaleAbout(pivot, Math.exp(zoom * KEY_ZOOM * dt));
      onScale?.(pose.scale);
    }
  });

  return null;
}
