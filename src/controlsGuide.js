// Options → Controls (threejs-ui, after grid-game-threejs's Controls guide): a drawing of the
// input last touched, the mouse (with the keys beneath it), a gamepad or the two XR
// controllers, each part that does something labelled with what it does, a leader line from
// the label to the part. One SVG string, which the windowed panel shows as it is and the XR
// panel draws onto its canvas (or rasterizes with the page), so the two look alike.
//
// The same file in every project (threejs-ui/controlsGuide.js); each project's own bindings
// are in its src/controls.js:
//   { mk: { mouse: { left, middle, right, wheel, move }, keys: [{ keys: ['Space', '/', '→'], action }] },
//     pad: { A, B, X, Y, LB, RB, LT, RT, view, start, L, L3, R, R3, dpad } or null (no gamepad controls),
//     xr: { left: { componentId: text }, right: { … } } (motion-controllers component ids, as the XR Control Guides') }
// A text's "\n"s start new lines; each line wraps to its column.

const FONT = 'system-ui, -apple-system, &quot;Segoe UI&quot;, Roboto, sans-serif';
const MEASURE_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** The inputs, as the Controls field names them. */
export const INPUT_NAMES = { mk: 'Mouse / Keyboard', pad: 'Gamepad', xr: 'XR Controllers' };

// ---------------------------------------------------------------------------------------------
// Which input was last touched: the mouse or keyboard (any press, the wheel, the mouse moved), a
// gamepad (polled: a button pressed or a stick pushed past half way), or an XR controller (in a
// session: entering it with tracked controllers, a trigger or a grip). Leaving XR goes back to
// what was used before it. A touch screen counts as the mouse.

let current = 'mk';
let beforeXR = 'mk';
const listeners = new Set();
let started = false;

function setInput(device) {
  if (device === current) return;
  current = device;
  for (const listener of listeners) listener();
}

/** 'mk' | 'pad' | 'xr': the input last touched (for useSyncExternalStore). */
export const getLastInput = () => current;

/** Calls `listener` whenever the input last touched changes; returns the unsubscriber. */
export function subscribeLastInput(listener) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const desk = () => setInput('mk');
  window.addEventListener('pointerdown', desk, true);
  window.addEventListener('keydown', desk, true);
  window.addEventListener('wheel', desk, { capture: true, passive: true });
  window.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && (e.movementX || e.movementY) && desk(), true);
  // gamepads send no events for their buttons: polled while one is connected (window frames
  // stop in an XR session, whose controllers aren't these gamepads anyway)
  let polling = false;
  const poll = () => {
    const pads = [...(navigator.getGamepads?.() ?? [])].filter(Boolean);
    if (pads.some((p) => p.buttons.some((b) => b.pressed) || p.axes.some((a) => Math.abs(a) > 0.5))) setInput('pad');
    polling = pads.length > 0;
    if (polling) requestAnimationFrame(poll);
  };
  const startPolling = () => {
    if (polling) return;
    polling = true;
    requestAnimationFrame(poll);
  };
  window.addEventListener('gamepadconnected', startPolling);
  startPolling();
}

/**
 * While XR session `session` runs, its controllers count as touched: on entering it (if it has
 * tracked controllers: not a phone's screen or a viewer's gaze) and at each trigger or grip
 * pressed. Returns the cleanup (for an effect); its end goes back to the input used before.
 */
export function watchXRInput(session) {
  if (!session) return undefined;
  start();
  const tracked = (source) => source?.targetRayMode === 'tracked-pointer';
  if (current !== 'xr') beforeXR = current;
  const check = () => [...session.inputSources].some(tracked) && setInput('xr');
  const press = (e) => tracked(e.inputSource) && setInput('xr');
  const end = () => current === 'xr' && setInput(beforeXR);
  check();
  session.addEventListener('inputsourceschange', check);
  session.addEventListener('selectstart', press);
  session.addEventListener('squeezestart', press);
  session.addEventListener('end', end);
  return () => {
    session.removeEventListener('inputsourceschange', check);
    session.removeEventListener('selectstart', press);
    session.removeEventListener('squeezestart', press);
    session.removeEventListener('end', end);
  };
}

