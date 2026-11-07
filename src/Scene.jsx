import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { XROrigin, useXR } from '@react-three/xr';
import * as THREE from 'three';
import { CameraBackground, CardboardRig } from './Cardboard.jsx';
import { GazeReticle } from './Gaze.jsx';
import { ControllerGuide } from './ControllerGuide.jsx';
import { XRPanel } from './XRMenuPanel.jsx';
import { Probes, useControllers } from './Grab.jsx';
import { SOLID_BACKGROUND } from './menu.js';
import { FramePacing } from './FramePacing.jsx';
import { PhoneStereoCameraFeed, PhoneStereoXR } from './PhoneStereo.jsx';
import { SideBySide } from './SideBySide.jsx';
import { Interlaced } from './Interlaced.jsx';
import { DesktopControls, Earth } from './Earth.jsx';
import { playTick } from './sound.js';

const BASE = import.meta.env.BASE_URL;
const SKY_URL = `${BASE}img/skybox.jpg`;

/** Renders `fallback` if a child throws, e.g. a texture that failed to download. */
class AssetBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.warn('[earth] asset failed to load, continuing without it:', error.message);
  }
  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}

// the window's camera, as App.jsx's Canvas starts it (DesktopControls keeps it there, tilted)
const WINDOW_FOV = 60;
// Without controllers (gaze, phones) the XR panel stands at waist height, tilted up toward the viewer
const MENU_HOME = { position: [0, 0.95, -0.75], rotation: [-0.55, 0, 0] };
const PHONE_STEREO_MENU_SCALE = 1.5;

// The stars are fixed to the Earth (the world turns round you, so the sky
// turns with it): the sky texture's up along the Earth's axis, so the pole
// star stands over the North Pole. Its frame, from the Earth's: x stays x,
// the Earth's z (north) is the texture's up, its y the texture's -z.
const SKY_FROM_EARTH = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1));
const EARTH_FROM_SKY = SKY_FROM_EARTH.clone().invert();
const _skyTurn = new THREE.Quaternion();

/**
 * The starry sky, behind everything (scene.background: drawn whatever the far
 * plane), turned with the Earth (`pose`). three.js looks the sky up along
 * (its rotation)ᵀ × the world direction: so the rotation is the Earth's, times the sky's frame's back to the Earth's.
 */
function Sky({ passthrough, pose }) {
  useFrame(({ scene }) => scene.backgroundRotation.setFromQuaternion(_skyTurn.multiplyQuaternions(pose.q, EARTH_FROM_SKY)));
  const texture = useLoader(THREE.TextureLoader, SKY_URL);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const hidden = useXR((s) => passthrough && s.mode === 'immersive-ar');
  useEffect(() => {
    if (hidden) return;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = gl.capabilities.getMaxAnisotropy();
    scene.background = texture;
    return () => {
      if (scene.background === texture) scene.background = null;
    };
  }, [texture, scene, gl, hidden]);
  return null;
}

const _eye = new THREE.Vector3();

