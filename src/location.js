// Where the viewer is, roughly, to start there.
//
// approximateLocation: from the network address, asking no permission (free
// keyless services, the second if the first fails), a city or so close.
// preciseLocation: the device's own location (GPS, Wi-Fi), which the
// browser asks permission for: used by Location → My Location.
// Either resolves { lat, lon } in degrees (and a `place` name if known), or null.

const TIMEOUT_MS = 4000;
const LAST_KEY = 'earth.lastView';

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

const SERVICES = [
  {
    url: 'https://get.geojs.io/v1/ip/geo.json',
    read: (j) => ({ lat: Number(j.latitude), lon: Number(j.longitude), place: [j.city, j.region, j.country].filter(Boolean).join(', ') }),
  },
  {
    url: 'https://ipapi.co/json/',
    read: (j) => ({ lat: Number(j.latitude), lon: Number(j.longitude), place: [j.city, j.region, j.country_name].filter(Boolean).join(', ') }),
  },
];

export async function approximateLocation() {
  for (const service of SERVICES) {
    try {
      const where = service.read(await getJson(service.url));
      if (Number.isFinite(where.lat) && Number.isFinite(where.lon) && (where.lat || where.lon)) return { ...where, source: 'network' };
    } catch (e) {
      console.warn(`[earth] location from ${service.url} failed:`, e?.message ?? e);
    }
  }
  return null;
}

export function preciseLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, source: 'device' }),
      (e) => {
        console.warn('[earth] device location unavailable:', e?.message ?? e);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

/** The view last left (EarthPose.toJSON), kept for when no location can be found. */
export function lastView() {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY));
    return v && Number.isFinite(v.lat) && Number.isFinite(v.lon) ? v : null;
  } catch {
    return null;
  }
}

export function keepView(view) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(view));
  } catch {
    // (not kept)
  }
}
