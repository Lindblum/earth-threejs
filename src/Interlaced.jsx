import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { EYE_SEPARATION } from './SideBySide.jsx';

// 3D: Interlaced, row-interleaved stereo for passive (polarised) 3D monitors:
// the left eye on the screen's odd rows counting from the top (1st, 3rd, ...),
// the right on the even ones. Each eye is drawn at full width and half
// height, keeping the full screen's aspect, then woven together row by row,
// so each pixel row shows one eye unscaled. Rows are counted from the top of
// the canvas, so it lines up when the page fills the screen (fullscreen).

const vertexShader = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform sampler2D left;
uniform sampler2D right;
uniform vec2 size; // the drawing buffer, in pixels
uniform float eyeHeight; // each eye's rows

void main() {
  float row = floor(size.y - gl_FragCoord.y); // 0 at the top
  float eyeRow = floor(row / 2.0);
  vec2 uv = vec2(gl_FragCoord.x / size.x, 1.0 - (eyeRow + 0.5) / eyeHeight);
  gl_FragColor = mod(row, 2.0) < 1.0 ? texture2D(left, uv) : texture2D(right, uv);
  #include <colorspace_fragment>
}`;

const _size = new THREE.Vector2();

function eyeTarget() {
  return new THREE.WebGLRenderTarget(1, 1, {
    samples: 4,
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
}

/** Takes over rendering while mounted; the camera and orbit controls carry on as usual. */
export function Interlaced() {
  const parts = useMemo(() => {
    const stereo = new THREE.StereoCamera();
    stereo.eyeSep = EYE_SEPARATION;
    const targets = [eyeTarget(), eyeTarget()];
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        left: { value: targets[0].texture },
        right: { value: targets[1].texture },
        size: { value: new THREE.Vector2() },
        eyeHeight: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    // one triangle covering the screen
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const quad = new THREE.Mesh(geometry, material);
    quad.frustumCulled = false;
    const weave = new THREE.Scene();
    weave.add(quad);
    return { stereo, targets, material, geometry, weave, camera: new THREE.Camera() };
  }, []);

  useEffect(
    () => () => {
      parts.targets.forEach((t) => t.dispose());
      parts.material.dispose();
      parts.geometry.dispose();
    },
    [parts],
  );

  useFrame(({ gl, scene, camera }) => {
    const { stereo, targets, material, weave } = parts;
    camera.updateMatrixWorld();
    stereo.update(camera);
    gl.getDrawingBufferSize(_size);
    const eyeHeight = Math.ceil(_size.y / 2);
    material.uniforms.size.value.copy(_size);
    material.uniforms.eyeHeight.value = eyeHeight;

    const previous = gl.getRenderTarget();
    [stereo.cameraL, stereo.cameraR].forEach((eye, i) => {
      const target = targets[i];
      if (target.width !== _size.x || target.height !== eyeHeight) target.setSize(_size.x, eyeHeight);
      gl.setRenderTarget(target);
      gl.render(scene, eye);
    });
    gl.setRenderTarget(previous);
    gl.render(weave, parts.camera);
  }, 1); // priority > 0: R3F skips its own render while this runs

  return null;
}
