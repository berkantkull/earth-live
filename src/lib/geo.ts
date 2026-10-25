/**
 * Coğrafi koordinat ↔ sahne koordinatı dönüşümleri.
 *
 * Sahne çerçevesi Dünya'ya sabittir (ECEF benzeri), birim = Dünya yarıçapı:
 *   +Y = Kuzey kutbu, +X = (0°, 0°), -Z = (0°, 90°D)
 * Bu eşleme three.js SphereGeometry'nin eşdikdörtgen UV düzeniyle birebir örtüşür.
 */

export const EARTH_RADIUS_KM = 6371.0088;
const DEG = Math.PI / 180;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export function latLonToVec3(lat: number, lon: number, radius = 1, out: Vec3Like = { x: 0, y: 0, z: 0 }): Vec3Like {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const c = Math.cos(phi);
  out.x = radius * c * Math.cos(lambda);
  out.y = radius * Math.sin(phi);
  out.z = -radius * c * Math.sin(lambda);
  return out;
}

export function vec3ToLatLon(v: Vec3Like): { lat: number; lon: number; radius: number } {
  const radius = Math.hypot(v.x, v.y, v.z);
  if (radius === 0) return { lat: 0, lon: 0, radius: 0 };
  const lat = Math.asin(Math.max(-1, Math.min(1, v.y / radius))) / DEG;
  const lon = Math.atan2(-v.z, v.x) / DEG;
  return { lat, lon, radius };
}

/** ECEF (km; z = kutup, x = Greenwich) → sahne birimleri */
export function ecfToScene(x: number, y: number, z: number, out: Vec3Like = { x: 0, y: 0, z: 0 }): Vec3Like {
  out.x = x / EARTH_RADIUS_KM;
  out.y = z / EARTH_RADIUS_KM;
  out.z = -y / EARTH_RADIUS_KM;
  return out;
}

export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Büyük daire mesafesi (haversine), km */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Başlangıç noktası, rota (derece) ve mesafeden varış noktası — uçak konum tahmini için */
export function destinationPoint(lat: number, lon: number, bearingDeg: number, distanceKmValue: number): { lat: number; lon: number } {
  const delta = distanceKmValue / EARTH_RADIUS_KM;
  const theta = bearingDeg * DEG;
  const phi1 = lat * DEG;
  const lambda1 = lon * DEG;
  const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
  const y = Math.sin(theta) * Math.sin(delta) * Math.cos(phi1);
  const x = Math.cos(delta) - Math.sin(phi1) * sinPhi2;
  const lambda2 = lambda1 + Math.atan2(y, x);
  return { lat: phi2 / DEG, lon: normalizeLon(lambda2 / DEG) };
}

/**
 * Kameradan bakıldığında p noktası birim küre (Dünya) tarafından örtülüyor mu?
 * Kamera→p ışınının küreye p'den önce girip girmediğine bakar.
 */
export function isOccludedByEarth(cam: Vec3Like, p: Vec3Like, radius = 1): boolean {
  const dx = p.x - cam.x;
  const dy = p.y - cam.y;
  const dz = p.z - cam.z;
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return false;
  const ux = dx / len, uy = dy / len, uz = dz / len;
  const b = cam.x * ux + cam.y * uy + cam.z * uz;
  const c = cam.x * cam.x + cam.y * cam.y + cam.z * cam.z - radius * radius;
  const disc = b * b - c;
  if (disc <= 0) return false;
  const t = -b - Math.sqrt(disc);
  return t > 0 && t < len - 1e-4;
}

export function formatLat(lat: number, digits = 3): string {
  return `${Math.abs(lat).toFixed(digits)}° ${lat >= 0 ? 'K' : 'G'}`;
}

export function formatLon(lon: number, digits = 3): string {
  return `${Math.abs(lon).toFixed(digits)}° ${lon >= 0 ? 'D' : 'B'}`;
}
