import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { pulse, readControllers } from './grip.js';
import { focusables, parseSlide, slideEndId, slideId } from './menu.js';

// Touch controllers in XR: getting about the world, and the XR panels (as in
// grid-game-threejs and physics-sandbox-threejs).
//
// Both grips held in mid-air (neither on a panel), as in Tilt Brush and
// Google Earth VR: the world is held by both hands. It scales with the
// distance between them (apart: bigger, together: smaller), turns with the
// line between them, and the point between them stays between them, so
// moving both hands drags it. Scale it down to hold the whole globe; up to
// stand in a street.
//
// The world's kept upright round you: the Earth's centre straight below
// your head, whatever its scale (see EarthPose.follow).
//
// The sticks: the left moves you the way the left controller points (up and
// down too: point down to come down to the ground; pushed sideways, sideways),
// faster the higher you are; either trigger, pulled, speeds that up (to
// BOOST times at full pull). The right, up and down, raises and lowers you
// (as fast, boosted too); left and right, turns you about the line from the
// Earth's centre up through your head. While a controller points at a panel,
// two sticks work it instead of moving you. The pointing controller's scrolls
// it (up and down). The stick of the controller the panel is docked on (or, a
// panel not docked there, the other controller's) steps through it: the lit
// control starts at the one pointed at, up and down go through its buttons,
// settings and choices (left and right set a slider), A / X presses the one
// lit, B / Y goes up a level. Pressed in (L3 / R3), a stick steps through the
// panels docked on its controller wherever it points (its probe turns blue);
// pressed again, back to moving.
//
// The panels dock on a controller, stacked upward, tipped toward the eyes:
// the View panel and Options above it on the left. A grip pressed while that
// controller points at a panel, or touches it, takes the panel off its dock
// and holds it rigidly; let go near the other controller it docks there,
// anywhere else it stays put (travelling with you). A double tap of a grip
// docks the panel it points at on that controller, or, at no panel, lets go
// of the panels docked there, leaving them where they are. A triple tap
// brings every undocked panel to that controller. While a grip holds a
// panel, its thumbstick pushes it away or reels it in (up / down) and rolls
// it (left / right).
//
// Without controllers (gaze, phones) the menu stands at `home` instead and
// the View panel hides.

const HANDS = ['left', 'right'];
const otherHand = (hand) => (hand === 'left' ? 'right' : 'left');

export const PROBE_RADIUS = 0.01; // m: the probe's, 2 cm across
const PROBE_TIP = new THREE.Vector3(0, 0, -0.05); // its centre, in target-ray space: 5 cm out in front
export const PROBE_COLOR = '#d9642b';
export const PROBE_MENU_COLOR = '#3a8dde'; // a probe whose stick works the panels

const PULSE = { grab: [0.6, 50], detach: [0.4, 30], dock: [0.9, 80], zone: [0.25, 20] }; // [strength, ms]

/** Docked on one controller, the panels stand stacked upward in this order (the first nearest it). */
const DOCK_STACK = ['view', 'menu'];
/** Where each panel docks at first. */
const FIRST_DOCK = { menu: 'left', view: 'left' };
const dockPose = (mirror) => ({
  anchor: new THREE.Vector3(-0.01 * mirror, 0.06, 0.02),
  turn: new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(-45), 0, THREE.MathUtils.degToRad(5 * mirror), 'YXZ')),
});
const DOCK_POSE = { left: dockPose(1), right: dockPose(-1) };
const DOCK_GAP = 0.008; // m between docked panels
const DOCK_SCALE = 0.5; // docked, the panels are half their free size
const DOCK_REACH = 0.12; // m: a held panel let go this near the other controller docks there
const TOUCH_REACH = 0.03; // m: a grip this near a panel's face takes it
const GRIP_TAP_S = 0.3; // a grip pressed no longer than this is a tap...
const GRIP_DOUBLE_TAP_S = 0.35; // ...and pressed again within this, a double tap (once more: a triple tap)
const FLY_S = 0.4; // a panel docked from afar flies there
const GROW_RATE = 12; // per second: a panel in the hand eases to its free size
// a thumbstick while its grip holds a panel
const PUSH_RATE = 1.5; // per second at full tilt, this share of its distance from the hand...
const PUSH_MIN_M = 0.25; // ...but never slower than at this distance
const REEL_MIN_M = 0.05; // reeled in no nearer the hand than this
const ROLL_RATE = Math.PI; // radians per second at full tilt
// getting about
const MOVE_SPEED = 1.5; // world m/s at full tilt, standing on the ground...
const MOVE_PER_HEIGHT = 1; // ...and this many times your height over it a second, higher up
const TURN_SPEED = 1.5; // rad/s at full tilt
const BOOST = 8; // a trigger pulled all the way: moving this many times faster
const MIN_SPAN = 0.02; // m: hands nearer than this don't scale
const MENU_SCROLL_SPEED = 1400; // canvas px a second at full tilt: a pointing controller's stick scrolling the panel
const MENU_TILT = 0.6; // a stick tilted this far steps through a panel...
const MENU_REPEAT = [0.4, 0.12]; // ...again after this long held, then this often

