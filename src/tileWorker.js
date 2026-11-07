// Off the page's thread: a tile's ground. Fetches (and caches) the elevation
// tile covering it, decodes its heights, and builds the tile's mesh: a grid
// of SEGMENTS × SEGMENTS quads over its patch of the Earth, plus a skirt
// hanging down from its edges (hiding the cracks where a finer tile meets a
// coarser one). Vertices are relative to the tile's centre, so they keep
// their precision in 32-bit floats; the centre goes back in full.
//
// Message in:  { type: 'build', id, z, x, y, ez, ex, ey, terrain, segments, url }
//              { type: 'cancel', id }
// Message out: { id, positions, heights, center, radius, minH, maxH } | { id, error }

import { fetchTile } from './tileCache.js';
import { edgeLoop, geodeticToEcef, tileLat, tileLon } from './geo.js';

const SIZE = 256; // an elevation tile's pixels a side
const MAX_KEPT = 48; // decoded elevation tiles kept in memory (256 KB each)
const kept = new Map(); // url -> Promise<Float32Array | null>, oldest first
const cancelled = new Set();

let canvas = null;
let ctx = null;

/**
 * Terrarium PNG to heights in metres (row 0 the north edge), the sea floor
 * at sea level and spikes taken out (see despike). `pixelM`: a pixel's width.
 */
async function decode(blob, pixelM) {
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  if (!canvas) {
    canvas = new OffscreenCanvas(SIZE, SIZE);
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.drawImage(bitmap, 0, 0, SIZE, SIZE);
  bitmap.close?.();
  const rgba = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const heights = new Float32Array(SIZE * SIZE);
  // (the sea floor isn't shown: oceans lie at sea level; so do the data's voids, thousands of metres deep)
  for (let i = 0, p = 0; i < heights.length; i++, p += 4) heights[i] = Math.max(0, rgba[p] * 256 + rgba[p + 1] + rgba[p + 2] / 256 - 32768);
  return despike(heights, pixelM);
}

const SPIKE_M = 30; // a pixel this much (plus a 45° slope's rise over a pixel) above or below its neighbours is an error in the data
const _ring = new Float32Array(8);

/**
 * The elevation tiles have errors: single pixels (or pairs) hundreds of
 * metres above or below the ground round them, which would stand out of the
 * ground as needles. A pixel further above its second-highest neighbour (or
 * below its second-lowest) than real ground can rise over a pixel takes the
 * middle of its neighbours' heights instead.
 */
function despike(heights, pixelM) {
  const limit = SPIKE_M + pixelM;
  const source = heights.slice();
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = Math.min(SIZE - 1, Math.max(0, x + dx));
          const yy = Math.min(SIZE - 1, Math.max(0, y + dy));
          _ring[k++] = source[yy * SIZE + xx];
        }
      _ring.sort();
      const h = source[y * SIZE + x];
      if (h - _ring[6] > limit || _ring[1] - h > limit) heights[y * SIZE + x] = (_ring[3] + _ring[4]) / 2;
    }
  return heights;
}

/** Elevation tile `url`'s heights (decoded once, kept), whose pixels are `pixelM` wide. */
function elevation(url, pixelM) {
  let entry = kept.get(url);
  if (entry) {
    kept.delete(url); // (most recently used: to the end)
    kept.set(url, entry);
    return entry;
  }
  entry = fetchTile(url).then((blob) => (blob ? decode(blob, pixelM) : null));
  entry.catch(() => kept.delete(url)); // (failed: tried again next time)
  kept.set(url, entry);
  while (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value);
  return entry;
}

