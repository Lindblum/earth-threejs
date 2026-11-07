import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { iconSvg } from './Icon.jsx';
import { parseSlide, settingItems, slideEndId, slideId, snapToSlider, splitLabel } from './menu.js';
import { useGazeTarget } from './Gaze.jsx';

// The panels in XR. Each draws a panel of the same template as the windowed
// ones (menu.js optionsPanel, viewPanel: its toggle button, title, XR status,
// "Name: Value" buttons, and the shared open / collapsed state) onto a
// canvas, since WebXR can't show page elements. Collapsed, it keeps only its
// toggle button, in the same place. An open dropdown lists
// its choices beneath it, two to a row. A slider's track fills the right of its button: a
// pointer presses or drags along it, the gaze sets the value it stares at. Past MAX_VIEW_H the settings scroll
// beneath the title, with arrows (for gaze), a thumb to drag, a track to
// page and the mouse wheel. The grip at the bottom-right corner, dragged,
// sets the panel's width and the height it may grow to. Controller rays,
// hand pinches and gaze pick a control from where they hit the texture.

const W = 1000; // canvas px of the reference width...
const WIDTH_M = 0.44; // ...which is this many metres: sets the text size in XR
const PAD = 32;
const TITLE_Y = 68; // (PAD + TOGGLE / 2: the gear on the padding)
const LINE_H = 40; // the XR status line
const BUTTON_H = 62;
const GAP = 16;
const ICON = 44;
const ICON_GAP = 28; // between icon and text
const TOGGLE = 72; // the gear button, top left, that collapses and opens the panel...
const GEAR_ICON = 40; // ...and its icon's size
const PX_M = WIDTH_M / W; // metres per canvas px
const MAX_VIEW_H = 1150; // the tallest the panel gets (about half a metre); past it the settings scroll
const SCROLL_COLUMN = 44; // the scrollbar's column, added to the right of the buttons
const SCROLL_GAP = 16; // between the buttons and that column
const ARROW = 40; // the scroll arrows' height
const BAR = 12; // the track's width
const SCROLL_UP = 'menu:scrollUp';
const SCROLL_DOWN = 'menu:scrollDown';
const SCROLL_TRACK = 'menu:scrollTrack';
const RESIZE = 'menu:resize';
const GRIP = PAD; // the resize grip, filling the bottom-right corner's padding
const MIN_SIZE = { w: 520, h: 360 }; // canvas px the panel can be dragged down to...
const MAX_SIZE = { w: 2600, h: 2600 }; // ...and up to
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const _plane = new THREE.Plane();
const _normal = new THREE.Vector3();
const _point = new THREE.Vector3();

