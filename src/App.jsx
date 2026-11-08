import { Fragment, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Canvas } from '@react-three/fiber';
import { XR, createXRStore, useXRSessionModeSupported } from '@react-three/xr';
import Scene from './Scene.jsx';
import Icon from './Icon.jsx';
import { getLastInput, subscribeLastInput, watchXRInput } from './controlsGuide.js';
import { phoneARSessionInit } from './PhoneStereo.jsx';
import { XR_RESOLUTION, setXRViewportScale } from './xrResolution.js';
import { CardboardOverlay, canUseCardboard, enterCardboard, exitCardboard } from './Cardboard.jsx';
import { Stopped, rememberError, takeLastError } from './Recovery.jsx';
import { setVibration } from './grip.js';
import { initSound, playTick, setVolume, wakeSoundInXR } from './sound.js';
import { readSetting, writeSetting } from './settings.js';
import { EarthPose } from './EarthPose.js';
import { DEG, formatLatLon } from './geo.js';
import { IMAGERY, credits, imageryDate } from './sources.js';
import { clearTileCache } from './tileCache.js';
import { approximateLocation, keepView, lastView, preciseLocation } from './location.js';
import {
  DETAIL,
  MENU_TOGGLE,
  PICK_PREFIX,
  SCALE_RESET,
  TEXT_SIZE,
  TILE_MEMORY,
  VIBRATION,
  VIEW_TOGGLE,
  VOLUME,
  XR_VIEWS,
  availableViews,
  menuItems,
  optionsPanel,
  parseSlide,
  parseSlideEnd,
  pickedChoice,
  possibleLabels,
  possibleSliderNames,
  settingItems,
  slideEndId,
  slideId,
  menuPointer,
  snapToSlider,
  splitLabel,
  viewPanel,
} from './menu.js';

// How the display settings work:
//   Background (Solid / Skybox / Passthrough): what is behind the globe. Changes live.
//   View: picks from the views this device supports (see menu.js):
//     Normal and 3D: SBS (half side-by-side, for 3D TVs) are windowed.
//     The XR views start a session, only from a tap, as browsers require.
//
// XR: HMD Stereo (headsets) starts an AR session where supported (so every
// background, passthrough included, can be switched live), otherwise VR.
// XR: Phone AR / Phone Viewer start one AR session (tracked by ARCore) that
// the app draws as one view, or two lens-corrected eyes for a phone viewer.
// Phones without AR get a view steered by the motion sensors instead.

const xrOptions = {
  // the grips hold the world and the panels themselves (see Grab.jsx): no grab pointers
  controller: { grabPointer: false },
  frameRate: 'high',
  emulate: import.meta.env.DEV ? 'metaQuest3' : false,
  foveation: 0.5,
  frameBufferScaling: undefined, // Options → Display → XR Resolution, set as each session starts (see enterXR)
};
const store = createXRStore(xrOptions);
if (import.meta.env.DEV) window.__xrStore = store;

function enterPhoneAR() {
  xrOptions.customSessionInit = phoneARSessionInit(store.getState().domOverlayRoot);
  try {
    return store.enterAR();
  } finally {
    xrOptions.customSessionInit = undefined;
  }
}

function isPhone() {
  if (isHeadsetBrowser()) return false;
  return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) && canUseCardboard();
}

function isHeadsetBrowser() {
  return /OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent);
}

