/**
 * Güneş-altı noktası (Güneş'in tam tepede olduğu konum).
 * Astronomical Almanac düşük hassasiyetli formülleri — 1950-2050 arası ~0.01° doğruluk;
 * gece/gündüz sınırını çizmek için fazlasıyla yeterli.
 */

const DEG = Math.PI / 180;

export function julianDate(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

export function subsolarPoint(date: Date): { lat: number; lon: number } {
  const n = julianDate(date) - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const epsilon = (23.439 - 0.0000004 * n) * DEG;

  const declination = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  const rightAscension = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (280.46061837 + 360.98564736629 * n) % 360;

  let lon = rightAscension / DEG - gmst;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lat: declination / DEG, lon };
}
