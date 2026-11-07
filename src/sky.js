import * as THREE from 'three';

// Where the sky is now: the stars (fixed to J2000 right ascension and
// declination, carried to today by precession), the Sun and the Moon, all
// turned into the Earth's frame (ECEF) by the Earth's rotation (GMST).
//
// Frames: ECI is the equator and equinox's (x toward the vernal equinox, z
// the celestial pole); ECEF the Earth's (x toward 0° longitude, z the North
// Pole); galactic coordinates as the IAU's (x toward the galactic centre, z
// the north galactic pole). The skybox (public/img/skybox.jpg) is a
// galactic panorama: the galactic centre in the middle, longitude growing
// to the left (as the sky seen from inside, north up; the image as found
// had it mirrored, and was flipped), north at the top.
//
// Accuracy, low-precision formulas from the Astronomical Almanac: the Sun to
// about 0.01°, the Moon to about 0.3°; plenty to see by.

const DEG = Math.PI / 180;
const J2000 = 2451545.0; // Julian date of 2000 Jan 1, 12:00 TT (UT here: the 69 s between them don't show)

/** The Julian date of `date` (a Date or ms since 1970). */
export const julian = (date) => +date / 86400000 + 2440587.5;

const _a = new THREE.Quaternion();
const _b = new THREE.Quaternion();
const _p = new THREE.Quaternion();
const _p2 = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);

/** Greenwich mean sidereal time at `date` (rad): how far the Earth has turned from the equinox. */
export function gmst(date) {
  const d = julian(date) - J2000;
  const t = d / 36525;
  const deg = 280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38710000;
  return THREE.MathUtils.euclideanModulo(deg, 360) * DEG;
}

/** Precession (IAU 1976) from J2000's equator and equinox to `date`'s, as a turn (into `out`). */
export function precession(date, out = new THREE.Quaternion()) {
  const t = (julian(date) - J2000) / 36525;
  const arcsec = DEG / 3600;
  const zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t * t * t) * arcsec;
  const z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t * t * t) * arcsec;
  const theta = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t * t * t) * arcsec;
  // (frame turns R3(-z) R2(θ) R3(-ζ), as turns of the vectors)
  out.setFromAxisAngle(Z, z);
  out.multiply(_p.setFromAxisAngle(Y, -theta));
  return out.multiply(_p2.setFromAxisAngle(Z, zeta));
}

/** The turn from `date`'s equator and equinox (ECI of date) into the Earth's frame (ECEF), into `out`. */
export function ecefFromEci(date, out = new THREE.Quaternion()) {
  return out.setFromAxisAngle(Z, -gmst(date));
}

/** The turn from J2000's frame (the stars' catalogue positions) into the Earth's frame at `date`, into `out`. */
export function ecefFromJ2000(date, out = new THREE.Quaternion()) {
  return ecefFromEci(date, out).multiply(precession(date, _b));
}

// Galactic into J2000 equatorial: the IAU's matrix (equatorial to galactic), transposed.
export const J2000_FROM_GALACTIC = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().set(
    -0.0548755604, 0.4941094279, -0.867666149, 0,
    -0.8734370902, -0.44482963, -0.1980763734, 0,
    -0.4838350155, 0.7469822445, 0.4559837762, 0,
    0, 0, 0, 1,
  ),
);

// The skybox's frame (three.js's equirect lookup: u from atan2(z, x), v from y)
// into galactic: longitude l grows to the image's left, so a texture
// direction (x, y, z) is galactic (x, -z, y). Then a small correction: the
// panorama is turned 3.7° from true galactic axes (fitted to 38 of the
// brightest stars found in it, Sirius to Denebola: a median 0.16° off after).
const SKYBOX_AXES = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1));
const SKYBOX_CORRECTION = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().set(
    0.998107, -0.053785, 0.029827, 0,
    0.054338, 0.998359, -0.01805, 0,
    -0.028808, 0.019637, 0.999392, 0,
    0, 0, 0, 1,
  ),
);
export const GALACTIC_FROM_SKYBOX = SKYBOX_CORRECTION.clone().multiply(SKYBOX_AXES);

