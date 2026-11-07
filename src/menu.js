// Options menu model shared by the windowed panel (DOM) and the XR panel
// (drawn on a canvas): four groups, Location, Map, Display and Accessibility, each
// opening a list of setting buttons beneath it, each "Name: Value". A
// dropdown opens a list of choices beneath it (a chevron on its right); a
// slider sets a value along its track; the rest toggle when pressed.

import { XR_RESOLUTION } from './xrResolution.js';
import { IMAGERY, IMAGERY_IDS } from './sources.js';

export const MENU_TITLE = 'Earth';

/** The panels' toggle buttons: Options' gear (opens and closes it), the View panel's (into XR or back). */
export const MENU_TOGGLE = 'menu:toggle';
export const VIEW_TOGGLE = 'view:toggle';
/** Options' corner, the world's scale: pressed, back to real size. */
export const SCALE_RESET = 'scale:reset';

/** The world's scale as shown: "1:1" is real size, "1:1,000" a thousandth of it, "10:1" ten times. */
export function scaleLabel(scale) {
  if (scale >= 1) return `${scale >= 9.95 ? Math.round(scale) : +scale.toFixed(1)}:1`;
  const n = 1 / scale;
  const digits = Math.max(0, Math.floor(Math.log10(n)) - 1);
  const rounded = Math.round(n / 10 ** digits) * 10 ** digits;
  return `1:${rounded.toLocaleString('en-US')}`;
}

/**
 * The panels, one template for both renderers (the windowed one in App.jsx,
 * the XR one in XRMenuPanel.jsx), stacked top to bottom: each { id, toggle:
 * { id, icon, label }, title, corner?, status?, open, items, labels? } (items and
 * labels: see menuItems, possibleLabels). Closed, a panel shows only its
 * toggle button, top left; open, the title beside it, `corner` ({ id,
 * label, title, widest }: a small button) in the top-right corner, and its items beneath.
 *
 * Options: the gear, the title, the world's scale, the status lines (where
 * you are; in XR, which XR), the menu. `menu`: { open, status, items, labels, scale }.
 */
export function optionsPanel({ scale, ...menu }) {
  return {
    id: 'options',
    toggle: { id: MENU_TOGGLE, icon: 'gear', label: menu.open ? 'Hide options' : 'Show options' },
    title: MENU_TITLE,
    corner: {
      id: SCALE_RESET,
      label: scaleLabel(scale),
      title: Math.abs(scale - 1) < 1e-3 ? "The world's scale: real size. Scroll, or in XR hold both grips and move your hands apart or together, to scale it" : "The world's scale. Press for real size, where you are",
      widest: '1:20,000,000',
    },
    ...menu,
  };
}

/**
 * The View panel, as in grid-game-threejs: one button, never opened, that
 * switches between the Normal view and XR: HMD Stereo, showing the one it
 * switches to (outside XR the headset, in XR the monitor).
 */
export function viewPanel(inXR) {
  const label = inXR ? 'Normal view' : 'XR: HMD Stereo';
  return { id: 'view', toggle: { id: VIEW_TOGGLE, icon: inXR ? 'monitor' : 'vr', label }, title: label, open: false, items: [] };
}

/** Options → Background, in list order (passthrough last). */
export const BACKGROUNDS = ['solid', 'skybox', 'passthrough'];
const BACKGROUND_LABELS = { solid: 'Solid', skybox: 'Skybox', passthrough: 'Passthrough (XR Only)' };

/** The Vite + React starter's page colour, used for the Solid background. */
export const SOLID_BACKGROUND = '#242424';

/**
 * Options → View, in list order. Normal and the 3D views are windowed; the
 * rest are XR sessions. Phones get the phone views, headsets the HMD one.
 */
