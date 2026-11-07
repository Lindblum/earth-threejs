import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// 3D: SBS, half side-by-side for 3D TVs and projectors: the left eye on the
// left half, the right on the right, each keeping the full screen's aspect,
// so it is squeezed to half width. The display stretches each half back.

export const EYE_SEPARATION = 0.064; // metres

const _size = new THREE.Vector2();

/** Takes over rendering while mounted; the camera and orbit controls carry on as usual. */
export function SideBySide() {
  const stereo = useMemo(() => {
    const s = new THREE.StereoCamera();
    s.eyeSep = EYE_SEPARATION;
    return s;
  }, []);

  useFrame(({ gl, scene, camera }) => {
    camera.updateMatrixWorld();
    stereo.update(camera);
    gl.getSize(_size);
    const half = _size.x / 2;
    gl.setScissorTest(true);
    [stereo.cameraL, stereo.cameraR].forEach((eye, i) => {
      gl.setViewport(i * half, 0, half, _size.y);
      gl.setScissor(i * half, 0, half, _size.y);
      gl.render(scene, eye);
    });
    gl.setScissorTest(false);
    gl.setViewport(0, 0, _size.x, _size.y);
  }, 1); // priority > 0: R3F skips its own render while this runs

  return null;
}