/** The solid colour as a sphere round the viewer (in an AR session three.js clears to transparent). */
function SolidDome() {
  const dome = useRef(null);
  useFrame(({ camera }) => dome.current?.position.copy(camera.getWorldPosition(_eye)));
  return (
    <mesh ref={dome} renderOrder={-1000} frustumCulled={false} raycast={() => null}>
      <sphereGeometry args={[10, 16, 8]} />
      <meshBasicMaterial color={SOLID_BACKGROUND} side={THREE.BackSide} depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function Backdrop({ background, pose }) {
  const scene = useThree((s) => s.scene);
  const inAR = useXR((s) => s.mode === 'immersive-ar');
  const solid = background === 'solid';
  useEffect(() => {
    if (!solid || inAR) return;
    const color = new THREE.Color(SOLID_BACKGROUND);
    scene.background = color;
    return () => {
      if (scene.background === color) scene.background = null;
    };
  }, [solid, inAR, scene]);
  if (solid) return inAR ? <SolidDome /> : null;
  return (
    <AssetBoundary>
      <Suspense fallback={null}>
        <Sky passthrough={background === 'passthrough'} pose={pose} />
      </Suspense>
    </AssetBoundary>
  );
}

/** Light for the controllers' models and probes (the ground itself is unlit: its photos are their own light). */
function Lights() {
  return (
    <>
      <hemisphereLight args={['#dfe8ff', '#3a3f4a', 1.2]} />
      <directionalLight position={[1.5, 4, 1]} intensity={1.5} />
    </>
  );
}

/** Out of XR: the window's projection back (three.js leaves the headset's on the camera). */
function RestoreViewAfterXR() {
  const session = useXR((s) => s.session);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const was = useRef(null);
  useEffect(() => {
    const ended = was.current && !session;
    was.current = session;
    if (!ended) return;
    camera.matrixAutoUpdate = true;
    camera.scale.set(1, 1, 1);
    camera.up.set(0, 1, 0);
    if (camera.isPerspectiveCamera) {
      camera.fov = WINDOW_FOV;
      camera.aspect = size.width / size.height;
      camera.zoom = 1;
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    gl.setSize(size.width, size.height, false);
    invalidate();
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }, [session, camera, gl, size, invalidate]);
  return null;
}

/**
 * The player: the XR origin (never moved: the Earth moves round it, see
 * EarthPose), the controllers' probes and the panels that travel with them.
 */
function Player({ origin, pose, panels, menus, onSelect, onFocus, textSize, homeScale, children }) {
  const left = useRef(null);
  const right = useRef(null);
  const probes = useMemo(() => ({ left, right }), []);
  useControllers({ origin, pose, panels, probes, home: MENU_HOME, homeScale, textSize, menus, onSelect, onFocus });
  return (
    <XROrigin ref={origin}>
      <Probes probes={probes} />
      {children}
    </XROrigin>
  );
}

/**
 * `panels`: the panels' template (Options, and the View panel where a
 * headset can be used; see menu.js), `onSelect(id)` for their buttons.
 * `pose`: the Earth's place (EarthPose); `globeRef`: the Globe, once made;
 * `globeOptions`: its settings; `onStatus`: where you are, now and then.
 * `menuOverlay`: the page shows Options over the scene (Phone AR), so no panel in it.
 */
export default function Scene({ state, panels, onSelect, menuOverlay, phone, pose, globeRef, globeOptions, onStatus }) {
  const inSession = useXR((s) => s.mode === 'immersive-vr' || s.mode === 'immersive-ar');
  const inAR = useXR((s) => s.mode === 'immersive-ar');
  const phoneStereo = phone && inAR && state.stereo;
  const hasControllers = useXR((s) => s.inputSourceStates.some((input) => input.type === 'controller'));
  const immersive = inSession || state.handheld;
  const cameraPassthrough = state.handheld && state.passthrough;
  const [cameraFailed, setCameraFailed] = useState(false);
  useEffect(() => setCameraFailed(false), [cameraPassthrough]);
  const origin = useRef(null);
  const menuPanel = useRef(null);
  const viewPanel = useRef(null);
  const panelRefs = useMemo(() => ({ menu: menuPanel, view: viewPanel }), []);
  const { options, view } = panels;
  const menus = useRef(null);
  menus.current = { menu: options, view };
  const [stickFocus, setStickFocus] = useState({});
  return (
    <>
      {cameraPassthrough && !cameraFailed ? (
        <CameraBackground
          split={state.stereo}
          onError={(e) => {
            console.warn('[earth] camera unavailable, showing the skybox instead:', e?.message ?? e);
            setCameraFailed(true);
          }}
        />
      ) : (
        <Backdrop background={state.background} pose={pose} />
      )}
      <FramePacing seeThrough={false} vsync={state.vsync} />
      <RestoreViewAfterXR />
      {state.view === 'sbs' && !immersive && <SideBySide />}
      {state.view === 'interlaced' && !immersive && <Interlaced />}
      {phoneStereo && <PhoneStereoXR />}
      {phoneStereo && state.passthrough && (
        <PhoneStereoCameraFeed onUnavailable={(reason) => console.warn(`[earth] no per-eye camera image (${reason}); the browser's camera view shows behind instead`)} />
      )}
      <Lights />
      {/* (the controls move the Earth first; then it's placed and its tiles picked for the frame) */}
      {!immersive && <DesktopControls pose={pose} globeRef={globeRef} />}
      <Player
        origin={origin}
        pose={pose}
        panels={panelRefs}
        menus={menus}
        onSelect={onSelect}
        onFocus={(lit) => {
          setStickFocus(lit);
          if (Object.keys(lit).length) playTick(); // (a step through a panel with a thumbstick)
        }}
        textSize={state.textSize}
        homeScale={phone && state.stereo ? PHONE_STEREO_MENU_SCALE : 1}
      >
        {immersive && !menuOverlay && <XRPanel panel={options} onSelect={onSelect} groupRef={menuPanel} focusKey={stickFocus.menu} />}
        {inSession && view && <XRPanel panel={view} onSelect={onSelect} groupRef={viewPanel} focusKey={stickFocus.view} />}
      </Player>
      <Earth pose={pose} globeRef={globeRef} options={globeOptions} onStatus={onStatus} />
      {inSession && hasControllers && state.controllerGuide && <ControllerGuide textSize={state.textSize} />}
      {immersive && !hasControllers && <GazeReticle />}
      {state.handheld && <CardboardRig split={state.stereo} />}
    </>
  );
}
