import sun from 'lineicons/assets/svgs/regular/sun-1.svg?raw';
import ban from 'lineicons/assets/svgs/regular/ban-2.svg?raw';
import globe from 'lineicons/assets/svgs/regular/globe-1.svg?raw';
import picture from 'lineicons/assets/svgs/regular/gallery.svg?raw';
import eye from 'lineicons/assets/svgs/regular/eye.svg?raw';
import gear from 'lineicons/assets/svgs/regular/gear-1.svg?raw';
import rotate from 'lineicons/assets/svgs/regular/refresh-circle-1-clockwise.svg?raw';
import pause from 'lineicons/assets/svgs/regular/pause.svg?raw';
import diamond from 'lineicons/assets/svgs/regular/diamonds-1.svg?raw';
import chevronDown from 'lineicons/assets/svgs/regular/chevron-down.svg?raw';
import chevronUp from 'lineicons/assets/svgs/regular/chevron-up.svg?raw';
import check from 'lineicons/assets/svgs/regular/check.svg?raw';
import gamepad from 'lineicons/assets/svgs/regular/game-pad-modern-1.svg?raw';
import play from 'lineicons/assets/svgs/regular/play.svg?raw';
import selectCursor from 'lineicons/assets/svgs/regular/select-cursor-1.svg?raw';
import arrowDown from 'lineicons/assets/svgs/regular/arrow-downward.svg?raw';
import floppy from 'lineicons/assets/svgs/regular/floppy-disk-1.svg?raw';
import folder from 'lineicons/assets/svgs/regular/folder-1.svg?raw';
import filePlus from 'lineicons/assets/svgs/regular/file-plus-circle.svg?raw';
import fileMultiple from 'lineicons/assets/svgs/regular/file-multiple.svg?raw';
import volume from 'lineicons/assets/svgs/regular/volume-high.svg?raw';
import volumeMute from 'lineicons/assets/svgs/regular/volume-mute.svg?raw';
import palette from 'lineicons/assets/svgs/regular/colour-palette-3.svg?raw';
import bulb from 'lineicons/assets/svgs/regular/bulb-2.svg?raw';
import clipboard from 'lineicons/assets/svgs/regular/clipboard.svg?raw';
import trash from 'lineicons/assets/svgs/regular/trash-3.svg?raw';
import layers from 'lineicons/assets/svgs/regular/layers-1.svg?raw';
import cloud from 'lineicons/assets/svgs/regular/cloud-2.svg?raw';
import mapMarker from 'lineicons/assets/svgs/regular/map-marker-1.svg?raw';
import mountains from 'lineicons/assets/svgs/regular/mountains-2.svg?raw';
import ruler from 'lineicons/assets/svgs/regular/ruler-1.svg?raw';
import database from 'lineicons/assets/svgs/regular/database-2.svg?raw';
import barChart from 'lineicons/assets/svgs/regular/bar-chart-4.svg?raw';

// Lineicons ship with a fixed fill; recolour to follow the surrounding text
// and size to the font.
const recolour = (svg) =>
  svg
    .replace(/fill="#323544"/g, 'fill="currentColor"')
    .replace(/\swidth="\d+"\sheight="\d+"/, ' width="1.25em" height="1.25em" aria-hidden="true"');

// The free Lineicons set has no VR headset (its "oculus" icon is the brand
// wordmark) and no cube, so these are drawn to match: 24px grid, 1.5px
// rounded strokes.
const headset = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M5.5 7h13A2.5 2.5 0 0 1 21 9.5v5a2.5 2.5 0 0 1-2.5 2.5h-3.13a1.5 1.5 0 0 1-1.3-.76l-.77-1.35a1.5 1.5 0 0 0-2.6 0l-.77 1.35a1.5 1.5 0 0 1-1.3.76H5.5A2.5 2.5 0 0 1 3 14.5v-5A2.5 2.5 0 0 1 5.5 7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
<path d="M3 11.5H1.75M21 11.5h1.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

