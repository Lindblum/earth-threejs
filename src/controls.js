// What each input does here, for Options → Controls (controlsGuide.js draws it) and the
// XR Control Guides (ControllerGuide.jsx labels the controllers with XR_CONTROLS).

/** XR controllers: what each part does, by hand; the XR Control Guides' labels too. */
const GRIP = `Both held: hold the world
Apart / together: scale it
Turn / move them: turn, drag it
On a menu: take it
Tap twice: dock / undock
Tap 3 times: menus here`;
const TRIGGER = `Point and press a menu
Pull while moving: faster`;
export const XR_CONTROLS = {
  left: {
    'xr-standard-trigger': TRIGGER,
    'xr-standard-squeeze': GRIP,
    'xr-standard-thumbstick': `Move where it points
(point down: come down)
Pointing at a menu: scroll it
Its menu pointed at: step through
Press: this hand's menus / back
Holding a menu: push / pull, roll`,
    'x-button': 'In menus: choose',
    'y-button': 'In menus: back a level',
  },
  right: {
    'xr-standard-trigger': TRIGGER,
    'xr-standard-squeeze': GRIP,
    'xr-standard-thumbstick': `Up / down: rise, come down
Left / right: turn
Pointing at a menu: scroll it
Its menu pointed at: step through
Press: this hand's menus / back
Holding a menu: push / pull, roll`,
    'a-button': 'In menus: choose',
    'b-button': 'In menus: back a level',
  },
};
/** Each input's controls (see controlsGuide.js): no gamepad controls yet. */
export const CONTROLS = {
  mk: {
    mouse: {
      left: 'Drag: move over the Earth\nCtrl-drag: turn, tilt',
      wheel: 'Scale, about the mouse',
      right: 'Drag: turn; up / down: tilt',
    },
    keys: [
      { keys: ['W', 'A', 'S', 'D', '/', '↑', '←', '↓', '→'], action: 'Move' },
      { keys: ['Q', '/', 'E'], action: 'Turn' },
      { keys: ['R', '/', 'F'], action: 'Scale up / down' },
      { keys: ['Enter', '/', 'Esc'], action: 'Options' },
      { keys: ['W', 'S', '/', '↑', '↓'], action: 'Mouse over a menu: step through it' },
      { keys: ['A', 'D', '/', '←', '→'], action: 'Mouse over a menu: set a slider' },
      { keys: ['Enter', '/', 'Space'], action: 'Mouse over a menu: press' },
      { keys: ['Backspace'], action: 'Mouse over a menu: back a level' },
    ],
  },
  pad: null,
  xr: XR_CONTROLS,
};
