/** Arama kutusunda uçak ve uydu eşleştirme (yer araması Open-Meteo'dan ayrıca gelir). */
import type { Aircraft, SatelliteTle } from './types.ts';

export interface ObjectMatch {
  layer: 'aircraft' | 'satellites';
  key: string;
  title: string;
  sub: string;
}

const norm = (s: string) => s.toLocaleUpperCase('en-US').replace(/\s+/g, '');

/**
 * Uçaklar: çağrı işareti (THY, THY1C) veya ICAO24 adresinin başı.
 * Tam eşleşme önce gelir, sonra kısa çağrı işaretleri.
 */
export function matchAircraft(list: readonly Aircraft[], query: string, limit = 4): ObjectMatch[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const hits: { a: Aircraft; score: number }[] = [];
  for (const a of list) {
    const cs = a.callsign ? norm(a.callsign) : '';
    const icao = a.icao24.toUpperCase();
    let score = -1;
    if (cs === q || icao === q) score = 0;
    else if (cs.startsWith(q)) score = 1 + cs.length / 100;
    else if (icao.startsWith(q)) score = 2;
    if (score >= 0) hits.push({ a, score });
  }
  return hits
    .sort((x, y) => x.score - y.score)
    .slice(0, limit)
    .map(({ a }) => ({
      layer: 'aircraft',
      key: a.icao24,
      title: a.callsign ?? a.icao24.toUpperCase(),
      sub: `${a.country} · ${a.onGround ? 'yerde' : a.altitudeM !== null ? `${Math.round(a.altitudeM * 3.28084).toLocaleString('tr-TR')} ft` : 'havada'}`,
    }));
}

/**
 * Uydular: ad içinde geçen metin (ISS, STARLINK, HUBBLE) veya tam NORAD numarası.
 * Adı sorguyla başlayanlar ve kısa adlar önce gelir.
 */
export function matchSatellites(list: readonly SatelliteTle[], query: string, limit = 4): ObjectMatch[] {
  const raw = query.trim();
  if (raw.length < 2) return [];
  const q = raw.toLocaleUpperCase('en-US');
  const asNumber = /^\d+$/.test(raw) ? Number(raw) : null;
  const hits: { s: SatelliteTle; score: number }[] = [];
  for (const s of list) {
    const name = s.name.toLocaleUpperCase('en-US');
    let score = -1;
    if (asNumber !== null && s.norad === asNumber) score = 0;
    else if (name === q) score = 0.5;
    else if (name.startsWith(q)) score = 1 + name.length / 100;
    else if (name.includes(q)) score = 2 + name.length / 100;
    // enkaz parçaları ve roket gövdeleri asıl uydunun önüne geçmesin
    if (score > 0 && /\b(DEB|R\/B)\b/.test(name)) score += 0.5;
    if (score >= 0) hits.push({ s, score });
  }
  return hits
    .sort((x, y) => x.score - y.score)
    .slice(0, limit)
    .map(({ s }) => ({ layer: 'satellites', key: String(s.norad), title: s.name, sub: `NORAD ${s.norad}` }));
}
