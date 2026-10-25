import { describe, expect, it } from 'vitest';
import {
  destinationPoint,
  distanceKm,
  ecfToScene,
  EARTH_RADIUS_KM,
  isOccludedByEarth,
  latLonToVec3,
  normalizeLon,
  vec3ToLatLon,
} from '../src/lib/geo.ts';

describe('latLonToVec3 / vec3ToLatLon', () => {
  it('eksenleri three.js küre UV düzeniyle eşler', () => {
    const p0 = latLonToVec3(0, 0);
    expect(p0.x).toBeCloseTo(1);
    expect(p0.y).toBeCloseTo(0);
    expect(p0.z).toBeCloseTo(0);

    const east = latLonToVec3(0, 90);
    expect(east.z).toBeCloseTo(-1);

    const north = latLonToVec3(90, 0);
    expect(north.y).toBeCloseTo(1);
  });

  it('gidiş-dönüş dönüşümü koordinatı korur', () => {
    for (const [lat, lon] of [[41.0082, 28.9784], [-33.86, 151.21], [64.1, -21.9], [0, 179.9], [-89, -45]]) {
      const back = vec3ToLatLon(latLonToVec3(lat, lon, 1.3));
      expect(back.lat).toBeCloseTo(lat, 6);
      expect(back.lon).toBeCloseTo(lon, 6);
      expect(back.radius).toBeCloseTo(1.3, 9);
    }
  });

  it('ECEF km değerlerini sahne çerçevesine çevirir', () => {
    // ECEF +Y = 90°D → sahnede -Z
    const p = ecfToScene(0, EARTH_RADIUS_KM, 0);
    expect(p.z).toBeCloseTo(-1);
    const ll = vec3ToLatLon(p);
    expect(ll.lon).toBeCloseTo(90);
  });
});

describe('mesafe ve rota', () => {
  it('İstanbul–Ankara büyük daire mesafesi ≈ 350 km', () => {
    expect(distanceKm(41.0082, 28.9784, 39.9334, 32.8597)).toBeGreaterThan(340);
    expect(distanceKm(41.0082, 28.9784, 39.9334, 32.8597)).toBeLessThan(360);
  });

  it('destinationPoint, distanceKm ile tutarlıdır', () => {
    const d = destinationPoint(47.45, 8.55, 87, 500);
    expect(distanceKm(47.45, 8.55, d.lat, d.lon)).toBeCloseTo(500, 3);
  });

  it('antimeridyeni geçen rotalarda boylamı normalize eder', () => {
    const d = destinationPoint(0, 179.5, 90, 200);
    expect(d.lon).toBeLessThan(-178);
    expect(normalizeLon(190)).toBe(-170);
    expect(normalizeLon(-190)).toBe(170);
  });
});

describe('isOccludedByEarth', () => {
  const cam = { x: 3, y: 0, z: 0 };
  it('kameraya bakan yüzeydeki nokta görünür', () => {
    expect(isOccludedByEarth(cam, { x: 1.01, y: 0, z: 0 })).toBe(false);
  });
  it('Dünya’nın arkasındaki nokta gizlenir', () => {
    expect(isOccludedByEarth(cam, { x: -1.01, y: 0, z: 0 })).toBe(true);
  });
  it('yörüngedeki ama yanda kalan uydu görünür', () => {
    expect(isOccludedByEarth(cam, { x: 0, y: 1.5, z: 0 })).toBe(false);
  });
});
