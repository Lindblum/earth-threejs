// The interface's sounds, synthesized (Web Audio): grid-game-threejs's menu
// tick (its SOUND_EFFECTS.tick: a 35 ms sine gliding from F♯6 to F6), on
// every menu press and every step a thumbstick takes through a panel.
//
// The browser holds audio back until the page has had a click or a key (or
// in XR, a controller's press): the context is made on the first sound, and
// woken by those (see wakeSoundInXR).

const TICK = { f0: 1479.98, f1: 1396.91, dur: 0.035, gain: 0.05 }; // (NOTE.Fs6 → NOTE.F6)
const MIN_GAP_MS = 40; // the same sound no oftener than this (quick repeats don't pile up)

let ctx = null;
let out = null;
let volume = 1; // Accessibility → Volume: 0 (off) to 1
let last = -Infinity;

function audio() {
  if (volume <= 0) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = volume;
    out.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** Accessibility → Volume: 0 (off) to 1. */
export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v || 0));
  if (out) out.gain.value = volume;
}

/** The menu tick (as in grid-game-threejs): a press, or a step through a menu. */
export function playTick() {
  const now = performance.now();
  if (now - last < MIN_GAP_MS) return;
  last = now;
  const c = audio();
  if (!c || c.state !== 'running') return;
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(TICK.f0, t);
  o.frequency.exponentialRampToValueAtTime(TICK.f1, t + TICK.dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(TICK.gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + TICK.dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + TICK.dur + 0.02);
}

/** The page's first click or key lets the audio play (made then, so the first tick isn't lost). */
export function initSound() {
  const wake = () => audio();
  window.addEventListener('pointerdown', wake, { capture: true });
  window.addEventListener('keydown', wake, { capture: true });
  return () => {
    window.removeEventListener('pointerdown', wake, { capture: true });
    window.removeEventListener('keydown', wake, { capture: true });
  };
}

/** In XR the page gets no clicks: a controller's press wakes the audio instead. Returns the undo. */
export function wakeSoundInXR(session) {
  const wake = () => audio();
  session.addEventListener('selectstart', wake);
  session.addEventListener('squeezestart', wake);
  return () => {
    session.removeEventListener('selectstart', wake);
    session.removeEventListener('squeezestart', wake);
  };
}