const toggleIn = (id) => (list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

/** Settings kept in this browser (cookies: see settings.js), read back with `fallback` for anything missing. */
const loadSetting = (key, fallback) => readSetting(key, fallback);
function useKept(key, initial) {
  const [value, setValue] = useState(initial);
  useEffect(() => writeSetting(key, value), [key, value]);
  return [value, setValue];
}

const MAP_KEY = 'earth.map';
const MAP_VERSION = 2; // (2: Color Blending off by default)
const ACCESSIBILITY_KEY = 'earth.accessibility';
const XR_RESOLUTION_KEY = 'earth.xrResolution';
const VSYNC_KEY = 'earth.vsync';
const STATS_KEY = 'earth.stats';

/** Map settings: { imagery, terrain, colorMatch, clouds, constellations, detail, tileMemory }, as last left. */
function loadMap() {
  const saved = loadSetting(MAP_KEY, {});
  return {
    imagery: IMAGERY[saved.imagery] ? saved.imagery : 'esri',
    terrain: saved.terrain !== false,
    // (Display → Color Blending: off unless chosen; saved before version 2, it was only the old default, On)
    colorMatch: saved.version >= MAP_VERSION ? saved.colorMatch === true : false,
    version: MAP_VERSION,
    clouds: saved.clouds === true,
    constellations: saved.constellations === true,
    detail: snapToSlider(DETAIL, saved.detail),
    tileMemory: snapToSlider(TILE_MEMORY, saved.tileMemory ?? (isHeadsetBrowser() ? 350 : TILE_MEMORY.default)),
  };
}

function loadAccessibility() {
  const saved = loadSetting(ACCESSIBILITY_KEY, {});
  return {
    volume: snapToSlider(VOLUME, saved.volume),
    vibration: snapToSlider(VIBRATION, saved.vibration),
    textSize: snapToSlider(TEXT_SIZE, saved.textSize),
    controllerGuide: saved.controllerGuide === true,
  };
}

/** Where you start, and at what scale: 1:1,000 (a city in a room, standing a giant over it). */
const START_SCALE = 1e-3;

function useViewerState() {
  const [background, setBackground] = useState('skybox');
  const [screenView, setScreenView] = useState('normal');
  const [phoneStereo, setPhoneStereo] = useState(true);
  const [handheld, setHandheld] = useState(false);
  const [keepXRPose, setKeepXRPose] = useState(false);
  const [menuOpen, setMenuOpen] = useState(true);
  const [groups, setGroups] = useState([]);
  const [dropdowns, setDropdowns] = useState([]);
  const [map, setMap] = useKept(MAP_KEY, loadMap());
  const [accessibility, setAccessibility] = useKept(ACCESSIBILITY_KEY, loadAccessibility());
  useEffect(() => setVibration(accessibility.vibration), [accessibility.vibration]);
  useEffect(() => setVolume(accessibility.volume), [accessibility.volume]);
  const [vsync, setVSync] = useKept(VSYNC_KEY, loadSetting(VSYNC_KEY, true) !== false);
  const [stats, setStats] = useKept(STATS_KEY, loadSetting(STATS_KEY, false) === true);
  const [xrResolution, setXRResolution] = useKept(XR_RESOLUTION_KEY, snapToSlider(XR_RESOLUTION, loadSetting(XR_RESOLUTION_KEY, null)));
  const [xrResolutionActive, setXRResolutionActive] = useState(null);
  useEffect(() => setXRViewportScale(xrResolution, xrResolutionActive), [xrResolution, xrResolutionActive]);
  const [scale, setScale] = useState(START_SCALE);
  const [locating, setLocating] = useState(null); // 'network' | 'device' while finding where you are
  const [cacheCleared, setCacheCleared] = useState(false);
  // Text Size being dragged: only its label shows the new size, until it's let go
  const [textSizeDragged, setTextSizeDragged] = useState(null);
  const dragged = useRef(null);
  const dragTextSize = (v) => setTextSizeDragged((dragged.current = snapToSlider(TEXT_SIZE, v)));
  const commitTextSize = () => {
    const v = dragged.current;
    if (v == null) return;
    dragged.current = null;
    setTextSizeDragged(null);
    setAccessibility((a) => ({ ...a, textSize: v }));
  };
  useEffect(() => {
    if (textSizeDragged == null) return;
    window.addEventListener('pointerup', commitTextSize);
    window.addEventListener('pointercancel', commitTextSize);
    return () => {
      window.removeEventListener('pointerup', commitTextSize);
      window.removeEventListener('pointercancel', commitTextSize);
    };
  }, [textSizeDragged != null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    document.documentElement.style.setProperty('--text-scale', String(accessibility.textSize));
  }, [accessibility.textSize]);

  const actions = useMemo(
    () => ({
      setVibration: (v) => setAccessibility((a) => ({ ...a, vibration: snapToSlider(VIBRATION, v) })),
      setVolume: (v) => setAccessibility((a) => ({ ...a, volume: snapToSlider(VOLUME, v) })),
      setMap: (change) => setMap((m) => ({ ...m, ...change })),
      setScale,
      setLocating,
      setCacheCleared,
      toggleStats: () => setStats((v) => !v),
      setBackground,
      setScreenView,
      setPhoneStereo,
      setHandheld,
      toggleMenu: () => {
        setMenuOpen((v) => !v);
        setGroups([]);
        setDropdowns([]);
      },
      toggleGroup: (id) => setGroups(toggleIn(id)),
      toggleDropdown: (id) => setDropdowns(toggleIn(id)),
      closeDropdown: (id) => setDropdowns((list) => list.filter((x) => x !== id)),
      dragTextSize,
      commitTextSize,
      toggleControllerGuide: () => setAccessibility((a) => ({ ...a, controllerGuide: !a.controllerGuide })),
      setXRResolution: (v) => setXRResolution(snapToSlider(XR_RESOLUTION, v)),
      toggleVSync: () => setVSync((v) => !v),
      setXRResolutionActive,
      setKeepXRPose,
    }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const state = {
    ...map,
    stats,
    scale,
    locating,
    cacheCleared,
    background,
    passthrough: background === 'passthrough',
    screenView,
    stereo: phoneStereo,
    handheld,
    menuOpen,
    groups,
    dropdowns,
    ...accessibility,
    textSizeDragged,
    vsync,
    xrResolution,
    xrResolutionActive,
    keepXRPose,
  };
  return [state, actions];
}

function useKeyboard(actions) {
  useEffect(() => {
    const keymap = { Enter: actions.toggleMenu, NumpadEnter: actions.toggleMenu, Escape: actions.toggleMenu };
    const onKey = (e) => {
      if (e.repeat || e.defaultPrevented || e.target.closest?.('input, select, textarea')) return;
      const action = keymap[e.code];
      if (!action) return;
      e.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);
}

// The windowed panels with the keys that move you (the sticks' stand-ins),
// while the mouse is over a panel: they work the panel instead of the world,
// as a stick does in XR while its controller points at one. W / S or up /
// down step through its buttons, settings and choices, starting at the one
// under the mouse; A / D or left / right set a slider; Enter or Space presses
// the one lit; Backspace goes up a level (closes its group or dropdown).
const MENU_KEYS = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Enter: 'press',
  NumpadEnter: 'press',
  Space: 'press',
  Backspace: 'back',
};
const MENU_CONTROLS = '.hud button.collapse, .hud button.menu-btn, .hud .menu-option, .hud input[type="range"]';

/** The keys that move you work the panel under the mouse instead (see above); `selectRef`: ref to onSelect. */
function useMenuKeys(selectRef) {
  useEffect(() => {
    let stack = null; // the panels under the mouse (in 3D: SBS, one eye's copy)
    let hovered = null; // the control under the mouse, as last seen
    let started = null; // ...when the keys last took over from it
    let sliding = null; // a slider being set with the keys: its id
    const controlOf = (el) => {
      const c = el?.closest?.('button, label.menu-slider');
      return c?.matches('label') ? c.querySelector('input') : c;
    };
    const controls = () => [...(stack ?? document).querySelectorAll(MENU_CONTROLS)].filter((c) => !c.disabled && !c.closest('.menu-sizer'));
    const onMove = (e) => {
      const over = Boolean(e.target.closest?.('.hud'));
      menuPointer.over = over;
      if (over) stack = e.target.closest('.hud-stack');
      hovered = over ? controlOf(e.target) : null;
    };
    const onLeave = () => {
      menuPointer.over = false;
      hovered = null;
    };
    const onKey = (e) => {
      const action = MENU_KEYS[e.code];
      if (!action || !menuPointer.over) return;
      if (e.type === 'keyup') {
        if (sliding && (action === 'left' || action === 'right')) {
          selectRef.current?.(slideEndId(sliding));
          sliding = null;
        }
        return;
      }
      e.preventDefault(); // (no scrolling, no native presses or slider steps, and the world doesn't move: see DesktopControls)
      const list = controls();
      if (!list.length) return;
      let at = list.indexOf(document.activeElement);
      // the mouse has moved onto another control since: the keys go on from there
      if (hovered && hovered !== started && list.includes(hovered)) {
        at = list.indexOf(hovered);
        started = hovered;
        if (action === 'up' || action === 'down') {
          hovered.focus({ focusVisible: true });
          playTick();
          return;
        }
      }
      if (at < 0) {
        // nothing lit yet, nor under the mouse: up / down light the first
        if (action === 'up' || action === 'down') {
          list[0].focus({ focusVisible: true });
          playTick();
        }
        return;
      }
      const control = list[at];
      if (action === 'up' || action === 'down') {
        const next = list[Math.min(list.length - 1, Math.max(0, at + (action === 'up' ? -1 : 1)))];
        if (next !== control) {
          next.focus({ focusVisible: true });
          next.scrollIntoView({ block: 'nearest' });
          playTick();
        }
      } else if (action === 'left' || action === 'right') {
        if (control.type !== 'range') return;
        control.focus({ focusVisible: true });
        const step = Number(control.step) || 1;
        const value = Math.min(Number(control.max), Math.max(Number(control.min), +(Number(control.value) + (action === 'left' ? -step : step)).toFixed(4)));
        if (value === Number(control.value)) return;
        sliding = control.dataset.id;
        selectRef.current?.(slideId(sliding, value));
      } else if (action === 'press') {
        if (e.repeat || control.type === 'range') return;
        control.focus({ focusVisible: true });
        control.click();
      } else if (action === 'back') {
        const parent = control.closest('.menu-group, .menu-options')?.previousElementSibling;
        if (!parent?.matches('button')) return;
        parent.click();
        parent.focus({ focusVisible: true });
      }
    };
    window.addEventListener('pointermove', onMove, true);
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('pointermove', onMove, true);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      menuPointer.over = false;
    };
  }, [selectRef]);
}

function useXRSupport() {
  const vr = useXRSessionModeSupported('immersive-vr');
  const ar = useXRSessionModeSupported('immersive-ar');
  return { vr, ar, checked: vr !== undefined || ar !== undefined };
}

const getSessionActive = () => store.getState().session != null;
const getSessionMode = () => store.getState().mode ?? null;
const getDomOverlay = () => store.getState().session?.domOverlayState != null;

const describe = (e) => `${e?.name ?? 'Error'}${e?.message ? ` - ${e.message}` : ''}`;

/** "Name: Value": the name on the left, the value against the right edge. */
function Label({ text }) {
  const { name, value } = splitLabel(text);
  return (
    <span className="label">
      <span className="name">{value ? `${name}:` : name}</span>
      {value && <span className="value">{value}</span>}
    </span>
  );
}

function MenuButtons({ items, labels, sliderNames = [], onSelect }) {
  return (
    <div className="menu-items">
      <MenuList items={items} onSelect={onSelect} />
      {/* invisible, zero-height copies of every possible label and dropdown
          choice, indented like the settings in a group: they set the panel's width */}
      <div className="menu-sizer menu-group" aria-hidden="true">
        {labels.map((label) =>
          sliderNames.includes(splitLabel(label).name) ? (
            <div key={label} className="menu-btn menu-slider">
              <Icon name="layers" />
              <Label text={label} />
              <input type="range" tabIndex={-1} />
            </div>
          ) : (
            <div key={label} className="menu-btn">
              <Icon name="layers" />
              <Label text={label} />
              <Icon name="dropdown" />
            </div>
          ),
        )}
        <div className="menu-options">
          {settingItems(items).flatMap((item) =>
            (item.dropdown?.options ?? []).map((option) => (
              <div key={option.id} className="menu-option">
                {option.icon && <Icon name={option.icon} />}
                <span className="option-label">{option.label}</span>
                <Icon name="check" />
              </div>
            )),
          )}
        </div>
      </div>
    </div>
  );
}

/** Buttons, each followed when open by its group's settings or its dropdown's choices. */
function MenuList({ items, onSelect }) {
  return items.map((item) => {
    const open = (item.group ?? item.dropdown)?.open;
    if (item.slider) {
      const { min, max, step, value } = item.slider;
      return (
        <label key={item.id} className="menu-btn menu-slider" title={item.title}>
          <Icon name={item.icon} />
          <Label text={item.label} />
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            aria-label={splitLabel(item.label).name}
            data-id={item.id}
            onChange={(e) => onSelect(slideId(item.id, Number(e.target.value)))}
            onPointerUp={() => onSelect(slideEndId(item.id))}
            onKeyUp={() => onSelect(slideEndId(item.id))}
          />
        </label>
      );
    }
    return (
      <Fragment key={item.id}>
        <button
          className="menu-btn"
          disabled={item.disabled}
          title={item.title}
          aria-expanded={item.group || item.dropdown ? open : undefined}
          onClick={() => onSelect(item.id)}
        >
          <Icon name={item.icon} />
          <Label text={item.label} />
          {(item.group || item.dropdown) && <Icon name={open ? 'dropdownOpen' : 'dropdown'} />}
        </button>
        {item.group?.open && (
          <div className="menu-group">
            <MenuList items={item.group.items} onSelect={onSelect} />
            {/* Controls: a drawing of what the input last touched does (controlsGuide.js) */}
            {item.group.guide && <div className="controls-guide" dangerouslySetInnerHTML={{ __html: item.group.guide.svg }} />}
          </div>
        )}
        {item.dropdown?.open && (
          <div className="menu-options" role="listbox">
            {item.dropdown.options.map((option) => (
              <button
                key={option.id}
                className={`menu-option${option.selected ? ' selected' : ''}`}
                role="option"
                aria-selected={option.selected}
                disabled={option.disabled}
                title={option.title}
                onClick={() => onSelect(option.id)}
              >
                {option.icon && <Icon name={option.icon} />}
                <span className="option-label">{option.label}</span>
                {option.selected && <Icon name="check" />}
              </button>
            ))}
          </div>
        )}
      </Fragment>
    );
  });
}

/** Calls `onOutside` for a click or tap (not a drag) outside `ref`'s element while `active`. */
function useClickOutside(ref, active, onOutside) {
  const latest = useRef(onOutside);
  latest.current = onOutside;
  useEffect(() => {
    if (!active) return;
    let down = null;
    const onDown = (e) => {
      down = ref.current?.contains(e.target) || e.target.closest?.('.hud-stack') ? null : { x: e.clientX, y: e.clientY };
    };
    const onUp = (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) latest.current();
      down = null;
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
    };
  }, [ref, active]);
}

/** Page elements shown over a phone's AR session, in the store's DOM overlay. */
function XROverlay({ children }) {
  const wrapper = useRef(null);
  useEffect(() => {
    const el = wrapper.current;
    const keep = (e) => e.preventDefault();
    el?.addEventListener('beforexrselect', keep);
    return () => el?.removeEventListener('beforexrselect', keep);
  }, []);
  const root = store.getState().domOverlayRoot;
  return root ? createPortal(<div ref={wrapper}>{children}</div>, root) : null;
}

/**
 * The windowed panels, stacked in the top-left corner (in 3D: SBS a copy for
 * each eye). A click outside them closes Options.
 */
/**
 * 3D: SBS draws each panel twice, a copy for each eye: scrolling either
 * copy's body (wheel, drag, keys) scrolls the other's to match, so both
 * eyes see the same. `ref`: the element round both copies (.sbs-eyes).
 */
function useMirroredScroll(ref, active) {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    let mirroring = false;
    const onScroll = (e) => {
      const el = e.target;
      if (mirroring || !(el instanceof Element) || !el.classList.contains('hud-body')) return;
      const eye = el.closest('.sbs-eye');
      const index = [...eye.querySelectorAll('.hud-body')].indexOf(el);
      mirroring = true;
      for (const other of root.querySelectorAll('.sbs-eye')) {
        if (other === eye) continue;
        const body = other.querySelectorAll('.hud-body')[index];
        if (body) body.scrollTop = el.scrollTop;
      }
      requestAnimationFrame(() => (mirroring = false));
    };
    // (scroll events don't bubble: caught on the way down)
    root.addEventListener('scroll', onScroll, true);
    return () => root.removeEventListener('scroll', onScroll, true);
  }, [ref, active]);
}