const _world = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _step = new THREE.Matrix4();
const _originInverse = new THREE.Matrix4();
const _gripInverse = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _right = new THREE.Vector3();
const _centre = new THREE.Vector3();

/** A controller's probe's centre, into `out`, from its target-ray pose (world). */
export const controllerTip = (rayMatrix, out) => out.copy(PROBE_TIP).applyMatrix4(rayMatrix);

function isShown(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** A panel group's visible panel, in its own metres at scale 1 (set by the panel as userData.bounds). */
const boundsOf = (group) => group.userData.bounds ?? { left: -0.05, right: 0.05, top: 0.05, bottom: -0.05, button: 0 };

function rotationAbout(origin, axis, angle) {
  return new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, origin.z)
    .multiply(_step.makeRotationAxis(axis, angle))
    .multiply(new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z));
}

/**
 * Controllers in XR. `origin`: ref to the XROrigin (the panels' parent; it's
 * never moved: the Earth moves instead); `pose`: the Earth's (EarthPose);
 * `onScale(scale)`: the world's scale changed; `panels`: { menu, view },
 * refs to the panels' groups; `probes`: { left, right }, refs to the probes'
 * meshes; `home`, `homeScale`: the menu's place without controllers;
 * `textSize`; `menus`: ref to the panels' templates, `onSelect(id)` their
 * buttons, `onFocus(lit)` what the sticks have lit in each.
 */