const cube = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M12 2.75 20.25 7.25v9.5L12 21.25 3.75 16.75v-9.5L12 2.75Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
<path d="M3.75 7.25 12 11.75l8.25-4.5M12 11.75v9.5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

// Sphere: a circle with an equator and a meridian
const sphere = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<circle cx="12" cy="12" r="9.25" stroke="currentColor" stroke-width="1.5"/>
<path d="M2.75 12c0 2.2 4.14 4 9.25 4s9.25-1.8 9.25-4M12 2.75c-2.2 0-4 4.14-4 9.25s1.8 9.25 4 9.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

// Solid background: a filled rectangle, as in grid-game-threejs
const solid = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<rect x="2.75" y="5" width="18.5" height="14" rx="1.5" fill="currentColor" fill-opacity="0.35" stroke="currentColor" stroke-width="1.5"/>
</svg>`;

// Stereo: a pair of eyes (one-eye Mono is Lineicons' eye)
const eyes = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M1.75 12C3.5 9 9 9 10.75 12 9 15 3.5 15 1.75 12Z M13.25 12C15 9 20.5 9 22.25 12 20.5 15 15 15 13.25 12Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
<circle cx="6.25" cy="12" r="1.4" fill="currentColor"/>
<circle cx="17.75" cy="12" r="1.4" fill="currentColor"/>
</svg>`;

// View Mode icons, drawn to match: a screen, the screen split in two,
// the screen in rows, a phone, and a phone turned sideways in a viewer (two lenses)
const monitor = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<rect x="2.75" y="4.25" width="18.5" height="12" rx="1.75" stroke="currentColor" stroke-width="1.5"/>
<path d="M12 16.25v3.5M8.5 19.75h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

// Display: the screen, as Normal view's
const display = monitor;

const monitorSbs = monitor.replace(
  '</svg>',
  `<path d="M12 6v8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
<circle cx="7.4" cy="10.25" r="1.4" fill="currentColor"/>
<circle cx="16.6" cy="10.25" r="1.4" fill="currentColor"/>
</svg>`,
);

// Interlaced: the screen's rows, alternate ones solid and dashed
const monitorInterlaced = monitor.replace(
  '</svg>',
  `<path d="M6 7.75h12M6 12.75h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
<path d="M6 10.25h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="2 2.5"/>
</svg>`,
);

const phone = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<rect x="6.75" y="2.75" width="10.5" height="18.5" rx="2" stroke="currentColor" stroke-width="1.5"/>
<path d="M10.75 18.25h2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

const phoneViewer = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<rect x="2.75" y="6.75" width="18.5" height="10.5" rx="2" stroke="currentColor" stroke-width="1.5"/>
<path d="M12 6.75v10.5" stroke="currentColor" stroke-width="1.5"/>
<circle cx="7.4" cy="12" r="2.1" stroke="currentColor" stroke-width="1.5"/>
<circle cx="16.6" cy="12" r="2.1" stroke="currentColor" stroke-width="1.5"/>
</svg>`;

// Edges: a wire frame, a ball at each corner
const edges = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M5 5h14v14H5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
<circle cx="5" cy="5" r="2" fill="currentColor"/>
<circle cx="19" cy="5" r="2" fill="currentColor"/>
<circle cx="5" cy="19" r="2" fill="currentColor"/>
<circle cx="19" cy="19" r="2" fill="currentColor"/>
</svg>`;

// XR unavailable: the headset, struck through
const headsetOff = headset.replace(
  '</svg>',
  `<path d="M3.5 3.5 20.5 20.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`,
);

