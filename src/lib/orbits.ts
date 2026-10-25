import { eciToEcf, eciToGeodetic, gstime, propagate, twoline2satrec, type SatRec } from './sgp4.ts';
import type { SatelliteTle } from './types.ts';
import { EARTH_RADIUS_KM, ecfToScene } from './geo.ts';

const MU = 398600.4418; // km³/s²
const MINUTES_PER_DAY = 1440;

export type OrbitClass = 'LEO' | 'MEO' | 'GEO' | 'HEO';

export interface OrbitalElements {
  periodMin: number;
  inclinationDeg: number;
  eccentricity: number;
  semiMajorAxisKm: number;
  apogeeKm: number;
  perigeeKm: number;
  epoch: Date;
  orbitClass: OrbitClass;
}

export function makeSatrec(tle: SatelliteTle): SatRec | null {
  if (tle.line1.length < 69 || tle.line2.length < 69) return null;
  try {
    const rec = twoline2satrec(tle.line1, tle.line2);
    return rec.error || !(rec.no > 0) || !Number.isFinite(rec.ecco) ? null : rec;
  } catch {
    return null;
  }
}

export function orbitalElements(rec: SatRec): OrbitalElements {
  const meanMotionRadPerMin = rec.no; // rad/dk
  const periodMin = (2 * Math.PI) / meanMotionRadPerMin;
  const n = meanMotionRadPerMin / 60; // rad/s
  const a = Math.cbrt(MU / (n * n));
  const e = rec.ecco;
  const apogeeKm = a * (1 + e) - EARTH_RADIUS_KM;
  const perigeeKm = a * (1 - e) - EARTH_RADIUS_KM;
  return {
    periodMin,
    inclinationDeg: (rec.inclo * 180) / Math.PI,
    eccentricity: e,
    semiMajorAxisKm: a,
    apogeeKm,
    perigeeKm,
    epoch: new Date((rec.jdsatepoch - 2440587.5) * 86400000),
    orbitClass: classifyOrbit(periodMin, e),
  };
}

export function classifyOrbit(periodMin: number, eccentricity: number): OrbitClass {
  if (eccentricity > 0.25) return 'HEO';
  if (periodMin < 128) return 'LEO';
  if (Math.abs(periodMin - MINUTES_PER_DAY * 0.99727) < 60) return 'GEO';
  return 'MEO';
}

export const ORBIT_CLASS_INDEX: Record<OrbitClass, number> = { LEO: 0, MEO: 1, GEO: 2, HEO: 3 };

export interface SatState {
  /** sahne birimleri, Dünya'ya sabit çerçeve */
  x: number;
  y: number;
  z: number;
  lat: number;
  lon: number;
  altKm: number;
  /** km/s, eylemsiz çerçevede */
  speedKms: number;
}

export function satelliteState(rec: SatRec, date: Date): SatState | null {
  const pv = propagate(rec, date);
  if (!pv || typeof pv.position !== 'object') return null;
  const gmst = gstime(date);
  const ecf = eciToEcf(pv.position, gmst);
  const geo = eciToGeodetic(pv.position, gmst);
  const p = ecfToScene(ecf.x, ecf.y, ecf.z);
  const v = pv.velocity;
  return {
    x: p.x,
    y: p.y,
    z: p.z,
    lat: (geo.latitude * 180) / Math.PI,
    lon: (geo.longitude * 180) / Math.PI,
    altKm: geo.height,
    speedKms: Math.hypot(v.x, v.y, v.z),
  };
}

/**
 * Tüm uyduların sahne konumlarını out dizisine yazar (x,y,z üçlüleri).
 * Hesaplanamayanlar NaN olarak işaretlenir.
 */
export function propagateAll(recs: (SatRec | null)[], date: Date, out: Float32Array): number {
  const gmst = gstime(date);
  let ok = 0;
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    const pv = rec ? propagate(rec, date) : null;
    const o = i * 3;
    if (!pv || typeof pv.position !== 'object' || !Number.isFinite(pv.position.x)) {
      out[o] = out[o + 1] = out[o + 2] = Number.NaN;
      continue;
    }
    const ecf = eciToEcf(pv.position, gmst);
    out[o] = ecf.x / EARTH_RADIUS_KM;
    out[o + 1] = ecf.z / EARTH_RADIUS_KM;
    out[o + 2] = -ecf.y / EARTH_RADIUS_KM;
    ok++;
  }
  return ok;
}

/** Bir tam periyot boyunca (merkezde şimdiki zaman) Dünya'ya sabit çerçevede yörünge izi */
export function orbitPath(rec: SatRec, center: Date, samples = 256): Float32Array {
  const periodMs = ((2 * Math.PI) / rec.no) * 60000;
  const out = new Float32Array(samples * 3);
  let last = 0;
  for (let i = 0; i < samples; i++) {
    const t = new Date(center.getTime() + (i / (samples - 1) - 0.5) * periodMs);
    const s = satelliteState(rec, t);
    if (s) {
      out[i * 3] = s.x;
      out[i * 3 + 1] = s.y;
      out[i * 3 + 2] = s.z;
      last = i;
    } else if (i > 0) {
      out[i * 3] = out[last * 3];
      out[i * 3 + 1] = out[last * 3 + 1];
      out[i * 3 + 2] = out[last * 3 + 2];
    }
  }
  return out;
}
