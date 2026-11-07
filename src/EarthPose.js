import * as THREE from 'three';
import { WGS84_A, ecefToGeodetic, geodeticToEcef, surfaceNormal } from './geo.js';

// Where the Earth is in the world. The viewer stays put (the XR origin is
// never moved or scaled); the Earth moves, turns and scales round them, so
// everything near them stays near the world's origin, where 32-bit floats
// are precise.
//
// The pose: a point on the ground, `p` (ECEF, on the ellipsoid, at the
// ground's `height` there), shows at world point `anchor`; `q` turns the
// Earth's frame into the world's, with the ground's up at p along the world's
// +Y (the horizon level there); `scale` is world metres per real metre (1:
// real size; 0.001: 1:1,000, a city in a room). So
//
//   world = T(anchor) · S(scale) · R(q) · T(-(p + up · height)) · ecef
//
// Moving (the sticks, a mouse drag) turns the Earth about its centre so that
// another point comes to the anchor, its frame carried with it, then levelled
// again. Scaling and turning (both grips, the wheel) happen about a point in
// the world, which stays put. And the anchor follows the viewer: each frame
// it's moved to the ground beneath them (when that's within a sliver of a
// degree round the Earth, so the turn that levels it can't be seen), so the
// ground's up is always theirs, and it's the ground beneath them that's
// followed as finer heights load.

export const SCALE = Object.freeze({ min: 5e-8, max: 10 }); // the smallest (a globe about 60 cm across) and biggest the world gets
const REANCHOR_MAX = 0.002; // rad: the ground beneath the viewer becomes the anchor when it's this near round the Earth
const HEIGHT_EASE = 10; // per second: the ground beneath you eases back to its height as you travel over hills
// A head that goes nearer the ground than this (or under it) is pushed back
// out: past the camera's near plane (5 cm, its corners up to about 10 cm off
// in a headset's wide view), so the ground's never cut open to show the void.
const HEAD_CLEARANCE = 0.15; // world m
const AROUND = 0.25; // world m: the ground this far round the head counts too (a slope rising beside it)
const AROUND_POINTS = 6;

const _y = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Matrix4();
const _arr = [0, 0, 0];

/** The rotation turning the Earth's frame at (lat, lon) into the world's: east to +X, up to +Y, north to -Z. */
export function enuQuaternion(lat, lon) {
  const [ux, uy, uz] = surfaceNormal(lat, lon);
  const east = new THREE.Vector3(-Math.sin(lon), Math.cos(lon), 0);
  const up = new THREE.Vector3(ux, uy, uz);
  const north = new THREE.Vector3().crossVectors(up, east);
  // rows: east, up, south
  _m.set(east.x, east.y, east.z, 0, up.x, up.y, up.z, 0, -north.x, -north.y, -north.z, 0, 0, 0, 0, 1);
  return new THREE.Quaternion().setFromRotationMatrix(_m);
}

export class EarthPose {
  constructor() {
    this.p = new THREE.Vector3(); // ECEF, on the ellipsoid
    this.lat = 0;
    this.lon = 0;
    this.height = 0; // the ground's height at p, m
    this.q = new THREE.Quaternion();
    this.scale = 1e-3;
    this.anchor = new THREE.Vector3();
    this.matrix = new THREE.Matrix4();
    this.inverse = new THREE.Matrix4();
    this.clearance = 1; // the viewer's head above the ground beneath it, world m (see follow)
    this.groundY = 0; // the world height the ground beneath the viewer is kept at (see follow)
    this.anchored = false; // the anchor is beneath the viewer
    this.regrounded = true; // scaled or turned since: groundY taken afresh
    this.beneath = { lat: 0, lon: 0 }; // the point on the ground beneath the viewer's head (rad; see follow)
    this.head = new THREE.Vector3(0, 1.6, 0); // the viewer's head (world), as last followed
    this.setLocation(0, 0);
  }

  /** The ground at (lat, lon) under `anchor` (world), facing `heading` (rad, clockwise from north). */
  setLocation(lat, lon, heading = 0, anchor = this.anchor, height = 0) {
    this.lat = lat;
    this.lon = lon;
    this.p.fromArray(geodeticToEcef(lat, lon, 0, _arr));
    this.height = height;
    this.q.copy(enuQuaternion(lat, lon)).premultiply(_q.setFromAxisAngle(_y, heading));
    this.anchor.copy(anchor);
    this.regrounded = true;
    this.update();
  }

  /** The way the world's -Z faces, clockwise from north (rad). */
  get heading() {
    // north at p, in the world
    const n = _v.set(-Math.sin(this.lat) * Math.cos(this.lon), -Math.sin(this.lat) * Math.sin(this.lon), Math.cos(this.lat)).applyQuaternion(this.q);
    return Math.atan2(-n.x, -n.z);
  }

