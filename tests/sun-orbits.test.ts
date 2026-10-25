import { describe, expect, it } from 'vitest';
import { classifyOrbit, makeSatrec, orbitalElements, orbitPath, propagateAll, satelliteState } from '../src/lib/orbits.ts';
import { subsolarPoint } from '../src/lib/sun.ts';
import { GOES16, ISS } from './fixtures.ts';

describe('subsolarPoint', () => {
  it('Haziran gündönümünde Yengeç dönencesindedir', () => {
    const s = subsolarPoint(new Date('2026-06-21T12:00:00Z'));
    expect(s.lat).toBeCloseTo(23.44, 1);
  });

  it('Aralık gündönümünde Oğlak dönencesindedir', () => {
    expect(subsolarPoint(new Date('2026-12-21T12:00:00Z')).lat).toBeCloseTo(-23.44, 1);
  });

  it('ekinoksta ekvatora yakındır', () => {
    expect(Math.abs(subsolarPoint(new Date('2026-03-20T15:00:00Z')).lat)).toBeLessThan(0.5);
  });

  it('12:00 UTC civarında Greenwich meridyenine yakındır (zaman denklemi ±4°)', () => {
    const s = subsolarPoint(new Date('2026-04-15T12:00:00Z'));
    expect(Math.abs(s.lon)).toBeLessThan(4.5);
  });

  it('saatte 15° batıya kayar', () => {
    const a = subsolarPoint(new Date('2026-05-01T06:00:00Z'));
    const b = subsolarPoint(new Date('2026-05-01T07:00:00Z'));
    expect(a.lon - b.lon).toBeCloseTo(15, 0);
  });
});

describe('yörünge hesapları', () => {
  const at = new Date('2026-10-24T06:00:00Z');

  it('ISS için gerçekçi yörünge elemanları üretir', () => {
    const rec = makeSatrec(ISS)!;
    const el = orbitalElements(rec);
    expect(el.periodMin).toBeGreaterThan(91);
    expect(el.periodMin).toBeLessThan(94);
    expect(el.inclinationDeg).toBeCloseTo(51.63, 1);
    expect(el.orbitClass).toBe('LEO');
    expect(el.perigeeKm).toBeGreaterThan(350);
    expect(el.apogeeKm).toBeLessThan(450);
  });

  it('ISS konumu 350–450 km irtifada ve ~7.66 km/s hızdadır', () => {
    const s = satelliteState(makeSatrec(ISS)!, at)!;
    expect(s.altKm).toBeGreaterThan(350);
    expect(s.altKm).toBeLessThan(450);
    expect(s.speedKms).toBeGreaterThan(7.5);
    expect(s.speedKms).toBeLessThan(7.8);
    expect(Math.abs(s.lat)).toBeLessThanOrEqual(51.7);
    // sahne yarıçapı = (R + h) / R
    expect(Math.hypot(s.x, s.y, s.z)).toBeCloseTo(1 + s.altKm / 6371, 2);
  });

  it('GOES-16 yer eşzamanlıdır ve ~35.786 km irtifadadır', () => {
    const rec = makeSatrec(GOES16)!;
    expect(orbitalElements(rec).orbitClass).toBe('GEO');
    const a = satelliteState(rec, at)!;
    const b = satelliteState(rec, new Date(at.getTime() + 6 * 3600_000))!;
    expect(a.altKm).toBeGreaterThan(35_600);
    expect(a.altKm).toBeLessThan(36_000);
    // Dünya'ya göre neredeyse sabit
    expect(Math.abs(a.lon - b.lon)).toBeLessThan(1);
    expect(Math.abs(a.lat)).toBeLessThan(1);
  });

  it('propagateAll geçersiz kayıtları NaN olarak işaretler', () => {
    const out = new Float32Array(9);
    const ok = propagateAll([makeSatrec(ISS), null, makeSatrec(GOES16)], at, out);
    expect(ok).toBe(2);
    expect(Number.isNaN(out[3])).toBe(true);
    expect(Math.hypot(out[0], out[1], out[2])).toBeCloseTo(1.065, 1);
    expect(Math.hypot(out[6], out[7], out[8])).toBeCloseTo(6.6, 1);
  });

  it('bozuk TLE null döner', () => {
    expect(makeSatrec({ name: 'X', norad: 1, line1: '1 garbage', line2: '2 garbage' })).toBeNull();
  });

  it('orbitPath tüm noktaları sonlu üretir', () => {
    const path = orbitPath(makeSatrec(ISS)!, at, 64);
    expect(path.length).toBe(64 * 3);
    expect([...path].every(Number.isFinite)).toBe(true);
  });

  it('classifyOrbit', () => {
    expect(classifyOrbit(95, 0.001)).toBe('LEO');
    expect(classifyOrbit(718, 0.01)).toBe('MEO');
    expect(classifyOrbit(1436, 0.0002)).toBe('GEO');
    expect(classifyOrbit(718, 0.7)).toBe('HEO');
  });
});
