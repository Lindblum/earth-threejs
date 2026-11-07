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
| Elevation | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen Terrarium) | Heights to zoom 15. Oceans are drawn at sea level (no sea floor) |
| Start location | [GeoJS](https://www.geojs.io), then [ipapi.co](https://ipapi.co) | From your network address, no permission asked. Location → My Location asks the device (GPS) instead |

Credits for what's showing are at the bottom right (in XR, under the Options title).

## How it works

- **Tiles** (`src/Globe.js`): a quadtree of Web Mercator tiles from zoom 2 (16 always kept) down to the imagery's finest. Each frame, a tile splits into its four children while a texel of its image would cover more than 1.5 screen pixels (Map → Detail scales this) from the viewer's distance, so near ground is fine and far ground coarse. Tiles over the horizon are skipped, tiles out of view kept 4× coarser, and a split tile joins up again only well under the limit (no flicker between levels). A tile stays drawn until all four children are ready, so there are never holes; meanwhile the three levels beneath it are asked for at once. Loads go nearest first, 16 at a time; one for ground no longer wanted (or 4× further off than what's wanted) gives way, and at most 4 tiles are uploaded to the GPU a frame.
- **Meshes** (`src/tileWorker.js`, a Web Worker): each tile is a 32 × 32 grid on the WGS84 ellipsoid, its heights from the elevation tile three zooms coarser (one sample per vertex; the data's single-pixel spikes and voids, hundreds of metres off, are filtered out first), with skirts hanging from its edges to hide cracks between levels. Vertices are relative to the tile's centre, so they keep their precision in 32-bit floats; the Earth's placement is worked out in 64-bit JavaScript numbers.
- **Caching**: every tile downloaded is kept in the browser's Cache Storage (`src/tileCache.js`, up to 30,000 tiles, oldest dropped first; Map → Clear Tile Cache forgets them), and up to Map → Tile Memory tiles stay loaded on the GPU, least recently used dropped first.
- **The world moves, not you** (`src/EarthPose.js`): the XR origin never moves or scales. The Earth turns, moves and scales round you, so everything near you stays near the origin. The ground beneath your head is the anchor: its up is the world's up, and travelling follows its rise and fall. Near real size your head is kept above the ground.
- **Fades** (`src/tileMaterial.js`): a tile newly shown fades in over 0.35 s from what it replaced (the part of the coarser tile it split out of, or the four children that joined back into it), its image and its ground both: each vertex starts at the old ground's height there and eases to its own.
- **Color Blending** (Video; photos only, maps are shown as they are): neighbouring tiles often come from different photos, so their colours clash (water most). Every tile is compared with its zoom-10 ancestor (one image, one colour balance, under a large area) patch by patch, each patch about one of the reference's pixels across (~500 m) at every zoom. Each zoom's samples make a smooth correction field over the ground (Gaussian, ~1 km), and each tile takes that field at a 9 × 9 lattice whose outer points lie on its edges: a function of place alone, so neighbouring tiles agree where they meet and no seams are made. Where a coarser tile meets a finer one (another photo layer), the finer one's edge is shaded, fading out by its middle, to match its own ancestor at the coarser zoom over the same ground: that's the neighbour's photo layer, so the two meet without a step, and what's compared is always the same place in two photos (a shore along the edge isn't mistaken for a photo difference). Off: every tile's gain is exactly 1, at once.
- **The sky** turns with the Earth (it's the world that turns, not you): the stars are fixed to it, the pole star over the North Pole.
- **Depth**: the near plane stays at 5 cm (hands and panels), the far one just past the horizon, in powers of two.

## Controls

| | Desktop | XR |
| --- | --- | --- |
| Scale the world | Wheel (toward the point under the mouse); R / F | Both grips in mid-air: hands apart (bigger) / together (smaller) |
| Move | Drag (the ground follows the mouse); WASD / arrows | Left stick (the way the left controller points); faster the higher you are |
| Turn | Right-drag or Ctrl-drag sideways (about the point at the centre); Q / E | Right stick; or both grips, turning your hands |
| Tilt | Right-drag up / down | Your head |
| Real size | Options' corner (the scale), or Location → Real Size | the same |
| Menus | `Enter` / `Esc` toggles Options | Options docks on the left controller; stick pressed in (L3 / R3) works it; grip a panel to move it, tap twice to dock / undock |

## Options

| Group | Settings |
| --- | --- |
| Location | My Location (the device's), Approximate Location (back to where you started), Real Size |
| Map | Imagery (15 sources: photos and maps; switching crossfades, nearest first), Terrain, Clouds, Detail, Tile Memory, Clear Tile Cache |
| Video | Background (Solid, Skybox, Passthrough), View Mode, Color Blending, Show Stats (fps, tiles), VSync, XR Resolution |
| Accessibility | Volume (the menu tick, from grid-game-threejs: every press and thumbstick step, not slider drags), Vibration, Text Size, Controller Guide |

## Layout

- `src/geo.js`: WGS84 and Web Mercator math
- `src/sources.js`: the tile services and their credits
- `src/tileCache.js`, `src/tileWorker.js`, `src/Globe.js`: downloading, building and choosing the tiles
- `src/EarthPose.js`: where the Earth is in the world, and moving it
- `src/Earth.jsx`: the globe in the scene, the depth range, the desktop controls
- `src/Grab.jsx`, `src/grip.js`: XR controllers: holding the world, the sticks, the panels
- `src/location.js`: finding where you are
- `src/Scene.jsx`, `src/App.jsx`: the scene, app state and windowed panels
- `src/menu.js`, `src/XRMenuPanel.jsx`: the panels and their XR (canvas) versions
- `src/SideBySide.jsx`, `src/Interlaced.jsx`, `src/PhoneStereo.jsx`, `src/Cardboard.jsx`, `src/CardboardLens.js`, `src/Gaze.jsx`: the stereo and phone views

## Next

Once getting about is smooth: an atmosphere and day / night, place search, buildings (OpenStreetMap), and flying up and down with the right stick.