/** Bilinear height at elevation-image pixel (px, py), clamped to the image. */
function sample(heights, px, py) {
  const x = Math.min(SIZE - 1, Math.max(0, px));
  const y = Math.min(SIZE - 1, Math.max(0, py));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(SIZE - 1, x0 + 1);
  const y1 = Math.min(SIZE - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const a = heights[y0 * SIZE + x0] * (1 - fx) + heights[y0 * SIZE + x1] * fx;
  const b = heights[y1 * SIZE + x0] * (1 - fx) + heights[y1 * SIZE + x1] * fx;
  return a * (1 - fy) + b * fy;
}

async function build({ id, z, x, y, ez, ex, ey, terrain, segments: n, url }) {
  // (a pixel's width in metres, at the elevation tile's middle)
  const pixelM = (2 * Math.PI * 6378137 * Math.cos(tileLat(ey + 0.5, ez))) / 2 ** ez / SIZE;
  const source = terrain && url ? await elevation(url, pixelM) : null;
  if (cancelled.delete(id)) return null;
  const side = n + 1;
  const heights = new Float32Array(side * side);
  // where this tile lies in its elevation tile (an ancestor, or itself)
  const scale = 2 ** (z - ez);
  const ox = x - ex * scale;
  const oy = y - ey * scale;
  let minH = Infinity;
  let maxH = -Infinity;
  for (let j = 0; j < side; j++)
    for (let i = 0; i < side; i++) {
      const h = source ? Math.max(0, sample(source, ((ox + i / n) / scale) * SIZE - 0.5, ((oy + j / n) / scale) * SIZE - 0.5)) : 0;
      heights[j * side + i] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  // the centre: the middle of the tile in Mercator, halfway up its heights
  const center = geodeticToEcef(tileLat(y + 0.5, z), tileLon(x + 0.5, z), (minH + maxH) / 2);
  // the grid, then the skirt: one vertex below each edge vertex, going round
  // the edge clockwise as seen from above (north edge west to east, east edge
  // north to south, south edge east to west, west edge south to north)
  const ring = n * 4;
  const positions = new Float32Array((side * side + ring) * 3);
  const p = [0, 0, 0];
  let radius = 0;
  const lats = Array.from({ length: side }, (_, j) => tileLat(y + j / n, z));
  const lons = Array.from({ length: side }, (_, i) => tileLon(x + i / n, z));
  for (let j = 0; j < side; j++)
    for (let i = 0; i < side; i++) {
      geodeticToEcef(lats[j], lons[i], heights[j * side + i], p);
      const k = (j * side + i) * 3;
      positions[k] = p[0] - center[0];
      positions[k + 1] = p[1] - center[1];
      positions[k + 2] = p[2] - center[2];
      radius = Math.max(radius, Math.hypot(positions[k], positions[k + 1], positions[k + 2]));
    }
  // skirts hang a little more than a cell's width (what a coarser neighbour can be off by)
  const tileMetres = ((lons[n] - lons[0]) * 6378137 * Math.cos((lats[0] + lats[n]) / 2)) / n;
  const depth = Math.max(20, tileMetres * 1.5 + (maxH - minH) * 0.1);
  edgeLoop(n).forEach(([i, j], r) => {
    geodeticToEcef(lats[j], lons[i], heights[j * side + i] - depth, p);
    const k = (side * side + r) * 3;
    positions[k] = p[0] - center[0];
    positions[k + 1] = p[1] - center[1];
    positions[k + 2] = p[2] - center[2];
  });
  return { id, positions, heights, center, radius, minH, maxH };
}

// Clouds (Map → Clouds), from a world image of longwave infrared (NOAA's
// geostationary mosaic): grey brightness rises as the temperature falls,
// calibrated on clear tropical ocean (GREY_TROPICS, ~299 K) and the coldest
// storm tops (255, ~190 K). Clear ground's temperature is estimated locally:
// the warmest few percent (BACKGROUND_PERCENTILE) of the (3 × BLOCK)² pixels
// round each BLOCK (about 8°): even under a big storm, some of that is clear.
// So cold land in winter isn't taken for cloud, nor warm tropics for clear. Colder than that background by CLOUD_K and
// more is cloud; its top is as high as the air is that much colder
// (LAPSE_K_PER_KM). Out: RGBA bytes, R the cloud's cover (0 to 1), G its
// top's height (0 to MAX_TOP_KM).
const GREY_TROPICS = 60;
const K_PER_GREY = (299 - 190) / (255 - GREY_TROPICS);
const BLOCK = 32;
const BACKGROUND_PERCENTILE = 0.05;
const CLOUD_K = [8, 24]; // colder than clear ground by this: from no cloud to full cover
const LAPSE_K_PER_KM = 6.5;
export const MAX_TOP_KM = 15;

async function clouds({ id, url, elevationUrl: elevationTemplate }) {
  const elevationUrl = (z, x, y) => elevationTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  const response = await fetch(url, { credentials: 'omit', cache: 'no-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for clouds`);
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const { width: w, height: h } = bitmap;
  const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const px = ctx.getImageData(0, 0, w, h).data;
  // each block's histogram of greys (pixels with data)...
  const bw = Math.ceil(w / BLOCK);
  const bh = Math.ceil(h / BLOCK);
  const histograms = new Uint32Array(bw * bh * 256);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (px[i + 3] > 0) histograms[(Math.floor(y / BLOCK) * bw + Math.floor(x / BLOCK)) * 256 + px[i]]++;
    }
  // ...and each block's clear-ground grey: the low percentile of it and its eight neighbours together (round the world east and west)
  const background = new Float32Array(bw * bh).fill(NaN);
  const sum = new Uint32Array(256);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      sum.fill(0);
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = by + dy;
        if (yy < 0 || yy >= bh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const base = (yy * bw + ((bx + dx + bw) % bw)) * 256;
          for (let v = 0; v < 256; v++) {
            sum[v] += histograms[base + v];
            count += histograms[base + v];
          }
        }
      }
      if (count < BLOCK) continue;
      const want = count * BACKGROUND_PERCENTILE;
      let seen = 0;
      for (let v = 0; v < 256; v++) {
        seen += sum[v];
        if (seen >= want) {
          background[by * bw + bx] = v;
          break;
        }
      }
    }
  // (blocks with no data: their neighbours' background)
  const bgAt = (x, y) => {
    const fx = Math.min(bw - 1, Math.max(0, x / BLOCK - 0.5));
    const fy = Math.min(bh - 1, Math.max(0, y / BLOCK - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    let sum = 0;
    let weight = 0;
    for (const [xx, yy, wgt] of [
      [x0, y0, (1 - (fx - x0)) * (1 - (fy - y0))],
      [x0 + 1, y0, (fx - x0) * (1 - (fy - y0))],
      [x0, y0 + 1, (1 - (fx - x0)) * (fy - y0)],
      [x0 + 1, y0 + 1, (fx - x0) * (fy - y0)],
    ]) {
      const b = background[Math.min(bh - 1, yy) * bw + Math.min(bw - 1, xx)];
      if (!Number.isNaN(b)) {
        sum += b * wgt;
        weight += wgt;
      }
    }
    return weight ? sum / weight : GREY_TROPICS;
  };
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (px[i + 3] === 0) continue; // (no satellite sees there: the poles)
      const colder = (px[i] - bgAt(x, y)) * K_PER_GREY; // K colder than clear ground
      const t = Math.min(1, Math.max(0, (colder - CLOUD_K[0]) / (CLOUD_K[1] - CLOUD_K[0])));
      const cover = t * t * (3 - 2 * t);
      if (cover <= 0) continue;
      const top = Math.min(MAX_TOP_KM, Math.max(0.5, colder / LAPSE_K_PER_KM));
      out[i] = Math.round(cover * 255);
      out[i + 1] = Math.round((top / MAX_TOP_KM) * 255);
      out[i + 3] = 255;
    }
  const ground = await groundMap(elevationUrl);
  self.postMessage({ id, clouds: out, width: w, height: h, ground: ground.slice(), groundWidth: GROUND_W }, [out.buffer]);
}

// The world's ground, coarsely, for the clouds (so their layers fade out
// where mountains rise into them): the highest ground in each cell of a
// GROUND_W × GROUND_W / 2 latitude / longitude grid, as bytes (0 to
// GROUND_MAX_M), from zoom GROUND_ZOOM's elevation tiles. Made once.
const GROUND_W = 1024;
const GROUND_ZOOM = 2;
const GROUND_MAX_M = 6000;
let groundPromise = null;

function groundMap(url) {
  groundPromise ??= (async () => {
    const n = 2 ** GROUND_ZOOM;
    const tiles = await Promise.all(
      Array.from({ length: n * n }, (_, k) => {
        const x = k % n;
        const y = Math.floor(k / n);
        const pixelM = (2 * Math.PI * 6378137 * Math.cos(tileLat(y + 0.5, GROUND_ZOOM))) / n / SIZE;
        return elevation(url(GROUND_ZOOM, x, y), pixelM).catch(() => null);
      }),
    );
    const gw = GROUND_W;
    const gh = GROUND_W / 2;
    const out = new Uint8Array(gw * gh);
    const world = n * SIZE; // Web Mercator pixels across
    const reach = 2; // (pixels round each sample: its cell's highest)
    for (let j = 0; j < gh; j++) {
      const lat = Math.PI / 2 - ((j + 0.5) / gh) * Math.PI;
      if (Math.abs(lat) > 1.48) continue;
      const my = ((1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2) * world;
      for (let i = 0; i < gw; i++) {
        const mx = ((i + 0.5) / gw) * world;
        let high = 0;
        for (let dy = -reach; dy <= reach; dy++)
          for (let dx = -reach; dx <= reach; dx++) {
            const px = (Math.floor(mx) + dx + world) % world;
            const py = Math.min(world - 1, Math.max(0, Math.floor(my) + dy));
            const tile = tiles[Math.floor(py / SIZE) * n + Math.floor(px / SIZE)];
            if (tile) high = Math.max(high, tile[(py % SIZE) * SIZE + (px % SIZE)]);
          }
        out[j * gw + i] = Math.round(Math.min(1, high / GROUND_MAX_M) * 255);
      }
    }
    return out;
  })();
  return groundPromise;
}

self.onmessage = async ({ data }) => {
  if (data.type === 'clouds') {
    clouds(data).catch((e) => self.postMessage({ id: data.id, error: e?.message ?? String(e) }));
    return;
  }
  if (data.type === 'cancel') {
    if (cancelled.size > 2000) cancelled.clear(); // (ids cancelled after they were done)
    cancelled.add(data.id);
    return;
  }
  try {
    const result = await build(data);
    if (!result) return;
    self.postMessage(result, [result.positions.buffer, result.heights.buffer]);
  } catch (e) {
    cancelled.delete(data.id);
    self.postMessage({ id: data.id, error: e?.message ?? String(e) });
  }
};