  update() {
    const [ux, uy, uz] = surfaceNormal(this.lat, this.lon);
    _v.set(ux, uy, uz).multiplyScalar(this.height).add(this.p);
    this.matrix.makeTranslation(-_v.x, -_v.y, -_v.z);
    this.matrix.premultiply(_m.makeRotationFromQuaternion(this.q));
    this.matrix.premultiply(_s.makeScale(this.scale, this.scale, this.scale));
    this.matrix.premultiply(_m.makeTranslation(this.anchor.x, this.anchor.y, this.anchor.z));
    this.inverse.copy(this.matrix).invert();
    return this;
  }

  /** ECEF point `ecef` into the world, into `out`. */
  toWorld(ecef, out = new THREE.Vector3()) {
    return out.copy(ecef).applyMatrix4(this.matrix);
  }

  /** World point `world` into ECEF, into `out`. */
  toEcef(world, out = new THREE.Vector3()) {
    return out.copy(world).applyMatrix4(this.inverse);
  }

  /** The Earth turned about its centre by `r` (a quaternion, ECEF): the point at the anchor moves with it, then the anchor's up is levelled. */
  rotateEarth(r) {
    // world = … R(q) T(-p) r⁻¹ · ecef  ==  … R(q r⁻¹) T(-r p) · ecef
    this.p.applyQuaternion(r);
    const geo = ecefToGeodetic(this.p.x, this.p.y, this.p.z);
    this.lat = geo.lat;
    this.lon = geo.lon;
    this.p.fromArray(geodeticToEcef(geo.lat, geo.lon, 0, _arr));
    this.q.multiply(_q.copy(r).invert());
    this.level();
  }

  /** The anchor's up turned onto the world's +Y (a hair's turn about the anchor, after moving). */
  level() {
    const [ux, uy, uz] = surfaceNormal(this.lat, this.lon);
    const up = _n.set(ux, uy, uz).applyQuaternion(this.q);
    this.q.premultiply(_q.setFromUnitVectors(up, _y));
    this.q.normalize();
    this.update();
  }

  /** The viewer travels `delta` (world m, along the ground): the Earth turns under the anchor the other way. */
  travel(delta) {
    const t = _v.copy(delta).divideScalar(this.scale).applyQuaternion(_q.copy(this.q).invert()); // (in the Earth's frame)
    const length = t.length();
    if (length < 1e-9) return;
    const axis = new THREE.Vector3().crossVectors(this.p, t).normalize();
    if (axis.lengthSq() < 0.5) return;
    this.rotateEarth(new THREE.Quaternion().setFromAxisAngle(axis, length / this.p.length()));
  }

  /** The world turned `angle` (rad, counter-clockwise seen from above) about the vertical line through world point `pivot`. */
  turnAbout(pivot, angle) {
    _q.setFromAxisAngle(_y, angle);
    this.q.premultiply(_q);
    this.anchor.sub(pivot).applyQuaternion(_q).add(pivot);
    this.regrounded = true;
    this.update();
  }

  /** The world turned `angle` (rad) about the line through world point `pivot` along `axis` (a unit vector, world). */
  turnAboutAxis(pivot, axis, angle) {
    _q.setFromAxisAngle(axis, angle);
    this.q.premultiply(_q);
    this.anchor.sub(pivot).applyQuaternion(_q).add(pivot);
    this.regrounded = true;
    this.update();
  }

  /** The viewer rises `dy` (world m; down if less than 0): the world moves the other way, the ground followed at its new height. */
  rise(dy) {
    this.anchor.y -= dy;
    this.groundY -= dy;
    this.update();
  }

  /** The world's centre, in the world, into `out`. */
  centre(out = new THREE.Vector3()) {
    return out.set(0, 0, 0).applyMatrix4(this.matrix);
  }

  /** The world scaled by `factor` about world point `pivot` (within SCALE); returns the factor applied. */
  scaleAbout(pivot, factor) {
    const scale = THREE.MathUtils.clamp(this.scale * factor, SCALE.min, SCALE.max);
    factor = scale / this.scale;
    this.scale = scale;
    this.anchor.sub(pivot).multiplyScalar(factor).add(pivot);
    this.regrounded = true;
    this.update();
    return factor;
  }

  /** A copy of the pose, for a gesture to work from (see gesture). */
  snapshot() {
    return { anchor: this.anchor.clone(), q: this.q.clone(), scale: this.scale, p: this.p.clone(), lat: this.lat, lon: this.lon, height: this.height };
  }

  /**
   * Both hands on the world: as it was at `start` (a snapshot, the hands'
   * midpoint `mid0` then), scaled by `factor` and turned by `angle` about the
   * midpoint, which has moved to `mid`. Returns the scale.
   */
  gesture(start, mid0, mid, factor, angle) {
    this.p.copy(start.p);
    this.lat = start.lat;
    this.lon = start.lon;
    this.height = start.height;
    this.scale = THREE.MathUtils.clamp(start.scale * factor, SCALE.min, SCALE.max);
    factor = this.scale / start.scale;
    _q.setFromAxisAngle(_y, angle);
    this.q.copy(start.q).premultiply(_q);
    this.anchor.copy(start.anchor).sub(mid0).multiplyScalar(factor).applyQuaternion(_q).add(mid);
    this.regrounded = true;
    this.update();
    return this.scale;
  }