function Hud({ panels, onSelect, error, sbs, resizable }) {
  const panel = useRef(null);
  const [size, setSize] = useState(null);
  useClickOutside(panel, panels[0].open, () => onSelect(MENU_TOGGLE));
  useMirroredScroll(panel, sbs);
  const panelProps = { panels, onSelect, error, size: resizable ? size : null, onResize: resizable ? setSize : null };
  if (!sbs) return <HudPanel {...panelProps} panelRef={panel} />;
  return (
    <div className="sbs-eyes" ref={panel}>
      {[0, 1].map((eye) => (
        <div key={eye} className="sbs-eye" aria-hidden={eye === 1 || undefined}>
          <HudPanel {...panelProps} stretch={2} />
        </div>
      ))}
    </div>
  );
}

const HUD_MIN_WIDTH = 200;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const HUD_MIN_HEIGHT = 120;

function ResizeHandle({ stretch = 1, onResize }) {
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const hud = handle.closest('.hud');
    const start = { x: e.clientX, y: e.clientY, width: hud.offsetWidth, height: hud.offsetHeight };
    handle.setPointerCapture(e.pointerId);
    const onMove = (m) =>
      onResize({
        width: clamp(start.width + (m.clientX - start.x) * stretch, HUD_MIN_WIDTH, window.innerWidth - 24),
        height: clamp(start.height + m.clientY - start.y, HUD_MIN_HEIGHT, window.innerHeight - 24),
      });
    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  };
  return <div className="hud-resize" onPointerDown={onPointerDown} onDoubleClick={() => onResize(null)} title="Resize (double-click to fit)" />;
}

