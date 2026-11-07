// Tiles kept on this device, in the browser's Cache Storage, so places seen
// before load at once and the tile servers are asked as little as can be.
// Used by the page (imagery) and the tile worker (elevation) alike.
//
// Cache Storage has no size limit of its own (the browser clears the whole
// site's storage under pressure), so it's kept to MAX_ENTRIES: every so often
// the oldest are deleted (its keys come back in the order they were put).

const CACHE_NAME = 'earth-tiles-v1';
const MAX_ENTRIES = 30000; // about 1 GB of 256 px tiles at most
const TRIM_EVERY = 500; // puts between counts
const TRIM_TO = 0.8; // trimmed, down to this share of MAX_ENTRIES

let cachePromise = null;
let puts = 0;
let trimming = false;

function openCache() {
  // (no Cache Storage outside secure contexts: plain fetches then)
  if (!cachePromise) cachePromise = typeof caches === 'undefined' ? Promise.resolve(null) : caches.open(CACHE_NAME).catch(() => null);
  return cachePromise;
}

async function trim(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    const excess = keys.length - Math.floor(MAX_ENTRIES * TRIM_TO);
    if (keys.length > MAX_ENTRIES) for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
  } catch {
    // (left as it is)
  } finally {
    trimming = false;
  }
}

/**
 * `url`'s body as a Blob: from the cache if it's there, else fetched (and
 * kept). Null for a tile the server hasn't got (404, 204). Throws on network
 * failure or `signal`'s abort.
 */
export async function fetchTile(url, signal) {
  const cache = await openCache();
  if (cache) {
    const hit = await cache.match(url).catch(() => null);
    if (hit) return hit.status === 200 ? hit.blob() : null;
  }
  const response = await fetch(url, { signal, mode: 'cors', credentials: 'omit' });
  if (response.status === 404 || response.status === 204) {
    // (remembered as missing too: no asking again)
    if (cache) cache.put(url, new Response(null, { status: 204 })).catch(() => {});
    return null;
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  if (cache) {
    cache.put(url, response.clone()).catch(() => {});
    if (++puts % TRIM_EVERY === 0) trim(cache);
  }
  return response.blob();
}

/** Forgets every tile kept on this device. */
export async function clearTileCache() {
  cachePromise = null;
  if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME);
}