// ---------------------------------------------------------------------------------------------
// The drawing: 300 units wide (any width on the page: it scales), labels in a column either
// side of the device, each level with its part where it can, labels that would overlap moved
// apart as a group centred on their parts (as grid-game-threejs's LabelledDiagram).

const W = 300;
const COL = 92; // a label column's width
const SIZE = 8.5; // label text
const LINE = 10; // a label line's height
const PAD = 2; // above and below a label's lines
const GAP = 3; // between labels in a column
const INK = '#e8ecf2';
const MUTED = '#9aa3b8';
const DOT = '#9cc8ff';
const SHAPE = `fill="rgba(255,255,255,0.06)" stroke="${MUTED}" stroke-width="1.4"`;
const KEY = `fill="rgba(255,255,255,0.14)" stroke="${MUTED}" stroke-width="1.4"`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let measureCtx;
function textWidth(text, size, weight = 400) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  measureCtx.font = `${weight} ${size}px ${MEASURE_FONT}`;
  return measureCtx.measureText(text).width;
}

/** `text`'s lines: its own ("\n"), each wrapped at word breaks to `width`. */
function wrap(text, width, size = SIZE) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, size) > width) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Lines of text from (x, top), `anchor` 'start' | 'middle' | 'end'. */
function textLines(lines, x, top, anchor, { size = SIZE, line = LINE, fill = INK, weight = 400 } = {}) {
  const spans = lines.map((l, i) => `<tspan x="${x}" y="${(top + (i + 0.5) * line + size * 0.35).toFixed(1)}">${esc(l)}</tspan>`).join('');
  return `<text font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${spans}</text>`;
}

/**
 * Labels for the parts in `anchors` [{ part, press?, x, y, side: 'left' | 'right' | 'bottom' }]
 * that `texts` gives text for (a part's `press`: its click, after "Click: "), placed. Each:
 * { x, y, side, lines, ly (top), h }.
 */
function placeLabels(anchors, texts, below) {
  const shown = anchors
    .map((a) => {
      const own = texts[a.part];
      const click = a.press && texts[a.press];
      const text = [own, click && `Click: ${click}`].filter(Boolean).join('\n');
      return text ? { ...a, text } : null;
    })
    .filter(Boolean);
  const column = (side) => {
    const col = shown
      .filter((a) => a.side === side)
      .sort((a, b) => a.y - b.y || (side === 'left' ? b.x - a.x : a.x - b.x))
      .map((a) => {
        const lines = wrap(a.text, COL - 4);
        return { ...a, lines, h: lines.length * LINE + PAD * 2 };
      });
    // groups of labels that would touch, each centred on the mean height of its parts
    const groups = [];
    for (const a of col) {
      groups.push({ items: [a], h: a.h, mid: a.y });
      for (;;) {
        const g = groups.at(-1);
        const prev = groups.at(-2);
        if (!prev || prev.mid + prev.h / 2 + GAP <= g.mid - g.h / 2) break;
        const items = [...prev.items, ...g.items];
        const h = items.reduce((t, b) => t + b.h, 0) + GAP * (items.length - 1);
        groups.splice(-2, 2, { items, h, mid: items.reduce((t, b) => t + b.y, 0) / items.length });
      }
    }
    return groups.flatMap((g) => {
      let y = g.mid - g.h / 2;
      return g.items.map((a) => {
        const ly = y;
        y += a.h + GAP;
        return { ...a, ly };
      });
    });
  };
  const bottom = shown
    .filter((a) => a.side === 'bottom')
    .map((a) => {
      const lines = wrap(a.text, 130);
      return { ...a, lines, h: lines.length * LINE + PAD * 2, ly: below };
    });
  return [...column('left'), ...column('right'), ...bottom];
}

