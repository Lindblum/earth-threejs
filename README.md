# Earth

A globe you can hold: satellite imagery on real terrain, streamed in tiles that get finer as you come closer, on a desktop, in stereo 3D or in WebXR. It starts near you at 1:1,000 (a city fits in a room). In XR, hold the world with both hands to scale it from a 60 cm globe up to ten times real size.

Built with [three.js](https://threejs.org), React, [@react-three/fiber](https://r3f.docs.pmnd.rs), [@react-three/xr](https://pmndrs.github.io/xr/) and Vite. It began as a copy of physics-sandbox-threejs, which supplied the XR shell, panels and views.

## Run

```sh
npm install
npm run dev        # http://localhost:5177, with a Quest 3 emulator
npm run dev:xr     # HTTPS on your LAN, for a headset or phone
npm run build      # static site in dist/
npm run preview    # the build, on http://localhost:5277
```

## Data (free, no keys)

| What | Source |
| --- | --- |
| Photos | Esri World Imagery and Clarity (to zoom 19), USGS NAIP (US), EOX Sentinel-2 cloudless, NASA GIBS (daily VIIRS / MODIS, Blue Marble, Black Marble) |
| Maps | OpenStreetMap, Esri Streets / Topo / Ocean / Physical, National Geographic, OpenTopoMap, USGS Topo |
| Imagery dates | Esri's citations service, shown under the location |
| Clouds | NOAA GMGSI infrared mosaic via [nowCOAST](https://nowcoast.noaa.gov), hourly; cloud-top heights from infrared temperature, drawn as stacked shells |
| Stars | `public/img/skybox.jpg`, a galactic panorama of the Milky Way |
| Constellations | [d3-celestial](https://github.com/ofrohn/d3-celestial) (Olaf Frohn, BSD-3-Clause) |
| Moon | [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) (public domain) |
| Elevation | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium, to zoom 15; oceans drawn at sea level) |
| Start location | [GeoJS](https://www.geojs.io), then [ipapi.co](https://ipapi.co), from your IP address; My Location uses the device's GPS |

Credits for what's on show are at the bottom right (in XR, under the Options title).

## How it works

- **Tiles** (`src/Globe.js`): a quadtree of Web Mercator tiles. A tile splits while one texel of its image covers more than 1.5 screen pixels (Map → Detail scales this). A parent stays drawn until all four of its children are ready, so there are never holes. The nearest tiles load first.
- **Meshes** (`src/tileWorker.js`): a 32 × 32 grid on the WGS84 ellipsoid for each tile, with skirts to hide cracks. Vertices are stored relative to the tile's centre so they stay precise in 32-bit floats.
- **Caching**: downloaded tiles are kept in Cache Storage (up to 30,000), and up to Map → Tile Memory tiles stay on the GPU.
- **The world moves, not you** (`src/EarthPose.js`): the XR origin is fixed, and the Earth turns, moves and scales around you. The ground beneath your head is the anchor. If your head goes under the ground, it is pushed back out.
- **Fades** (`src/tileMaterial.js`): a newly shown tile fades in over 0.35 s from the tile it replaced, in both its image and its height.
- **Color Blending**: each photo tile's colours are corrected toward those of its zoom-10 ancestor. The correction depends only on the place, so neighbouring tiles agree at their edges.
- **The sky** (`src/sky.js`, `src/SkyLayer.jsx`): the stars, the Sun and the Moon are where they are now by the clock, including sidereal time and precession. The skybox came mirrored, so it was flipped and fitted to the brightest stars. The Sun, the Moon (lit by the Sun, so it shows its phase) and the constellations are drawn at infinity.
- **The air** (`src/atmosphere.js`): single scattering in a spherical atmosphere (Nishita, O'Neil, Bruneton): Rayleigh scattering makes the sky blue, haze makes the glow round the Sun, and ozone keeps the dusk sky blue. The Sun's dimming through the air comes from a small table worked out at startup, and the rest is a short ray-march per pixel. It gives a blue sky by day, reds and golds at sunrise and sunset, and blue twilight, and none of it from above the air, where there's only a thin blue rim round the Earth. The same sums add haze over far ground and clouds, and redden the sunlight on them when the Sun is low. The sky fades out the stars as it brightens.
- **Day and night**: the Sun lights the ground and the clouds. The night side is at 6%, with a dusk band about 10° wide.
- **Clouds** (`src/clouds.js`, `src/groundCapture.js`): a layer fades out over its last few hundred metres above the ground. Near you it uses the ground as drawn (the tiles, captured from above as a height map now and then); further off, a coarse world height map.
- **Depth**: the sky is drawn first and the ground over it, so the two never fight over depth. The plain globe beneath the tiles is pushed back in the depth buffer, and the clouds pulled forward. The near plane is at 5 cm (in the window, further out when high up), and the far plane sits just past the horizon, in powers of two.

## Controls

| | Desktop | XR |
| --- | --- | --- |
| Scale | Wheel; R / F | Both grips: hands apart or together |
| Move | Drag; WASD / arrows | Left stick, the way the controller points; faster when higher up, and with a trigger |
| Up / down | R / F | Right stick up / down |
| Turn | Right-drag or Ctrl-drag; Q / E | Right stick left / right; or both grips |
| Tilt | Right-drag up / down | Your head |
| Real size | The scale in Options' corner, or Location → 1:1 Scale | The same |
| Menus | `Enter` / `Esc` toggles Options. With the mouse over a panel, WASD / arrows step and set sliders, `Enter` / `Space` press, `Backspace` goes back | Options docks on the left controller. While you point at a panel, that controller's stick scrolls it and the other stick steps through it; A / X press, B / Y go back. Grip a panel to move it; tap twice to dock or undock it |

## Options

| Group | Settings |
| --- | --- |
| Location | My Location, Approximate Location, 1:1 Scale |
| Map | Imagery, Terrain, Clouds, Constellations, Detail, Tile Memory, Clear Tile Cache |
| Controls | What the input last touched does: the mouse and keys, a gamepad or the XR controllers, drawn and labelled |
| Display | View Mode, Background, Color Blending, Show Stats, VSync, XR Resolution |
| Accessibility | Volume, Vibration, Text Size, XR Control Guides |

## Layout

- `src/geo.js`: WGS84 and Web Mercator math
- `src/sources.js`: tile services and credits
- `src/tileCache.js`, `src/tileWorker.js`, `src/Globe.js`: the tiles
- `src/EarthPose.js`: the Earth's place in the world
- `src/Earth.jsx`: the globe in the scene and the desktop controls
- `src/Grab.jsx`, `src/grip.js`: the XR controllers
- `src/sky.js`, `src/SkyLayer.jsx`, `src/constellations.js`: the sky
- `src/atmosphere.js`: the air (the sky's light, haze, sunlight through it)
- `src/clouds.js`, `src/groundCapture.js`: the clouds
- `src/location.js`: finding where you are
- `src/Scene.jsx`, `src/App.jsx`, `src/menu.js`, `src/XRMenuPanel.jsx`: the scene, app state and panels
- `src/SideBySide.jsx`, `src/PhoneStereo.jsx`, `src/Cardboard.jsx`, `src/CardboardLens.js`, `src/Gaze.jsx`: the stereo and phone views

## Next

City lights on the night side, a time control, place search, and buildings.
