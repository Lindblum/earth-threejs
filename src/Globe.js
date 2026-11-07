import * as THREE from 'three';
import { DEG, MERCATOR_MAX_LAT, WGS84_A, WGS84_B, angleDiff, edgeLoop, ecefToGeodetic, geodeticToEcef, mercatorX, mercatorY, surfaceNormal, tileBounds, tileLat, tileLon } from './geo.js';
import { ELEVATION, IMAGERY } from './sources.js';
import { fetchTile } from './tileCache.js';
import { makeClouds } from './clouds.js';
import { FADE_S, GAIN_POINTS, endFade, fadeFrom, gainTexture, setGains, sunlight, tileMaterial } from './tileMaterial.js';
import { sunUniform } from './sky.js';

// The globe: a quadtree of Web Mercator tiles, each a mesh of its patch of
// ground (built in the tile worker from elevation tiles) wearing its imagery
// tile. Every frame it picks the tiles to draw: a tile is split into its four
// children while its image would show coarser than DETAIL_PX screen pixels a
// texel from where the viewer is (near ground gets fine tiles, far ground and
// the horizon coarse ones), and tiles facing away (over the horizon) are
// skipped. A tile is drawn until all four children have loaded, so there are
// never holes; tiles not looked at (behind you) are kept coarser.
//
// Loads go nearest-the-root first, a few at a time, and are dropped when no
// longer wanted. Loaded tiles are kept (least recently used dropped first) up
// to `maxTiles`; every download is also kept on the device (see tileCache.js).
//
// Precision: the Earth is 6,400 km across, too big for the GPU's 32-bit
// floats near the viewer. Each tile's vertices are relative to its own
// centre, and its place in the world (the Earth's matrix times its centre) is
// worked out in JavaScript's 64-bit numbers before the GPU sees it.

export const SEGMENTS = 32; // a tile's grid, quads a side
const ROOT_ZOOM = 2; // the tiles always kept: 4 × 4 of them
const IMAGE_PX = 256;
const DETAIL_PX = 1.5; // a texel at most this many pixels across (at Detail 100%)
const OFFSCREEN_DETAIL = 6; // ...and this many for tiles out of view
const MAX_INFLIGHT = 16; // tiles loading at once
const SWAP_FADE_S = 0.8; // a tile's image crossfading to another source's
const TERRAIN_ZOOM = 14; // tiles split this far for the ground's shape, however coarse the imagery
const LOOK_AHEAD = 3; // levels below a tile still showing that are asked for at once
const MAX_PREEMPT = 4; // loads given way a frame, at most
const PREEMPT = 2; // a wanted tile 4× nearer than one loading takes its place
const MERGE_AT = 0.75; // a split tile joins up again only under this share of the split limit
const ACTIVATE_PER_FRAME = 4; // tiles made ready (their textures uploaded) per frame, at most
const DROP_AFTER_FRAMES = 45; // a load no longer wanted this long is dropped
const RETRY_S = 6; // a failed tile is tried again after this
const EVICT_EVERY = 30; // frames between clear-outs
const ELEVATION_LAG = 3; // a tile's heights come from the elevation tile this many zooms coarser (256 px over 8 × 8 tiles: one sample per vertex)
const MAX_TERRAIN_M = 9000; // the highest ground, for culling before a tile's heights are known
const BASE_DEPTH = 3000; // m: the plain globe under the tiles (filling the poles and any gap) lies this far down
const OCEAN = new THREE.Color('#0d2742');
const ICE = new THREE.Color('#dfe7ee');
/** What a tile with no image (the source has none there) shows: the ocean's blue. */
const NO_IMAGE = new THREE.DataTexture(new Uint8Array([...OCEAN.clone().convertLinearToSRGB().toArray().map((c) => Math.round(c * 255)), 255]), 1, 1);
NO_IMAGE.colorSpace = THREE.SRGBColorSpace;
NO_IMAGE.needsUpdate = true;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _frustum = new THREE.Frustum();
const _projScreen = new THREE.Matrix4();
const _p = [0, 0, 0];

// Colour matching (see grade)
const REFERENCE_ZOOM = 10; // tiles finer than this are matched to their ancestor at this zoom (one survey under a large area)
const THUMB = 16; // a tile's colour thumbnail, px a side
const REFERENCE_THUMB = 64; // a reference's, finer: compared over small tiles' ground
const SMOOTH_REFERENCE_PX = 2; // the matching is smoothed over this many reference pixels (Gaussian sigma; about a kilometre)
const PRIOR = 0.05; // weight of "no change" in the smoothing: where few tiles are known, less is changed
const GAIN_RANGE = [0.33, 3]; // how far colour matching may brighten or darken...
const TINT_RANGE = 0.6; // ...and tint: a channel's gain within this share of the brightness's
const GAIN_FLOOR = 0.004; // (linear: keeps near-black patches' gains sane)
const GAIN_EASE = 3; // per second: a tile's colours ease to their match as it changes
const GRADE_PER_FRAME = 8; // tiles' gains worked out again a frame, at most
const MAX_SAMPLES = 12000; // colour samples kept a zoom (oldest forgotten first)
const UNGRADED = new Float32Array(GAIN_POINTS * GAIN_POINTS * 3).fill(1);

const thumbCanvases = new Map(); // size -> 2D context
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * A tile's image shrunk to `size` × `size`, in linear RGB (Float32Array,
 * rows from the north); `levels` coarser than the tile, just its part of it.
 */
function thumbnail(image, levels, x, y, size = THUMB) {
  const thumb = new Float32Array(size * size * 3);
  if (!image || image === NO_IMAGE.image) {
    const ocean = OCEAN.toArray();
    for (let i = 0; i < size * size; i++) thumb.set(ocean, i * 3);
    return thumb;
  }
  let context = thumbCanvases.get(size);
  if (!context) {
    context = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true });
    context.imageSmoothingQuality = 'high';
    thumbCanvases.set(size, context);
  }
  const sub = 2 ** levels;
  const w = image.width / sub;
  const h = image.height / sub;
  context.clearRect(0, 0, size, size);
  context.drawImage(image, (x % sub) * w, (y % sub) * h, w, h, 0, 0, size, size);
  const rgba = context.getImageData(0, 0, size, size).data;
  for (let i = 0; i < size * size; i++) for (let c = 0; c < 3; c++) thumb[i * 3 + c] = toLinear(rgba[i * 4 + c] / 255);
  return thumb;
}

const FEATHER = 0.5; // edge feathering reaches this share of a tile in from each edge (to its middle)
const FEATHER_MAX = 0.9; // (log) a tile's edge shades at most this far toward its coarser neighbour's photo layer (×2.5)
const FEATHERED_RANGE = [0.25, 4]; // the gain field and feathering together, at most
const _own = [0, 0, 0];
const _other = [0, 0, 0];
const _gain = [0, 0, 0];
const _spot = [0, 0, 0];

/** A gain lattice's (GAIN_POINTS² × RGB, points at i / (GAIN_POINTS - 1)) value at uv (u, v), bilinear, into `out`. */
function latticeAt(gains, u, v, out) {
  const m = GAIN_POINTS - 1;
  const fx = THREE.MathUtils.clamp(u * m, 0, m);
  const fy = THREE.MathUtils.clamp(v * m, 0, m);
  const x0 = Math.min(m - 1, Math.floor(fx));
  const y0 = Math.min(m - 1, Math.floor(fy));
  const tx = fx - x0;
  const ty = fy - y0;
  const n = GAIN_POINTS;
  for (let c = 0; c < 3; c++) {
    const a = gains[(y0 * n + x0) * 3 + c] * (1 - tx) + gains[(y0 * n + x0 + 1) * 3 + c] * tx;
    const b = gains[((y0 + 1) * n + x0) * 3 + c] * (1 - tx) + gains[((y0 + 1) * n + x0 + 1) * 3 + c] * tx;
    out[c] = a * (1 - ty) + b * ty;
  }
  return out;
}

