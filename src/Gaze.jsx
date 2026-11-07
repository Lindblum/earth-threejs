import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Hands-free activation: look at a control and hold your gaze for DWELL_SECONDS.
// A reticle marks the centre of view and fills a ring while the timer runs.

const DWELL_SECONDS = 1;
const IDLE_DISTANCE = 2; // reticle depth when not over a control
const RETICLE_SIZE = 0.035; // outer ring radius per metre of distance (~2°): constant on-screen size
const RING_SEGMENTS = 48;

const targets = new Set();

/**
 * Makes an object gaze-activatable. A panel holding several controls passes
 * `pick(intersection)`, returning the control's key under the gaze (or null);
 * the dwell restarts whenever that key changes. `onGaze(key | null)` reports
 * focus so the control can highlight; `onActivate(key)` fires after the dwell.
 * Single controls omit `pick` and get `true` as their key.
 */
export function useGazeTarget(ref, onActivate, onGaze, pick) {
  const handlers = useRef({ onActivate, onGaze, pick });
  handlers.current = { onActivate, onGaze, pick };
  const enabled = Boolean(onActivate);
  useEffect(() => {
    const object = ref.current;
    if (!enabled || !object) return;
    const target = {
      object,
      pick: (hit) => (handlers.current.pick ? handlers.current.pick(hit) : true),
      activate: (key) => handlers.current.onActivate?.(key),
      focus: (key) => handlers.current.onGaze?.(key),
    };
    targets.add(target);
    return () => {
      targets.delete(target);
      target.focus(null);
    };
  }, [ref, enabled]);
}

const _origin = new THREE.Vector3();
const _direction = new THREE.Vector3();

export function GazeReticle() {
  const reticle = useRef(null);
  const progressRing = useRef(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const ringGeometry = useMemo(
    // starts at 12 o'clock and runs clockwise
    () => new THREE.RingGeometry(0.62, 1, RING_SEGMENTS, 1, Math.PI / 2, -Math.PI * 2),
    [],
  );
  const dwell = useRef({ target: null, key: null, elapsed: 0, fired: false });

  useEffect(
    () => () => {
      dwell.current.target?.focus(null);
      ringGeometry.dispose();
    },
    [ringGeometry],
  );

  useFrame(({ camera }, dt) => {
    camera.getWorldPosition(_origin);
    camera.getWorldDirection(_direction);
    raycaster.set(_origin, _direction);

    let hit = null;
    let hitTarget = null;
    let hitKey = null;
    for (const target of targets) {
      if (!target.object.visible) continue;
      const [intersection] = raycaster.intersectObject(target.object, false);
      if (!intersection || (hit && intersection.distance >= hit.distance)) continue;
      const key = target.pick(intersection);
      if (key == null) continue; // on the panel, but not on a control
      hit = intersection;
      hitTarget = target;
      hitKey = key;
    }

    const state = dwell.current;
    if (hitTarget !== state.target || hitKey !== state.key) {
      if (hitTarget !== state.target) state.target?.focus(null);
      hitTarget?.focus(hitKey);
      Object.assign(state, { target: hitTarget, key: hitKey, elapsed: 0, fired: false });
    } else if (hitTarget && !state.fired) {
      state.elapsed += Math.min(dt, 0.1);
      if (state.elapsed >= DWELL_SECONDS) {
        state.fired = true; // look away to re-arm, so a stare doesn't repeat
        hitTarget.activate(hitKey);
      }
    }

    const progress = state.target && !state.fired ? Math.min(state.elapsed / DWELL_SECONDS, 1) : 0;
    progressRing.current.geometry.setDrawRange(0, Math.round(progress * RING_SEGMENTS) * 6);

    // sit just in front of the control, or float at a comfortable depth
    const distance = hit ? Math.max(hit.distance - 0.01, 0.05) : IDLE_DISTANCE;
    reticle.current.position.copy(_origin).addScaledVector(_direction, distance);
    reticle.current.quaternion.copy(camera.getWorldQuaternion(reticle.current.quaternion));
    reticle.current.scale.setScalar(distance * RETICLE_SIZE);
  });

  const overlay = { depthTest: false, depthWrite: false, transparent: true, toneMapped: false };
  return (
    <group ref={reticle} renderOrder={1000}>
      <mesh renderOrder={1000}>
        <circleGeometry args={[0.22, 24]} />
        <meshBasicMaterial color="#ffffff" opacity={0.9} {...overlay} />
      </mesh>
      <mesh renderOrder={1000}>
        <ringGeometry args={[0.62, 1, RING_SEGMENTS]} />
        <meshBasicMaterial color="#ffffff" opacity={0.25} {...overlay} />
      </mesh>
      <mesh ref={progressRing} geometry={ringGeometry} renderOrder={1001}>
        <meshBasicMaterial color="#ffd34d" side={THREE.DoubleSide} {...overlay} />
      </mesh>
    </group>
  );
}