function HudPanel({ panelRef, panels, onSelect, error, size, onResize, stretch }) {
  return (
    <div className="hud-stack" ref={panelRef}>
      {panels.map((panel, i) => (
        <Panel key={panel.id} panel={panel} onSelect={onSelect} error={i === 0 ? error : null} size={i === 0 ? size : null} onResize={i === 0 ? onResize : null} stretch={stretch} />
      ))}
    </div>
  );
}

function Panel({ panel, onSelect, error, size, onResize, stretch }) {
  const { toggle, open } = panel;
  const button = (
    <button className="collapse" onClick={() => onSelect(toggle.id)} aria-label={toggle.label} aria-expanded={panel.items.length ? open : undefined} title={toggle.label}>
      <Icon name={toggle.icon} />
    </button>
  );
  if (!open) {
    return (
      <aside className="hud collapsed">
        <header>{button}</header>
      </aside>
    );
  }
  const status = (Array.isArray(panel.status) ? panel.status : [panel.status]).filter(Boolean);
  return (
    <aside className="hud" style={size ? { '--hud-width': `${size.width}px`, '--hud-height': `${size.height}px` } : undefined}>
      <header>
        {button}
        <h1>{panel.title}</h1>
        {panel.corner && (
          <button className="corner" onClick={() => onSelect(panel.corner.id)} title={panel.corner.title}>
            {panel.corner.label}
          </button>
        )}
      </header>
      <div className="hud-body">
        {status.map((line) => (
          <p key={line} className="stats">
            {line}
          </p>
        ))}
        <MenuButtons items={panel.items} labels={panel.labels} sliderNames={panel.sliderNames} onSelect={onSelect} />
        {error && (
          <p className="note error" role="alert">
            {error}
          </p>
        )}
      </div>
      {onResize && <ResizeHandle stretch={stretch} onResize={onResize} />}
    </aside>
  );
}