/** A tile's colour at its uv (u, v), as its field shows it (before feathering): its thumbnail times its field's gain there; into `out`. */
function colourAt(node, u, v, out) {
  out[0] = out[1] = out[2] = 0;
  addSample(node.thumb, THUMB, u, v, out);
  latticeAt(node.fieldGains ?? UNGRADED, u, v, _gain);
  for (let c = 0; c < 3; c++) out[c] *= _gain[c];
  return out;
}

/** A `size`² thumbnail's colour at its tile's uv (u, v), bilinear, added into `out`. */
function addSample(thumb, size, u, v, out) {
  const fx = THREE.MathUtils.clamp(u * size - 0.5, 0, size - 1);
  const fy = THREE.MathUtils.clamp(v * size - 0.5, 0, size - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  for (let c = 0; c < 3; c++) {
    const a = thumb[(y0 * size + x0) * 3 + c] * (1 - tx) + thumb[(y0 * size + x1) * 3 + c] * tx;
    const b = thumb[(y1 * size + x0) * 3 + c] * (1 - tx) + thumb[(y1 * size + x1) * 3 + c] * tx;
    out[c] += a * (1 - ty) + b * ty;
  }
}

/** A loaded tile's ground height at its uv (u, v), bilinear in its grid. */
function heightIn(node, u, v) {
  const side = SEGMENTS + 1;
  const fx = THREE.MathUtils.clamp(u * SEGMENTS, 0, SEGMENTS);
  const fy = THREE.MathUtils.clamp(v * SEGMENTS, 0, SEGMENTS);
  const i = Math.min(SEGMENTS - 1, Math.floor(fx));
  const j = Math.min(SEGMENTS - 1, Math.floor(fy));
  const tx = fx - i;
  const ty = fy - j;
  const h = node.heights;
  const a = h[j * side + i] * (1 - tx) + h[j * side + i + 1] * tx;
  const b = h[(j + 1) * side + i] * (1 - tx) + h[(j + 1) * side + i + 1] * tx;
  return a * (1 - ty) + b * ty;
}

let compositeContext = null;
const NO_DATA = 12; // r + g + b at most this: a satellite's "nothing here" black

/**
 * One tile from several sources' tiles (`layers`: url functions, best
 * first): the first one's image, its black (no data: between a satellite's
 * passes) filled from the next one's, and so on. An ImageBitmap, or null if none has the tile.
 */
async function composite(layers, z, x, y, signal) {
  const blobs = await Promise.all(layers.map((url) => fetchTile(url(z, x, y), signal).catch((e) => (e?.name === 'AbortError' ? Promise.reject(e) : null))));
  const bitmaps = await Promise.all(blobs.map((b) => (b ? createImageBitmap(b) : null)));
  const have = bitmaps.filter(Boolean);
  if (!have.length) return null;
  const size = have[0].width;
  if (!compositeContext) compositeContext = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true });
  const ctx = compositeContext;
  ctx.canvas.width = ctx.canvas.height = size;
  let out = null;
  for (const bitmap of have) {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(bitmap, 0, 0, size, size);
    bitmap.close?.();
    const image = ctx.getImageData(0, 0, size, size);
    if (!out) {
      out = image;
      continue;
    }
    const o = out.data;
    const d = image.data;
    for (let i = 0; i < o.length; i += 4)
      if (o[i] + o[i + 1] + o[i + 2] <= NO_DATA && d[i] + d[i + 1] + d[i + 2] > NO_DATA) {
        o[i] = d[i];
        o[i + 1] = d[i + 1];
        o[i + 2] = d[i + 2];
      }
  }
  ctx.putImageData(out, 0, 0);
  return createImageBitmap(ctx.canvas);
}

/** Is colour blending on for `options`? Photos only: maps' flat colours are one design already, and would only be tinted. */
const blends = (options) => Boolean(options.colorMatch) && (IMAGERY[options.imagery] ?? IMAGERY.esri).group === 'photo';

class TileNode {
  constructor(z, x, y, parent) {
    this.z = z;
    this.x = x;
    this.y = y;
    this.parent = parent;
    this.children = null;
    this.state = 'idle'; // 'loading' | 'pending' (loaded, awaiting upload) | 'ready' | 'failed'
    this.bounds = tileBounds(z, x, y);
    this.iz = z; // the imagery zoom it shows (coarser where the source has nothing finer)
    this.minH = parent?.minH ?? 0;
    this.maxH = parent?.maxH ?? MAX_TERRAIN_M;
    this.lastUsed = 0;
    this.lastWanted = 0;
    this.retryAt = 0;
    this.mesh = null;
    this.heights = null;
    this.seen = -1; // the frame `view` was worked out for
    this.view = { culled: false, inView: true, sse: 0, distance: 0 };
    // its widest (nearest the equator) width, a texel's share of it
    const b = this.bounds;
    const widest = Math.cos(Math.min(Math.abs(b.north), Math.abs(b.south), b.north * b.south < 0 ? 0 : Infinity));
    this.texelM = ((b.east - b.west) * WGS84_A * widest) / IMAGE_PX;
    // a bounding sphere before its heights are known: round the surface middle, out to its corners
    const mid = geodeticToEcef(tileLat(y + 0.5, z), tileLon(x + 0.5, z), 0);
    this.approxCenter = new THREE.Vector3(...mid);
    let r = 0;
    for (const [la, lo] of [
      [b.north, b.west],
      [b.north, b.east],
      [b.south, b.west],
      [b.south, b.east],
      [b.north, (b.west + b.east) / 2],
      [b.south, (b.west + b.east) / 2],
    ])
      r = Math.max(r, _v.fromArray(geodeticToEcef(la, lo, 0)).distanceTo(this.approxCenter));
    this.approxRadius = r + MAX_TERRAIN_M;
  }

  get key() {
    return `${this.z}/${this.x}/${this.y}`;
  }
}

/** The grid's texture coordinates and triangles, the same for every tile (shared by all their meshes). */
function sharedGeometry(n) {
  const side = n + 1;
  const loop = edgeLoop(n);
  const uv = new Float32Array((side * side + loop.length) * 2);
  for (let j = 0; j < side; j++)
    for (let i = 0; i < side; i++) {
      uv[(j * side + i) * 2] = i / n;
      uv[(j * side + i) * 2 + 1] = j / n; // (v from the north edge down: the image's rows, unflipped)
    }
  loop.forEach(([i, j], r) => {
    uv[(side * side + r) * 2] = i / n;
    uv[(side * side + r) * 2 + 1] = j / n;
  });
  const index = [];
  const at = (i, j) => j * side + i;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i, j + 1);
      const d = at(i + 1, j + 1);
      index.push(a, c, b, b, c, d); // (counter-clockwise seen from above)
    }
  for (let r = 0; r < loop.length; r++) {
    const e0 = at(...loop[r]);
    const e1 = at(...loop[(r + 1) % loop.length]);
    const s0 = side * side + r;
    const s1 = side * side + ((r + 1) % loop.length);
    index.push(e0, e1, s0, e1, s1, s0); // (facing out from the edge)
  }
  return { uv: new THREE.BufferAttribute(uv, 2), index: new THREE.BufferAttribute(new Uint16Array(index), 1) };
}

