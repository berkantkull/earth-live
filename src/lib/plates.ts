/** Tektonik plaka sınırları: veri biçimi ve küre üzerindeki geometri hesapları. */
import { distanceKm } from './geo.ts';

export interface PlateBoundary {
  /** plaka kodları (PB2002) */
  a: string;
  b: string;
  /** 1: dalma-batma (subduction) zonu */
  sub: 0 | 1;
  /** sınırı tanımlayan çalışma */
  src: string;
  /** [enlem, boylam, enlem, boylam, ...] */
  c: number[];
}

export interface PlateData {
  /** Türkçe plaka adları */
  names: Record<string, string>;
  /** özgün (İngilizce) plaka adları */
  namesEn?: Record<string, string>;
  lines: PlateBoundary[];
}

const DEG = Math.PI / 180;

/**
 * Uzun parçalara büyük daire üzerinde ara noktalar ekler; böylece çizgi kirişle kürenin
 * içinden geçmez. Boylamı ±180°'yi aşan parçalarda çizgi koparılır (dönüşte ayrı parça başlar).
 * Çıktı: her biri [enlem, boylam, ...] olan sürekli parçalar.
 */
export function densify(c: number[], maxStepDeg = 1): number[][] {
  const parts: number[][] = [];
  let cur: number[] = [c[0], c[1]];
  for (let i = 2; i < c.length; i += 2) {
    const [lat1, lon1, lat2, lon2] = [c[i - 2], c[i - 1], c[i], c[i + 1]];
    if (Math.abs(lon2 - lon1) > 180) {
      if (cur.length >= 4) parts.push(cur);
      cur = [lat2, lon2];
      continue;
    }
    const steps = Math.ceil(Math.max(Math.abs(lat2 - lat1), Math.abs(lon2 - lon1)) / maxStepDeg);
    for (let s = 1; s <= steps; s++) {
      const p = slerpLatLon(lat1, lon1, lat2, lon2, s / steps);
      cur.push(p[0], p[1]);
    }
  }
  if (cur.length >= 4) parts.push(cur);
  return parts;
}

function slerpLatLon(lat1: number, lon1: number, lat2: number, lon2: number, t: number): [number, number] {
  if (t === 1) return [lat2, lon2];
  const a = [Math.cos(lat1 * DEG) * Math.cos(lon1 * DEG), Math.cos(lat1 * DEG) * Math.sin(lon1 * DEG), Math.sin(lat1 * DEG)];
  const b = [Math.cos(lat2 * DEG) * Math.cos(lon2 * DEG), Math.cos(lat2 * DEG) * Math.sin(lon2 * DEG), Math.sin(lat2 * DEG)];
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-9) return [lat1, lon1];
  const k1 = Math.sin((1 - t) * omega) / Math.sin(omega);
  const k2 = Math.sin(t * omega) / Math.sin(omega);
  const x = k1 * a[0] + k2 * b[0];
  const y = k1 * a[1] + k2 * b[1];
  const z = k1 * a[2] + k2 * b[2];
  return [Math.atan2(z, Math.hypot(x, y)) / DEG, Math.atan2(y, x) / DEG];
}

/** Sınırın toplam uzunluğu (km), antimeridyen sıçramaları hariç */
export function boundaryLengthKm(c: number[]): number {
  let km = 0;
  for (let i = 2; i < c.length; i += 2) {
    if (Math.abs(c[i + 1] - c[i - 1]) > 180) continue;
    km += distanceKm(c[i - 2], c[i - 1], c[i], c[i + 1]);
  }
  return km;
}

/**
 * Bir noktanın sınıra en yakın uzaklığı (km). Köşe noktaları ~1° aralıklarla
 * sıklaştırıldığı için hata birkaç on km'yi geçmez — "sınıra yakın mı" sorusu için yeterli.
 */
export function distanceToBoundaryKm(lat: number, lon: number, parts: number[][]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const p of parts) {
    for (let i = 0; i < p.length; i += 2) {
      // kaba eleme: enlem farkı zaten en iyiden büyükse haversine'e gerek yok
      if (Math.abs(p[i] - lat) * 111.2 > best) continue;
      const d = distanceKm(lat, lon, p[i], p[i + 1]);
      if (d < best) best = d;
    }
  }
  return best;
}