/** "3.2 km up", "450 m up", "1.7 m up": the viewer's height over the ground, in real metres. */
function heightLabel(clearance, scale) {
  const m = clearance / scale;
  if (!Number.isFinite(m)) return '';
  if (m >= 1e6) return `${Math.round(m / 1000).toLocaleString('en-US')} km up`;
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 1e4 ? 0 : 1)} km up`;
  return `${m >= 10 ? Math.round(m) : m.toFixed(1)} m up`;
}

/** Frames a second, measured over the last second. */
function useFps(active) {
  const [fps, setFps] = useState(null);
  useEffect(() => {
    if (!active) return;
    let frames = 0;
    let last = performance.now();
    let id;
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [active]);
  return fps;
}

export default function App() {
  const [viewerState, actions] = useViewerState();
  useKeyboard(actions);
  const selectRef = useRef(null);
  useMenuKeys(selectRef);
  useEffect(initSound, []);
  const pose = useMemo(() => new EarthPose(), []);
  const globeRef = useRef(null);
  if (import.meta.env.DEV) window.__pose = pose;

  const support = useXRSupport();
  const phone = useMemo(isPhone, []);
  const headset = useMemo(isHeadsetBrowser, []);
  const sessionActive = useSyncExternalStore(store.subscribe, getSessionActive);
  const input = useSyncExternalStore(subscribeLastInput, getLastInput); // (the input last touched: Options → Controls shows it)
  const sessionMode = useSyncExternalStore(store.subscribe, getSessionMode);
  const domOverlay = useSyncExternalStore(store.subscribe, getDomOverlay);
  const inXR = sessionActive || viewerState.handheld;
  const xrSupported = Boolean(support.vr || support.ar);
  const views = useMemo(() => availableViews({ phone, headset, xrSupported }), [phone, headset, xrSupported]);
  const view = inXR ? (phone ? (viewerState.stereo ? 'phoneViewer' : 'phoneAR') : 'hmd') : viewerState.screenView;
  const state = { ...viewerState, view };
  const passthroughAvailable = Boolean(support.ar) || phone;
  const menuOverlay = phone && inXR && !viewerState.stereo && (viewerState.handheld || domOverlay);
  const [error, setError] = useState(takeLastError);
  const [contextLost, setContextLost] = useState(false);
  const [where, setWhere] = useState(null); // { lat, lon, scale, clearance, stats } (see Earth.jsx)
  const [place, setPlace] = useState(null); // the place found at the start, by name
  const start = useRef(null); // where you started (Approximate Location goes back there)
  const fps = useFps(state.stats);
  // when the imagery under you is from (Esri's photos: asked for the place and zoom shown; others: fixed)
  const [dataDate, setDataDate] = useState(null);
  const imageryRef = useRef(state.imagery);
  imageryRef.current = state.imagery;
  useEffect(() => {
    let asked = '';
    const look = () => {
      const { lat: la, lon: lo } = pose.beneath;
      const zoom = globeRef.current?.zoomAt(la, lo);
      if (zoom == null) return;
      const imagery = imageryRef.current;
      const lat = la / DEG;
      const lon = lo / DEG;
      const key = `${imagery}/${zoom}/${lat.toFixed(2)}/${lon.toFixed(2)}`;
      if (key === asked) return;
      asked = key;
      imageryDate(imagery, lat, lon, zoom).then((date) => {
        if (asked === key) setDataDate(date);
      });
    };
    const timer = setInterval(look, 1500);
    return () => clearInterval(timer);
  }, [pose]);
  useEffect(() => setDataDate(null), [state.imagery]);

  /** To (lat, lon) in degrees, at `scale` (or as you are), facing `heading` (rad; north). */
  const goTo = (lat, lon, scale = pose.scale, heading = 0) => {
    pose.scale = scale;
    // (the place beneath the head: in XR you may have walked off the origin)
    pose.setLocation(lat * DEG, lon * DEG, heading, pose.anchor.set(pose.head.x, 0, pose.head.z), globeRef.current?.heightAt(lat * DEG, lon * DEG) ?? 0);
    actions.setScale(pose.scale);
  };

  // the start: roughly where you are (from your network address); else where you last were; else the whole globe
  useEffect(() => {
    let gone = false;
    const last = lastView();
    if (last) {
      pose.scale = last.scale;
      pose.setLocation(last.lat * DEG, last.lon * DEG, last.heading * DEG);
      actions.setScale(pose.scale);
    } else {
      // (the whole globe while you're found)
      pose.scale = 2e-7;
      pose.setLocation(20 * DEG, 0);
      actions.setScale(pose.scale);
    }
    actions.setLocating('network');
    approximateLocation().then((found) => {
      if (gone) return;
      actions.setLocating(null);
      if (found) {
        start.current = found;
        setPlace(found.place || null);
        goTo(found.lat, found.lon, START_SCALE);
      } else if (!last) {
        goTo(20, 0, 2e-7);
        setError("Couldn't find your location: showing the whole globe. Location → My Location asks the device instead.");
      }
    });
    // where you are, kept for next time (and if no location's found then)
    const keep = () => keepView(pose.toJSON());
    const timer = setInterval(keep, 5000);
    window.addEventListener('pagehide', keep);
    return () => {
      gone = true;
      clearInterval(timer);
      window.removeEventListener('pagehide', keep);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const findMe = () => {
    actions.setLocating('device');
    preciseLocation().then((found) => {
      actions.setLocating(null);
      if (found) {
        setError(null);
        goTo(found.lat, found.lon, Math.max(pose.scale, START_SCALE));
      } else setError("Couldn't get this device's location (permission refused, or none to be had).");
    });
  };
  const goBack = () => {
    if (start.current) goTo(start.current.lat, start.current.lon, START_SCALE);
    else {
      actions.setLocating('network');
      approximateLocation().then((found) => {
        actions.setLocating(null);
        if (!found) return setError("Couldn't find your location from the network.");
        start.current = found;
        setPlace(found.place || null);
        goTo(found.lat, found.lon, START_SCALE);
      });
    }
  };
  /** 1:1 scale, standing on the ground beneath you (not the anchor: that may be elsewhere), facing as you were. */
  const realSize = () => goTo(pose.beneath.lat / DEG, pose.beneath.lon / DEG, 1, pose.heading);

  // into an XR view, straight from the tap, at XR Resolution; whether it started
  const enterXR = async (stereo) => {
    setError(null);
    let label = 'AR';
    xrOptions.frameBufferScaling = state.xrResolution;
    try {
      if (phone && support.ar) await enterPhoneAR();
      else if (phone) {
        enterCardboard({ landscape: stereo }).then((sensors) => {
          if (!sensors) console.warn('[earth] motion sensor access denied; the view will not follow the phone');
        });
        actions.setHandheld(true);
      } else if (support.ar) await store.enterAR();
      else {
        label = 'VR';
        await store.enterVR();
      }
    } catch (e) {
      console.error(`[earth] could not start ${label}`, e);
      setError(`Couldn't start ${label}: ${describe(e)}`);
      return false;
    }
    if (store.getState().session) actions.setXRResolutionActive(state.xrResolution);
    return true;
  };
  useEffect(() => {
    if (!sessionActive) actions.setXRResolutionActive(null);
  }, [sessionActive, actions]);
  // in XR the controllers' presses wake the sound (the page gets no clicks there)
  useEffect(() => {
    const session = sessionActive && store.getState().session;
    return session ? wakeSoundInXR(session) : undefined;
  }, [sessionActive]);
  // ...and count as the input last touched (see controlsGuide.js)
  useEffect(() => {
    const session = sessionActive && store.getState().session;
    return session ? watchXRInput(session) : undefined;
  }, [sessionActive]);

  // XR Resolution let go at a new value during a session: the session starts again at it
  const restartingXR = useRef(false);
  const [restartWanted, setRestartWanted] = useState(false);
  useEffect(() => {
    if (!restartWanted) return;
    setRestartWanted(false);
    restartXR();
  });
  const restartXR = async () => {
    const session = store.getState().session;
    if (!session || state.handheld || restartingXR.current || state.xrResolution === state.xrResolutionActive) return;
    restartingXR.current = true;
    actions.setKeepXRPose(true);
    try {
      const ended = new Promise((resolve) => session.addEventListener('end', resolve, { once: true }));
      session.end();
      await ended;
      if (await enterXR(state.stereo)) return;
      setError('XR Resolution changed: tap anywhere to go back into XR');
      const back = (e) => {
        window.removeEventListener('pointerup', back, true);
        window.removeEventListener('keydown', back, true);
        if (store.getState().session) return;
        e.preventDefault();
        e.stopPropagation();
        enterXR(state.stereo).finally(() => actions.setKeepXRPose(false));
      };
      window.addEventListener('pointerup', back, true);
      window.addEventListener('keydown', back, true);
    } finally {
      restartingXR.current = false;
      if (store.getState().session) actions.setKeepXRPose(false);
    }
  };
  const exitXR = () => {
    if (state.handheld) {
      exitCardboard();
      actions.setHandheld(false);
    }
    store.getState().session?.end();
  };

  useEffect(() => {
    if (!state.handheld) return;
    if (state.stereo) screen.orientation?.lock?.('landscape').catch(() => {});
    else screen.orientation?.unlock?.();
  }, [state.handheld, state.stereo]);
  useEffect(() => {
    if (!state.handheld) return;
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) actions.setHandheld(false);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [state.handheld, actions]);

  // the status lines: where you are; the stats; which XR
  const xrStatus = !inXR ? null : state.handheld ? `XR: motion sensors only, ${state.stereo ? 'stereo' : 'mono'}` : phone ? `XR: phone AR, ${state.stereo ? 'stereo' : 'mono'}` : `XR: headset ${sessionMode === 'immersive-ar' ? 'AR' : 'VR'}`;
  const status = [
    where ? `${formatLatLon(where.lat, where.lon, where.scale < 1e-5 ? 2 : 4)} · ${heightLabel(where.clearance, where.scale)}` : state.locating ? 'Finding where you are…' : null,
    // (the place found at the start, while you're still over it)
    dataDate ? `${IMAGERY[state.imagery].group === 'photo' ? 'Imagery' : 'Map data'}: ${dataDate}` : null,
    place && !inXR && where && start.current && Math.hypot(where.lat / DEG - start.current.lat, where.lon / DEG - start.current.lon) < 0.1 ? place : null,
    state.stats && where ? `${fps ?? '–'} fps · ${where.stats.drawn} tiles drawn · ${where.stats.ready} loaded · ${where.stats.loading} loading · zoom ${where.stats.deepest}` : null,
    xrStatus,
    inXR ? credits(state.imagery, state.terrain, state.clouds) : null,
  ];

  const items = menuItems(state.textSizeDragged != null ? { ...state, textSize: state.textSizeDragged } : state, { passthroughAvailable, views, phone, input, checking: !support.checked && !phone });
  const onSelect = (id) => {
    const slide = parseSlide(id);
    // (the menu tick, as in grid-game-threejs: every press, but not every step of a slider's drag)
    if (!slide && !parseSlideEnd(id)) playTick();
    if (slide) slideTo(slide.id, slide.value);
    else if (parseSlideEnd(id) === 'textSize') actions.commitTextSize();
    else if (parseSlideEnd(id) === 'xrResolution') setRestartWanted(true);
    else if (id.startsWith(PICK_PREFIX)) {
      const choice = pickedChoice(items, id);
      if (!choice) return;
      actions.closeDropdown(choice.id);
      choose(choice.id, choice.value);
    } else if (id === MENU_TOGGLE) actions.toggleMenu();
    else if (id === VIEW_TOGGLE) {
      if (inXR) exitXR();
      else selectView('hmd');
    } else if (items.find((item) => item.id === id)?.group) actions.toggleGroup(id);
    else if (settingItems(items).find((item) => item.id === id)?.dropdown) actions.toggleDropdown(id);
    else if (id === 'myLocation') findMe();
    else if (id === 'approximate') goBack();
    else if (id === 'realSize' || id === SCALE_RESET) realSize();
    else if (id === 'terrain') actions.setMap({ terrain: !state.terrain });
    else if (id === 'colorMatch') actions.setMap({ colorMatch: !state.colorMatch });
    else if (id === 'clouds') actions.setMap({ clouds: !state.clouds });
    else if (id === 'constellations') actions.setMap({ constellations: !state.constellations });
    else if (id === 'clearCache')
      clearTileCache().then(
        () => actions.setCacheCleared(true),
        (e) => setError(`Couldn't clear the tile cache: ${describe(e)}`),
      );
    else if (id === 'stats') actions.toggleStats();
    else if (id === 'controllerGuide') actions.toggleControllerGuide();
    else if (id === 'vsync') actions.toggleVSync();
  };
  selectRef.current = onSelect;
  const slideTo = (id, value) => {
    if (id === 'textSize') actions.dragTextSize(value);
    else if (id === 'vibration') actions.setVibration(value);
    else if (id === 'volume') actions.setVolume(value);
    else if (id === 'detail') actions.setMap({ detail: snapToSlider(DETAIL, value) });
    else if (id === 'tileMemory') actions.setMap({ tileMemory: snapToSlider(TILE_MEMORY, value) });
    else if (id === 'xrResolution') actions.setXRResolution(value);
  };
  const choose = (id, value) => {
    if (id === 'imagery') actions.setMap({ imagery: value });
    else if (id === 'background') actions.setBackground(value);
    else if (id === 'view') selectView(value);
  };
  const selectView = (next) => {
    if (next === view) return;
    const toXR = XR_VIEWS.includes(next);
    if (toXR) actions.setPhoneStereo(next === 'phoneViewer');
    if (toXR && !inXR) {
      actions.setScreenView('normal');
      enterXR(next === 'phoneViewer');
    } else if (!toXR) {
      if (inXR) exitXR();
      actions.setScreenView(next);
    }
  };
  const labels = useMemo(() => possibleLabels({ passthroughAvailable, views }), [passthroughAvailable, views]);
  const sliderNames = useMemo(() => possibleSliderNames({ passthroughAvailable, views }), [passthroughAvailable, views]);
  const panels = {
    options: optionsPanel({ open: state.menuOpen, status, items, labels, sliderNames, scale: state.scale }),
    view: views.includes('hmd') ? viewPanel(inXR) : null,
  };
  const leftPanels = [panels.options, ...(panels.view ? [panels.view] : [])];
  const globeOptions = useMemo(
    () => ({ imagery: state.imagery, terrain: state.terrain, clouds: state.clouds, colorMatch: state.colorMatch, detail: state.detail, maxTiles: state.tileMemory }),
    [state.imagery, state.terrain, state.clouds, state.colorMatch, state.detail, state.tileMemory],
  );
  const onStatus = (s) => {
    setWhere(s);
    if (Math.abs(s.scale - state.scale) > state.scale * 0.01) actions.setScale(s.scale);
  };

  return (
    <>
      {contextLost && <Stopped message="The graphics stopped (the browser dropped the 3D view's context)." />}
      <Canvas
        flat
        dpr={[1, 2]}
        camera={{ position: [0, 1.6, 0], fov: 60, near: 0.05, far: 1e4 }}
        onCreated={({ gl }) =>
          gl.domElement.addEventListener('webglcontextlost', () => {
            console.error('[earth] WebGL context lost');
            rememberError('the graphics context was lost');
            setContextLost(true);
          })
        }
      >
        <XR store={store}>
          <Suspense fallback={null}>
            <Scene
              state={state}
              panels={panels}
              onSelect={onSelect}
              menuOverlay={menuOverlay}
              phone={phone}
              pose={pose}
              globeRef={globeRef}
              globeOptions={globeOptions}
              onStatus={onStatus}
              onScale={actions.setScale}
            />
          </Suspense>
        </XR>
      </Canvas>
      {!inXR && <p className="credits">{credits(state.imagery, state.terrain, state.clouds)}</p>}
      {state.handheld ? (
        <>
          <CardboardOverlay split={state.stereo} onExit={exitXR} />
          {menuOverlay && <Hud panels={[panels.options]} onSelect={onSelect} error={error} />}
        </>
      ) : sessionActive ? (
        menuOverlay && (
          <XROverlay>
            <Hud panels={[panels.options]} onSelect={onSelect} error={error} />
          </XROverlay>
        )
      ) : (
        <Hud panels={leftPanels} onSelect={onSelect} error={error} sbs={state.view === 'sbs'} resizable />
      )}
    </>
  );
}
