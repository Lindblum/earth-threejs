// Settings and the last view, kept in cookies: one cookie a key, its value
// JSON, for a year (renewed whenever it's saved). Scoped to the app's own
// path, so apps sharing a site (lindblum.github.io/…) don't see each
// other's. Values once kept in localStorage are read from there the first
// time, and moved into a cookie.

const MAX_AGE_S = 365 * 24 * 3600;
// (the page's folder: "/earth-threejs/" when published, "/" in development)
const PATH = location.pathname.replace(/[^/]*$/, '') || '/';

function cookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split('; ')) if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
  return null;
}

/** Setting `key`'s saved value, or `fallback` if there's none (or it can't be read). */
export function readSetting(key, fallback = null) {
  try {
    let text = cookie(key);
    if (text == null) {
      // (kept before cookies: moved over)
      text = localStorage.getItem(key);
      if (text != null) {
        writeSetting(key, JSON.parse(text));
        localStorage.removeItem(key);
      }
    }
    return text == null ? fallback : (JSON.parse(text) ?? fallback);
  } catch {
    return fallback;
  }
}

/** Saves setting `key` as `value` (JSON). */
export function writeSetting(key, value) {
  try {
    document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(JSON.stringify(value))}; max-age=${MAX_AGE_S}; path=${PATH}; SameSite=Lax`;
  } catch {
    // (not kept)
  }
}

/** Forgets setting `key`. */
export function removeSetting(key) {
  try {
    document.cookie = `${encodeURIComponent(key)}=; max-age=0; path=${PATH}; SameSite=Lax`;
    localStorage.removeItem(key);
  } catch {
    // (nothing to forget)
  }
}