/** The plain globe beneath the tiles: ocean blue, white past the tiles' reach at the poles; lit by the Sun as they are. */
function baseGlobe() {
  const geometry = new THREE.SphereGeometry(1, 128, 64);
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // SphereGeometry's pole is +Y; the Earth's is +Z
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const lat = Math.asin(THREE.MathUtils.clamp(y, -1, 1));
    const lon = Math.atan2(-z, x);
    geodeticToEcef(lat, lon, -BASE_DEPTH, _p);
    pos.setXYZ(i, _p[0], _p[1], _p[2]);
    (Math.abs(lat) > MERCATOR_MAX_LAT - 0.5 * DEG ? ICE : OCEAN).toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  const material = new THREE.ShaderMaterial({
    name: 'BaseGlobe',
    vertexColors: true,
    uniforms: { sunDirection: sunUniform },
    vertexShader: /* glsl */ `
      varying vec3 vColor;
      varying vec3 vUp;
      void main() {
        vColor = color;
        vUp = position; // (ECEF)
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDirection;
      varying vec3 vColor;
      varying vec3 vUp;
      void main() {
        gl_FragColor = vec4(vColor * ${sunlight('vUp')}, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'base-globe';
  return mesh;
}

export class Globe {
  /** `renderer`: for uploading textures a few at a time. */
  constructor(renderer) {
    this.renderer = renderer;
    this.root = new THREE.Group(); // ECEF; its matrix is the Earth's place in the world (see EarthPose)
    this.root.name = 'earth';
    this.root.matrixAutoUpdate = false;
    this.base = baseGlobe();
    this.root.add(this.base);
    this.shared = sharedGeometry(SEGMENTS);
    this.loop = edgeLoop(SEGMENTS);
    this.options = { imagery: 'esri', terrain: true, detail: 1, maxTiles: 450, colorMatch: false };
    this.frame = 0;
    this.inflight = 0;
    this.pending = []; // loaded, awaiting upload
    this.nextId = 1;
    this.jobs = new Map(); // worker job id -> { resolve, reject }
    this.worker = new Worker(new URL('./tileWorker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      const job = this.jobs.get(data.id);
      if (!job) return;
      this.jobs.delete(data.id);
      if (data.error) job.reject(new Error(data.error));
      else job.resolve(data);
    };
    this.maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    // (a headset's memory is tighter: the smaller cloud map)
    this.cloudWidth = /OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent) ? 2048 : 4096;
    this.stats = { drawn: 0, ready: 0, loading: 0, deepest: 0 };
    this.fading = new Map(); // node -> { start, from: [nodes] }: tiles fading in from what they replaced
    this.imageryVersion = 0; // goes up as the imagery source changes; each tile's image is of one (see switchImagery)
    this.swaps = new Set(); // tiles loading a new source's image
    this.pendingSwaps = []; // ...and loaded, awaiting upload
    this.levels = new Map(); // zoom -> { samples (key -> { x, y, log }), version }: colour matching's samples (see sample)
    this.makeRoots();
  }

  makeRoots() {
    this.roots = [];
    const n = 2 ** ROOT_ZOOM;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) this.roots.push(new TileNode(ROOT_ZOOM, x, y, null));
  }

  /**
   * { imagery, terrain, colorMatch, detail, maxTiles }. Terrain changing
   * loads every tile again; imagery changing swaps the tiles' images,
   * crossfading (see switchImagery); colour blending changing applies at once.
   */
  setOptions(options) {
    const was = this.options;
    this.options = { ...was, ...options };
    if (was.terrain !== this.options.terrain) this.reset();
    else if (was.imagery !== this.options.imagery) this.switchImagery();
    if (blends(was) !== blends(this.options)) this.recolour();
    if (Boolean(this.options.clouds) !== Boolean(this.clouds)) this.showClouds(this.options.clouds);
  }

  /** Map → Clouds: the cloud shell shown or taken away. */
  showClouds(on) {
    if (on && !this.clouds) {
      this.clouds = makeClouds(this.cloudWidth, (url) => this.analyseClouds(url));
      this.root.add(this.clouds);
    } else if (!on && this.clouds) {
      this.root.remove(this.clouds);
      this.clouds.userData.dispose();
      this.clouds = null;
    }
  }

  /** The tile worker's cloud analysis of infrared image `url`: { clouds (RGBA bytes), width, height }. */
  analyseClouds(url) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'clouds', id, url, elevationUrl: ELEVATION.url('{z}', '{x}', '{y}') });
    });
  }

  /** The imagery zoom shown at (lat, lon) (radians): the drawn tile's there, or null. */
  zoomAt(lat, lon) {
    if (!this.drawn?.length) return null;
    const node = this.drawnAt(mercatorX(angleDiff(lon, 0)), mercatorY(THREE.MathUtils.clamp(lat, -MERCATOR_MAX_LAT, MERCATOR_MAX_LAT)), new Set(this.drawn));
    return node ? Math.max(0, node.iz) : null;
  }

  /**
   * Colour blending switched on or off: at once, not eased (to compare).
   * Off, every tile's gains are 1: its photo exactly as it is.
   */
  recolour() {
    const on = blends(this.options);
    this.forEachNode((node) => {
      node.gainVersion = -1;
      if (!node.gainMap || on) return;
      node.fieldGains = node.gainTarget = node.gainsSettled = UNGRADED;
      node.gains.fill(1);
      setGains(node.gainMap, node.gains);
    });
    this.snapColours = true;
  }

  /**
   * Another imagery source: each tile on show (and its coarser tiles) keeps
   * its ground and loads the new source's image, nearest first, then
   * crossfades to it (SWAP_FADE_S); tiles not on show are dropped, to load
   * afresh when wanted. So the old map gives way to the new one patch by patch.
   */
  switchImagery() {
    this.imageryVersion++;
    this.levels.clear(); // (another source's colours)
    this.pendingSwaps.length = 0;
    this.forEachNode((node) => {
      if (node.swap) this.dropSwap(node);
      if (node.state === 'loading' || node.state === 'pending' || (node.state === 'ready' && node.z > ROOT_ZOOM && node.lastUsed < this.frame - 1)) this.unload(node);
      node.sampled = false;
      node.referenceThumb = null;
      node.gainVersion = -1;
      node.swapRetryAt = 0;
    });
  }

  dropSwap(node) {
    node.swap.abort.abort();
    this.swaps.delete(node);
    node.swap = null;
  }

  /** Tiles on show (and their coarser tiles) still showing an old source's image: their new images loaded, nearest first. */
  scheduleSwaps() {
    if (!this.imageryVersion) return;
    const stale = new Set();
    const now = performance.now() / 1000;
    for (const node of this.drawn)
      for (let n = node; n; n = n.parent)
        if (n.state === 'ready' && n.imageryVersion !== this.imageryVersion && !n.swap && now >= (n.swapRetryAt ?? 0)) stale.add(n);
    const order = [...stale].sort((a, b) => (a.view?.distance ?? Infinity) - (b.view?.distance ?? Infinity));
    for (const node of order) {
      if (this.loading.size + this.swaps.size >= MAX_INFLIGHT) break;
      this.startSwap(node);
    }
  }

  startSwap(node) {
    const swap = (node.swap = { abort: new AbortController() });
    this.swaps.add(node);
    this.loadImagery(node, swap.abort.signal, true).then(
      (image) => {
        this.swaps.delete(node);
        if (node.swap !== swap || node.state !== 'ready') {
          image?.bitmap.close?.();
          return;
        }
        swap.image = image ?? { bitmap: null, iz: -1 };
        this.pendingSwaps.push(node);
      },
      (e) => {
        this.swaps.delete(node);
        if (node.swap !== swap) return;
        node.swap = null;
        if (e?.name === 'AbortError') return;
        console.warn(`[earth] tile ${node.key}'s new image failed:`, e?.message ?? e);
        node.swapRetryAt = performance.now() / 1000 + RETRY_S;
      },
    );
  }

  /** A tile's new source image in: its old one crossfades to it (its ground stays as it is). */
  applySwap(node) {
    const { bitmap, iz } = node.swap.image;
    node.swap = null;
    const material = node.mesh.material;
    const fading = this.fading.get(node);
    if (fading) this.endFading(node, fading);
    const before = { texture: node.texture, gainMap: node.gainMap };
    const map = this.imageTexture(bitmap, iz, node);
    node.iz = bitmap ? iz : node.parent?.iz ?? 0;
    node.texture = map;
    node.thumb = thumbnail(bitmap, node.z - iz, node.x, node.y);
    node.referenceThumb = null;
    node.sampled = false;
    node.gainMap = gainTexture();
    node.gains = UNGRADED.slice();
    node.gainTarget = node.fieldGains = node.gainsSettled = null;
    node.gainVersion = -1;
    node.imageryVersion = this.imageryVersion;
    map.updateMatrix();
    material.uniforms.map.value = map;
    material.uniforms.mapTransform.value.copy(map.matrix);
    material.uniforms.gainMap.value = node.gainMap;
    this.sample(node);
    this.grade(node);
    node.gains.set(node.gainTarget);
    setGains(node.gainMap, node.gains);
    // (the ground stays put: no height morph)
    const delta = node.mesh.geometry.getAttribute('heightDelta');
    if (delta) {
      delta.array.fill(0);
      delta.needsUpdate = true;
    }
    fadeFrom(material, [{ texture: before.texture, gainMap: before.gainMap, transform: new THREE.Matrix3() }]);
    this.fading.set(node, { start: performance.now() / 1000, from: [], duration: SWAP_FADE_S, free: [before.texture === NO_IMAGE ? null : before.texture, before.gainMap] });
  }

  /** A fade over: only the tile's own image shown, and what it faded from (if it's let go of) freed. */
  endFading(node, f) {
    if (node.mesh) endFade(node.mesh.material);
    for (const thing of f.free ?? []) thing?.dispose();
    this.fading.delete(node);
  }

  /** A tile's texture from `bitmap` (null: none), the source's image at zoom `iz` (coarser than the tile: just its part of it). */
  imageTexture(bitmap, iz, node) {
    if (!bitmap) return NO_IMAGE;
    const map = new THREE.Texture(bitmap);
    map.flipY = false; // (an ImageBitmap can't be flipped on upload; the uvs run from the top)
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = this.maxAnisotropy;
    map.generateMipmaps = true;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    const sub = 2 ** (node.z - iz);
    if (sub > 1) {
      map.repeat.set(1 / sub, 1 / sub);
      map.offset.set((node.x % sub) / sub, (node.y % sub) / sub);
    }
    map.needsUpdate = true;
    this.renderer.initTexture(map);
    return map;
  }

  forEachNode(f) {
    const walk = (node) => {
      f(node);
      node.children?.forEach(walk);
    };
    this.roots.forEach(walk);
  }

  /** Every tile dropped, to load again. */
  reset() {
    const all = [];
    const walk = (node) => {
      all.push(node);
      node.children?.forEach(walk);
    };
    this.roots.forEach(walk);
    for (const node of all) this.unload(node);
    this.pending.length = 0;
    this.levels?.clear(); // (another imagery's colours)
    this.makeRoots();
  }

  dispose() {
    this.showClouds(false);
    this.reset();
    this.worker.terminate();
    this.base.geometry.dispose();
    this.base.material.dispose();
  }

  /** The node's mesh and image freed, or its load dropped: back to idle. */
  unload(node) {
    this.loading.delete(node);
    if (node.swap) this.dropSwap(node);
    node.loadToken = null;
    if (node.state === 'loading') {
      node.abort?.abort();
      if (node.jobId) {
        this.worker.postMessage({ type: 'cancel', id: node.jobId });
        this.jobs.get(node.jobId)?.reject(new DOMException('dropped', 'AbortError'));
        this.jobs.delete(node.jobId);
      }
    }
    if (node.loaded) {
      node.loaded.bitmap?.close?.();
      node.loaded = null;
    }
    if (node.mesh) {
      this.root.remove(node.mesh);
      // (the uvs and triangles are every tile's: taken off first, or disposing this one frees them for all)
      node.mesh.geometry.deleteAttribute('uv');
      node.mesh.geometry.setIndex(null);
      node.mesh.geometry.dispose();
      if (node.texture !== NO_IMAGE) node.texture?.dispose();
      node.gainMap?.dispose();
      node.gainMap = node.gainTarget = node.gainsSettled = null;
      node.texture = null;
      const fading = this.fading.get(node);
      if (fading) this.endFading(node, fading);
      node.mesh.material.dispose();
      node.mesh = null;
    }
    node.heights = null;
    node.state = 'idle';
  }

  /** The source image for `node`: { bitmap, iz }, the finest the source has (its parent's zoom at most, unless `own`), or null. */
  async loadImagery(node, signal, own = false) {
    const source = IMAGERY[this.options.imagery] ?? IMAGERY.esri;
    // (where the parent had to make do with a coarser image, there's nothing finer for its children either)
    const parent = node.parent;
    let iz = Math.min(node.z, source.maxZoom, !own && parent && parent.state === 'ready' && parent.iz < parent.z && parent.imageryVersion === this.imageryVersion ? parent.iz : Infinity);
    for (; iz >= 0; iz--) {
      const shift = node.z - iz;
      if (source.layers) {
        const bitmap = await composite(source.layers, iz, node.x >> shift, node.y >> shift, signal);
        if (bitmap) return { bitmap, iz };
        continue;
      }
      const blob = await fetchTile(source.url(iz, node.x >> shift, node.y >> shift), signal);
      if (blob) return { bitmap: await createImageBitmap(blob), iz };
    }
    return null;
  }

  /** The node's ground, from the worker: { positions, heights, center, radius, minH, maxH }. */
  buildMesh(node) {
    const id = this.nextId++;
    node.jobId = id;
    const ez = Math.max(0, Math.min(ELEVATION.maxZoom, node.z - ELEVATION_LAG));
    const shift = node.z - ez;
    const ex = node.x >> shift;
    const ey = node.y >> shift;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'build', id, z: node.z, x: node.x, y: node.y, ez, ex, ey, terrain: this.options.terrain, segments: SEGMENTS, url: ELEVATION.url(ez, ex, ey) });
    });
  }

  /** The nodes loading now. */
  get loading() {
    return this._loading ?? (this._loading = new Set());
  }

  load(node) {
    node.state = 'loading';
    this.loading.add(node);
    node.abort = new AbortController();
    // (this load's own: one dropped and started again mustn't let the old one's ending touch the new)
    const token = (node.loadToken = {});
    this.inflight++;
    const signal = node.abort.signal;
    Promise.all([this.loadImagery(node, signal), this.buildMesh(node)]).then(
      ([image, ground]) => {
        this.inflight--;
        if (node.loadToken === token) this.loading.delete(node);
        if (node.loadToken !== token || node.state !== 'loading') {
          image?.bitmap.close?.();
          return;
        }
        node.jobId = null;
        node.loaded = { bitmap: image?.bitmap ?? null, iz: image?.iz ?? -1, ground };
        node.state = 'pending';
        this.pending.push(node);
      },
      (e) => {
        this.inflight--;
        if (node.loadToken === token) this.loading.delete(node);
        if (node.loadToken !== token || node.state !== 'loading') return;
        node.jobId = null;
        if (e?.name === 'AbortError') {
          node.state = 'idle';
          return;
        }
        console.warn(`[earth] tile ${node.key} failed:`, e?.message ?? e);
        node.state = 'failed';
        node.retryAt = performance.now() / 1000 + RETRY_S;
      },
    );
  }

  /** A loaded node's mesh made and its texture uploaded: ready to draw. */
  activate(node) {
    const { bitmap, iz, ground } = node.loaded;
    node.loaded = null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(ground.positions, 3));
    geometry.setAttribute('uv', this.shared.uv);
    geometry.setIndex(this.shared.index);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), ground.radius);
    const map = this.imageTexture(bitmap, iz, node);
    node.iz = bitmap ? iz : node.parent?.iz ?? 0;
    node.imageryVersion = this.imageryVersion;
    node.texture = map;
    node.thumb = thumbnail(bitmap, node.z - iz, node.x, node.y);
    node.gainMap = gainTexture();
    node.gains = UNGRADED.slice(); // as shown (eased toward gainTarget)
    node.gainTarget = null;
    node.gainVersion = -1; // the colour samples its target was worked out from
    const material = tileMaterial(map, node.gainMap, new THREE.Vector3().fromArray(ground.center));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.fromArray(ground.center);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    mesh.userData.tile = node;
    node.mesh = mesh;
    node.heights = ground.heights;
    node.minH = ground.minH;
    node.maxH = ground.maxH;
    node.center = new THREE.Vector3().fromArray(ground.center);
    node.radius = ground.radius;
    node.state = 'ready';
    this.root.add(mesh);
    // its colours matched at once (later changes, as more tiles load round it, are eased to)
    this.sample(node);
    this.grade(node);
    node.gains.set(node.gainTarget);
    setGains(node.gainMap, node.gains);
  }

  /**
   * Colour matching. Neighbouring tiles often come from different photos
   * (another survey, season or camera, most of all between zooms), so their
   * colours clash, worst on water. Every tile is compared with its ancestor
   * at REFERENCE_ZOOM over the same ground: one image, one colour balance,
   * under a large area. That gives a sample of how this zoom's photos differ
   * from the reference here (`sample`). The samples of each zoom make a
   * smooth correction field over the ground (`fieldAt`): a Gaussian-weighted
   * average of nearby samples, over no less than a couple of the reference's
   * pixels, so it's never comparing finer detail than the reference has.
   * A tile's gains are that field at a lattice whose outer points lie on its
   * edges: a function of place alone, so neighbours agree where they meet,
   * and no seams are made.
   */

  /** `node`'s colour sample (once its reference has loaded): how its average colour differs from the reference's over its ground. */
  sample(node) {
    if (node.sampled || node.z <= REFERENCE_ZOOM) return;
    let ref = node.parent;
    while (ref && ref.z > REFERENCE_ZOOM) ref = ref.parent;
    if (ref?.state !== 'ready') return;
    ref.referenceThumb ??= thumbnail(ref.texture.image, ref.z - ref.iz, ref.x, ref.y, REFERENCE_THUMB);
    const k = 2 ** (node.z - ref.z);
    // patches about a reference pixel across (one a tile, for tiles smaller than that): every zoom sampled at the same scale on the ground
    const cells = THREE.MathUtils.clamp(Math.round(REFERENCE_THUMB / k), 1, 8);
    const level = this.levelOf(node.z);
    const sub = 4; // points averaged a patch, each way
    for (let cj = 0; cj < cells; cj++)
      for (let ci = 0; ci < cells; ci++) {
        const refSum = [0, 0, 0];
        const ownSum = [0, 0, 0];
        for (let j = 0; j < sub; j++)
          for (let i = 0; i < sub; i++) {
            const u = (ci + (i + 0.5) / sub) / cells;
            const v = (cj + (j + 0.5) / sub) / cells;
            addSample(ref.referenceThumb, REFERENCE_THUMB, (node.x - ref.x * k + u) / k, (node.y - ref.y * k + v) / k, refSum);
            addSample(node.thumb, THUMB, u, v, ownSum);
          }
        const key = `${node.key}:${ci},${cj}`;
        level.samples.delete(key); // (to the end: newest)
        level.samples.set(key, {
          // (where, in Web Mercator's 0 to 1: the same units at every zoom)
          x: (node.x + (ci + 0.5) / cells) / 2 ** node.z,
          y: (node.y + (cj + 0.5) / cells) / 2 ** node.z,
          log: [0, 1, 2].map((c) => Math.log((refSum[c] / sub ** 2 + GAIN_FLOOR) / (ownSum[c] / sub ** 2 + GAIN_FLOOR))),
        });
      }
    while (level.samples.size > MAX_SAMPLES) level.samples.delete(level.samples.keys().next().value);
    level.version++;
    node.sampled = true;
  }

  levelOf(z) {
    let level = this.levels.get(z);
    if (!level) this.levels.set(z, (level = { samples: new Map(), version: 0 }));
    return level;
  }

  /** `node`'s gains: the correction field at its lattice, brightness and tint kept in range. Sets `gainTarget`. */
  grade(node) {
    const level = this.levelOf(node.z);
    node.gainVersion = level.version;
    if (!blends(this.options) || node.z <= REFERENCE_ZOOM || !level.samples.size) {
      node.fieldGains = node.gainTarget = UNGRADED;
      this.featherDirty = true;
      return;
    }
    // the field's smoothing, the same on the ground at every zoom (Web Mercator units); and the samples near enough to count
    const tile = 1 / 2 ** node.z;
    const sigma = SMOOTH_REFERENCE_PX / (2 ** REFERENCE_ZOOM * REFERENCE_THUMB);
    const reach = 3 * sigma;
    const cx = (node.x + 0.5) * tile;
    const cy = (node.y + 0.5) * tile;
    const near = [];
    for (const s of level.samples.values()) if (Math.abs(s.x - cx) <= reach + tile / 2 && Math.abs(s.y - cy) <= reach + tile / 2) near.push(s);
    const n = GAIN_POINTS;
    const gains = new Float32Array(n * n * 3);
    const log = [0, 0, 0];
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const px = (node.x + i / (n - 1)) * tile;
        const py = (node.y + j / (n - 1)) * tile;
        let weight = PRIOR; // (toward no change)
        log[0] = log[1] = log[2] = 0;
        for (const s of near) {
          const d2 = (s.x - px) ** 2 + (s.y - py) ** 2;
          const w = Math.exp(-d2 / (2 * sigma * sigma));
          weight += w;
          for (let c = 0; c < 3; c++) log[c] += w * s.log[c];
        }
        const target = log.map((l) => Math.exp(l / weight));
        const lum = THREE.MathUtils.clamp(0.2126 * target[0] + 0.7152 * target[1] + 0.0722 * target[2], ...GAIN_RANGE);
        for (let c = 0; c < 3; c++) gains[(j * n + i) * 3 + c] = THREE.MathUtils.clamp(target[c], lum * (1 - TINT_RANGE), lum * (1 + TINT_RANGE));
      }
    node.fieldGains = node.gainTarget = gains;
    this.featherDirty = true;
  }

  /**
   * Drawn tiles sampled, their fields worked out again as samples near them
   * change (a few a frame), their edges feathered again when the tiles drawn
   * or the fields change (`changed`: tiles drawn this frame that weren't
   * last, or the other way), and their gains eased toward all that.
   */
  matchColours(dt, changed) {
    let graded = 0;
    const ease = 1 - Math.exp(-GAIN_EASE * dt);
    for (const node of this.drawn) {
      if (!node.sampled) this.sample(node);
      if (graded < GRADE_PER_FRAME && node.gainVersion !== this.levelOf(node.z).version) {
        graded++;
        this.grade(node);
      }
    }
    if (this.snapColours) for (const node of this.drawn) if (node.gainVersion !== this.levelOf(node.z).version) this.grade(node); // (switched: all at once)
    if (changed || this.featherDirty || this.snapColours) {
      this.featherDirty = false;
      const drawn = new Set(this.drawn);
      for (const node of this.drawn) if (node.fieldGains) this.feather(node, drawn);
    }
    const snap = this.snapColours;
    this.snapColours = false;
    for (const node of this.drawn) {
      const target = node.gainTarget;
      if (!target || node.gainsSettled === target) continue;
      if (snap) {
        node.gains.set(target);
        node.gainsSettled = target;
        setGains(node.gainMap, node.gains);
        continue;
      }
      let moving = false;
      for (let k = 0; k < target.length; k++) {
        const d = target[k] - node.gains[k];
        if (Math.abs(d) > 0.003) moving = true;
        node.gains[k] += d * ease;
      }
      if (!moving) {
        node.gains.set(target);
        node.gainsSettled = target;
      }
      setGains(node.gainMap, node.gains);
    }
  }

  /** The drawn tile (in `drawn`) covering Web Mercator point (mx, my), or null. */
  drawnAt(mx, my, drawn) {
    mx -= Math.floor(mx);
    if (my < 0 || my >= 1) return null;
    const n = 2 ** ROOT_ZOOM;
    let node = this.roots[Math.floor(my * n) * n + Math.floor(mx * n)];
    while (node) {
      if (drawn.has(node)) return node;
      if (!node.children) return null;
      const k = 2 ** (node.z + 1);
      node = node.children[(Math.floor(my * k) - node.y * 2) * 2 + (Math.floor(mx * k) - node.x * 2)];
    }
    return null;
  }

  /**
   * Edge feathering: where a tile meets a neighbour (whatever its zoom) and
   * their colours still differ (another photo), each is shaded toward the
   * colour halfway between them as it nears that edge, over FEATHER of its
   * width: both meet in the middle, so a hard step becomes a gradient, and
   * where they already agree nothing changes. Sets `gainTarget` from `fieldGains`.
   */
  feather(node, drawn) {
    if (!blends(this.options)) {
      node.gainTarget = node.fieldGains;
      return;
    }
    const n = GAIN_POINTS;
    const k = 2 ** node.z;
    const inside = 0.5 / THUMB; // (half a thumbnail pixel in from the edge, each side)
    // each edge: where its lattice points are (u, v from t), and which way is out
    const edges = [
      { at: (t) => [t, 0], out: [0, -1] }, // north
      { at: (t) => [t, 1], out: [0, 1] }, // south
      { at: (t) => [0, t], out: [-1, 0] }, // west
      { at: (t) => [1, t], out: [1, 0] }, // east
    ];
    const logs = edges.map((edge) => {
      const raw = [];
      for (let i = 0; i < n; i++) {
        const [u, v] = edge.at(i / (n - 1));
        const ui = u - edge.out[0] * inside;
        const vi = v - edge.out[1] * inside;
        // Only where a coarser tile meets this one (a zoom change: another photo layer). Same-zoom
        // neighbours are one photo layer, already continuous; and what differs across an edge may be
        // the ground itself (a shore along it), so the neighbour isn't what's compared with.
        const other = this.drawnAt((node.x + u + edge.out[0] * inside) / k, (node.y + v + edge.out[1] * inside) / k, drawn);
        if (!other || other === node || other.z >= node.z) {
          raw.push(null);
          continue;
        }
        // This tile's ancestor at the neighbour's zoom shows this same ground in the neighbour's photo
        // layer: where they differ here, that's the photos. Matched to it at the edge, this tile is
        // continuous with the neighbour (the ancestor is, being of its layer).
        let ancestor = node.parent;
        while (ancestor && ancestor.z > other.z) ancestor = ancestor.parent;
        if (ancestor?.state !== 'ready' || !ancestor.thumb) {
          raw.push(null);
          continue;
        }
        const levels = node.z - ancestor.z;
        const kk = 2 ** levels;
        // (this tile's colour over the ancestor's thumbnail pixel there, so both are compared at its scale)
        const footprint = Math.min(1, kk / THUMB);
        _own[0] = _own[1] = _own[2] = 0;
        for (let a = -1; a <= 1; a++)
          for (let b = -1; b <= 1; b++) {
            const su = THREE.MathUtils.clamp(ui + (a * footprint) / 3, 0, 1);
            const sv = THREE.MathUtils.clamp(vi + (b * footprint) / 3, 0, 1);
            colourAt(node, su, sv, _spot);
            for (let c = 0; c < 3; c++) _own[c] += _spot[c] / 9;
          }
        colourAt(ancestor, (node.x - ancestor.x * kk + ui) / kk, (node.y - ancestor.y * kk + vi) / kk, _other);
        raw.push([0, 1, 2].map((c) => THREE.MathUtils.clamp(Math.log((_other[c] + GAIN_FLOOR) / (_own[c] + GAIN_FLOOR)), -FEATHER_MAX, FEATHER_MAX)));
      }
      // smoothed along the edge (a stray patch, a road along it, mustn't streak)
      return raw.map((_, i) => {
        const sum = [0, 0, 0];
        let weight = 0;
        for (let d = -2; d <= 2; d++) {
          const r = raw[i + d];
          if (!r) continue;
          const w = 3 - Math.abs(d);
          weight += w;
          for (let c = 0; c < 3; c++) sum[c] += w * r[c];
        }
        return weight ? sum.map((s) => s / weight) : [0, 0, 0];
      });
    });
    const gains = new Float32Array(n * n * 3);
    const span = FEATHER * (n - 1); // lattice steps the feathering reaches in
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        // distance in from each edge (north, south, west, east), and where along it
        const reach = [
          [j, i],
          [n - 1 - j, i],
          [i, j],
          [n - 1 - i, j],
        ];
        const extra = [0, 0, 0];
        reach.forEach(([d, along], e) => {
          const w = THREE.MathUtils.smoothstep(1 - d / span, 0, 1);
          if (w > 0) for (let c = 0; c < 3; c++) extra[c] += w * logs[e][along][c];
        });
        for (let c = 0; c < 3; c++) {
          const g = node.fieldGains[(j * n + i) * 3 + c] * Math.exp(extra[c]);
          gains[(j * n + i) * 3 + c] = THREE.MathUtils.clamp(g, FEATHERED_RANGE[0], FEATHERED_RANGE[1]);
        }
      }
    node.gainTarget = gains;
  }

  /** `node`'s ground starts at the old ground's heights (`before(u, v)`, at its uvs), easing to its own as it fades (see tileMaterial.js). */
  morphFrom(node, before) {
    const geometry = node.mesh.geometry;
    const count = geometry.getAttribute('position').count;
    let attribute = geometry.getAttribute('heightDelta');
    if (!attribute) geometry.setAttribute('heightDelta', (attribute = new THREE.BufferAttribute(new Float32Array(count), 1)));
    const side = SEGMENTS + 1;
    const delta = attribute.array;
    for (let j = 0; j < side; j++)
      for (let i = 0; i < side; i++) {
        const k = j * side + i;
        delta[k] = before(i / SEGMENTS, j / SEGMENTS) - node.heights[k];
      }
    // (the skirt hangs from the edge as it moves)
    this.loop.forEach(([i, j], r) => (delta[side * side + r] = delta[j * side + i]));
    attribute.needsUpdate = true;
  }

  /**
   * How `node` looks from the viewer this frame (worked out once a frame):
   * culled (over the horizon), inView (in the camera's frustum), sse (a
   * texel's size on screen, px), distance (m).
   */
  look(node, v) {
    if (node.seen === this.frame) return node.view;
    node.seen = this.frame;
    const b = node.bounds;
    // the tile's point nearest the viewer (roughly): their lat / lon clamped into it, at a height within its range
    const lat = THREE.MathUtils.clamp(v.lat, b.south, b.north);
    const dw = angleDiff(v.lon, b.west);
    const width = b.east - b.west;
    const lon = dw >= 0 && dw <= width ? v.lon : Math.abs(angleDiff(v.lon, b.west)) < Math.abs(angleDiff(v.lon, b.east)) ? b.west : b.east;
    const h = THREE.MathUtils.clamp(v.h, node.minH, node.maxH);
    geodeticToEcef(lat, lon, h, _p);
    const dx = v.ecef.x - _p[0];
    const dy = v.ecef.y - _p[1];
    const dz = v.ecef.z - _p[2];
    const distance = Math.max(1, Math.hypot(dx, dy, dz));
    const n = surfaceNormal(lat, lon);
    // facing away from the viewer, beyond a margin: over the horizon
    const facing = dx * n[0] + dy * n[1] + dz * n[2];
    const culled = facing < -(node.texelM * IMAGE_PX * 0.05 + 1000);
    // in the camera's view: its bounding sphere, carried into the world
    _sphere.center.copy(node.center ?? node.approxCenter).applyMatrix4(this.root.matrixWorld);
    _sphere.radius = (node.center ? node.radius + 50 : node.approxRadius) * v.scale;
    const inView = v.frustum.intersectsSphere(_sphere);
    node.view = { culled, inView, distance, sse: (node.texelM / distance) * v.pixelsPerRadian };
    return node.view;
  }

  /** Should `node` give way to its children? */
  wantsSplit(node, v) {
    const source = IMAGERY[this.options.imagery] ?? IMAGERY.esri;
    // (past a source's finest zoom, tiles still split, its image stretched, for the ground's shape, to TERRAIN_ZOOM)
    if (node.z >= Math.max(source.maxZoom, TERRAIN_ZOOM)) return false;
    if (node.state === 'ready' && node.iz < node.z && node.z >= TERRAIN_ZOOM) return false; // (the source has nothing finer here)
    const view = this.look(node, v);
    // (split last frame: it stays split until well under the limit, so tiles near it don't flicker between levels)
    const limit = ((view.inView ? DETAIL_PX : OFFSCREEN_DETAIL) / this.options.detail) * (node.split ? MERGE_AT : 1);
    return view.sse > limit;
  }

  want(node, v) {
    node.lastWanted = this.frame;
    const view = this.look(node, v);
    // nearest first (a tile's own parents, as near, a hair before it); out of view after everything in it
    node.priority = Math.log2(Math.max(1, view.distance)) + node.z * 0.05 + (view.inView ? 0 : 100);
    if (node.state === 'idle' || (node.state === 'failed' && performance.now() / 1000 >= node.retryAt)) this.wanted.push({ node, priority: node.priority });
  }

  /** Can `node`'s ground be drawn, by it or its loaded descendants? (A parent dropped while its children showed.) */
  coverable(node, v) {
    if (node.state === 'ready') return true;
    return Boolean(node.children?.every((c) => this.look(c, v).culled || this.coverable(c, v)));
  }

  draw(node, v) {
    node.lastUsed = this.frame;
    if (node.state === 'ready') {
      node.mesh.visible = true;
      this.drawn.push(node);
      return;
    }
    this.want(node, v);
    if (node.children && this.coverable(node, v)) for (const c of node.children) if (!this.look(c, v).culled) this.draw(c, v);
  }

  visit(node, v) {
    node.lastUsed = this.frame;
    node.split = false;
    if (this.look(node, v).culled) return;
    if (this.wantsSplit(node, v)) {
      const children = this.childrenOf(node);
      const ready = children.every((c) => this.look(c, v).culled || c.state === 'ready');
      if (ready) {
        node.split = true;
        for (const c of children) this.visit(c, v);
        return;
      }
      // not all there yet: this tile shows meanwhile, and the levels beneath it are all asked for at once
      for (const c of children) this.lookAhead(c, v, LOOK_AHEAD);
    }
    this.draw(node, v);
  }

  childrenOf(node) {
    if (!node.children) node.children = [0, 1, 2, 3].map((i) => new TileNode(node.z + 1, node.x * 2 + (i & 1), node.y * 2 + (i >> 1), node));
    return node.children;
  }

  /** `node` (not drawn yet) wanted, and those beneath it that will be, `depth` levels down: so a near place gets its finest tiles without waiting a round trip a level. */
  lookAhead(node, v, depth) {
    if (this.look(node, v).culled) return;
    node.lastUsed = this.frame;
    if (node.state !== 'ready') this.want(node, v);
    if (depth > 0 && this.wantsSplit(node, v)) for (const c of this.childrenOf(node)) this.lookAhead(c, v, depth - 1);
  }

  /**
   * Per frame: picks and draws the tiles for `camera` (the XR camera in XR),
   * with the Earth placed by `pose` (EarthPose); `viewportHeight` in px.
   */
  update(camera, pose, viewportHeight) {
    this.frame++;
    this.root.matrix.copy(pose.matrix);
    this.root.matrixWorldNeedsUpdate = true;
    this.root.updateMatrixWorld(true);
    // the viewer, in the Earth's frame
    camera.getWorldPosition(_v);
    const ecef = _w.copy(_v).applyMatrix4(pose.inverse);
    const geo = ecefToGeodetic(ecef.x, ecef.y, ecef.z);
    _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreen);
    const v = {
      ecef,
      lat: geo.lat,
      lon: geo.lon,
      h: geo.h,
      scale: pose.scale,
      frustum: _frustum,
      // px per radian: half the viewport's height times the projection's focal length
      pixelsPerRadian: (viewportHeight / 2) * Math.abs(camera.projectionMatrix.elements[5] || 1),
    };
    this.viewer = v;
    const before = new Set(this.drawn ?? []);
    for (const node of before) if (node.mesh) node.mesh.visible = false;
    this.drawn = [];
    this.wanted = [];
    for (const root of this.roots) this.visit(root, v);
    this.fade(before);
    const now = performance.now() / 1000;
    const changed = this.drawn.length !== before.size || this.drawn.some((node) => !before.has(node));
    this.matchColours(Math.min(0.1, now - (this.lastUpdate ?? now)), changed);
    this.lastUpdate = now;

    // start the most wanted loads (nearest first, in view before out of it)
    this.wanted.sort((a, b) => a.priority - b.priority);
    let preempted = 0;
    for (const { node, priority } of this.wanted) {
      if (this.loading.size >= MAX_INFLIGHT) {
        if (preempted >= MAX_PREEMPT) break;
        preempted++;
        // full: a load for ground no longer wanted, or much further off (4× or more), gives way
        let worst = null;
        for (const n of this.loading) {
          const p = n.lastWanted === this.frame ? n.priority : Infinity;
          if (!worst || p > worst.p) worst = { n, p };
        }
        if (!worst || worst.p < priority + PREEMPT) break;
        this.unload(worst.n);
      }
      this.load(node);
    }
    this.scheduleSwaps();
    // uploads, a few a frame (coarsest first; then new source images, nearest first)
    let uploads = 0;
    if (this.pending.length) {
      this.pending.sort((a, b) => a.z - b.z);
      for (const node of this.pending.splice(0, ACTIVATE_PER_FRAME)) if (node.state === 'pending') (this.activate(node), uploads++);
    }
    if (this.pendingSwaps.length && uploads < ACTIVATE_PER_FRAME) {
      this.pendingSwaps.sort((a, b) => (a.view?.distance ?? Infinity) - (b.view?.distance ?? Infinity));
      for (const node of this.pendingSwaps.splice(0, ACTIVATE_PER_FRAME - uploads)) if (node.swap?.image && node.state === 'ready') this.applySwap(node);
    }
    if (this.frame % EVICT_EVERY === 0) this.housekeep();
    this.stats.drawn = this.drawn.length;
    this.stats.loading = this.loading.size;
    this.stats.deepest = this.drawn.reduce((m, n) => Math.max(m, n.z), 0);
  }

  /**
   * Tiles shown this frame that weren't last frame fade in from what they
   * replaced (`before`: those drawn last frame): the coarser tile they split
   * out of, or the children that joined back into them. Fades under way move on.
   */
  fade(before) {
    const now = performance.now() / 1000;
    for (const node of this.drawn) {
      if (before.has(node) || this.fading.has(node)) continue;
      const from = [];
      // split out of a coarser tile: its image's part over this one
      let a = node.parent;
      while (a && !before.has(a)) a = a.parent;
      if (a?.state === 'ready') {
        const levels = node.z - a.z;
        const k = 2 ** -levels;
        const transform = new THREE.Matrix3().set(k, 0, (node.x - a.x * 2 ** levels) * k, 0, k, (node.y - a.y * 2 ** levels) * k, 0, 0, 1);
        from.push({ node: a, texture: a.texture, gainMap: a.gainMap, transform });
        const k2 = 2 ** levels;
        this.morphFrom(node, (u, v) => heightIn(a, (node.x - a.x * k2 + u) / k2, (node.y - a.y * k2 + v) / k2));
      } else if (node.children?.every((c) => c.state === 'ready') && node.children.some((c) => before.has(c) || c.split)) {
        // the children joined back into it: each its quarter
        node.children.forEach((c, i) => from.push({ node: c, texture: c.texture, transform: new THREE.Matrix3().set(2, 0, -(i & 1), 0, 2, -(i >> 1), 0, 0, 1), gainMap: c.gainMap }));
        this.morphFrom(node, (u, v) => {
          const i = u >= 0.5 ? 1 : 0;
          const j = v >= 0.5 ? 1 : 0;
          return heightIn(node.children[j * 2 + i], u * 2 - i, v * 2 - j);
        });
      }
      if (!from.length) continue;
      fadeFrom(node.mesh.material, from);
      this.fading.set(node, { start: now, from: from.map((f) => f.node) });
    }
    const shown = new Set(this.drawn);
    for (const [node, f] of this.fading) {
      const t = (now - f.start) / (f.duration ?? FADE_S);
      // (done, replaced in turn, or what it fades from gone)
      if (t >= 1 || !shown.has(node) || f.from.some((n) => n.state !== 'ready')) {
        this.endFading(node, f);
        continue;
      }
      node.mesh.material.uniforms.fade.value = t * t * (3 - 2 * t);
      for (const n of f.from) n.lastUsed = this.frame; // (kept while it's faded from)
    }
  }

  /** Loads no longer wanted dropped; the least recently used tiles over `maxTiles` freed. */
  housekeep() {
    const all = [];
    const walk = (node) => {
      all.push(node);
      node.children?.forEach(walk);
    };
    this.roots.forEach(walk);
    const ready = [];
    for (const node of all) {
      if ((node.state === 'loading' || node.state === 'pending') && this.frame - node.lastWanted > DROP_AFTER_FRAMES) this.unload(node);
      if (node.state === 'ready') ready.push(node);
    }
    this.stats.ready = ready.length;
    if (ready.length > this.options.maxTiles) {
      const spare = ready.filter((n) => n.lastUsed < this.frame - 1 && n.z > ROOT_ZOOM).sort((a, b) => a.lastUsed - b.lastUsed || b.z - a.z);
      for (const node of spare.slice(0, ready.length - this.options.maxTiles)) this.unload(node);
    }
    // whole branches unused and empty: forgotten
    for (const node of all)
      if (node.children && this.frame - node.lastUsed > 600 && node.children.every((c) => c.state === 'idle' && !c.children)) node.children = null;
  }

  /** The ground's height (m above the ellipsoid) at (lat, lon), from the finest loaded tile there; null if none. */
  heightAt(lat, lon) {
    const mx = mercatorX(angleDiff(lon, 0));
    const my = mercatorY(THREE.MathUtils.clamp(lat, -MERCATOR_MAX_LAT, MERCATOR_MAX_LAT));
    if (my < 0 || my > 1) return null;
    const n = 2 ** ROOT_ZOOM;
    let node = this.roots[Math.min(n - 1, Math.floor(my * n)) * n + Math.min(n - 1, Math.floor(mx * n))];
    let best = node?.state === 'ready' ? node : null;
    while (node?.children) {
      const k = 2 ** (node.z + 1);
      const cx = Math.min(k - 1, Math.floor(mx * k));
      const cy = Math.min(k - 1, Math.floor(my * k));
      node = node.children[(cy - node.y * 2) * 2 + (cx - node.x * 2)];
      if (node?.state === 'ready') best = node;
    }
    return heightAtMercator(best, mx, my);
  }

  /**
   * The ground's height as drawn at (lat, lon): the higher of the finest
   * loaded tile's and the drawn tile's there (a coarser tile, or one still
   * fading from its parent, can stand above the finest heights); null if
   * neither has heights. For keeping the viewer above what's to be seen.
   */
  surfaceAt(lat, lon) {
    const fine = this.heightAt(lat, lon);
    if (!this.drawn?.length) return fine;
    const mx = mercatorX(angleDiff(lon, 0));
    const my = mercatorY(THREE.MathUtils.clamp(lat, -MERCATOR_MAX_LAT, MERCATOR_MAX_LAT));
    if (this.drawnSetOf !== this.drawn) this.drawnSet = new Set(this.drawn);
    this.drawnSetOf = this.drawn;
    const node = this.drawnAt(mx, my, this.drawnSet);
    const shown = heightAtMercator(node, mx, my);
    return shown == null ? fine : fine == null ? shown : Math.max(fine, shown);
  }

  /**
   * Where world ray `ray` meets the ground: { world, ecef, lat, lon } or null.
   * Against the ellipsoid raised to the ground's height there (twice, to settle).
   */
  raycast(ray, pose) {
    const o = _v.copy(ray.origin).applyMatrix4(pose.inverse);
    const d = _w.copy(ray.direction).transformDirection(pose.inverse);
    let h = 0;
    let hit = null;
    for (let pass = 0; pass < 3; pass++) {
      const t = intersectEllipsoid(o, d, h);
      if (t == null) return pass ? hitAt(hit, pose) : null;
      hit = o.clone().addScaledVector(d, t);
      const geo = ecefToGeodetic(hit.x, hit.y, hit.z);
      h = this.heightAt(geo.lat, geo.lon) ?? 0;
    }
    return hitAt(hit, pose);
  }
}