export const VIEWS = ['normal', 'sbs', 'interlaced', 'hmd', 'phoneAR', 'phoneViewer'];
export const XR_VIEWS = ['hmd', 'phoneAR', 'phoneViewer'];
const VIEW_LABELS = {
  normal: 'Normal',
  sbs: '3D: SBS',
  interlaced: '3D: Interlaced',
  hmd: 'XR: HMD Stereo',
  phoneAR: 'XR: Phone AR',
  phoneViewer: 'XR: Phone Viewer',
};
const VIEW_ICONS = { normal: 'monitor', sbs: 'monitorSbs', interlaced: 'monitorInterlaced', hmd: 'vr', phoneAR: 'phone', phoneViewer: 'phoneViewer' };

/**
 * The views this device can show. `env`: { phone, headset, xrSupported }.
 * A headset browser's own window can't show the 3D views usefully, so not there.
 */
export function availableViews(env) {
  return VIEWS.filter((view) => {
    if (view === 'sbs' || view === 'interlaced') return !env.headset;
    if (view === 'hmd') return !env.phone && env.xrSupported;
    if (view === 'phoneAR' || view === 'phoneViewer') return env.phone;
    return true;
  });
}

/**
 * A label's setting name and its value, split at the first ": ". The panels
 * draw the name on the left and the value against the right edge.
 */
export function splitLabel(label) {
  const at = label.indexOf(': ');
  return at < 0 ? { name: label, value: '' } : { name: label.slice(0, at), value: label.slice(at + 2) };
}

export const PICK_PREFIX = 'pick:';

/** Map → Detail: how fine the tiles are drawn (a texel at most 1.5 px at 100%); less is faster. */
export const DETAIL = Object.freeze({ min: 0.25, max: 2, step: 0.25, default: 1 });
/** Map → Tile Memory: how many tiles are kept loaded at most. */
export const TILE_MEMORY = Object.freeze({ min: 150, max: 1200, step: 50, default: 450 });

/** Accessibility → Volume: the interface's sounds (the menu tick), 0 (off) to 100%. */
export const VOLUME = Object.freeze({ min: 0, max: 1, step: 0.1, default: 1 });
/** Accessibility → Vibration: every buzz's strength, 0 (off) to 200% (above 100%: stronger, up to the controller's most; as in grid-game-threejs). */
export const VIBRATION = Object.freeze({ min: 0, max: 2, step: 0.1, default: 1 });

/** Accessibility → Text Size: a multiplier on the panels' text and icons, 75% to 200% (as in grid-game-threejs). */
export const TEXT_SIZE = Object.freeze({ min: 0.75, max: 2, step: 0.25, default: 1 });

/** `value` within `spec` ({ min, max, step, default }), snapped to its steps. */
export function snapToSlider(spec, value) {
  const n = value == null || value === '' ? NaN : Number(value); // (nothing saved: the default, not 0)
  const v = Math.min(spec.max, Math.max(spec.min, Number.isFinite(n) ? n : spec.default));
  return +(Math.round(v / spec.step) * spec.step).toFixed(4);
}

const SLIDE_PREFIX = 'slide:';
const SLIDE_END_PREFIX = 'slideEnd:';
/** The id a slider sends to set `value`: "slide:<id>=<value>" (a pointer's press or drag, the gaze's stare). */
export const slideId = (id, value) => `${SLIDE_PREFIX}${id}=${value}`;
/** A "slide:<id>=<value>" id's { id, value }, or null for any other id. */
export function parseSlide(slide) {
  if (!slide?.startsWith(SLIDE_PREFIX)) return null;
  const [id, value] = slide.slice(SLIDE_PREFIX.length).split('=');
  return { id, value: Number(value) };
}
/** The id a slider sends when it's let go ("slideEnd:<id>"), and back: the slider's id, or null. */
export const slideEndId = (id) => `${SLIDE_END_PREFIX}${id}`;
export const parseSlideEnd = (id) => (id?.startsWith(SLIDE_END_PREFIX) ? id.slice(SLIDE_END_PREFIX.length) : null);

const percent = (v) => `${Math.round(v * 100)}%`;

/**
 * A dropdown: the button shows the current choice, and when it is open
 * (in `state.dropdowns`), lists every choice beneath it. `choices`:
 * [{ value, label, icon?, disabled?, title? }]. Choosing one sends "pick:<id>:<index>".
 */
