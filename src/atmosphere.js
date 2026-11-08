import * as THREE from 'three';
import { WGS84_A, WGS84_B } from './geo.js';
import { sunUniform } from './sky.js';

// The air: a blue sky by day, red and gold at sunrise and sunset, black from
// above it; haze over far ground; the Sun's light reddened low in the sky.
//
// Single scattering in a spherical atmosphere, as in Nishita et al. (1993),
// O'Neil (GPU Gems 2, ch. 16) and Bruneton & Neyret (2008), with Bruneton's
// coefficients: Rayleigh scattering by the air (blue: it scatters short
// wavelengths most), Mie by its haze (white, mostly forward: the glow round
// the Sun) and ozone's absorption (it keeps the twilight zenith blue). Light
// along a view ray is the sum, over points on it, of the sunlight reaching
// each point (dimmed by the air between it and the Sun), scattered toward
// the eye (by how much air is there, and the angle), dimmed by the air
// between there and the eye. The Sun's dimming is looked up in a small table
// worked out once here (Bruneton's transmittance table, parametrized as in
// his 2017 model); the rest is a short ray-march in the shader. A little
// light scattered more than once is added, all round (twilight, and the side
// of the sky away from the Sun, would be too dark without it).
//
// Units: kilometres. The Earth's an ellipsoid; its frame (ECEF) is stretched
// along its axis by a/b, which makes it a sphere of radius a (a ray's still a
// ray), so the sums are a sphere's: altitudes come out within 0.34% of true.
//
// The camera's place and the view's directions come in through the world:
// three.js's cameraPosition (each eye's, in XR) and `ecefFromWorld` (the
// Earth's pose, inverted), so each eye's sky lines up with the globe it sees.

const KM = 1000;
export const RG = WGS84_A / KM; // the ground: a sphere in the stretched frame
export const RT = RG + 100; // the top of the atmosphere
const STRETCH_Z = WGS84_A / WGS84_B;
const BETA_R = [5.802e-3, 13.558e-3, 33.1e-3]; // Rayleigh scattering, per km (red, green, blue)
const H_R = 8; // km: the air's scale height
const BETA_MS = 3.996e-3; // Mie scattering, per km
const BETA_ME = 4.4e-3; // Mie extinction (scattering and absorption)
const H_M = 1.2; // km: haze's scale height
const MIE_G = 0.8; // how much Mie scattering goes forward
const BETA_O = [0.65e-3, 1.881e-3, 0.085e-3]; // ozone absorption, per km, at its peak...
const OZONE = [25, 15]; // ...25 km up, falling to nothing 15 km above and below
// light scattered more than once, roughly: all round (no phase), from sunlight that keeps coming past
// the Sun's setting (the lit sky above still lights the air, till the Sun's TWILIGHT below the horizon there)
const MULTIPLE = 0.05;
const TWILIGHT = 0.2; // (a cosine: about 11°)
const SKY_LIGHT_LIFT = 0.4; // (the light round a point: as the Sun's, this much higher)
export const EXPOSURE = 20; // the sky's radiance (the Sun's irradiance 1) to the screen: 1 - exp(-L · this)
const AIR_OVER_PHOTOS = 0.3; // the air's light over the photos, through thin air (they have their own haze)
const SUN_EDGE = 0.008; // the Earth's shadow's soft edge (cosines): the Sun's disc setting, and a little more

// the transmittance table: Bruneton's parametrization (rays to the atmosphere's top, from any height)
const LUT_W = 256; // across: the ray's angle
const LUT_H = 64; // down: the height

const H_TOP = Math.sqrt(RT * RT - RG * RG);
const density = (h) => [Math.exp(-h / H_R), Math.exp(-h / H_M), Math.max(0, 1 - Math.abs(h - OZONE[0]) / OZONE[1])];

/** The optical depth (red, green, blue) from radius `r` along cosine `mu` to the top. */
function opticalDepth(r, mu, steps = 120) {
  const s = r * Math.sqrt(Math.max(0, 1 - mu * mu));
  const d = Math.max(0, -r * mu + Math.sqrt(Math.max(0, (RT - s) * (RT + s))));
  const dt = d / steps;
  const out = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * dt;
    const h = Math.sqrt(r * r + t * t + 2 * r * mu * t) - RG;
    const [dr, dm, dz] = density(h);
    for (let c = 0; c < 3; c++) out[c] += (BETA_R[c] * dr + BETA_ME * dm + BETA_O[c] * dz) * dt;
  }
  return out;
}

