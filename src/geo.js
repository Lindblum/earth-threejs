// The Earth's shape (WGS84) and the Web Mercator tiles that cover it.
//
// ECEF: Earth-centred, Earth-fixed metres; x through (0°, 0°), y through
// (0°, 90° E), z through the North Pole. Latitudes and longitudes in radians.
// Plain math, no three.js, so the tile worker can use it too.

export const WGS84_A = 6378137; // equatorial radius, m
export const WGS84_B = 6356752.314245; // polar radius, m
const E2 = 1 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A); // first eccentricity squared
const EP2 = (WGS84_A * WGS84_A) / (WGS84_B * WGS84_B) - 1; // second eccentricity squared

export const DEG = Math.PI / 180;
/** Web Mercator's limit, ±85.05°: tiles reach no nearer the poles. */
export const MERCATOR_MAX_LAT = Math.atan(Math.sinh(Math.PI));

/** Geodetic (lat, lon, height above the ellipsoid) to ECEF, into `out` ([x, y, z] or anything with 0, 1, 2), from offset `o`. */
export function geodeticToEcef(lat, lon, h, out = [0, 0, 0], o = 0) {
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = WGS84_A / Math.sqrt(1 - E2 * sinLat * sinLat);
  out[o] = (n + h) * cosLat * Math.cos(lon);
  out[o + 1] = (n + h) * cosLat * Math.sin(lon);
  out[o + 2] = (n * (1 - E2) + h) * sinLat;
  return out;
}

/** ECEF to geodetic { lat, lon, h } (Bowring's method: millimetre-close anywhere near the surface). */
export function ecefToGeodetic(x, y, z) {
  const p = Math.hypot(x, y);
  if (p < 1e-6) return { lat: z >= 0 ? Math.PI / 2 : -Math.PI / 2, lon: 0, h: Math.abs(z) - WGS84_B };
  const theta = Math.atan2(z * WGS84_A, p * WGS84_B);
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const lat = Math.atan2(z + EP2 * WGS84_B * sinT ** 3, p - E2 * WGS84_A * cosT ** 3);
  const sinLat = Math.sin(lat);
  const n = WGS84_A / Math.sqrt(1 - E2 * sinLat * sinLat);
  const h = Math.abs(lat) < 1.5 ? p / Math.cos(lat) - n : z / sinLat - n * (1 - E2);
  return { lat, lon: Math.atan2(y, x), h };
}

/** The ellipsoid's outward normal (the local up) at (lat, lon): [x, y, z]. */
export function surfaceNormal(lat, lon) {
  const c = Math.cos(lat);
  return [c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat)];
}

/** Tile column `x` of 2^z: its western edge's longitude. */
export const tileLon = (x, z) => (x / 2 ** z) * 2 * Math.PI - Math.PI;
/** Tile row `y` of 2^z (from the north): its northern edge's latitude. */
export const tileLat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z)));
/** Latitude to Web Mercator's y, 0 (north edge) to 1 (south edge). */
export const mercatorY = (lat) => (1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2;
/** Longitude to Web Mercator's x, 0 (180° W) to 1 (180° E). */
export const mercatorX = (lon) => (lon + Math.PI) / (2 * Math.PI);

/** Tile (z, x, y)'s edges: { west, east, north, south } in radians. */
export function tileBounds(z, x, y) {
  return { west: tileLon(x, z), east: tileLon(x + 1, z), north: tileLat(y, z), south: tileLat(y + 1, z) };
}

/** `a` - `b` in radians, wrapped to -π..π. */
export function angleDiff(a, b) {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** "47.6062° N, 122.3321° W" */
export function formatLatLon(lat, lon, digits = 4) {
  const la = lat / DEG;
  const lo = angleDiff(lon, 0) / DEG;
  return `${Math.abs(la).toFixed(digits)}° ${la >= 0 ? 'N' : 'S'}, ${Math.abs(lo).toFixed(digits)}° ${lo >= 0 ? 'E' : 'W'}`;
}

/** A tile mesh's grid edge vertices, (i, j) of an n × n grid, clockwise from the north-west corner as seen from above (each corner once). */
export function edgeLoop(n) {
  const loop = [];
  for (let i = 0; i < n; i++) loop.push([i, 0]); // north, west to east
  for (let j = 0; j < n; j++) loop.push([n, j]); // east, north to south
  for (let i = n; i > 0; i--) loop.push([i, n]); // south, east to west
  for (let j = n; j > 0; j--) loop.push([0, j]); // west, south to north
  return loop;
}
