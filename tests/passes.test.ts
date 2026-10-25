import { describe, expect, it } from 'vitest';
import { makeSatrec } from '../src/lib/orbits.ts';
import { inEarthShadow, predictPasses, sunElevationDeg } from '../src/lib/passes.ts';
import { GOES16, ISS } from './fixtures.ts';

const istanbul = { lat: 41.0082, lon: 28.9784, name: 'İstanbul' };
const from = Date.parse('2026-10-24T06:00:00Z');

describe('sunElevationDeg', () => {
  it('İstanbul’da öğlen Güneş ufkun üstünde, gece yarısı altında', () => {
    expect(sunElevationDeg(istanbul.lat, istanbul.lon, Date.parse('2026-10-24T10:00:00Z'))).toBeGreaterThan(25);
    expect(sunElevationDeg(istanbul.lat, istanbul.lon, Date.parse('2026-10-24T21:00:00Z'))).toBeLessThan(-30);
  });
});

describe('inEarthShadow', () => {
  it('Güneş tarafındaki uydu aydınlık, tam arkadaki gölgede', () => {
    const t = Date.parse('2026-03-20T12:00:00Z'); // ekinoks, Güneş ≈ (0°, 0°)
    expect(inEarthShadow(7000, 0, 0, t)).toBe(false);
    expect(inEarthShadow(-7000, 0, 0, t)).toBe(true);
    // gölge silindirinin dışında kalan yüksek yörünge
    expect(inEarthShadow(-7000, 0, 7000, t)).toBe(false);
  });
});

describe('predictPasses', () => {
  const rec = makeSatrec(ISS)!;
  const passes = predictPasses(rec, istanbul, from, { hours: 48 });

  it('ISS için 48 saatte birden fazla geçiş bulur', () => {
    expect(passes.length).toBeGreaterThan(2);
  });

  it('her geçiş tutarlıdır: başlangıç < tepe < bitiş, süre ve yükselme makul', () => {
    for (const p of passes) {
      expect(p.start).toBeLessThan(p.max);
      expect(p.max).toBeLessThan(p.end);
      // 10° üstünde ISS geçişi en fazla ~8 dakika sürer
      expect(p.end - p.start).toBeLessThan(9 * 60_000);
      expect(p.maxElevationDeg).toBeGreaterThanOrEqual(10);
      expect(p.maxElevationDeg).toBeLessThanOrEqual(90);
      expect(p.visibleMs).toBeLessThanOrEqual(p.end - p.start + 60_000);
    }
  });

  it('geçişler zaman sırasındadır ve çakışmaz', () => {
    for (let i = 1; i < passes.length; i++) expect(passes[i].start).toBeGreaterThan(passes[i - 1].end);
  });

  it('görünür geçişler yalnızca gözlemci karanlıktayken olur', () => {
    for (const p of passes.filter((x) => x.visible)) {
      expect(sunElevationDeg(istanbul.lat, istanbul.lon, p.max)).toBeLessThan(0);
    }
  });

  it('yer eşzamanlı uydu "geçiş" yapmaz', () => {
    const goes = makeSatrec(GOES16)!;
    // GOES-16 (75°B) İstanbul ufkunun altında kalır
    expect(predictPasses(goes, istanbul, from, { hours: 24 })).toEqual([]);
  });
});