/** The table: transmittance (RGB) to the top, for each (angle, height). */
function buildTable() {
  const data = new Float32Array(LUT_W * LUT_H * 4);
  for (let j = 0; j < LUT_H; j++) {
    const rho = H_TOP * (j / (LUT_H - 1));
    const r = Math.sqrt(rho * rho + RG * RG);
    const dMin = RT - r;
    const dMax = rho + H_TOP;
    for (let i = 0; i < LUT_W; i++) {
      const d = dMin + (i / (LUT_W - 1)) * (dMax - dMin);
      const mu = d === 0 ? 1 : THREE.MathUtils.clamp((H_TOP * H_TOP - rho * rho - d * d) / (2 * r * d), -1, 1);
      const tau = opticalDepth(r, mu);
      const k = (j * LUT_W + i) * 4;
      for (let c = 0; c < 3; c++) data[k + c] = Math.exp(-tau[c]);
      data[k + 3] = 1;
    }
  }
  return data;
}

const table = buildTable();

function tableTexture() {
  const half = new Uint16Array(table.length);
  for (let i = 0; i < table.length; i++) half[i] = THREE.DataUtils.toHalfFloat(table[i]);
  const texture = new THREE.DataTexture(half, LUT_W, LUT_H, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** The table's (u, v) for radius `r`, cosine `mu` (as the shader's lutUv). */
function lutUv(r, mu) {
  const rho = Math.sqrt(Math.max(0, (r - RG) * (r + RG)));
  const s = r * Math.sqrt(Math.max(0, 1 - mu * mu));
  const d = Math.max(0, -r * mu + Math.sqrt(Math.max(0, (RT - s) * (RT + s))));
  const dMin = RT - r;
  const dMax = rho + H_TOP;
  return [THREE.MathUtils.clamp((d - dMin) / Math.max(dMax - dMin, 1e-6), 0, 1), THREE.MathUtils.clamp(rho / H_TOP, 0, 1)];
}

/** The table at radius `r`, cosine `mu` (bilinear), times the Sun's being above the horizon there: into `out` (RGB array). */
export function sunTransmittance(r, mu, out = [0, 0, 0]) {
  const [u, v] = lutUv(r, mu);
  const x = u * (LUT_W - 1);
  const y = v * (LUT_H - 1);
  const i = Math.min(LUT_W - 2, Math.floor(x));
  const j = Math.min(LUT_H - 2, Math.floor(y));
  const fx = x - i;
  const fy = y - j;
  const muH = -Math.sqrt(Math.max(0, (r - RG) * (r + RG))) / r;
  const up = THREE.MathUtils.smoothstep(mu - muH, -SUN_EDGE, SUN_EDGE);
  for (let c = 0; c < 3; c++) {
    const at = (a, b) => table[((j + b) * LUT_W + i + a) * 4 + c];
    out[c] = ((at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy) * (r < RT ? up : 1);
  }
  return out;
}

// the Sun's light on the ground at noon with it overhead: what the photos were taken in (their daylight is 1)
const NOON = sunTransmittance(RG, 1);

/** The stretched frame (km) of ECEF point `ecef` (m), into `out`. */
export const stretched = (ecef, out = new THREE.Vector3()) => out.set(ecef.x / KM, ecef.y / KM, (ecef.z / KM) * STRETCH_Z);

/** Shared by every material that's lit by the Sun or seen through the air (one value each, set once a frame). */
export const atmosphereUniforms = {
  transmittanceTable: { value: tableTexture() },
  ecefFromWorld: { value: new THREE.Matrix4() }, // the Earth's pose, inverted (Globe.update keeps it)
  sunDirection: sunUniform, // ECEF, a unit vector
};

const f = (x) => (Number.isInteger(x) ? `${x}.0` : String(x));
const v3 = ([x, y, z]) => `vec3(${f(x)}, ${f(y)}, ${f(z)})`;

// Day and night on the ground: the photos have their own daylight in them,
// so the Sun lights them fully wherever it's well up (no shading of slopes:
// that would darken them twice), its light reddening as it gets low (the air
// it comes through: the table), and falling to NIGHT through a dusk band
// across the terminator (the Sun from DAYLIGHT[0] below the horizon to
// DAYLIGHT[1] above, as sines of its height).
export const NIGHT = 0.06;
export const DAYLIGHT = [-0.07, 0.1];
const TINT = 0.8; // how much of the Sun's reddening shows on the ground (the rest: the sky's light, which doesn't redden)

/**
 * GLSL: the atmosphere's uniforms and functions, for vertex or fragment shaders:
 *  - atmoCamera(): the camera (this eye), stretched km
 *  - atmoStretch(ecefMetres), atmoDirection(worldVector): into the stretched frame (a direction normalized)
 *  - atmosphere(o, d, tEnd, n, out L, out T): along a ray (o, d) to tEnd (km), n steps (up to 16): in-scattered light, transmittance
 *  - atmoTone(L): light to the screen; atmoOver(color, L, T): a surface seen through the air
 *  - sunlightAt(p, early): the Sun's light (NIGHT to 1, reddened when low) at stretched point p; `early`: light comes this much sooner
 *  - altitudeKm(p): of stretched point p
 */
export const ATMOSPHERE_GLSL = /* glsl */ `
uniform sampler2D transmittanceTable;
uniform mat4 ecefFromWorld;
uniform vec3 sunDirection;
const float RG = ${f(RG)};
const float RT = ${f(RT)};
const float H_TOP = ${f(H_TOP)};
const vec3 STRETCH = vec3(1.0, 1.0, ${f(STRETCH_Z)});
const vec3 BETA_R = ${v3(BETA_R)};
const float BETA_MS = ${f(BETA_MS)};
const float BETA_ME = ${f(BETA_ME)};
const vec3 BETA_O = ${v3(BETA_O)};
const float ATMO_PI = 3.14159265;

vec3 atmoStretch(vec3 ecefMetres) { return ecefMetres * (STRETCH / ${f(KM)}); }
vec3 atmoDirection(vec3 world) { return normalize(mat3(ecefFromWorld) * world * STRETCH); }
vec3 atmoCamera() { return atmoStretch((ecefFromWorld * vec4(cameraPosition, 1.0)).xyz); }
vec3 atmoSun() { return normalize(sunDirection * STRETCH); }
float altitudeKm(vec3 p) { return length(p) - RG; }

vec2 lutUv(float r, float mu) {
  float rho = sqrt(max(0.0, (r - RG) * (r + RG)));
  float s = r * sqrt(max(0.0, 1.0 - mu * mu));
  float d = max(0.0, -r * mu + sqrt(max(0.0, (RT - s) * (RT + s))));
  float dMin = RT - r;
  float dMax = rho + H_TOP;
  vec2 x = clamp(vec2((d - dMin) / max(dMax - dMin, 1e-6), rho / H_TOP), 0.0, 1.0);
  return (x * vec2(${LUT_W - 1}.0, ${LUT_H - 1}.0) + 0.5) / vec2(${LUT_W}.0, ${LUT_H}.0);
}

/** The sunlight reaching radius r with the Sun at cosine mu from straight up: dimmed by the air, nothing below the horizon. */
vec3 sunTransmittance(float r, float mu) {
  float muH = -sqrt(max(0.0, (r - RG) * (r + RG))) / r;
  vec3 t = texture2D(transmittanceTable, lutUv(r, mu)).rgb;
  return t * (r < RT ? smoothstep(-${f(SUN_EDGE)}, ${f(SUN_EDGE)}, mu - muH) : 1.0);
}

vec3 atmoDensity(float h) {
  return vec3(exp(-h / ${f(H_R)}), exp(-h / ${f(H_M)}), max(0.0, 1.0 - abs(h - ${f(OZONE[0])}) / ${f(OZONE[1])}));
}

/** Where ray (o + t d) meets the sphere of radius R (r = |o|): (near, far), far < 0 when it misses. */
vec2 sphereHit(vec3 o, vec3 d, float r, float R) {
  float b = dot(o, d);
  float c = (r - R) * (r + R);
  float disc = b * b - c;
  if (disc < 0.0) return vec2(-1.0);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

void atmosphere(vec3 o, vec3 d, float tEnd, int n, out vec3 L, out vec3 T) {
  L = vec3(0.0);
  T = vec3(1.0);
  float r = length(o);
  vec2 top = sphereHit(o, d, r, RT);
  if (top.y <= 0.0) return;
  float t0 = max(top.x, 0.0);
  float t1 = min(top.y, tEnd);
  vec2 ground = sphereHit(o, d, r, RG);
  if (ground.x > 0.0) t1 = min(t1, ground.x);
  if (t1 <= t0) return;
  vec3 sun = atmoSun();
  // inside the air: steps closer together near the eye (the air's thickest there, looking up)
  float power = r < RT ? 2.0 : 1.0;
  vec3 depth = vec3(0.0);
  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  vec3 sumMultiple = vec3(0.0);
  float ta = t0;
  for (int i = 0; i < 16; i++) {
    if (i >= n) break;
    float tb = t0 + (t1 - t0) * pow(float(i + 1) / float(n), power);
    float ds = tb - ta;
    vec3 p = o + d * (0.5 * (ta + tb));
    ta = tb;
    float rp = length(p);
    vec3 dens = atmoDensity(rp - RG);
    vec3 ext = (BETA_R * dens.x + BETA_ME * dens.y + BETA_O * dens.z) * ds;
    vec3 seen = exp(-(depth + 0.5 * ext)) * ds;
    float muS = dot(p, sun) / rp;
    vec3 w = seen * sunTransmittance(rp, muS);
    depth += ext;
    sumR += w * dens.x;
    sumM += w * dens.y;
    float muH = -sqrt(max(0.0, (rp - RG) * (rp + RG))) / rp;
    // (the sky above lights it: its light comes the short way down, so it's barely reddened)
    vec3 around = texture2D(transmittanceTable, lutUv(rp, min(1.0, max(muS, muH) + ${f(SKY_LIGHT_LIFT)}))).rgb * smoothstep(-${f(TWILIGHT)}, 0.05, muS - muH);
    sumMultiple += seen * around * (BETA_R * dens.x + BETA_MS * dens.y);
  }
  T = exp(-depth);
  float nu = dot(d, sun);
  float phaseR = 3.0 / (16.0 * ATMO_PI) * (1.0 + nu * nu);
  const float g = ${f(MIE_G)};
  float phaseM = 3.0 / (8.0 * ATMO_PI) * (1.0 - g * g) * (1.0 + nu * nu) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * nu, 1.5));
  L = sumR * BETA_R * phaseR + sumM * BETA_MS * phaseM + sumMultiple * ${f(MULTIPLE)};
}

vec3 atmoTone(vec3 L) { return 1.0 - exp(-L * ${f(EXPOSURE)}); }

/** A surface of colour \`color\` (as lit) seen through air that lets T through and scatters L in: the colour as light (the tone curve undone), dimmed, the air's light added, toned again. Through thin air (looking down from above it, or not far) the air's light is cut to AIR_OVER_PHOTOS: the photos have their own haze. */
vec3 atmoOver(vec3 color, vec3 L, vec3 T) {
  vec3 radiance = -log(max(1.0 - color, vec3(1e-4))) / ${f(EXPOSURE)};
  float thin = smoothstep(0.25, 0.9, dot(T, vec3(0.3333)));
  return atmoTone(radiance * T + L * mix(1.0, ${f(AIR_OVER_PHOTOS)}, thin));
}

vec3 sunlightAt(vec3 p, float early) {
  float r = length(p);
  float mu = dot(p, atmoSun()) / r;
  float day = smoothstep(${f(DAYLIGHT[0])} - early, ${f(DAYLIGHT[1])}, mu);
  float muH = -sqrt(max(0.0, (r - RG) * (r + RG))) / r;
  vec3 tint = texture2D(transmittanceTable, lutUv(max(r, RG), max(mu, muH + 0.004))).rgb / ${v3(NOON)};
  return mix(vec3(${f(NIGHT)}), mix(vec3(1.0), min(tint, vec3(1.0)), ${f(TINT)}), day);
}
`;

const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * The Sun's colour as seen from ECEF point `ecef` (m), the Sun along `sun`
 * (ECEF unit vector): the air's reddening and dimming (1 above the air,
 * nothing below the horizon), into `out` (THREE.Color, linear).
 */
export function sunColorFrom(ecef, sun, out = new THREE.Color()) {
  stretched(ecef, _p);
  _s.set(sun.x, sun.y, sun.z * STRETCH_Z).normalize();
  const r = _p.length();
  const t = r >= RT ? [1, 1, 1] : sunTransmittance(r, _p.dot(_s) / r);
  return out.setRGB(t[0], t[1], t[2]);
}

/** The height (km, above the stretched sphere) of ECEF point `ecef` (m). */
export const altitudeKm = (ecef) => stretched(ecef, _p).length() - RG;
