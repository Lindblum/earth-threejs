import globe from 'lineicons/assets/svgs/regular/globe-1.svg?raw';
import picture from 'lineicons/assets/svgs/regular/gallery.svg?raw';
import gear from 'lineicons/assets/svgs/regular/gear-1.svg?raw';
import chevronDown from 'lineicons/assets/svgs/regular/chevron-down.svg?raw';
import chevronUp from 'lineicons/assets/svgs/regular/chevron-up.svg?raw';
import check from 'lineicons/assets/svgs/regular/check.svg?raw';
import gamepad from 'lineicons/assets/svgs/regular/game-pad-modern-1.svg?raw';
import volume from 'lineicons/assets/svgs/regular/volume-high.svg?raw';
import volumeMute from 'lineicons/assets/svgs/regular/volume-mute.svg?raw';
import palette from 'lineicons/assets/svgs/regular/colour-palette-3.svg?raw';
import trash from 'lineicons/assets/svgs/regular/trash-3.svg?raw';
import layers from 'lineicons/assets/svgs/regular/layers-1.svg?raw';
import cloud from 'lineicons/assets/svgs/regular/cloud-2.svg?raw';
import mapMarker from 'lineicons/assets/svgs/regular/map-marker-1.svg?raw';
import locationArrow from 'lineicons/assets/svgs/regular/location-arrow-right.svg?raw';
import searchPlus from 'lineicons/assets/svgs/regular/search-plus.svg?raw';
import mountains from 'lineicons/assets/svgs/regular/mountains-2.svg?raw';
import ruler from 'lineicons/assets/svgs/regular/ruler-1.svg?raw';
import database from 'lineicons/assets/svgs/regular/database-2.svg?raw';
import barChart from 'lineicons/assets/svgs/regular/bar-chart-4.svg?raw';

// Lineicons ship with a fixed fill; recolour to follow the surrounding text.
// (Sized by the CSS: --ui-icon, threejs-ui.)
const recolour = (svg) =>
  svg
    .replace(/fill="#323544"/g, 'fill="currentColor"')
    .replace(/\swidth="\d+"\sheight="\d+"/, ' width="1.25em" height="1.25em" aria-hidden="true"');

// The free Lineicons set has no VR headset (its "oculus" icon is the brand
// wordmark), so it's drawn to match: 24px grid, 1.5px
// rounded strokes.
const headset = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M5.5 7h13A2.5 2.5 0 0 1 21 9.5v5a2.5 2.5 0 0 1-2.5 2.5h-3.13a1.5 1.5 0 0 1-1.3-.76l-.77-1.35a1.5 1.5 0 0 0-2.6 0l-.77 1.35a1.5 1.5 0 0 1-1.3.76H5.5A2.5 2.5 0 0 1 3 14.5v-5A2.5 2.5 0 0 1 5.5 7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
<path d="M3 11.5H1.75M21 11.5h1.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

// Solid background: a filled rectangle, as in grid-game-threejs
const solid = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<rect x="2.75" y="5" width="18.5" height="14" rx="1.5" fill="currentColor" fill-opacity="0.35" stroke="currentColor" stroke-width="1.5"/>
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

// Controls: a gamepad, as grid-game-threejs's (its outline, D-pad and two buttons)
const controls = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M7.2 7.2h9.6l3.84 1.44 1.92 7.2-2.4 2.88-4.32-3.36H8.16l-4.32 3.36-2.4-2.88 1.92-7.2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
<path d="M7.2 9.6v3.36M5.52 11.28h3.36" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
<circle cx="15.84" cy="10.32" r="1" fill="currentColor"/>
<circle cx="17.76" cy="12.48" r="1" fill="currentColor"/>
</svg>`;

// Accessibility: a figure with open arms, in a circle (grid-game-threejs's, drawn on this grid; the same in every project)
const accessibility = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<circle cx="12" cy="12" r="9.6" stroke="currentColor" stroke-width="1.5"/>
<circle cx="12" cy="6.5" r="1.5" fill="currentColor"/>
<path d="M6.25 9.6h11.5M12 9.6v4.3M9.1 18.7l2.9-4.8 2.9 4.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// Text Size: a big A beside a small one (the same in every project)
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

// XR Control Guides: a gamepad, struck through when off
const controllerGuideOn = recolour(gamepad);
const controllerGuideOff = recolour(gamepad).replace(
  '</svg>',
  `<path d="M3.5 3.5 20.5 20.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`,
);