/** A unit vector at right ascension `ra`, declination `dec` (rad), into `out`. */
export const fromRaDec = (ra, dec, out = new THREE.Vector3()) => out.set(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));

/** The ecliptic longitude / latitude (rad) at obliquity `eps` as an equatorial unit vector, into `out`. */
function fromEcliptic(lon, lat, eps, out) {
  const x = Math.cos(lat) * Math.cos(lon);
  const y = Math.cos(lat) * Math.sin(lon);
  const z = Math.sin(lat);
  return out.set(x, y * Math.cos(eps) - z * Math.sin(eps), y * Math.sin(eps) + z * Math.cos(eps));
}

/** The direction of the Sun from the Earth at `date` (a unit vector, ECI of date), into `out`. */
export function sunEci(date, out = new THREE.Vector3()) {
  const n = julian(date) - J2000;
  const L = 280.46 + 0.9856474 * n;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  return fromEcliptic(lambda, 0, eps, out);
}

/** The Moon's place from the Earth's centre at `date` (metres, ECI of date), into `out`. */
export function moonEci(date, out = new THREE.Vector3()) {
  const n = julian(date) - J2000;
  const t = n / 36525;
  const s = (a, b) => Math.sin((a + b * t) * DEG);
  const c = (a, b) => Math.cos((a + b * t) * DEG);
  const lambda = 218.32 + 481267.881 * t + 6.29 * s(135.0, 477198.87) - 1.27 * s(259.3, -413335.36) + 0.66 * s(235.7, 890534.22) + 0.21 * s(269.9, 954397.74) - 0.19 * s(357.5, 35999.05) - 0.11 * s(186.5, 966404.03);
  const beta = 5.13 * s(93.3, 483202.02) + 0.28 * s(228.2, 960400.89) - 0.28 * s(318.3, 6003.15) - 0.17 * s(217.6, -407332.21);
  const parallax = 0.9508 + 0.0518 * c(135.0, 477198.87) + 0.0095 * c(259.3, -413335.36) + 0.0078 * c(235.7, 890534.22) + 0.0028 * c(269.9, 954397.74);
  const distance = 6378140 / Math.sin(parallax * DEG);
  const eps = (23.439 - 0.0000004 * n) * DEG;
  return fromEcliptic(lambda * DEG, beta * DEG, eps, out).multiplyScalar(distance);
}

export const MOON_RADIUS = 1737400; // m
export const SUN_ANGULAR_RADIUS = 0.2666 * DEG; // as seen from the Earth (it varies by 1.7% over the year)

/** The sky now, in the Earth's frame (ECEF): { stars (turn: J2000 → ECEF), sun (unit vector), moon (m) }, into `out`. */
export function skyAt(date, out = { stars: new THREE.Quaternion(), sun: new THREE.Vector3(), moon: new THREE.Vector3() }) {
  ecefFromJ2000(date, out.stars);
  const turn = ecefFromEci(date, _a);
  sunEci(date, out.sun).applyQuaternion(turn);
  moonEci(date, out.moon).applyQuaternion(turn);
  return out;
}

// The sky as it is now, shared: kept up to date by updateSky (from SkyLayer.jsx,
// each frame; worked out afresh once a second: the sky turns 0.004° a second).
export const sky = skyAt(Date.now());
/** The direction of the Sun (a unit vector, ECEF): one uniform shared by every tile's and cloud layer's material. */
export const sunUniform = { value: sky.sun.clone() };
const REFRESH_MS = 1000;
let refreshed = 0;

/** Brings `sky` (and sunUniform) to now, at most once a second. Returns `sky`. */
export function updateSky(now = Date.now()) {
  if (Math.abs(now - refreshed) < REFRESH_MS) return sky;
  refreshed = now;
  skyAt(now, sky);
  sunUniform.value.copy(sky.sun);
  return sky;
}