/** A label's leader line, its part's dot and its text. */
function drawLabel(a) {
  const down = a.side === 'bottom';
  const lx = down ? a.x : a.side === 'left' ? COL : W - COL;
  const ly = down ? a.ly : a.ly + a.h / 2;
  const tx = down ? a.x : a.side === 'left' ? COL - 3 : W - COL + 3;
  const anchor = down ? 'middle' : a.side === 'left' ? 'end' : 'start';
  return (
    `<line x1="${a.x}" y1="${a.y}" x2="${lx}" y2="${ly}" stroke="${MUTED}" stroke-width="0.8" stroke-opacity="0.7"/>` +
    `<circle cx="${a.x}" cy="${a.y}" r="1.8" fill="${DOT}"/>` +
    textLines(a.lines, tx, a.ly + PAD, anchor)
  );
}

/** The SVG of `body` (markup) over viewBox rows `top` to `bottom`: { svg, width, height }. */
function svgOf(body, top, bottom) {
  const height = Math.ceil(bottom - top);
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${Math.floor(top)} ${W} ${height}" width="${W}" height="${height}" role="img">${body}</svg>`,
    width: W,
    height,
  };
}

/** A device drawn in the middle (`shape`), its parts in `anchors` labelled from `texts`; at least `minHeight` tall. */
function labelledDevice(shape, anchors, texts, { minHeight, below = minHeight, extra = '', extraBottom = 0 }) {
  const labels = placeLabels(anchors, texts, below);
  const top = Math.min(0, ...labels.map((a) => a.ly - 4));
  const bottom = Math.max(minHeight, extraBottom, ...labels.map((a) => a.ly + a.h + 4));
  return { body: shape + labels.map(drawLabel).join('') + extra, top, bottom };
}

// --- the mouse (grid-game-threejs's) ---

const MOUSE_SHAPE = `<g>
<path ${SHAPE} d="M150 22 C128 22 122 40 122 62 L122 112 C122 136 134 150 150 150 C166 150 178 136 178 112 L178 62 C178 40 172 22 150 22 Z"/>
<path ${SHAPE} fill="none" d="M122 70 L178 70 M150 22 L150 70"/>
<rect ${KEY} x="146" y="38" width="8" height="18" rx="4"/>
</g>`;
const MOUSE_ANCHORS = [
  { part: 'left', x: 132, y: 40, side: 'left' },
  { part: 'middle', x: 147, y: 54, side: 'left' },
  { part: 'move', x: 140, y: 118, side: 'left' },
  { part: 'wheel', x: 153, y: 40, side: 'right' },
  { part: 'right', x: 168, y: 58, side: 'right' },
];

/** The keys, a row each beneath the mouse: their caps (a "/" between alternatives), then what they do, in a column after the widest caps. */
function keyRows(keys, top) {
  const CAP_H = 12;
  const CAP_SIZE = 7.5;
  const capW = (cap) => (cap === '/' ? 8 : Math.max(CAP_H, textWidth(cap, CAP_SIZE, 600) + 7) + 2);
  const capsW = (caps) => caps.reduce((t, cap) => t + capW(cap), 0);
  const tx = Math.min(W / 2, Math.max(0, ...keys.map((k) => capsW(k.keys))) + 6);
  let y = top;
  let out = '';
  for (const { keys: caps, action } of keys) {
    let x = 0;
    for (const cap of caps) {
      if (cap === '/') out += textLines(['/'], x + 4, y, 'middle', { fill: MUTED });
      else {
        const w = capW(cap) - 2;
        out += `<rect ${KEY} x="${x + 0.7}" y="${y + (LINE - CAP_H) / 2 + 0.7}" width="${w - 1.4}" height="${CAP_H - 1.4}" rx="2.5"/>`;
        out += textLines([cap], x + w / 2, y, 'middle', { size: CAP_SIZE, weight: 600 });
      }
      x += capW(cap);
    }
    const lines = wrap(action, W - tx);
    out += textLines(lines, tx, y, 'start');
    y += Math.max(CAP_H, lines.length * LINE) + 4;
  }
  return { body: out, bottom: y };
}

