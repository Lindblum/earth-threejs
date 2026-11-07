import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useXRInputSourceState } from '@react-three/xr';
import * as THREE from 'three';
import { XR_CONTROLS as TEXTS } from './controls.js';

// Accessibility → XR Control Guides, as in grid-game-threejs: a label
// beside each of a controller's sticks, triggers and grips saying what it
// does. Each label points, with a thin leader line, at the middle of that
// part on the controller's own model (the motion-controllers layout's nodes
// for it). A / B / X / Y and the grip stand in a column on the controller's
// inner side (toward the other hand), the stick and the menu button in one
// on its outer side, the trigger out in front. Text Size scales the labels.

const HANDS = ['left', 'right'];
/** The components labelled, in the columns' order (top to bottom). */
const COMPONENTS = ['menu', 'y-button', 'b-button', 'x-button', 'a-button', 'xr-standard-thumbstick', 'xr-standard-trigger', 'xr-standard-squeeze'];
/** Where each component's label goes: 'inner' (the side toward the other hand), 'outer', or 'front' (ahead of it). */
const PLACE = { 'a-button': 'inner', 'b-button': 'inner', 'x-button': 'inner', 'y-button': 'inner', 'xr-standard-squeeze': 'inner', 'xr-standard-trigger': 'front', 'xr-standard-thumbstick': 'outer', menu: 'outer' };
const FONT_PX = 40;
const LINE_PX = 50; // a text line's height on the canvas
const PAD_PX = 12;
const CANVAS_W = 640;
const TEXT_M = 0.009; // a text line's height in the world (m), at Text Size 100%
const OUT_M = 0.07; // the outer column's distance from the controller (m)
const INNER_M = 0.045; // the inner column's (m): closer, leaving room between the hands
const FRONT_M = 0.07; // the trigger's label: this far in front of it (m)
const ROW_GAP_M = 0.004; // between a column's labels (m)

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _at = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _p = new THREE.Vector3();
const _box = new THREE.Box3();

/**
 * Where component `id` sits on controller model `model`: the centre of its
 * parts' shapes (its root node and its visual responses' nodes), not a
 * node's origin (a part's pivot is often elsewhere); into `out`. Null when
 * the model has none of them yet (it loads after the layout).
 */
function componentCentre(model, layout, id, nodesFound, out) {
  let nodes = nodesFound.get(id);
  if (!nodes?.length) {
    const component = layout.components[id];
    const names = [component.rootNodeName, ...Object.values(component.visualResponses ?? {}).flatMap((v) => [v.valueNodeName, v.minNodeName, v.maxNodeName])];
    nodes = [...new Set(names.filter(Boolean).map((n) => model.getObjectByName(n)).filter(Boolean))];
    nodesFound.set(id, nodes);
  }
  if (!nodes.length) return null;
  _box.makeEmpty();
  for (const node of nodes) _box.expandByObject(node);
  return _box.isEmpty() ? nodes[0].getWorldPosition(out) : _box.getCenter(out);
}

class Label {
  constructor(parent) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = LINE_PX + PAD_PX * 2;
    this.texture = this._texture();
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthTest: false, depthWrite: false, transparent: true, toneMapped: false }));
    this.sprite.renderOrder = 11;
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xe8f2ff, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }));
    this.line.renderOrder = 10;
    this.line.frustumCulled = false;
    for (const o of [this.sprite, this.line]) {
      o.raycast = () => {};
      o.visible = false;
      parent.add(o);
    }
    this.key = null;
  }

  _texture() {
    const t = new THREE.CanvasTexture(this.canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** Shows `text` (lines split by \n), anchored at its `side` edge ('left', 'right' or 'center'), `lineM` metres a line. */
  set(text, side, lineM) {
    const key = `${text}|${side}|${lineM}`;
    if (key === this.key) return;
    this.key = key;
    const lines = text.split('\n');
    const h = lines.length * LINE_PX + PAD_PX * 2;
    if (this.canvas.height !== h) {
      // a texture can't change size once uploaded: a new one for the new canvas
      this.canvas.height = h;
      this.texture.dispose();
      this.texture = this._texture();
      this.sprite.material.map = this.texture;
    }
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, CANVAS_W, h);
    ctx.font = `600 ${FONT_PX}px system-ui, sans-serif`;
    const w = Math.min(CANVAS_W, Math.max(...lines.map((l) => ctx.measureText(l).width)) + PAD_PX * 2);
    // the box hugs the edge nearest the controller
    const x0 = side === 'left' ? 0 : side === 'center' ? (CANVAS_W - w) / 2 : CANVAS_W - w;
    ctx.fillStyle = 'rgba(12, 16, 28, 0.82)';
    ctx.beginPath();
    ctx.roundRect(x0, 0, w, h, 14);
    ctx.fill();
    ctx.fillStyle = '#eef3fa';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, x0 + PAD_PX, PAD_PX + LINE_PX * (i + 0.5)));
    this.texture.needsUpdate = true;
    const k = lineM / LINE_PX; // m per canvas px
    this.sprite.scale.set(CANVAS_W * k, h * k, 1);
    this.sprite.center.set(side === 'left' ? 0 : side === 'center' ? 0.5 : 1, 0.5);
  }

  hide() {
    this.sprite.visible = this.line.visible = false;
  }

  dispose() {
    this.texture.dispose();
    this.sprite.material.dispose();
    this.line.geometry.dispose();
    this.line.material.dispose();
  }
}