// Accessibility: the figure with open arms, in a circle
const accessibility = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<circle cx="12" cy="12" r="9.25" stroke="currentColor" stroke-width="1.5"/>
<circle cx="12" cy="7.4" r="1.4" fill="currentColor"/>
<path d="M7.5 10.1 12 11l4.5-.9M12 11v3.2m0 0-2.2 3.6m2.2-3.6 2.2 3.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// Text Size: a big A beside a small one
const textSize = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M2.75 19.25 8 4.75l5.25 14.5M4.6 14.25h6.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M14.25 19.25 17.75 10l3.5 9.25M15.5 16.25h4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// VSync, as in grid-game-threejs: a display with a frame edge running
// straight down it, or, off, torn: the edge jumping sideways halfway down
const vsyncOn = monitor.replace(
  '</svg>',
  `<path d="M10.5 6.75v7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`,
);
const vsyncOff = monitor.replace(
  '</svg>',
  `<path d="M9.5 6.75v3.5M13.5 10.25v3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
<path d="M6 10.25h12" stroke="currentColor" stroke-width="1" stroke-opacity="0.45" stroke-linecap="round"/>
</svg>`,
);

// XR Resolution: a pixel grid, its cells finer toward one corner (as in grid-game-threejs)
const xrResolution = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<rect x="3.75" y="3.75" width="16.5" height="16.5" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
<path d="M12 3.75v16.5M3.75 12h16.5" stroke="currentColor" stroke-width="1.5"/>
<path d="M7.9 3.75V12M3.75 7.9H12" stroke="currentColor" stroke-width="1" stroke-opacity="0.6"/>
</svg>`;

// Controller Guide: a gamepad, struck through when off
const controllerGuideOn = recolour(gamepad);
const controllerGuideOff = recolour(gamepad).replace(
  '</svg>',
  `<path d="M3.5 3.5 20.5 20.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`,
);

const gravity = recolour(arrowDown);
const gravityOff = gravity.replace(
  '</svg>',
  `<path d="M3.5 3.5 20.5 20.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`,
);