/** A tile's ground height at Web Mercator point (mx, my), or null if it has no heights. */
const heightAtMercator = (node, mx, my) => (node?.heights ? heightIn(node, mx * 2 ** node.z - node.x, my * 2 ** node.z - node.y) : null);

function hitAt(ecef, pose) {
  const geo = ecefToGeodetic(ecef.x, ecef.y, ecef.z);
  return { ecef, world: ecef.clone().applyMatrix4(pose.matrix), lat: geo.lat, lon: geo.lon };
}

/** The nearest t ≥ 0 at which ray (o + t d) meets the ellipsoid raised by `h`, or null. */
export function intersectEllipsoid(o, d, h = 0) {
  const a = WGS84_A + h;
  const b = WGS84_B + h;
  // in the space where that ellipsoid is the unit sphere
  const ox = o.x / a;
  const oy = o.y / a;
  const oz = o.z / b;
  const dx = d.x / a;
  const dy = d.y / a;
  const dz = d.z / b;
  const A = dx * dx + dy * dy + dz * dz;
  const B = 2 * (ox * dx + oy * dy + oz * dz);
  const C = ox * ox + oy * oy + oz * oz - 1;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t0 = (-B - s) / (2 * A);
  const t1 = (-B + s) / (2 * A);
  if (t0 >= 0) return t0;
  if (t1 >= 0) return t1; // (from inside)
  return null;
}