export function useControllers({ origin, pose, onScale, panels, probes, home, homeScale, textSize, menus, onSelect, onFocus }) {
  const gl = useThree((s) => s.gl);
  // hand -> { target: 'panel', key, offset, point, size, grow, zone } | { target: 'world' } | { target: 'none' }
  const grabs = useRef({});
  const holding = useRef(null); // both grips on the world: { start (pose snapshot), mid0, span0, angle0 }
  const buttons = useRef({});
  const menuMode = useRef({});
  const focus = useRef({});
  const steps = useRef({});
  const sliding = useRef({});
  const reportedFocus = useRef('');
  const pointedAt = useRef({}); // hand -> the control its ray was last on, "panel:id" (the lit one follows the ray as it moves)
  const docks = useRef(Object.fromEntries(Object.entries(FIRST_DOCK).map(([key, hand]) => [key, { dock: hand }])));
  const taps = useRef({});
  const pressed = useRef({});
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const homePose = useMemo(
    () => ({ position: new THREE.Vector3(...home.position), quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(...home.rotation)) }),
    [home],
  );

  useFrame((_, delta, frame) => {
    const dt = Math.min(delta, 0.1);
    const now = performance.now() / 1000;
    const referenceSpace = gl.xr.getReferenceSpace();
    const o = origin.current;
    const controllers = frame && o && referenceSpace ? readControllers(frame, referenceSpace, o) : {};
    const buzz = (hand, [strength, ms]) => pulse(controllers[hand]?.gamepad, strength, ms);
    const groupOf = (key) => panels[key]?.current ?? null;
    const shownPanels = () => Object.keys(docks.current).filter((key) => groupOf(key) && isShown(groupOf(key)));
    if (o) _originInverse.copy(o.matrixWorld).invert();

    const placeWorld = (key, world) => {
      _local.multiplyMatrices(_originInverse, world).decompose(groupOf(key).position, groupOf(key).quaternion, groupOf(key).scale);
    };

    /** The panel `c`'s ray points at (nearest): { key, point (world), distance, id (the control there, or null) } or null. */
    const panelPointed = (c) => {
      let best = null;
      raycaster.ray.copy(c.ray);
      raycaster.far = Infinity;
      for (const key of shownPanels()) {
        const hit = raycaster.intersectObject(groupOf(key), true)[0];
        if (hit && (!best || hit.distance < best.distance)) best = { key, hit };
      }
      if (!best) return null;
      const id = best.hit.object.userData.pick?.(best.hit) ?? null;
      return { key: best.key, point: best.hit.point.clone(), distance: best.hit.distance, id: parseSlide(id)?.id ?? id };
    };

    /** The panel `c` points at or touches (nearest): { key, point (world), distance } or null. */
    const panelAt = (c) => {
      const best = panelPointed(c);
      if (best) return best;
      for (const key of shownPanels()) {
        const g = groupOf(key);
        const b = boundsOf(g);
        g.updateWorldMatrix(true, false);
        const local = g.worldToLocal(_v.copy(c.position));
        const reach = TOUCH_REACH / g.scale.x;
        if (local.x >= b.left - reach && local.x <= b.right + reach && local.y >= b.bottom - reach && local.y <= b.top + reach && Math.abs(local.z) < reach)
          return { key, point: c.position.clone(), distance: 0 };
      }
      return null;
    };

    const dockZone = (hand, key) => {
      const c = controllers[otherHand(hand)];
      if (!c) return null;
      const g = groupOf(key);
      const b = boundsOf(g);
      g.updateWorldMatrix(true, false);
      const local = g.worldToLocal(_v.copy(c.position));
      local.set(THREE.MathUtils.clamp(local.x, b.left, b.right), THREE.MathUtils.clamp(local.y, b.bottom, b.top), 0);
      return g.localToWorld(local).distanceTo(c.position) < DOCK_REACH ? otherHand(hand) : null;
    };

    const release = (key) => {
      for (const hand of HANDS) if (grabs.current[hand]?.key === key) grabs.current[hand] = { target: 'none' };
    };

    const dock = (key, hand) => {
      release(key);
      const g = groupOf(key);
      docks.current[key].dock = hand;
      docks.current[key].fly = { t0: now, position: g.position.clone(), quaternion: g.quaternion.clone(), scale: g.scale.x };
    };

    const takePanel = (hand, c, at) => {
      const d = docks.current[at.key];
      buzz(hand, d.dock ? PULSE.detach : PULSE.grab);
      release(at.key);
      Object.assign(d, { dock: null, on: null, fly: null });
      const g = groupOf(at.key);
      g.updateWorldMatrix(true, false);
      _gripInverse.copy(c.grip).invert();
      grabs.current[hand] = {
        target: 'panel',
        key: at.key,
        offset: _gripInverse.clone().multiply(g.matrixWorld),
        point: at.point.clone().applyMatrix4(_gripInverse),
        size: 1,
        grow: textSize / g.scale.x,
        zone: null,
      };
    };

    /** Both grips in mid-air: the world's held from here. */
    const holdWorld = () => {
      const l = controllers.left.position;
      const r = controllers.right.position;
      const span = r.clone().sub(l);
      holding.current = {
        start: pose.snapshot(),
        mid0: l.clone().add(r).multiplyScalar(0.5),
        span0: Math.max(span.length(), MIN_SPAN),
        angle0: Math.atan2(span.x, span.z),
      };
      for (const h of HANDS) {
        grabs.current[h] = { target: 'world' };
        buzz(h, PULSE.grab);
      }
    };

    const gripStart = (hand, c) => {
      const tap = (taps.current[hand] ??= { pressedAt: -1, tappedAt: -Infinity, count: 0 });
      tap.count = now - tap.tappedAt < GRIP_DOUBLE_TAP_S ? tap.count + 1 : 1;
      tap.tappedAt = -Infinity;
      tap.pressedAt = now;
      grabs.current[hand] = { target: 'none' };
      // the other grip already held in mid-air: both hold the world
      const other = grabs.current[otherHand(hand)];
      if (pressed.current[otherHand(hand)] && controllers[otherHand(hand)] && other?.target === 'none') {
        holdWorld();
        return;
      }
      if (tap.count >= 3) {
        const free = shownPanels().filter((key) => !docks.current[key].dock);
        for (const key of free) dock(key, hand);
        if (free.length) buzz(hand, PULSE.dock);
        return;
      }
      const at = panelAt(c);
      if (tap.count === 2) {
        if (at) {
          dock(at.key, hand);
          buzz(hand, PULSE.dock);
          return;
        }
        const mine = shownPanels().filter((key) => docks.current[key].on === hand);
        for (const key of mine) Object.assign(docks.current[key], { dock: null, on: null, fly: null });
        if (mine.length) buzz(hand, PULSE.detach);
        return;
      }
      if (at) takePanel(hand, c, at);
    };

    const gripEnd = (hand) => {
      const tap = taps.current[hand];
      if (tap) tap.tappedAt = tap.count < 3 && now - tap.pressedAt <= GRIP_TAP_S ? now : -Infinity;
      const g = grabs.current[hand];
      delete grabs.current[hand];
      if (g?.target === 'world') {
        // one grip let go: the world's let go, the other grip holds nothing now
        holding.current = null;
        grabs.current[otherHand(hand)] = { target: 'none' };
        return;
      }
      if (g?.target !== 'panel') return;
      const zone = dockZone(hand, g.key);
      if (!zone) return;
      docks.current[g.key].dock = zone;
      buzz(zone, PULSE.dock);
    };

    for (const hand of HANDS) {
      const down = Boolean(controllers[hand]?.squeeze);
      if (down && !pressed.current[hand]) gripStart(hand, controllers[hand]);
      else if (!down && pressed.current[hand]) gripEnd(hand);
      pressed.current[hand] = down;
    }

    // both hands on the world: scaled by their distance apart, turned with the line between them, dragged with their midpoint
    const w = holding.current;
    if (w && controllers.left && controllers.right) {
      const l = controllers.left.position;
      const r = controllers.right.position;
      const span = r.clone().sub(l);
      if (span.length() > MIN_SPAN) {
        const angle = Math.atan2(span.x, span.z) - w.angle0;
        const scale = pose.gesture(w.start, w.mid0, l.clone().add(r).multiplyScalar(0.5), span.length() / w.span0, angle);
        onScale?.(scale);
      }
    }

    // a held panel follows its grip; its stick pushes, reels and rolls it
    const busy = {};
    for (const hand of HANDS) {
      const c = controllers[hand];
      const g = grabs.current[hand];
      busy[hand] = Boolean(c && g && g.target !== 'none');
      if (!c || g?.target !== 'panel' || !groupOf(g.key)) continue;
      const { x, y } = c.stick;
      _gripInverse.copy(c.grip).invert();
      _axis.copy(c.ray.direction).transformDirection(_gripInverse);
      if (y) {
        const dist = g.point.length();
        const u = _axis.clone().multiplyScalar(Math.max(-y * PUSH_RATE * Math.max(dist, PUSH_MIN_M) * dt, REEL_MIN_M - dist));
        g.offset.premultiply(_step.makeTranslation(u.x, u.y, u.z));
        g.point.add(u);
      }
      if (x) {
        const roll = rotationAbout(c.ray.origin.clone().applyMatrix4(_gripInverse), _axis, x * ROLL_RATE * dt);
        g.offset.premultiply(roll);
        g.point.applyMatrix4(roll);
      }
      g.size += (g.grow - g.size) * (1 - Math.exp(-GROW_RATE * dt));
      const { x: px, y: py, z: pz } = g.point;
      _local.makeTranslation(px, py, pz).multiply(_step.makeScale(g.size, g.size, g.size));
      _local.multiply(_step.makeTranslation(-px, -py, -pz)).multiply(g.offset);
      placeWorld(g.key, _world.multiplyMatrices(c.grip, _local));
      const zone = dockZone(hand, g.key);
      if (zone && zone !== g.zone) buzz(zone, PULSE.zone);
      g.zone = zone;
    }

    // the sticks: moving and turning, or (pressed in) working the panels
    const pressedNow = (hand, button) => Boolean(controllers[hand]?.[button] && !buttons.current[hand]?.[button]);
    const step = (hand, axis, value) => {
      const key = `${hand}:${axis}`;
      const dir = value > MENU_TILT ? 1 : value < -MENU_TILT ? -1 : 0;
      const s = (steps.current[key] ??= { dir: 0, next: 0 });
      if (dir !== s.dir) {
        s.dir = dir;
        s.next = now + MENU_REPEAT[0];
        return dir;
      }
      if (dir && now >= s.next) {
        s.next = now + MENU_REPEAT[1];
        return dir;
      }
      return 0;
    };
    const pointing = {}; // hand -> the panel its ray is on: its stick scrolls that panel, not the world
    for (const hand of HANDS) {
      const c = controllers[hand];
      pointing[hand] = c && !busy[hand] ? panelPointed(c) : null;
      const scrollBy = pointing[hand] && groupOf(pointing[hand].key)?.userData.scrollBy;
      if (scrollBy && c.stick.y) scrollBy(c.stick.y * MENU_SCROLL_SPEED * dt);
    }
    // hand -> the panel another controller points at, which this one's stick steps through: the controller
    // it's docked on (docked on the pointing one itself, or not docked, the other); not while it points at one itself
    const stepping = {};
    for (const hand of HANDS) {
      const at = pointing[hand];
      if (!at) continue;
      const on = docks.current[at.key]?.on;
      const by = on && on !== hand ? on : otherHand(hand);
      if (controllers[by] && !busy[by] && !pointing[by]) stepping[by] = at;
    }
    let stepped = false; // (a stick or button moved the lit control, not the ray: that ticks)
    for (const hand of HANDS) {
      const c = controllers[hand];
      if (pressedNow(hand, 'stickPress')) {
        menuMode.current[hand] = !menuMode.current[hand];
        buzz(hand, menuMode.current[hand] ? PULSE.dock : PULSE.detach);
      }
      probes[hand]?.current?.material.color.set(menuMode.current[hand] ? PROBE_MENU_COLOR : PROBE_COLOR);
      const at = stepping[hand] ?? null;
      if (!c || busy[hand] || pointing[hand] || (!menuMode.current[hand] && !at)) {
        focus.current[hand] = null;
        pointedAt.current[hand] = null;
        continue;
      }
      // pointed at a panel: that one; else (pressed in) the ones docked here, or all
      const mine = DOCK_STACK.filter((key) => docks.current[key]?.on === hand && groupOf(key) && isShown(groupOf(key))).reverse();
      const keys = at ? [at.key] : mine.length ? mine : shownPanels();
      const list = keys.flatMap((key) => (menus?.current[key] ? focusables(menus.current[key]).map((f) => ({ ...f, key })) : []));
      if (!list.length) continue;
      // the ray moved onto another control: that one's lit, and the stick goes on from there
      const ray = at?.id != null ? `${at.key}:${at.id}` : null;
      if (ray && ray !== pointedAt.current[hand] && list.some((x) => x.key === at.key && x.id === at.id)) focus.current[hand] = { key: at.key, id: at.id };
      pointedAt.current[hand] = ray;
      const f = focus.current[hand];
      let i = Math.max(0, list.findIndex((x) => x.key === f?.key && x.id === f?.id));
      const dy = step(hand, 'y', c.stick.y);
      if (dy) {
        i = THREE.MathUtils.clamp(i + dy, 0, list.length - 1);
        buzz(hand, PULSE.zone);
        stepped = true;
      }
      const item = list[i];
      const dx = step(hand, 'x', c.stick.x);
      if (dx && item.slider) {
        const { min, max, step: by, value } = item.slider;
        const v = THREE.MathUtils.clamp(+(value + dx * by).toFixed(4), min, max);
        if (v !== value) {
          onSelect?.(slideId(item.id, v));
          sliding.current[hand] = item.id;
          buzz(hand, PULSE.zone);
        }
      }
      if (!c.stick.x && sliding.current[hand]) {
        onSelect?.(slideEndId(sliding.current[hand]));
        sliding.current[hand] = null;
      }
      if (pressedNow(hand, 'primary') && !item.slider) {
        onSelect?.(item.id);
        buzz(hand, PULSE.grab);
      }
      let lit = item;
      if (pressedNow(hand, 'secondary') && item.parent) {
        onSelect?.(item.parent);
        lit = { key: item.key, id: item.parent };
        buzz(hand, PULSE.detach);
        stepped = true;
      }
      focus.current[hand] = { key: lit.key, id: lit.id };
    }
    for (const hand of HANDS) {
      const c = controllers[hand];
      buttons.current[hand] = { stickPress: c?.stickPress, primary: c?.primary, secondary: c?.secondary };
    }
    const lit = {};
    for (const hand of HANDS) if (focus.current[hand]) lit[focus.current[hand].key] = focus.current[hand].id;
    const litKey = JSON.stringify(lit);
    if (litKey !== reportedFocus.current) {
      reportedFocus.current = litKey;
      onFocus?.(lit, stepped);
    }

    // moving the way the left controller points (up and down too), faster the higher you are, and with a trigger pulled
    const lc = controllers.left;
    const rc = controllers.right;
    const boost = 1 + (BOOST - 1) * Math.max(lc?.triggerValue ?? 0, rc?.triggerValue ?? 0);
    const speed = Math.max(MOVE_SPEED, MOVE_PER_HEIGHT * pose.clearance) * boost * dt;
    if (lc && !w && !busy.left && !menuMode.current.left && !pointing.left && !stepping.left && (lc.stick.x || lc.stick.y)) {
      const forward = _v.copy(lc.ray.direction);
      const right = _right.setFromMatrixColumn(lc.rayMatrix, 0).setY(0); // (sideways stays level)
      if (right.lengthSq() > 1e-6) right.normalize();
      const move = forward.multiplyScalar(-lc.stick.y * speed).addScaledVector(right, lc.stick.x * speed);
      pose.rise(move.y);
      pose.travel(move.setY(0));
    }
    // the right stick, whichever way it's tilted more (a push a little off straight doesn't do both), as in
    // physics-sandbox-threejs: up and down rise and come down (no lower than the ground lets you, see
    // EarthPose.follow), as fast as the left moves you; left and right turn
    const rightFree = rc && !w && !busy.right && !menuMode.current.right && !pointing.right && !stepping.right;
    if (rightFree && Math.abs(rc.stick.y) > Math.abs(rc.stick.x)) {
      pose.rise(-rc.stick.y * speed); // (stick y is negative pushed up)
    } else if (rightFree && rc.stick.x) {
      // turning about the line from the Earth's centre up through the head (pushed right: turned right)
      gl.xr.getCamera().getWorldPosition(_pos);
      const axis = _axis.copy(_pos).sub(pose.centre(_centre));
      if (axis.lengthSq() > 1e-12) pose.turnAboutAxis(_pos, axis.normalize(), rc.stick.x * TURN_SPEED * dt);
    }

    // the probes, at each controller's tip
    for (const hand of HANDS) {
      const c = controllers[hand];
      const probe = probes[hand]?.current;
      if (!probe) continue;
      probe.visible = Boolean(c);
      if (c) probe.position.copy(controllerTip(c.rayMatrix, _v).applyMatrix4(_originInverse));
    }

    // the panels not held: docked ones stacked on their controller, or at home without controllers
    const gaze = !controllers.left && !controllers.right;
    const rows = { left: [], right: [] };
    for (const key of DOCK_STACK) {
      const g = groupOf(key);
      const d = docks.current[key];
      if (!g) continue;
      if (key !== 'menu') g.visible = !gaze;
      if (HANDS.some((hand) => grabs.current[hand]?.key === key) || !d.dock) continue;
      if (gaze) {
        if (key === 'menu') {
          g.position.copy(homePose.position);
          g.quaternion.copy(homePose.quaternion);
          g.scale.setScalar(homeScale * textSize);
        }
        d.on = null;
        continue;
      }
      d.on = controllers[d.dock] ? d.dock : otherHand(d.dock);
      if (g.visible) rows[d.on].push(key);
    }
    for (const hand of HANDS) {
      const keys = rows[hand];
      if (!keys.length) continue;
      const sc = DOCK_SCALE * textSize;
      const first = boundsOf(groupOf(keys[0]));
      const x = -(first.button - first.left) * sc;
      let y = 0;
      keys.forEach((key, i) => {
        const g = groupOf(key);
        const b = boundsOf(g);
        const dp = DOCK_POSE[hand];
        _pos.set(x - b.left * sc, y - b.bottom * sc, i * 0.0005).applyQuaternion(dp.turn).add(dp.anchor);
        _world.compose(_pos, dp.turn, _scale.setScalar(sc)).premultiply(controllers[hand].rayMatrix);
        placeWorld(key, _world);
        const fly = docks.current[key].fly;
        if (fly) {
          const t = Math.min(1, (now - fly.t0) / FLY_S);
          const k = THREE.MathUtils.smootherstep(t, 0, 1);
          g.position.lerpVectors(fly.position, g.position, k);
          g.quaternion.slerpQuaternions(fly.quaternion, g.quaternion, k);
          g.scale.setScalar(THREE.MathUtils.lerp(fly.scale, g.scale.x, k));
          if (t >= 1) docks.current[key].fly = null;
        }
        y += (b.top - b.bottom) * sc + DOCK_GAP;
      });
    }
  });
}

/** Each controller's probe, a 2 cm orange ball (blue while its stick works the panels); placed by useControllers. */
export function Probes({ probes }) {
  return HANDS.map((hand) => (
    <mesh key={hand} ref={probes[hand]} visible={false} raycast={() => null}>
      <sphereGeometry args={[PROBE_RADIUS, 16, 12]} />
      <meshStandardMaterial color={PROBE_COLOR} roughness={0.3} />
    </mesh>
  ));
}