function dropdown(state, id, choices, current) {
  return {
    open: state.dropdowns.includes(id),
    options: choices.map((choice, i) => ({ ...choice, id: `${PICK_PREFIX}${id}:${i}`, selected: choice.value === current })),
  };
}

/** Whether the mouse is over a windowed panel: the keys that move you work the panel instead (see useMenuKeys in App.jsx, DesktopControls). */
export const menuPointer = { over: false };

/**
 * What can be focused in `panel` (for the thumbsticks: see Grab.jsx), top to
 * bottom as drawn: its toggle button, and open, its items, the settings of
 * its open groups and the choices of its open dropdowns, each { id, parent
 * (the open group or dropdown it's in, or null), slider? }. Disabled ones are skipped.
 */
export function focusables(panel) {
  const out = [{ id: panel.toggle.id, parent: null }];
  if (!panel.open) return out;
  const walk = (items, parent) => {
    for (const item of items) {
      if (item.disabled) continue;
      out.push({ id: item.id, parent, slider: item.slider });
      if (item.dropdown?.open) for (const option of item.dropdown.options) if (!option.disabled) out.push({ id: option.id, parent: item.id });
      if (item.group?.open) walk(item.group.items, item.id);
    }
  };
  walk(panel.items, null);
  return out;
}

/** Every setting in `items`, the ones inside groups included. */
export function settingItems(items) {
  return items.flatMap((item) => (item.group ? item.group.items : [item]));
}

/** The dropdown choice a "pick:<id>:<index>" id names, from `items`: { id, value } or null. */
export function pickedChoice(items, pickId) {
  const [id, index] = pickId.slice(PICK_PREFIX.length).split(':');
  const option = settingItems(items).find((item) => item.id === id)?.dropdown?.options[Number(index)];
  return option && !option.disabled ? { id, value: option.value } : null;
}

/**
 * Items: the groups Location, Map, Display and Accessibility, { id, label, icon, group: { open, items } },
 * which, when open (in `state.groups`), list their settings beneath, indented like
 * a dropdown's choices. Settings: { id, label ("Name: Value", see splitLabel),
 * icon, disabled?, title?, dropdown?, slider? }. `slider`: { min, max, step, value }. `dropdown`: { open, options: [{ id,
 * label, value, selected, icon?, disabled?, title? }] }, drawn with a chevron at the
 * far right and, when open, its options beneath. `env`: { passthroughAvailable,
 * views (available), phone, checking }.
 */
export function menuItems(state, env) {
  const settings = settingsById(state, env);
  const group = (id, label, icon, ids) => ({
    id,
    label,
    icon,
    group: { open: state.groups.includes(id), items: ids.map((setting) => settings[setting]) },
  });
  return [
    group('location', 'Location', 'location', ['myLocation', 'approximate', 'realSize']),
    group('map', 'Map', 'layers', ['imagery', 'terrain', 'clouds', 'constellations', 'detail', 'tileMemory', 'clearCache']),
    group('display', 'Display', 'display', ['view', 'background', 'colorMatch', 'stats', 'vsync', 'xrResolution']),
    group('accessibility', 'Accessibility', 'accessibility', ['volume', 'vibration', 'textSize', 'controllerGuide']),
  ];
}

const imageryIcon = (id) => (IMAGERY[id].group === 'photo' ? 'satellite' : 'map');