class Guide {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'controller-guide';
    this.labels = { left: new Map(), right: new Map() }; // hand -> component id -> Label
    this.nodes = new WeakMap(); // controller model -> component id -> its nodes
  }

  label(hand, id) {
    let l = this.labels[hand].get(id);
    if (!l) this.labels[hand].set(id, (l = new Label(this.group)));
    return l;
  }

  /**
   * Per frame. `controllers`: { left, right } controller states (with the
   * controller's model, `object`, and its `layout`); `camera`: the viewer
   * (labels lie in its view: its right and up). In a column each label sits
   * level with its part where it can; labels that would overlap are moved
   * apart as a group, centred on their parts.
   */
  update(controllers, camera, textSize) {
    camera.updateMatrixWorld();
    _right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    _up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const lineM = TEXT_M * textSize;
    for (const hand of HANDS) {
      const model = controllers[hand]?.object;
      const layout = controllers[hand]?.layout;
      if (!model || !layout) {
        for (const l of this.labels[hand].values()) l.hide();
        continue;
      }
      if (!this.nodes.has(model)) this.nodes.set(model, new Map());
      const nodesFound = this.nodes.get(model);
      const texts = TEXTS[hand];
      const outward = hand === 'left' ? -1 : 1; // (the outer side, as you see it)
      model.updateWorldMatrix(true, true);
      model.getWorldPosition(_at);
      const shown = [];
      for (const id of COMPONENTS) {
        const p = texts[id] && layout.components[id] && componentCentre(model, layout, id, nodesFound, new THREE.Vector3());
        if (!p) {
          this.labels[hand].get(id)?.hide();
          continue;
        }
        shown.push({ id, p, place: PLACE[id] ?? 'outer', l: this.label(hand, id) });
      }
      for (const place of ['inner', 'outer']) {
        const side = place === 'outer' ? outward : -outward;
        const column = shown.filter((x) => x.place === place);
        for (const x of column) {
          x.l.set(texts[x.id], side > 0 ? 'left' : 'right', lineM);
          x.h = x.l.sprite.scale.y;
          x.y = _p.copy(x.p).sub(_at).dot(_up); // (its part's height, as you see it)
        }
        column.sort((a, b) => b.y - a.y);
        // groups of labels that would touch, each centred on the mean height of its parts
        const groups = [];
        for (const x of column) {
          groups.push({ items: [x], h: x.h, mid: x.y });
          for (;;) {
            const g = groups.at(-1);
            const prev = groups.at(-2);
            if (!prev || prev.mid - prev.h / 2 - ROW_GAP_M >= g.mid + g.h / 2) break;
            const items = [...prev.items, ...g.items];
            const h = items.reduce((t, it) => t + it.h, 0) + ROW_GAP_M * (items.length - 1);
            groups.splice(-2, 2, { items, h, mid: items.reduce((t, it) => t + it.y, 0) / items.length });
          }
        }
        for (const g of groups) {
          let y = g.mid + g.h / 2;
          for (const x of g.items) {
            y -= x.h / 2;
            x.l.sprite.position.copy(_at).addScaledVector(_right, side * (place === 'inner' ? INNER_M : OUT_M)).addScaledVector(_up, y);
            y -= x.h / 2 + ROW_GAP_M;
          }
        }
      }
      // the trigger's label: out in front of it, where the controller points
      _fwd.set(0, 0, -1).transformDirection(model.matrixWorld);
      for (const x of shown.filter((it) => it.place === 'front')) {
        x.l.set(texts[x.id], 'center', lineM);
        x.l.sprite.position.copy(x.p).addScaledVector(_fwd, FRONT_M);
      }
      for (const { l, p } of shown) {
        const position = l.line.geometry.getAttribute('position');
        position.setXYZ(0, p.x, p.y, p.z);
        position.setXYZ(1, l.sprite.position.x, l.sprite.position.y, l.sprite.position.z);
        position.needsUpdate = true;
        l.sprite.visible = l.line.visible = true;
      }
    }
  }

  dispose() {
    for (const hand of HANDS) for (const l of this.labels[hand].values()) l.dispose();
  }
}

/** The guide's labels, while mounted (in an XR session with controllers, the guide on). */
export function ControllerGuide({ textSize }) {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const left = useXRInputSourceState('controller', 'left');
  const right = useXRInputSourceState('controller', 'right');
  const guide = useMemo(() => new Guide(), []);
  useEffect(() => {
    scene.add(guide.group);
    return () => {
      scene.remove(guide.group);
      guide.dispose();
    };
  }, [scene, guide]);
  // the viewer's head: the XR camera while presenting
  useFrame(({ camera }) => guide.update({ left, right }, gl.xr.isPresenting ? gl.xr.getCamera() : camera, textSize));
  return null;
}