function mouseGuide(mk) {
  const device = labelledDevice(MOUSE_SHAPE, MOUSE_ANCHORS, mk.mouse ?? {}, { minHeight: 156 });
  const keys = keyRows(mk.keys ?? [], device.bottom + 6);
  return svgOf(device.body + keys.body, device.top, keys.bottom);
}

// --- a gamepad (grid-game-threejs's) ---

const PAD_SHAPE = `<g>
<rect ${SHAPE} x="108" y="36" width="24" height="9" rx="3"/>
<rect ${SHAPE} x="168" y="36" width="24" height="9" rx="3"/>
<rect ${SHAPE} x="104" y="47" width="32" height="7" rx="3"/>
<rect ${SHAPE} x="164" y="47" width="32" height="7" rx="3"/>
<path ${SHAPE} d="M118 56 L182 56 C200 56 206 70 210 96 C214 122 208 138 196 138 C186 138 180 126 174 116 L126 116 C120 126 114 138 104 138 C92 138 86 122 90 96 C94 70 100 56 118 56 Z"/>
<circle ${KEY} cx="122" cy="76" r="9"/>
<circle ${KEY} cx="166" cy="98" r="9"/>
<path ${KEY} d="M131 92 h6 v4 h4 v6 h-4 v4 h-6 v-4 h-4 v-6 h4 z"/>
<circle ${KEY} cx="180" cy="68" r="4"/>
<circle ${KEY} cx="172" cy="76" r="4"/>
<circle ${KEY} cx="188" cy="76" r="4"/>
<circle ${KEY} cx="180" cy="84" r="4"/>
<circle ${KEY} cx="142" cy="72" r="2.6"/>
<circle ${KEY} cx="158" cy="72" r="2.6"/>
</g>`;
const PAD_ANCHORS = [
  { part: 'LT', x: 116, y: 40, side: 'left' },
  { part: 'LB', x: 112, y: 50, side: 'left' },
  { part: 'view', x: 142, y: 72, side: 'left' },
  { part: 'L', press: 'L3', x: 122, y: 76, side: 'left' },
  { part: 'dpad', x: 134, y: 99, side: 'left' },
  { part: 'RT', x: 184, y: 40, side: 'right' },
  { part: 'RB', x: 188, y: 50, side: 'right' },
  { part: 'start', x: 158, y: 72, side: 'right' },
  { part: 'Y', x: 180, y: 68, side: 'right' },
  { part: 'X', x: 172, y: 76, side: 'right' },
  { part: 'B', x: 188, y: 76, side: 'right' },
  { part: 'A', x: 180, y: 84, side: 'right' },
  { part: 'R', press: 'R3', x: 166, y: 98, side: 'bottom' },
];

function padGuide(pad) {
  if (!pad) {
    // nothing for a gamepad to do here: the gamepad, dimmed, and why
    const note = textLines(['No gamepad controls here: use the mouse and keyboard, or XR controllers.'].flatMap((t) => wrap(t, 220)), W / 2, 146, 'middle', { fill: MUTED });
    return svgOf(`<g opacity="0.45">${PAD_SHAPE}</g>${note}`, 30, 172);
  }
  const device = labelledDevice(PAD_SHAPE, PAD_ANCHORS, pad, { minHeight: 150, below: 142 });
  return svgOf(device.body, device.top, device.bottom);
}

// --- the XR controllers: a pair, as held (left and right), from behind ---

// the left controller; the right one is its mirror image (x → W - x)
const XR_LEFT = {
  handle: 'M115 64 C112 88 115 116 121 132 C124 140 132 140 135 132 C140 116 141 88 138 64 Z',
  face: { cx: 127, cy: 57, rx: 22, ry: 16 },
  trigger: { x: 119, y: 38, w: 16, h: 7 },
  stick: { cx: 119, cy: 56, r: 6.5 },
  upper: { cx: 135, cy: 50, r: 3.6 }, // Y (B on the right)
  lower: { cx: 138, cy: 61, r: 3.6 }, // X (A on the right)
  menu: { cx: 125, cy: 67, r: 2 },
  grip: { x: 135, y: 82, w: 5, h: 26 },
};