function settingsById(state, env) {
  const xrMissing = !env.views.some((view) => XR_VIEWS.includes(view));
  const items = [
    {
      id: 'myLocation',
      label: state.locating === 'device' ? 'My Location: Finding…' : 'My Location',
      icon: 'location',
      title: 'Go to where this device is (it asks for permission to use its location)',
    },
    {
      id: 'approximate',
      label: state.locating === 'network' ? 'Approximate Location: Finding…' : 'Approximate Location',
      icon: 'globe',
      title: 'Go back to where you started: roughly where you are, from your network address',
    },
    { id: 'realSize', label: '1:1 Scale', icon: 'realSize', title: 'The world at real size, standing on the ground where you are' },
    {
      id: 'imagery',
      label: `Imagery: ${IMAGERY[state.imagery].label}`,
      icon: imageryIcon(state.imagery),
      dropdown: dropdown(
        state,
        'imagery',
        IMAGERY_IDS.map((id) => ({ value: id, label: IMAGERY[id].label, icon: imageryIcon(id) })),
        state.imagery,
      ),
      title: 'What covers the ground: satellite and aerial photos (Esri, USGS, Sentinel-2, NASA) or maps (street, topographic, ocean...)',
    },
    {
      id: 'terrain',
      label: `Terrain: ${state.terrain ? 'On' : 'Off'}`,
      icon: state.terrain ? 'terrainOn' : 'terrainOff',
      title: 'On: hills and mountains in relief, from elevation tiles. Off: the ground flat (fewer downloads)',
    },
    {
      id: 'colorMatch',
      label: `Color Blending: ${state.colorMatch ? 'On' : 'Off'}`,
      icon: state.colorMatch ? 'colorMatchOn' : 'colorMatchOff',
      title: 'On: where neighbouring tiles come from different photos, their colours are evened out and shaded into each other at the edges. Off: every photo exactly as it is. (Photos only: maps are shown as they are)',
    },
    {
      id: 'clouds',
      label: `Clouds: ${state.clouds ? 'On' : 'Off'}`,
      icon: state.clouds ? 'cloudsOn' : 'cloudsOff',
      title: "The world's clouds as they are now (NOAA's geostationary satellites' infrared, hourly), each at its height",
    },
    {
      id: 'constellations',
      label: `Constellations: ${state.constellations ? 'On' : 'Off'}`,
      icon: state.constellations ? 'constellationsOn' : 'constellationsOff',
      title: "The constellations' figures and names, over the stars where they are now (with the Skybox background)",
    },
    {
      id: 'detail',
      label: `Detail: ${percent(state.detail)}`,
      icon: 'detailOn',
      slider: { ...DETAIL, value: state.detail },
      title: 'How sharp the ground is drawn: more loads finer tiles further off; less is faster',
    },
    {
      id: 'tileMemory',
      label: `Tile Memory: ${state.tileMemory} tiles`,
      icon: 'memory',
      slider: { ...TILE_MEMORY, value: state.tileMemory },
      title: 'How many tiles are kept loaded (about 0.4 MB of graphics memory each): more means fewer reloads looking back',
    },
    { id: 'clearCache', label: state.cacheCleared ? 'Clear Tile Cache: Cleared' : 'Clear Tile Cache', icon: 'delete', title: 'Forget the tiles kept on this device (they download again as needed)' },
    {
      id: 'background',
      label: `Background: ${BACKGROUND_LABELS[state.background]}`,
      icon: state.background,
      dropdown: dropdown(
        state,
        'background',
        BACKGROUNDS.map((b) => {
          const unavailable = b === 'passthrough' && !env.passthroughAvailable;
          return {
            value: b,
            label: BACKGROUND_LABELS[b],
            disabled: unavailable,
            title: unavailable ? 'Passthrough needs an XR headset or a phone camera' : undefined,
          };
        }),
        state.background,
      ),
    },
    {
      id: 'view',
      label: `View Mode: ${VIEW_LABELS[state.view]}`,
      icon: VIEW_ICONS[state.view],
      dropdown: dropdown(
        state,
        'view',
        VIEWS.map((view) => {
          const unavailable = !env.views.includes(view);
          return {
            value: view,
            label: VIEW_LABELS[view],
            icon: VIEW_ICONS[view],
            disabled: unavailable,
            title: unavailable ? viewUnavailableReason(view, env) : undefined,
          };
        }),
        state.view,
      ),
      title: xrMissing && !env.checking ? "WebXR isn't available here. Open the page in a headset browser over HTTPS for XR." : undefined,
    },
    {
      id: 'stats',
      label: `Show Stats: ${state.stats ? 'On' : 'Off'}`,
      icon: state.stats ? 'statsOn' : 'statsOff',
      title: 'Frame rate and tiles drawn, loaded and loading, under the title',
    },
    {
      id: 'vsync',
      label: `VSync: ${state.vsync ? 'On' : 'Off'}`,
      icon: state.vsync ? 'vsyncOn' : 'vsyncOff',
      title: 'On: a frame per display refresh. Off: frames as fast as they can be drawn (not in XR)',
    },
    {
      id: 'xrResolution',
      label: `XR Resolution: ${percent(state.xrResolution)}${state.xrResolutionActive != null && state.xrResolution !== state.xrResolutionActive ? ' (on release)' : ''}`,
      icon: 'xrResolution',
      slider: { ...XR_RESOLUTION, value: state.xrResolution },
      title: "The headset's resolution: lower draws faster",
    },
    {
      id: 'volume',
      label: `Volume: ${state.volume > 0 ? percent(state.volume) : 'Off'}`,
      icon: state.volume > 0 ? 'soundOn' : 'soundOff',
      slider: { ...VOLUME, value: state.volume },
      title: "The interface's sounds: a tick as a menu is pressed or stepped through",
    },
    {
      id: 'vibration',
      label: `Vibration: ${state.vibration > 0 ? percent(state.vibration) : 'Off'}`,
      icon: state.vibration > 0 ? 'vibrationOn' : 'vibrationOff',
      slider: { ...VIBRATION, value: state.vibration },
      title: "The controllers' buzz: taking hold of the world and the panels (above 100%: stronger)",
    },
    {
      id: 'textSize',
      label: `Text Size: ${percent(state.textSize)}`,
      icon: 'textSize',
      slider: { ...TEXT_SIZE, value: state.textSize },
    },
    {
      id: 'controllerGuide',
      label: `Controller Guide: ${state.controllerGuide ? 'On' : 'Off'}`,
      icon: state.controllerGuide ? 'controllerGuideOn' : 'controllerGuideOff',
      title: "In XR, labels beside the controllers' buttons saying what they do",
    },
  ];
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

/** Why this device can't show `view` (see availableViews). */
function viewUnavailableReason(view, env) {
  if (view === 'sbs' || view === 'interlaced') return "A headset's browser can't show the 3D views";
  if (view === 'phoneAR' || view === 'phoneViewer') return 'Needs a phone';
  if (env.phone) return 'Needs a headset';
  return env.checking ? 'Checking for WebXR…' : "WebXR isn't available here. Open the page in a headset browser over HTTPS for XR.";
}

/**
 * Every label the settings can show in this environment, so both panels can
 * size themselves to the widest one and not change width as values change.
 * (The groups' labels are short, so they don't set it; the panels also fit
 * the dropdowns' choices, two to a row.)
 */
export function possibleLabels(env) {
  const labels = new Set();
  const backgrounds = BACKGROUNDS.filter((b) => b !== 'passthrough' || env.passthroughAvailable);
  for (const flag of [false, true])
    for (const background of backgrounds)
      for (const view of env.views)
        for (const imagery of IMAGERY_IDS) {
          const state = { locating: flag ? 'device' : 'network', cacheCleared: flag, imagery, terrain: flag, clouds: flag, constellations: flag, colorMatch: flag, detail: DETAIL.max, tileMemory: TILE_MEMORY.max, stats: flag, volume: 1, vibration: 1, background, view, dropdowns: [], textSize: 1, controllerGuide: flag, vsync: flag, xrResolution: 1, xrResolutionActive: null };
          for (const item of Object.values(settingsById(state, env))) labels.add(item.label);
        }
  labels.add(`Text Size: ${percent(TEXT_SIZE.max)}`);
  labels.add(`Vibration: ${percent(VIBRATION.max)}`);
  labels.add(`Volume: ${percent(VOLUME.max)}`);
  labels.add(`XR Resolution: ${percent(XR_RESOLUTION.max)} (on release)`);
  return [...labels];
}