  /**
   * Each frame: the anchor moved to the ground beneath `head` (world) when
   * that's near enough round the Earth (`heightAt(lat, lon)`: the ground's
   * height, null if not loaded), with no jump; then the world eased up or
   * down so that ground stays at `groundY`, the height it was at when last
   * scaled or turned. So travelling follows the ground's rise and fall, and
   * finer heights loading don't move you. A head nearer the ground than
   * HEAD_CLEARANCE (or under it) is pushed back out: nearer the ground as
   * drawn (`surfaceAt(lat, lon)`, else heightAt), there or within AROUND of
   * it. Sets `clearance` (the
   * head's height over the ground beneath it, world m) and `beneath`.
   *
   * `upright` (XR): first the world's turned about the head so the Earth's
   * centre is straight below it (the ground beneath it level), whatever the
   * scale; then the anchor can always be moved beneath the head.
   */
  follow(head, heightAt, dt, upright = false, surfaceAt = null) {
    const e = this.toEcef(head, new THREE.Vector3());
    const geo = ecefToGeodetic(e.x, e.y, e.z);
    const [hx, hy, hz] = surfaceNormal(geo.lat, geo.lon);
    this.beneath.lat = geo.lat;
    this.beneath.lon = geo.lon;
    this.head.copy(head);
    if (upright) {
      // (a turn about the head: the head's own place on the Earth doesn't change)
      const n = _n.set(hx, hy, hz).applyQuaternion(this.q);
      if (n.y < 1 - 1e-12) {
        _q.setFromUnitVectors(n, _y);
        this.q.premultiply(_q).normalize();
        this.anchor.sub(head).applyQuaternion(_q).add(head);
        this.update();
      }
    }
    const [ux, uy, uz] = surfaceNormal(this.lat, this.lon);
    const apart = Math.acos(THREE.MathUtils.clamp(ux * hx + uy * hy + uz * hz, -1, 1));
    const near = apart < REANCHOR_MAX;
    if (!near && !upright) {
      this.anchored = false;
      this.clearance = (geo.h - (heightAt(geo.lat, geo.lon) ?? 0)) * this.scale;
      return;
    }
    const ground = heightAt(geo.lat, geo.lon) ?? (near ? this.height : 0);
    const g = new THREE.Vector3().fromArray(geodeticToEcef(geo.lat, geo.lon, 0, _arr));
    this.toWorld(_v.set(hx, hy, hz).multiplyScalar(ground).add(g), this.anchor);
    this.p.copy(g);
    this.lat = geo.lat;
    this.lon = geo.lon;
    this.height = ground;
    this.level();
    if (this.regrounded || !this.anchored || !near) this.groundY = this.anchor.y;
    this.regrounded = false;
    this.anchored = true;
    const dy = this.groundY - this.anchor.y;
    if (Math.abs(dy) > 1e-6) this.anchor.y += dy * (1 - Math.exp(-HEIGHT_EASE * dt));
    // (the highest ground drawn at and round the head, above the ground the anchor stands on)
    const lift = Math.max(0, this.floorNear(geo, surfaceAt ?? heightAt) - ground) * this.scale;
    if (head.y - this.anchor.y - lift < HEAD_CLEARANCE) {
      this.anchor.y = head.y - HEAD_CLEARANCE - lift;
      this.groundY = Math.min(this.groundY, this.anchor.y);
    }
    this.clearance = head.y - this.anchor.y;
    this.update();
  }

  /** The highest ground (m, by `surfaceAt`) at `geo` and AROUND (world m) round it; -Infinity where none's loaded. */
  floorNear(geo, surfaceAt) {
    let top = surfaceAt(geo.lat, geo.lon) ?? -Infinity;
    const r = AROUND / this.scale / WGS84_A; // rad round the Earth
    const cosLat = Math.max(Math.cos(geo.lat), 1e-6);
    for (let i = 0; i < AROUND_POINTS; i++) {
      const a = (i / AROUND_POINTS) * 2 * Math.PI;
      const h = surfaceAt(geo.lat + r * Math.cos(a), geo.lon + (r * Math.sin(a)) / cosLat);
      if (h != null && h > top) top = h;
    }
    return top;
  }

  /** What's kept between visits:{ lat, lon (beneath the viewer), heading, scale } (degrees). */
  toJSON() {
    return { lat: THREE.MathUtils.radToDeg(this.beneath.lat), lon: THREE.MathUtils.radToDeg(this.beneath.lon), heading: THREE.MathUtils.radToDeg(this.heading), scale: this.scale };
  }
}
