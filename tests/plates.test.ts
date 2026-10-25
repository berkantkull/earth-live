import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { distanceKm } from '../src/lib/geo.ts';
import { boundaryLengthKm, densify, distanceToBoundaryKm, type PlateData } from '../src/lib/plates.ts';

describe('densify', () => {
  it('uzun parçalara büyük daire üzerinde ara nokta ekler', () => {
    const [part] = densify([0, 0, 0, 10], 1);
    expect(part.length / 2).toBe(11);
    // tüm noktalar ekvatorda kalır
    for (let i = 0; i < part.length; i += 2) expect(part[i]).toBeCloseTo(0, 9);
  });

  it('antimeridyeni (±180°) aşan parçada çizgiyi koparır', () => {
    const parts = densify([10, 179, 10, -179, 11, -178], 1);
    expect(parts).toHaveLength(1); // ilk parça tek noktalı kaldığı için atlanır
    expect(parts[0][1]).toBe(-179);
  });

  it('ara noktalar uç noktalar arasındaki mesafeyi korur', () => {
    const [p] = densify([40, 20, 45, 40], 1);
    let total = 0;
    for (let i = 2; i < p.length; i += 2) total += distanceKm(p[i - 2], p[i - 1], p[i], p[i + 1]);
    expect(total).toBeCloseTo(distanceKm(40, 20, 45, 40), 0);
  });
});

describe('boundaryLengthKm', () => {
  it('ekvatorda 1° ≈ 111 km', () => {
    expect(boundaryLengthKm([0, 0, 0, 1])).toBeCloseTo(111.2, 0);
  });
  it('antimeridyen sıçramasını saymaz', () => {
    expect(boundaryLengthKm([0, 179, 0, -179])).toBe(0);
  });
});

describe('gerçek PB2002 verisi', () => {
  const data = JSON.parse(readFileSync('public/data/plates.json', 'utf8')) as PlateData;

  it('241 sınır ve Türkçe plaka adları içerir', () => {
    expect(data.lines).toHaveLength(241);
    expect(data.names.AT).toBe('Anadolu');
    expect(data.names.EU).toBe('Avrasya');
    expect(data.lines.some((l) => l.sub === 1)).toBe(true);
  });

  it('Kuzey Anadolu Fayı bölgesi Anadolu–Avrasya sınırına yakındır', () => {
    const naf = data.lines.filter((l) => [l.a, l.b].includes('AT') && [l.a, l.b].includes('EU'));
    expect(naf.length).toBeGreaterThan(0);
    const parts = naf.flatMap((l) => densify(l.c));
    // Düzce (1999 depremi bölgesi)
    expect(distanceToBoundaryKm(40.84, 31.16, parts)).toBeLessThan(60);
    // Ankara, fay hattından uzak
    expect(distanceToBoundaryKm(39.92, 32.85, parts)).toBeGreaterThan(100);
  });
});