function xrController(hand) {
  const m = hand === 'left' ? (x) => x : (x) => W - x;
  const c = XR_LEFT;
  const handle = c.handle.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${m(Number(x))} ${y}`);
  const rect = (r) => `x="${Math.min(m(r.x), m(r.x + r.w))}" y="${r.y}" width="${r.w}" height="${r.h}"`;
  const shape =
    `<path ${SHAPE} d="${handle}"/>` +
    `<ellipse ${SHAPE} cx="${m(c.face.cx)}" cy="${c.face.cy}" rx="${c.face.rx}" ry="${c.face.ry}"/>` +
    `<rect ${KEY} ${rect(c.trigger)} rx="3.5"/>` +
    `<circle ${KEY} cx="${m(c.stick.cx)}" cy="${c.stick.cy}" r="${c.stick.r}"/>` +
    `<circle ${KEY} cx="${m(c.upper.cx)}" cy="${c.upper.cy}" r="${c.upper.r}"/>` +
    `<circle ${KEY} cx="${m(c.lower.cx)}" cy="${c.lower.cy}" r="${c.lower.r}"/>` +
    `<circle ${KEY} cx="${m(c.menu.cx)}" cy="${c.menu.cy}" r="${c.menu.r}"/>` +
    `<rect ${KEY} ${rect(c.grip)} rx="2.5"/>` +
    textLines([hand === 'left' ? 'Left' : 'Right'], m(127), 144, 'middle', { fill: MUTED });
  const side = hand;
  const [upper, lower] = hand === 'left' ? ['y-button', 'x-button'] : ['b-button', 'a-button'];
  const anchors = [
    { part: 'xr-standard-trigger', x: m(c.trigger.x + c.trigger.w / 2), y: c.trigger.y + c.trigger.h / 2, side },
    { part: upper, x: m(c.upper.cx), y: c.upper.cy, side },
    { part: 'xr-standard-thumbstick', x: m(c.stick.cx), y: c.stick.cy, side },
    { part: lower, x: m(c.lower.cx), y: c.lower.cy, side },
    { part: 'menu', x: m(c.menu.cx), y: c.menu.cy, side },
    { part: 'xr-standard-squeeze', x: m(c.grip.x + c.grip.w / 2), y: c.grip.y + c.grip.h / 2, side },
  ];
  return { shape, anchors };
}

function xrGuide(xr) {
  const left = xrController('left');
  const right = xrController('right');
  const labels = [...placeLabels(left.anchors, xr?.left ?? {}, 0), ...placeLabels(right.anchors, xr?.right ?? {}, 0)];
  const top = Math.min(30, ...labels.map((a) => a.ly - 4));
  const bottom = Math.max(152, ...labels.map((a) => a.ly + a.h + 4));
  return svgOf(left.shape + right.shape + labels.map(drawLabel).join(''), top, bottom);
}

/**
 * The guide for input `device` ('mk' | 'pad' | 'xr') from a project's `controls` (see the top of
 * this file): { svg, width, height } (viewBox units; the SVG's own size is that too).
 */
export function controlsGuide(device, controls) {
  if (device === 'pad') return padGuide(controls.pad);
  if (device === 'xr') return xrGuide(controls.xr);
  return mouseGuide(controls.mk ?? {});
}

/** `guide`'s SVG at `width` px wide (for drawing it sharp onto a canvas). */
export function sizedGuideSvg(guide, width) {
  const height = Math.round((width * guide.height) / guide.width);
  return guide.svg.replace(`width="${guide.width}" height="${guide.height}"`, `width="${Math.round(width)}" height="${height}"`);
}

const guideImages = new Map();
/** An image of `guide` at `width` px, for a canvas; `onLoad` once it has loaded, if it hasn't yet. */
export function guideImage(guide, width, onLoad) {
  const svg = sizedGuideSvg(guide, width);
  let img = guideImages.get(svg);
  if (!img) {
    if (guideImages.size > 12) guideImages.clear();
    img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    guideImages.set(svg, img);
  }
  if (!img.complete) img.addEventListener('load', onLoad, { once: true });
  return img;
}
