/** Görsel ölçekler: renkler ve boyutlar. Lejant ile katmanlar aynı tanımları kullanır. */

export interface Stop {
  at: number;
  color: string;
  label: string;
}

/** Deprem derinliği (km) — sığ depremler sıcak renk */
export const DEPTH_STOPS: Stop[] = [
  { at: 0, color: '#ff4d3d', label: '0–35 km' },
  { at: 35, color: '#ff9f1c', label: '35–70 km' },
  { at: 70, color: '#ffd23f', label: '70–150 km' },
  { at: 150, color: '#3bceac', label: '150–300 km' },
  { at: 300, color: '#4d8bff', label: '300+ km' },
];

/** Uçak irtifası (m) */
export const ALTITUDE_STOPS: Stop[] = [
  { at: 0, color: '#9aa6b2', label: 'Yerde' },
  { at: 1, color: '#7cf3c9', label: '< 3 km' },
  { at: 3000, color: '#5ad1ff', label: '3–8 km' },
  { at: 8000, color: '#ffe066', label: '8–11 km' },
  { at: 11000, color: '#ffffff', label: '> 11 km' },
];

export const ORBIT_COLORS = {
  LEO: '#6ee7ff',
  MEO: '#b18cff',
  GEO: '#ffcf5c',
  HEO: '#ff7ab6',
} as const;

/** Yangın ışınım gücü (FRP, MW) */
export const FRP_STOPS: Stop[] = [
  // şehir ışıklarının sarısından ayrışsın diye turuncu-kırmızı tonlar
  { at: 0, color: '#ff8c1a', label: '< 10 MW' },
  { at: 10, color: '#ff5e1a', label: '10–50 MW' },
  { at: 50, color: '#ff2d2d', label: '50–200 MW' },
  { at: 200, color: '#ff1f6e', label: '200+ MW' },
];

export const EVENT_COLORS: Record<string, string> = {
  volcanoes: '#ff4f2e',
  severeStorms: '#b28cff',
  seaLakeIce: '#bfe9ff',
  floods: '#3fa7ff',
  landslides: '#c99a6b',
  dustHaze: '#d9c27a',
  snow: '#ffffff',
  tempExtremes: '#ff8fab',
  drought: '#e0a458',
  default: '#9ad7a6',
};

export const eventColor = (category: string) => EVENT_COLORS[category] ?? EVENT_COLORS.default;

export const PLATE_COLORS = {
  boundary: '#f4c95d',
  subduction: '#ff7a59',
  selected: '#ffffff',
} as const;

export function stopColor(stops: Stop[], value: number): string {
  let color = stops[0].color;
  for (const s of stops) if (value >= s.at) color = s.color;
  return color;
}

/**
 * Magnitüd → küre yüzeyinde dolu dairenin yarıçapı (sahne birimi; 1 = 6371 km).
 * Enerji ölçeği (logaritmik) yerine okunabilirlik: M2 ≈ 15 km, M5 ≈ 50 km, M7 ≈ 95 km.
 */
export function magnitudeRadius(mag: number): number {
  const m = Math.max(0, mag);
  return 0.0012 + 0.00028 * m * m;
}