/** `svg` struck through, for an effect turned off. */
const struck = (svg) => svg.replace('</svg>', '<path d="M3.5 3.5 20.5 20.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>');
const drawn = (d) =>
  `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="${d}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
// Refraction: a ray bent as it passes through a block
const refraction = drawn('M7 4.75h10v14.5H7ZM2.75 8.5 7 10.25l10 3.5 4.25 1.75');
// Shadows: a ball and its shadow on the ground
const shadows = drawn('M15.25 9a4.25 4.25 0 1 1-8.5 0 4.25 4.25 0 0 1 8.5 0ZM4.75 19.25c0 1 3.25 1.75 7.25 1.75s7.25-.75 7.25-1.75-3.25-1.75-7.25-1.75-7.25.75-7.25 1.75Z');
// Liquid surfaces: smooth, a drop; droplets, three of them
const liquidSmooth = drawn('M12 3.25s6.25 6.6 6.25 10.75a6.25 6.25 0 0 1-12.5 0C5.75 9.85 12 3.25 12 3.25Z');
const liquidDrops = drawn('M7.5 7.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM16.25 9a3.25 3.25 0 1 1-6.5 0 3.25 3.25 0 0 1 6.5 0ZM12.75 17.5a2.75 2.75 0 1 1-5.5 0 2.75 2.75 0 0 1 5.5 0ZM21.25 16.25a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z');

// Copy: two sheets, one over the other; Grid: a lattice
const copy = drawn('M8.75 8.75h10.5v10.5H8.75ZM15.25 8.75v-4H4.75v10.5h4');
// a pencil
const pencil = drawn('M15.75 4.75 19.25 8.25 8.5 19H5v-3.5ZM13.25 7.25l3.5 3.5');
const grid = drawn('M4.75 4.75h14.5v14.5H4.75ZM9.6 4.75v14.5M14.4 4.75v14.5M4.75 9.6h14.5M4.75 14.4h14.5');

// Satellite: a body with two solar panels; Map: a sheet folded in three
const satellite = drawn('M9.5 9.5l5 5M12 7l5 5-2.5 2.5-5-5ZM4.25 9.25 7.75 5.75l2.5 2.5-3.5 3.5ZM13.75 18.75l3.5-3.5 2.5 2.5-3.5 3.5ZM17 4.75a2.25 2.25 0 0 1 2.25 2.25');
const map = drawn('M3.75 6.25 9 4.25l6 2 5.25-2v13.5L15 19.75l-6-2-5.25 2ZM9 4.25v13.5M15 6.25v13.5');

const ICONS = {
  location: recolour(mapMarker),
  globe: recolour(globe),
  layers: recolour(layers),
  satellite,
  map,
  terrainOn: recolour(mountains),
  terrainOff: struck(recolour(mountains)),
  cloudsOn: recolour(cloud),
  cloudsOff: struck(recolour(cloud)),
  colorMatchOn: recolour(palette),
  colorMatchOff: struck(recolour(palette)),
  realSize: recolour(ruler),
  memory: recolour(database),
  statsOn: recolour(barChart),
  statsOff: struck(recolour(barChart)),
  copy,
  paste: recolour(clipboard),
  delete: recolour(trash),
  gridOn: grid,
  gridOff: struck(grid),
  refractionOn: refraction,
  refractionOff: struck(refraction),
  shadowsOn: shadows,
  shadowsOff: struck(shadows),
  glowOn: recolour(bulb),
  glowOff: struck(recolour(bulb)),
  detailOn: recolour(layers),
  detailOff: struck(recolour(layers)),
  liquidOn: liquidSmooth,
  liquidOff: liquidDrops,
  particlesHigh: recolour(cloud),
  particlesLow: struck(recolour(cloud)).replace('M3.5 3.5 20.5 20.5', 'M6 18.5 18 18.5'),
  mono: recolour(eye),
  stereo: eyes,
  vr: headset,
  vrOff: headsetOff,
  on: recolour(sun),
  off: recolour(ban),
  solid,
  gear: recolour(gear),
  edit: pencil,
  skybox: recolour(globe),
  passthrough: recolour(picture),
  rotate: recolour(rotate),
  pause: recolour(pause),
  shape: cube,
  sphere,
  select: recolour(selectCursor),
  play: recolour(play),
  eye: recolour(eye),
  gravity,
  gravityOff,
  file: recolour(fileMultiple),
  newScene: recolour(filePlus),
  save: recolour(floppy),
  open: recolour(folder),
  soundOn: recolour(volume),
  soundOff: recolour(volumeMute),
  material: recolour(palette),
  // Vibration (as grid-game-threejs's): a controller's handle with buzz lines either side, or still and struck through
  vibrationOn: `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M9.1 4.3h5.8v15.4H9.1ZM5.8 7.7 4.3 10.1l1.5 2.4-1.5 2.4M18.2 7.7l1.5 2.4-1.5 2.4 1.5 2.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  vibrationOff: `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M9.1 4.3h5.8v15.4H9.1ZM4.3 20.2 19.7 3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  reflectionsOn: recolour(sun),
  reflectionsOff: recolour(sun).replace('</svg>', '<path d="M3.5 3.5 20.5 20.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'),
  edges,
  monitor,
  display,
  monitorSbs,
  monitorInterlaced,
  phone,
  phoneViewer,
  faces: recolour(diamond),
  // a dropdown, closed and open, and the chosen option in its list
  dropdown: recolour(chevronDown),
  dropdownOpen: recolour(chevronUp),
  check: recolour(check),
  accessibility,
  textSize,
  xrResolution,
  vsyncOn,
  vsyncOff,
  controllerGuideOn,
  controllerGuideOff,
};


/** An icon as a standalone SVG in a fixed colour, for drawing onto a canvas. */
export function iconSvg(name, color = '#ffffff') {
  return (ICONS[name] ?? '')
    .replace(/currentColor/g, color)
    .replace(/width="1\.25em" height="1\.25em"/, 'width="96" height="96"');
}

export default function Icon({ name }) {
  return <span className="icon" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;
}