/** `svg` struck through, for an effect turned off. */
// Constellations: four stars joined by a figure's lines
const constellation = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<path d="M4.75 18 9.75 8.5l7 4.25 3-7.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" opacity="0.65"/>
<circle cx="4.75" cy="18" r="1.75" fill="currentColor"/><circle cx="9.75" cy="8.5" r="1.75" fill="currentColor"/><circle cx="16.75" cy="12.75" r="1.5" fill="currentColor"/><circle cx="19.75" cy="5.25" r="1.25" fill="currentColor"/>
</svg>`;

const struck = (svg) => svg.replace('</svg>', '<path d="M3.5 3.5 20.5 20.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>');
const drawn = (d) =>
  `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="${d}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Satellite: a body with two solar panels; Map: a sheet folded in three
const satellite = drawn('M9.5 9.5l5 5M12 7l5 5-2.5 2.5-5-5ZM4.25 9.25 7.75 5.75l2.5 2.5-3.5 3.5ZM13.75 18.75l3.5-3.5 2.5 2.5-3.5 3.5ZM17 4.75a2.25 2.25 0 0 1 2.25 2.25');
const map = drawn('M3.75 6.25 9 4.25l6 2 5.25-2v13.5L15 19.75l-6-2-5.25 2ZM9 4.25v13.5M15 6.25v13.5');

// Approximate (a place from the network, not the device): a spot within a dashed circle
const approximate = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.6 2.75" stroke-linecap="round"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>`;

// Vibration (xr-music-threejs's; the same in every project): a controller between buzz marks; off, the marks gone and a slash through it
const vibrationBody = `<rect x="8" y="4" width="8" height="16" rx="2.5" stroke="currentColor" stroke-width="1.5"/>`;
const vibrationOn = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
${vibrationBody}
<path d="M4.75 8.5 3 10.25l1.75 1.75L3 13.75l1.75 1.75M19.25 8.5 21 10.25l-1.75 1.75L21 13.75l-1.75 1.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
const vibrationOff = `<svg width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
${vibrationBody}
<path d="M3.5 3.5l17 17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

const ICONS = {
  location: recolour(mapMarker),
  myLocation: recolour(locationArrow),
  approximate,
  layers: recolour(layers),
  satellite,
  map,
  terrainOn: recolour(mountains),
  terrainOff: struck(recolour(mountains)),
  cloudsOn: recolour(cloud),
  cloudsOff: struck(recolour(cloud)),
  constellationsOn: constellation,
  constellationsOff: struck(constellation),
  colorMatchOn: recolour(palette),
  colorMatchOff: struck(recolour(palette)),
  realSize: recolour(ruler),
  detail: recolour(searchPlus),
  memory: recolour(database),
  statsOn: recolour(barChart),
  statsOff: struck(recolour(barChart)),
  delete: recolour(trash),
  vr: headset,
  solid,
  // (smaller, as grid-game-threejs's: about 65% of its box, not the 81% Lineicons' fills; threejs-ui)
  gear: recolour(gear),
  skybox: recolour(globe),
  passthrough: recolour(picture),
  soundOn: recolour(volume),
  soundOff: recolour(volumeMute),
  vibrationOn,
  vibrationOff,
  monitor,
  display,
  monitorSbs,
  phone,
  phoneViewer,
  // a dropdown, closed and open, and the chosen option in its list
  dropdown: recolour(chevronDown),
  dropdownOpen: recolour(chevronUp),
  check: recolour(check),
  accessibility,
  controls,
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
