import { describe, expect, it } from 'vitest';
import { alertLevel, pickAlert } from '../src/lib/alerts.ts';
import type { Earthquake } from '../src/lib/types.ts';

const now = Date.parse('2026-10-26T12:00:00Z');
const quake = (id: string, magnitude: number, minutesAgo: number, tsunami = false): Earthquake => ({
  id, magnitude, tsunami, time: now - minutesAgo * 60_000, updated: now, lat: 0, lon: 0, depthKm: 10,
  magType: 'mww', place: id, felt: null, alert: null, significance: null, status: null, url: '',
});

describe('alertLevel', () => {
  it('tsunami > M7+ > M6+, altı uyarı değil', () => {
    expect(alertLevel(quake('a', 5.2, 1, true))).toBe('tsunami');
    expect(alertLevel(quake('b', 7.1, 1))).toBe('major');
    expect(alertLevel(quake('c', 6.0, 1))).toBe('strong');
    expect(alertLevel(quake('d', 5.9, 1))).toBeNull();
  });
});

describe('pickAlert', () => {
  it('en önemli olanı seçer: tsunami, büyük deprem önüne geçer', () => {
    const r = pickAlert([quake('m7', 7.3, 10), quake('ts', 6.6, 30, true), quake('m6', 6.1, 5)], now, new Set());
    expect(r?.quake.id).toBe('ts');
  });

  it('aynı seviyede büyük olanı, eşitse yeni olanı seçer', () => {
    expect(pickAlert([quake('a', 6.2, 10), quake('b', 6.5, 40)], now, new Set())?.quake.id).toBe('b');
    expect(pickAlert([quake('a', 6.2, 40), quake('b', 6.2, 10)], now, new Set())?.quake.id).toBe('b');
  });

  it('bir saatten eski ve daha önce gösterilmiş depremleri atlar', () => {
    expect(pickAlert([quake('old', 7.5, 61)], now, new Set())).toBeNull();
    expect(pickAlert([quake('x', 6.8, 5)], now, new Set(['x']))).toBeNull();
  });

  it('eşiğin altındaki depremlerde uyarı yok', () => {
    expect(pickAlert([quake('a', 5.8, 1), quake('b', 4.0, 2)], now, new Set())).toBeNull();
  });
});
