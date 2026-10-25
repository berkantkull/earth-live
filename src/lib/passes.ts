/**
 * Bir uydunun belirli bir gözlem noktası üzerinden geçişlerinin tahmini.
 *
 * Çıplak gözle görünürlük için iki koşul gerekir:
 *  - gözlemci karanlıkta olmalı (Güneş ufkun en az 6° altında — sivil alacakaranlık sonrası)
 *  - uydu Güneş ışığı almalı (Dünya'nın gölgesinde olmamalı)
 */
import { EARTH_RADIUS_KM } from './geo.ts';
import { ecfToLookAngles, eciToEcf, gstime, propagate, type SatRec } from './sgp4.ts';
import { subsolarPoint } from './sun.ts';

const DEG = Math.PI / 180;

export interface Observer {
  lat: number;
  lon: number;
  /** metre */
  elevationM?: number;
  name: string;
}

export interface Pass {
  start: number;
  max: number;
  end: number;
  maxElevationDeg: number;
  startAzimuthDeg: number;
  endAzimuthDeg: number;
  /** geçişin herhangi bir anında çıplak gözle görülebilir mi */
  visible: boolean;
  /** görünür olduğu süre (ms) */
  visibleMs: number;
}

export interface PassOptions {
  /** ufkun bu kadar üstündeki kısımlar geçiş sayılır */
  minElevationDeg?: number;
  hours?: number;
  maxPasses?: number;
  /** tarama adımı (s) */
  stepSeconds?: number;
}

interface Sample {
  t: number;
  el: number;
  az: number;
  visible: boolean;
}

/** Gözlemci için Güneş'in ufuk üstü yüksekliği (derece) */
export function sunElevationDeg(lat: number, lon: number, t: number): number {
  const s = subsolarPoint(new Date(t));
  const cosZ =
    Math.sin(lat * DEG) * Math.sin(s.lat * DEG) + Math.cos(lat * DEG) * Math.cos(s.lat * DEG) * Math.cos((lon - s.lon) * DEG);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cosZ))) / DEG;
}

/**
 * Uydu Dünya'nın gölgesinde mi? Silindirik gölge modeli (ECEF, km):
 * Güneş'e ters taraftaysa ve Güneş eksenine uzaklığı Dünya yarıçapından küçükse gölgededir.
 */
export function inEarthShadow(x: number, y: number, z: number, t: number): boolean {
  const s = subsolarPoint(new Date(t));
  const sx = Math.cos(s.lat * DEG) * Math.cos(s.lon * DEG);
  const sy = Math.cos(s.lat * DEG) * Math.sin(s.lon * DEG);
  const sz = Math.sin(s.lat * DEG);
  const along = x * sx + y * sy + z * sz;
  if (along > 0) return false;
  const px = x - along * sx;
  const py = y - along * sy;
  const pz = z - along * sz;
  return Math.hypot(px, py, pz) < EARTH_RADIUS_KM;
}

function sample(rec: SatRec, obs: Observer, t: number): Sample | null {
  const date = new Date(t);
  const pv = propagate(rec, date);
  if (!pv || typeof pv.position !== 'object') return null;
  const ecf = eciToEcf(pv.position, gstime(date));
  const look = ecfToLookAngles(
    { latitude: obs.lat * DEG, longitude: obs.lon * DEG, height: (obs.elevationM ?? 0) / 1000 },
    ecf,
  );
  const el = look.elevation / DEG;
  const visible = el > 0 && sunElevationDeg(obs.lat, obs.lon, t) < -6 && !inEarthShadow(ecf.x, ecf.y, ecf.z, t);
  return { t, el, az: (look.azimuth / DEG + 360) % 360, visible };
}

/** Yükselmenin eşik değeri geçtiği anı ikiye bölerek (bisection) saniye hassasiyetinde bulur */
function crossing(rec: SatRec, obs: Observer, a: number, b: number, threshold: number, rising: boolean): number {
  for (let i = 0; i < 20 && b - a > 1000; i++) {
    const mid = (a + b) / 2;
    const s = sample(rec, obs, mid);
    const above = s !== null && s.el >= threshold;
    if (above === rising) b = mid;
    else a = mid;
  }
  return (a + b) / 2;
}

export function predictPasses(rec: SatRec, obs: Observer, from: number, opts: PassOptions = {}): Pass[] {
  const minEl = opts.minElevationDeg ?? 10;
  const hours = opts.hours ?? 72;
  const maxPasses = opts.maxPasses ?? 8;
  const step = (opts.stepSeconds ?? 30) * 1000;
  const until = from + hours * 3600_000;
  const passes: Pass[] = [];

  let prev = sample(rec, obs, from);
  let current: { start: number; samples: Sample[] } | null = null;
  if (prev && prev.el >= minEl) current = { start: from, samples: [prev] };

  for (let t = from + step; t <= until && passes.length < maxPasses; t += step) {
    const s = sample(rec, obs, t);
    if (!s) {
      prev = null;
      continue;
    }
    if (!current && s.el >= minEl && prev && prev.el < minEl) {
      current = { start: crossing(rec, obs, prev.t, t, minEl, true), samples: [] };
    }
    if (current) {
      if (s.el >= minEl) current.samples.push(s);
      else {
        const end = prev ? crossing(rec, obs, prev.t, t, minEl, false) : t;
        passes.push(finish(rec, obs, current.start, end, current.samples, step));
        current = null;
      }
    }
    prev = s;
  }
  return passes;
}

function finish(rec: SatRec, obs: Observer, start: number, end: number, samples: Sample[], step: number): Pass {
  // en yüksek noktayı örnekler arasında 1 sn hassasiyetle bul
  let best = samples.reduce((a, b) => (b.el > a.el ? b : a), samples[0] ?? { t: start, el: 0, az: 0, visible: false });
  for (let t = best.t - step; t <= best.t + step; t += 1000) {
    const s = sample(rec, obs, t);
    if (s && s.el > best.el) best = s;
  }
  const first = sample(rec, obs, start);
  const last = sample(rec, obs, end);
  const visibleSamples = samples.filter((s) => s.visible).length;
  return {
    start,
    max: best.t,
    end,
    maxElevationDeg: best.el,
    startAzimuthDeg: first?.az ?? 0,
    endAzimuthDeg: last?.az ?? 0,
    visible: visibleSamples > 0 || best.visible,
    visibleMs: visibleSamples * step,
  };
}