const iconImages = new Map();
function iconImage(name, onLoad) {
  if (!iconImages.has(name)) {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(name))}`;
    iconImages.set(name, img);
  }
  const img = iconImages.get(name);
  if (!img.complete) img.addEventListener('load', onLoad, { once: true });
  return img;
}

const BUTTON_FONT = `500 34px ${FONT}`;
const TITLE_FONT = `650 46px ${FONT}`;
const CORNER_FONT = `500 28px ${FONT}`; // the top-right corner's button (Options: the scene scale)
const CORNER_H = 48;
const cornerWidth = (corner) => (corner ? textWidth(corner.widest ?? corner.label, CORNER_FONT) + 32 : 0);
const INSET = 18; // icon from the button's left edge, text from its right
const VALUE_GAP = 40; // at least this between a setting's name and its value
const TRAILING = 36; // a dropdown's chevron, at the right edge
// a dropdown's choices: two to a row beneath its button, indented
const OPTION_FONT = `400 30px ${FONT}`;
const OPTION_H = 52;
const OPTION_GAP = 10;
const OPTION_INDENT = 54;
const CHECK = 30;
const OPTION_ICON = 32;
const OPTION_ICON_GAP = 14;

let measureCtx;
function textWidth(text, font) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/** The open panel's width: the widest possible button, or the title row if wider. */
function labelWidth(label) {
  const { name, value } = splitLabel(label);
  return value ? textWidth(`${name}:`, BUTTON_FONT) + VALUE_GAP + textWidth(value, BUTTON_FONT) : textWidth(name, BUTTON_FONT);
}

// a slider: its track from this share of its button's width to the right edge
const SLIDER_FROM = 0.55;
const KNOB = 17; // the knob's radius
const sliderTrack = (r) => ({ x0: r.x + r.w * SLIDER_FROM, x1: r.x + r.w - INSET - KNOB });
/** Slider `item`'s value at canvas x `px` on button rect `r`, snapped to its steps. */
function sliderValueAt(item, r, px) {
  const { x0, x1 } = sliderTrack(r);
  const { min, max } = item.slider;
  return snapToSlider(item.slider, min + clamp((px - x0) / (x1 - x0), 0, 1) * (max - min));
}

function panelWidth(title, labels, choices, sliderLabels, corner) {
  // the settings sit indented in their groups, and their choices further, two to a row
  const button = OPTION_INDENT + INSET + ICON + ICON_GAP + Math.max(0, ...labels.map(labelWidth)) + ICON_GAP + TRAILING + INSET;
  // a slider's label gets the left of its button, its track the rest
  const slider = OPTION_INDENT + Math.max(0, ...sliderLabels.map((l) => (INSET + ICON + ICON_GAP + labelWidth(l) + 24) / SLIDER_FROM));
  const choiceWidth = ({ label, icon }) => textWidth(label, OPTION_FONT) + (icon ? OPTION_ICON + OPTION_ICON_GAP : 0);
  const choice = 2 * INSET + CHECK + 10 + Math.max(0, ...choices.map(choiceWidth));
  const choiceRow = 2 * OPTION_INDENT + 2 * choice + OPTION_GAP;
  const titleRow = TOGGLE + 24 + textWidth(title, TITLE_FONT) + (corner ? 24 + cornerWidth(corner) : 0);
  return Math.ceil(2 * PAD + Math.max(button, slider, choiceRow, titleRow));
}

/** Where the settings start, beneath the title and status line. */
const bodyTop = (lines) => TITLE_Y + 34 + lines * LINE_H + 10;

/**
 * Canvas size and the hit rectangles for this state: { id, x, y, w, h } plus
 * `item` for a button or `option` for a choice in an open dropdown.
 * `lists`: false lays it out as if every group and dropdown were closed.
 */
function layout(toggleId, open, items, lines, panelW, lists = true) {
  const rects = [{ id: toggleId, x: PAD, y: TITLE_Y - TOGGLE / 2, w: TOGGLE, h: TOGGLE }];
  // collapsed: the panel around its toggle button alone, the same margin on every side
  if (!open) return { width: 2 * PAD + TOGGLE, height: 2 * (TITLE_Y - TOGGLE / 2) + TOGGLE, rects };
  let y = bodyTop(lines);
  // buttons from `x` to the panel's right padding; a group's settings and a
  // dropdown's choices go beneath, indented
  const place = (list, x) => {
    const w = panelW - PAD - x;
    for (const item of list) {
      rects.push({ id: item.id, item, x, y, w, h: BUTTON_H });
      y += BUTTON_H + GAP;
      if (!lists) continue;
      if (item.group?.open) place(item.group.items, x + OPTION_INDENT);
      if (!item.dropdown?.open) continue;
      const optionW = (w - OPTION_INDENT - OPTION_GAP) / 2;
      item.dropdown.options.forEach((option, i) => {
        rects.push({
          id: option.id,
          option,
          x: x + OPTION_INDENT + (i % 2) * (optionW + OPTION_GAP),
          y: y + Math.floor(i / 2) * (OPTION_H + OPTION_GAP),
          w: optionW,
          h: OPTION_H,
        });
      });
      y += Math.ceil(item.dropdown.options.length / 2) * (OPTION_H + OPTION_GAP) + GAP - OPTION_GAP;
    }
  };
  place(items, PAD);
  return { width: panelW, height: y - GAP + PAD, rects };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Text vertically centred on its ink at `cy`. */
function centredText(ctx, text, x, cy) {
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(text);
  ctx.fillText(text, x, cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
}

function drawButtonFrame(ctx, r, { hot, disabled }) {
  roundRect(ctx, r.x, r.y, r.w, r.h, 18);
  ctx.fillStyle = disabled ? 'rgba(255, 255, 255, 0.04)' : hot ? 'rgba(255, 255, 255, 0.24)' : 'rgba(255, 255, 255, 0.10)';
  ctx.fill();
  ctx.strokeStyle = hot ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = hot ? 4 : 2;
  ctx.stroke();
}

// Every panel is a slab 1 cm thick in the world (as in grid-game-threejs),
// whatever the panel's scale (docked, held, Text Size), behind its face, its outline the face's rounded frame, slightly see-through. The face
// shows from the front only; from behind, the slab's back. Unlit, so its
// sides are drawn lighter than its back to show the thickness.
const SLAB_DEPTH_M = 0.01;
const SLAB_GAP_M = 0.0005; // between the face and the slab's front, so they don't z-fight
const FRAME_RADIUS = 40; // canvas px: the frame's rounding (see the panels' draw)
const SLAB_MATERIALS = [
  new THREE.MeshBasicMaterial({ color: 0x1c2230, transparent: true, opacity: 0.8, depthWrite: false }), // front and back
  new THREE.MeshBasicMaterial({ color: 0x5a6782, transparent: true, opacity: 0.9, depthWrite: false }), // the sides
];

const _worldScale = new THREE.Vector3();

/** The slab behind a panel face `w` x `h` (m) centred on its parent, from SLAB_DEPTH_M behind to just behind the face, in the world. */
function PanelSlab({ w, h }) {
  const slab = useRef(null);
  const geometry = useMemo(() => {
    const r = Math.min(FRAME_RADIUS * PX_M, w / 2, h / 2);
    const [x0, y0, x1, y1] = [-w / 2, -h / 2, w / 2, h / 2];
    const shape = new THREE.Shape();
    shape.moveTo(x0 + r, y0);
    shape.lineTo(x1 - r, y0);
    shape.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0);
    shape.lineTo(x1, y1 - r);
    shape.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2);
    shape.lineTo(x0 + r, y1);
    shape.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI);
    shape.lineTo(x0, y0 + r);
    shape.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5);
    // a unit deep, from z = -1 to 0: scaled to its depth in the world each frame
    return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 6 }).translate(0, 0, -1);
  }, [w, h]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(() => {
    const m = slab.current;
    if (!m?.parent) return;
    const s = m.parent.getWorldScale(_worldScale).z || 1;
    m.scale.z = (SLAB_DEPTH_M - SLAB_GAP_M) / s;
    m.position.z = -SLAB_GAP_M / s;
  });
  // (drawn before the face; the face is what's pointed at)
  return <mesh ref={slab} geometry={geometry} material={SLAB_MATERIALS} renderOrder={-1} raycast={() => null} />;
}

/**
 * `panel`: a panel of the template (see menu.js), `onSelect(id)` for its buttons,
 * `focusKey`: the control a thumbstick has focused (see Grab.jsx), if any. Its
 * group's userData.bounds is its visible panel in the group's metres ({
 * left, right, top, bottom, button: the toggle button's centre }), for
 * docking and stacking it (see Grab.jsx), which also places the group.
 */
export function XRPanel({ panel, onSelect, groupRef, focusKey }) {
  const { toggle, title, status, items, labels, open, corner } = panel;
  const mesh = useRef(null);
  const [pointerKey, setPointerKey] = useState(null);
  const [gazeKey, setGazeKey] = useState(null);
  const [iconsLoaded, setIconsLoaded] = useState(0);
  // (status: a line, or several)
  const statusLines = (Array.isArray(status) ? status : [status]).filter(Boolean);
  const statusKey = statusLines.join('|');
  const lines = statusLines.length;
  const panelW = useMemo(() => {
    const settings = settingItems(items);
    const choices = settings.flatMap((item) => item.dropdown?.options ?? []);
    const sliderLabels = (labels ?? []).filter((l) => settings.some((i) => i.slider && splitLabel(i.label).name === splitLabel(l).name));
    return panelWidth(title, labels ?? settings.map((i) => i.label), choices, sliderLabels, corner);
  }, [title, labels, items, corner?.widest]); // eslint-disable-line react-hooks/exhaustive-deps
  // { w, h } in canvas px, dragged to with the grip: the width, and the height it may grow to
  const [size, setSize] = useState(null);
  const maxH = size?.h ?? MAX_VIEW_H;
  // too tall: the panel stops at maxH, the settings scroll between the title
  // and the bottom edge, and the scrollbar gets a column on the right
  // (a layout's height doesn't depend on its width)
  const scrollable = useMemo(() => open && layout(toggle.id, open, items, lines, panelW).height > maxH, [open, items, lines, panelW, maxH]);
  const scrollColumn = scrollable ? SCROLL_GAP + SCROLL_COLUMN - PAD / 2 : 0;
  const buttonsW = size && open ? size.w - scrollColumn : panelW;
  const { width: contentW, height: contentH, rects } = useMemo(() => layout(toggle.id, open, items, lines, buttonsW), [open, items, lines, buttonsW]);
  // the open panel's height with its dropdowns closed: the top edge stays put
  // as a list opens below or the grip is dragged, and collapsed, the gear
  // keeps to the top-left corner
  const openHeight = useMemo(() => Math.min(layout(toggle.id, true, items, lines, panelW, false).height, MAX_VIEW_H), [items, lines, panelW]);

  const width = contentW + scrollColumn;
  const height = scrollable ? maxH : contentH;
  const grip = open ? { id: RESIZE, x: width - GRIP, y: height - GRIP, w: GRIP, h: GRIP } : null;
  const cornerW = cornerWidth(corner);
  const cornerRect = open && corner ? { id: corner.id, x: width - PAD - cornerW, y: TITLE_Y - CORNER_H / 2, w: cornerW, h: CORNER_H } : null;
  const scrollMax = contentH - height;
  const [scroll, setScroll] = useState(0);
  const scrollTop = clamp(scroll, 0, scrollMax);
  const scrollTo = (v) => setScroll(clamp(v, 0, scrollMax));
  const viewTop = bodyTop(lines) - 6; // the settings show between these, a little room for their outlines
  const viewBottom = height - PAD + 6;
  const bar = useMemo(() => {
    if (!scrollable) return null;
    const x = contentW - PAD + SCROLL_GAP;
    const up = { id: SCROLL_UP, x, y: viewTop + 6, w: SCROLL_COLUMN, h: ARROW };
    const down = { id: SCROLL_DOWN, x, y: viewBottom - 6 - ARROW, w: SCROLL_COLUMN, h: ARROW };
    const track = { id: SCROLL_TRACK, x, y: up.y + ARROW + 8, w: SCROLL_COLUMN, h: down.y - 8 - (up.y + ARROW + 8) };
    const thumbH = Math.max(48, (track.h * height) / contentH);
    const thumb = { y: track.y + ((track.h - thumbH) * scrollTop) / scrollMax, h: thumbH };
    return { up, down, track, thumb, travel: track.h - thumbH };
  }, [scrollable, contentW, contentH, height, scrollTop, scrollMax, viewTop, viewBottom]);

  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  }, [width, height]);
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [canvas]);
  useEffect(() => () => texture.dispose(), [texture]);

  // (`focusKey`: what a thumbstick has focused in it, see Grab.jsx: lit as if pointed at, and scrolled into view)
  const hovered = focusKey ?? gazeKey ?? pointerKey;
  useEffect(() => {
    const r = focusKey && rects.find((q) => q.id === focusKey);
    if (!r || !scrollable || r === rects[0]) return;
    if (r.y - scrollTop < viewTop) scrollTo(r.y - viewTop);
    else if (r.y + r.h - scrollTop > viewBottom) scrollTo(r.y + r.h - viewBottom);
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const ctx = canvas.getContext('2d');
    const redraw = () => setIconsLoaded((n) => n + 1);
    ctx.clearRect(0, 0, width, height);

    roundRect(ctx, 4, 4, width - 8, height - 8, 40);
    ctx.fillStyle = 'rgba(12, 16, 28, 0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = TITLE_FONT;
    if (open) centredText(ctx, fit(ctx, title, width - 2 * PAD - TOGGLE - 24 - (cornerRect ? cornerW + 24 : 0)), PAD + TOGGLE + 24, TITLE_Y);
    if (cornerRect) {
      drawButtonFrame(ctx, cornerRect, { hot: hovered === corner.id });
      ctx.font = CORNER_FONT;
      ctx.fillStyle = 'rgba(232, 236, 246, 0.9)';
      ctx.textAlign = 'center';
      centredText(ctx, corner.label, cornerRect.x + cornerRect.w / 2, TITLE_Y);
      ctx.textAlign = 'left';
    }
    if (open && lines) {
      ctx.fillStyle = 'rgba(232, 236, 246, 0.6)';
      ctx.font = `400 26px ${FONT}`;
      statusLines.forEach((line, i) => centredText(ctx, fit(ctx, line, width - 2 * PAD), PAD, TITLE_Y + 34 + LINE_H * (i + 0.5)));
    }

    // the toggle button, top left
    const button = rects[0];
    drawButtonFrame(ctx, button, { hot: hovered === toggle.id });
    const icon = iconImage(toggle.icon, redraw);
    if (icon.complete && icon.naturalWidth) ctx.drawImage(icon, button.x + (button.w - GEAR_ICON) / 2, button.y + (button.h - GEAR_ICON) / 2, GEAR_ICON, GEAR_ICON);

    // the settings, scrolled, within their view
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, viewTop, width, viewBottom - viewTop);
    ctx.clip();
    ctx.translate(0, -scrollTop);
    for (const r of rects.slice(1)) {
      if (r.y + r.h < viewTop + scrollTop || r.y > viewBottom + scrollTop) continue;
      if (r.option) {
        // a choice in an open dropdown: smaller, the current one lit and ticked
        const { option } = r;
        roundRect(ctx, r.x, r.y, r.w, r.h, 14);
        const hot = option.id === hovered;
        ctx.fillStyle = hot ? 'rgba(255, 255, 255, 0.24)' : option.selected ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.05)';
        ctx.fill();
        ctx.strokeStyle = hot || option.selected ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = hot ? 4 : 2;
        ctx.stroke();
        ctx.globalAlpha = option.disabled ? 0.4 : 1;
        let tx = r.x + INSET;
        if (option.icon) {
          const icon = iconImage(option.icon, redraw);
          if (icon.complete && icon.naturalWidth) ctx.drawImage(icon, tx, r.y + (r.h - OPTION_ICON) / 2, OPTION_ICON, OPTION_ICON);
          tx += OPTION_ICON + OPTION_ICON_GAP;
        }
        ctx.fillStyle = '#ffffff';
        ctx.font = OPTION_FONT;
        const room = r.x + r.w - INSET - tx - (option.selected ? CHECK + 10 : 0);
        centredText(ctx, fit(ctx, option.label, room), tx, r.y + r.h / 2);
        if (option.selected) {
          const check = iconImage('check', redraw);
          if (check.complete && check.naturalWidth) ctx.drawImage(check, r.x + r.w - INSET - CHECK, r.y + (r.h - CHECK) / 2, CHECK, CHECK);
        }
        ctx.globalAlpha = 1;
        continue;
      }
      const { item } = r;
      const hot = (item.id === hovered || parseSlide(hovered)?.id === item.id) && !item.disabled;
      drawButtonFrame(ctx, r, { hot, disabled: item.disabled });
      ctx.globalAlpha = item.disabled ? 0.4 : 1;
      const img = iconImage(item.icon, redraw);
      if (img.complete && img.naturalWidth) ctx.drawImage(img, r.x + INSET, r.y + (r.h - ICON) / 2, ICON, ICON);
      ctx.fillStyle = '#ffffff';
      ctx.font = BUTTON_FONT;
      // the name on the left, the value against the right edge, then a dropdown's chevron
      const tx = r.x + INSET + ICON + ICON_GAP;
      let right = r.x + r.w - INSET;
      if (item.slider) {
        // the track and its knob on the right; the label gets the rest
        const { x0, x1 } = sliderTrack(r);
        const { min, max, value } = item.slider;
        const kx = x0 + ((value - min) / (max - min)) * (x1 - x0);
        const ty = r.y + r.h / 2;
        ctx.lineCap = 'round';
        ctx.lineWidth = 10;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.beginPath();
        ctx.moveTo(x0, ty);
        ctx.lineTo(x1, ty);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.beginPath();
        ctx.moveTo(x0, ty);
        ctx.lineTo(kx, ty);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(kx, ty, hot ? KNOB + 3 : KNOB, 0, Math.PI * 2);
        ctx.fill();
        right = x0 - 24;
      }
      const list = item.group ?? item.dropdown;
      if (list) {
        const icon = iconImage(list.open ? 'dropdownOpen' : 'dropdown', redraw);
        if (icon.complete && icon.naturalWidth) ctx.drawImage(icon, right - TRAILING, r.y + (r.h - TRAILING) / 2, TRAILING, TRAILING);
        right -= TRAILING + ICON_GAP;
      }
      const { name, value } = splitLabel(item.label);
      const nameText = value ? `${name}:` : name;
      centredText(ctx, fit(ctx, nameText, right - tx), tx, r.y + r.h / 2);
      if (value) {
        const room = right - tx - ctx.measureText(nameText).width - VALUE_GAP;
        ctx.textAlign = 'right';
        centredText(ctx, fit(ctx, value, room), right, r.y + r.h / 2);
        ctx.textAlign = 'left';
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    if (bar) {
      // arrows at either end, greyed at the end they point to, the track between
      for (const [r, name, end] of [
        [bar.up, 'dropdownOpen', scrollTop <= 0],
        [bar.down, 'dropdown', scrollTop >= scrollMax],
      ]) {
        drawButtonFrame(ctx, r, { hot: hovered === r.id && !end, disabled: end });
        ctx.globalAlpha = end ? 0.4 : 1;
        const icon = iconImage(name, redraw);
        if (icon.complete && icon.naturalWidth) ctx.drawImage(icon, r.x + (r.w - TRAILING) / 2, r.y + (r.h - TRAILING) / 2, TRAILING, TRAILING);
        ctx.globalAlpha = 1;
      }
      const x = bar.track.x + (bar.track.w - BAR) / 2;
      roundRect(ctx, x, bar.track.y, BAR, bar.track.h, BAR / 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fill();
      roundRect(ctx, x, bar.thumb.y, BAR, bar.thumb.h, BAR / 2);
      ctx.fillStyle = hovered === SCROLL_TRACK ? 'rgba(255, 255, 255, 0.7)' : 'rgba(255, 255, 255, 0.4)';
      ctx.fill();
    }

    if (open) {
      // the resize grip: three diagonal ridges across the corner, as in
      // grid-game-threejs (its 2.2 cm handle, drawn 64 px wide)
      const hot = hovered === RESIZE;
      const k = 0.022 / PX_M / 64;
      ctx.strokeStyle = hot ? '#9cc8ff' : 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = (hot ? 5 : 3) * k;
      ctx.lineCap = 'round';
      const corner = { x: width - 14 * k, y: height - 14 * k };
      for (const d of [18, 32, 46]) {
        ctx.beginPath();
        ctx.moveTo(corner.x - d * k, corner.y);
        ctx.lineTo(corner.x, corner.y - d * k);
        ctx.stroke();
      }
    }
    texture.needsUpdate = true;
  }, [canvas, texture, width, height, rects, open, title, statusKey, hovered, iconsLoaded, scrollTop, scrollMax, bar, viewTop, viewBottom, corner?.label]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The control at canvas px (px, py): the gear, a scroll control, or a setting or choice in view. */
  const controlAt = (px, py) => {
    const inside = (q, y = q.y) => px >= q.x && px <= q.x + q.w && py >= y && py <= y + q.h;
    if (inside(rects[0])) return toggle.id;
    if (cornerRect && inside(cornerRect)) return corner.id;
    if (grip && inside(grip)) return RESIZE;
    if (bar) for (const q of [bar.up, bar.down, bar.track]) if (inside(q)) return q.id;
    if (py < viewTop || py > viewBottom) return null;
    const r = rects.slice(1).find((q) => inside(q, q.y - scrollTop));
    if (!r || r.item?.disabled || r.option?.disabled) return null;
    // a slider's track (or a little left of it): the value there
    if (r.item?.slider && px >= sliderTrack(r).x0 - 2 * KNOB) return slideId(r.id, sliderValueAt(r.item, r, px));
    return r.id;
  };
  const canvasPoint = (uv) => [uv.x * width, (1 - uv.y) * height];
  const pick = (hit) => (hit?.uv ? controlAt(...canvasPoint(hit.uv)) : null);
  // the track and grip are for pointers, which press and drag them: gaze uses the arrows
  const gazePick = (hit) => {
    const key = pick(hit);
    return key === SCROLL_TRACK || key === RESIZE ? null : key;
  };
  const select = (key) => {
    if (key === SCROLL_UP) scrollTo(scrollTop - 2 * (BUTTON_H + GAP));
    else if (key === SCROLL_DOWN) scrollTo(scrollTop + 2 * (BUTTON_H + GAP));
    else if (key !== SCROLL_TRACK && key !== RESIZE) onSelect(key);
  };

  // dragging the thumb or the grip: the captured ray is followed on the
  // panel's plane, even once it slips off the panel. Points are canvas px
  // (y down) in the group, which stays put as the panel changes size.
  const drag = useRef(null);
  const rayPoint = (ray) => {
    const m = mesh.current;
    _plane.setFromNormalAndCoplanarPoint(_normal.set(0, 0, 1).transformDirection(m.matrixWorld), m.getWorldPosition(_point));
    if (!ray.intersectPlane(_plane, _point)) return null;
    const local = m.parent.worldToLocal(_point);
    return { x: local.x / PX_M, y: -local.y / PX_M };
  };
  const startDrag = (e, kind) => {
    const at = rayPoint(e.ray);
    if (!at) return;
    e.target.setPointerCapture?.(e.pointerId);
    drag.current = { kind, pointerId: e.pointerId, at, scroll: scrollTop, size: { w: width, h: height } };
  };
  // the gaze sets a slider in one go: set, then let go
  const gazeSelect = (key) => {
    select(key);
    const slide = parseSlide(key);
    if (slide) onSelect(slideEndId(slide.id));
  };
  useGazeTarget(mesh, gazeSelect, setGazeKey, gazePick);

  const centre = [((width - panelW) / 2) * PX_M, ((openHeight - height) / 2) * PX_M];
  const bounds = {
    left: centre[0] - (width / 2) * PX_M,
    right: centre[0] + (width / 2) * PX_M,
    top: centre[1] + (height / 2) * PX_M,
    bottom: centre[1] - (height / 2) * PX_M,
    button: centre[0] - (width / 2) * PX_M + (PAD + TOGGLE / 2) * PX_M,
  };
  return (
    <group ref={groupRef} userData={{ bounds }}>
      <mesh
        ref={mesh}
        position={[centre[0], centre[1], 0]}
        userData={{ pick: gazePick }} // (the control a ray hit is on: the sticks start there, see Grab.jsx)
        onPointerDown={(e) => {
          const key = pick(e);
          if (key === RESIZE) {
            e.stopPropagation();
            startDrag(e, 'resize');
            return;
          }
          const slide = parseSlide(key);
          if (slide) {
            // pressed on a slider: set there, then follow the ray along the track
            e.stopPropagation();
            select(key);
            startDrag(e, 'slider');
            if (drag.current) drag.current.slider = rects.find((q) => q.id === slide.id);
            return;
          }
          if (!bar || key !== SCROLL_TRACK) return;
          e.stopPropagation();
          const [, py] = canvasPoint(e.uv);
          if (py < bar.thumb.y || py > bar.thumb.y + bar.thumb.h) {
            // the track either side of the thumb: a page toward the press
            scrollTo(scrollTop + Math.sign(py - bar.thumb.y) * (viewBottom - viewTop));
            return;
          }
          startDrag(e, 'thumb');
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d?.pointerId !== e.pointerId) return setPointerKey(pick(e));
          const at = rayPoint(e.ray);
          if (!at) return;
          if (d.kind === 'thumb') scrollTo(d.scroll + ((at.y - d.at.y) * scrollMax) / bar.travel);
          else if (d.kind === 'slider') {
            // (the group's x, from its centre, to canvas px: the panel's left edge stays at -panelW / 2)
            const r = rects.find((q) => q.id === d.slider?.id);
            if (r) select(slideId(r.id, sliderValueAt(r.item, r, at.x + panelW / 2)));
          } else
            setSize({
              w: Math.round(clamp(d.size.w + at.x - d.at.x, MIN_SIZE.w, MAX_SIZE.w)),
              h: Math.round(clamp(d.size.h + at.y - d.at.y, MIN_SIZE.h, MAX_SIZE.h)),
            });
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (d?.pointerId !== e.pointerId) return;
          e.target.releasePointerCapture?.(e.pointerId);
          drag.current = null;
          if (d.kind === 'slider' && d.slider) onSelect(slideEndId(d.slider.id));
        }}
        onPointerOut={() => setPointerKey(null)}
        onWheel={(e) => {
          if (!bar) return;
          e.stopPropagation();
          scrollTo(scrollTop + e.deltaY);
        }}
        onClick={(e) => {
          const key = pick(e);
          if (key == null) return;
          e.stopPropagation();
          select(key);
        }}
      >
        <planeGeometry args={[width * PX_M, height * PX_M]} />
        {/* the front only (pressed from the front only too); alphaTest: the clear rest of the canvas draws nothing */}
        <meshBasicMaterial map={texture} transparent alphaTest={0.01} depthWrite={false} toneMapped={false} />
        <PanelSlab w={width * PX_M} h={height * PX_M} />
      </mesh>
    </group>
  );
}
