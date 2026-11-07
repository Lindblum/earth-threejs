# Earth

A globe you can hold: satellite imagery draped over real terrain, streamed in tiles that get finer the nearer you are, on a desktop, in stereo 3D, or in WebXR. It starts roughly where you are, at 1:1,000 (a city in a room). Hold the world with both hands to scale it from a 60 cm globe to ten times real size.

Built with [three.js](https://threejs.org), React, [@react-three/fiber](https://r3f.docs.pmnd.rs), [@react-three/xr](https://pmndrs.github.io/xr/) and Vite. It began as a copy of physics-sandbox-threejs: the XR shell, panels and views come from there.

## Run

```sh
npm install
npm run dev        # http://localhost:5177, with a Quest 3 emulator on localhost
npm run dev:xr     # HTTPS on your LAN, for a real headset or phone
npm run build      # static site in dist/ (relative paths, any host)
npm run preview    # the build, on http://localhost:5277
```

## Data (free, no keys)

| What | Source | Notes |
| --- | --- | --- |
| Imagery: photos | Esri World Imagery, Esri Clarity (sharper, sometimes older) | To zoom 19 (about 0.3 m a pixel) in much of the world. Asked with `blankTile=false`: where there's nothing finer, the coarser tile stretches over |
| | USGS National Map orthoimagery | The United States only (USDA NAIP aerial photos), to zoom 16 |
| | EOX Sentinel-2 cloudless 2023 | One cloud-free mosaic of the whole world, 10 m a pixel (CC BY-NC-SA 4.0) |
| | NASA GIBS: daily true colour (VIIRS on NOAA-20 and NOAA-21, MODIS on Aqua and Terra), Blue Marble, Black Marble night lights | Daily: two days ago, that day's clouds; each satellite's gaps between passes filled from the next's, to zoom 9; the others to zoom 8. World-scale sources (these, Esri Physical) are soft up close: they have nothing finer |
| Imagery: maps | OpenStreetMap, Esri Streets / Topo / Ocean / Physical (to zoom 8), National Geographic, OpenTopoMap, USGS Topo (US) | OpenStreetMap's and OpenTopoMap's servers ask for light use |
| Imagery dates | Esri's citations service (World Imagery, Clarity) | Shown under the location: the photo at the place and zoom on show, its date, source and resolution; other sources' fixed dates |
| Clouds | NOAA GMGSI longwave infrared mosaic (GOES, Meteosat, Himawari) via [nowCOAST](https://nowcoast.noaa.gov) | Map → Clouds: hourly, global to about ±70°. Each pixel's infrared temperature against clear ground nearby (the warmest few percent within ~8°) gives its cloud cover, and how much colder it is its top's height (6.5 K a km); drawn as stacked shells from 1 to 11.5 km, each showing the clouds whose tops reach it |
| Stars | The skybox (`public/img/skybox.jpg`): a galactic panorama of the Milky Way | Turned to where the stars are now (see How it works) |
| Constellations | [d3-celestial](https://github.com/ofrohn/d3-celestial) (Olaf Frohn, BSD-3-Clause) | Its figures and names, flattened into `src/constellations.js` |
| The Moon | [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) (LRO colour map, public domain) | `public/img/moon.jpg`, 1024 × 512 |
| Elevation | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen Terrarium) | Heights to zoom 15. Oceans are drawn at sea level (no sea floor) |
| Start location | [GeoJS](https://www.geojs.io), then [ipapi.co](https://ipapi.co) | From your network address, no permission asked. Location → My Location asks the device (GPS) instead |

Credits for what's showing are at the bottom right (in XR, under the Options title).

## How it works

- **Tiles** (`src/Globe.js`): a quadtree of Web Mercator tiles from zoom 2 (16 always kept) down to the imagery's finest. Each frame, a tile splits into its four children while a texel of its image would cover more than 1.5 screen pixels (Map → Detail scales this) from the viewer's distance, so near ground is fine and far ground coarse. Tiles over the horizon are skipped, tiles out of view kept 4× coarser, and a split tile joins up again only well under the limit (no flicker between levels). A tile stays drawn until all four children are ready, so there are never holes; meanwhile the three levels beneath it are asked for at once. Loads go nearest first, 16 at a time; one for ground no longer wanted (or 4× further off than what's wanted) gives way, and at most 4 tiles are uploaded to the GPU a frame.
- **Meshes** (`src/tileWorker.js`, a Web Worker): each tile is a 32 × 32 grid on the WGS84 ellipsoid, its heights from the elevation tile three zooms coarser (one sample per vertex; the data's single-pixel spikes and voids, hundreds of metres off, are filtered out first), with skirts hanging from its edges to hide cracks between levels. Vertices are relative to the tile's centre, so they keep their precision in 32-bit floats; the Earth's placement is worked out in 64-bit JavaScript numbers.
- **Caching**: every tile downloaded is kept in the browser's Cache Storage (`src/tileCache.js`, up to 30,000 tiles, oldest dropped first; Map → Clear Tile Cache forgets them), and up to Map → Tile Memory tiles stay loaded on the GPU, least recently used dropped first.
- **The world moves, not you** (`src/EarthPose.js`): the XR origin never moves or scales. The Earth turns, moves and scales round you, so everything near you stays near the origin. The ground beneath your head is the anchor: its up is the world's up, and travelling follows its rise and fall. In XR the world is kept upright round you at every scale: the Earth's centre straight below your head. You can come right down to the ground; a head that goes under it is pushed back out.
- **Fades** (`src/tileMaterial.js`): a tile newly shown fades in over 0.35 s from what it replaced (the part of the coarser tile it split out of, or the four children that joined back into it), its image and its ground both: each vertex starts at the old ground's height there and eases to its own.
- **Color Blending** (Display; photos only, maps are shown as they are): neighbouring tiles often come from different photos, so their colours clash (water most). Every tile is compared with its zoom-10 ancestor (one image, one colour balance, under a large area) patch by patch, each patch about one of the reference's pixels across (~500 m) at every zoom. Each zoom's samples make a smooth correction field over the ground (Gaussian, ~1 km), and each tile takes that field at a 9 × 9 lattice whose outer points lie on its edges: a function of place alone, so neighbouring tiles agree where they meet and no seams are made. Where a coarser tile meets a finer one (another photo layer), the finer one's edge is shaded, fading out by its middle, to match its own ancestor at the coarser zoom over the same ground: that's the neighbour's photo layer, so the two meet without a step, and what's compared is always the same place in two photos (a shore along the edge isn't mistaken for a photo difference). Off: every tile's gain is exactly 1, at once.
- **The sky** (`src/sky.js`, `src/SkyLayer.jsx`): the stars, the Sun and the Moon where they are now, by the clock. The Earth's turn (sidereal time), precession since 2000 (0.37° so far) and the Astronomical Almanac's low-precision Sun (about 0.01°) and Moon (about 0.3°) put them in the Earth's frame, and the Earth's pose into the world. The skybox is a galactic panorama: it came mirrored (the Magellanic Clouds and Andromeda gave it away) and was flipped, and it's turned 3.7° off true galactic axes, a correction fitted to 38 of the brightest stars found in it (a median 0.16° off after). The constellations, the Sun (its disc its true size, and a glow) and the Moon (its true size from where you stand, near side toward the Earth, lit by the Sun so in its phase, faint earthshine on the rest) are drawn at infinity: round the viewer and at the far plane's depth, so the Earth and clouds hide them and the far plane never has to reach them.
- **Day and night** (`src/tileMaterial.js` `sunlight`): the Sun lights the ground, the clouds and the plain globe beneath: fully wherever it's up (the photos have their own daylight, so no shading on top), down to 6% at night, through a dusk band about 10° wide across the terminator (a little later on clouds, whose tops catch the Sun after the ground's lost it). The controllers are lit by the Sun too, with only a little light all round.
- **Depth**: the near plane stays at 5 cm (hands and panels), the far one just past the horizon, in powers of two.

## Controls

| | Desktop | XR |
| --- | --- | --- |
| Scale the world | Wheel (toward the point under the mouse); R / F | Both grips in mid-air: hands apart (bigger) / together (smaller) |
| Move | Drag (the ground follows the mouse); WASD / arrows | Left stick: the way the left controller points, up and down too (point down to come down to the ground); faster the higher you are, and faster still with a trigger pulled (up to 8×) |
| Up and down | R / F zooms (the window's camera stays at eye height) | Right stick up / down: rise and come down (as fast as the left stick moves you, triggers too), no nearer the ground than 15 cm |
| Turn | Right-drag or Ctrl-drag sideways (turning on the spot); Q / E | Right stick left / right (about the line from the Earth's centre up through you); or both grips, turning your hands |
| Tilt | Right-drag up / down | Your head |
| Real size | Options' corner (the scale), or Location → 1:1 Scale | the same |
| Menus | `Enter` / `Esc` toggles Options; with the mouse over a panel, WASD / arrows step through it and set sliders (instead of moving), `Enter` / `Space` presses, `Backspace` goes up a level | Options docks on the left controller; a stick whose controller points at a panel steps through it (instead of moving or turning), A / X presses, B / Y goes up a level; pressed in (L3 / R3), a stick works its own controller's panels; grip a panel to move it, tap twice to dock / undock |

## Options

| Group | Settings |
| --- | --- |
| Location | My Location (the device's), Approximate Location (back to where you started), 1:1 Scale |
| Map | Imagery (15 sources: photos and maps; switching crossfades, nearest first), Terrain, Clouds, Constellations (figures and names over the stars, with the Skybox background), Detail, Tile Memory, Clear Tile Cache |
| Display | Background (Solid, Skybox, Passthrough; over passthrough no stars, Sun or Moon), View Mode, Color Blending, Show Stats (fps, tiles), VSync, XR Resolution |
| Accessibility | Volume (the menu tick, from grid-game-threejs: every press and thumbstick step, not slider drags), Vibration, Text Size, Controller Guide |

## Layout

- `src/geo.js`: WGS84 and Web Mercator math
- `src/sources.js`: the tile services and their credits
- `src/tileCache.js`, `src/tileWorker.js`, `src/Globe.js`: downloading, building and choosing the tiles
- `src/EarthPose.js`: where the Earth is in the world, and moving it
- `src/Earth.jsx`: the globe in the scene, the depth range, the desktop controls
- `src/Grab.jsx`, `src/grip.js`: XR controllers: holding the world, the sticks, the panels
- `src/sky.js`, `src/SkyLayer.jsx`, `src/constellations.js`: the stars, Sun and Moon now, and drawing them
- `src/location.js`: finding where you are
- `src/Scene.jsx`, `src/App.jsx`: the scene, app state and windowed panels
- `src/menu.js`, `src/XRMenuPanel.jsx`: the panels and their XR (canvas) versions
- `src/SideBySide.jsx`, `src/Interlaced.jsx`, `src/PhoneStereo.jsx`, `src/Cardboard.jsx`, `src/CardboardLens.js`, `src/Gaze.jsx`: the stereo and phone views

## Next

Once getting about is smooth: an atmosphere (a blue sky by day), city lights on the night side (Black Marble), a time control, place search, buildings (OpenStreetMap).
