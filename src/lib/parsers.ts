/** Upstream veri biçimlerinin ayrıştırıcıları — hem Node sunucusu hem tarayıcı (statik mod) kullanır. */
import type { Aircraft, Earthquake, GeocodeResult, SatelliteTle } from './types.ts';

// ---------------------------------------------------------------- USGS

export const usgsFeedUrl = (feed: string) =>
  `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}.geojson`;

interface UsgsFeature {
  id: string;
  geometry: { coordinates: [number, number, number] } | null;
  properties: {
    mag: number | null;
    magType?: string | null;
    place: string | null;
    time: number;
    updated: number;
    tsunami?: number;
    felt?: number | null;
    alert?: string | null;
    sig?: number | null;
    status?: string | null;
    url: string;
    title?: string;
  };
}

export function parseUsgs(json: { features?: UsgsFeature[] }): Earthquake[] {
  const out: Earthquake[] = [];
  for (const f of json.features ?? []) {
    const c = f.geometry?.coordinates;
    if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    const p = f.properties;
    out.push({
      id: f.id,
      lon: c[0],
      lat: c[1],
      depthKm: Number.isFinite(c[2]) ? c[2] : 0,
      magnitude: p.mag ?? 0,
      magType: p.magType ?? null,
      place: p.place ?? p.title ?? 'Bilinmeyen konum',
      time: p.time,
      updated: p.updated,
      tsunami: p.tsunami === 1,
      felt: p.felt ?? null,
      alert: p.alert ?? null,
      significance: p.sig ?? null,
      status: p.status ?? null,
      url: p.url,
    });
  }
  return out.sort((a, b) => b.time - a.time);
}

// ---------------------------------------------------------------- OpenSky

export const OPENSKY_STATES_URL = 'https://opensky-network.org/api/states/all';

/** OpenSky state vector: https://openskynetwork.github.io/opensky-api/rest.html */
export type StateVector = [
  string, string | null, string, number | null, number, number | null, number | null,
  number | null, boolean, number | null, number | null, number | null, unknown,
  number | null, string | null, boolean, number, (number | null)?,
];

export interface OpenSkyResult {
  /** unix saniye */
  time: number;
  aircraft: Aircraft[];
}

export function parseOpenSky(json: { time: number; states: StateVector[] | null }): OpenSkyResult {
  const aircraft: Aircraft[] = [];
  for (const s of json.states ?? []) {
    const lon = s[5];
    const lat = s[6];
    if (lon === null || lat === null || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    aircraft.push({
      icao24: s[0],
      callsign: s[1]?.trim() || null,
      country: s[2],
      positionTime: s[3] ?? s[4],
      lastContact: s[4],
      lon,
      lat,
      baroAltitudeM: s[7],
      altitudeM: s[13] ?? s[7],
      onGround: s[8],
      velocity: s[9],
      heading: s[10],
      verticalRate: s[11],
      squawk: s[14],
      category: s[17] ?? null,
    });
  }
  return { time: json.time, aircraft };
}

// ---------------------------------------------------------------- TLE (CelesTrak / SatNOGS)

export const celestrakUrl = (group: string) =>
  `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`;

export const SATNOGS_TLE_URL = 'https://db.satnogs.org/api/tle/?format=json';

export function parseTle(text: string): SatelliteTle[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
  const out: SatelliteTle[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    const next = lines[i + 1];
    const next2 = lines[i + 2];
    if (!cur.startsWith('1 ') && next?.startsWith('1 ') && next2?.startsWith('2 ')) {
      out.push({ name: cur.trim(), norad: Number(next.slice(2, 7)), line1: next, line2: next2 });
      i += 2;
    } else if (cur.startsWith('1 ') && next?.startsWith('2 ')) {
      // isimsiz iki satırlı format
      const norad = Number(cur.slice(2, 7));
      out.push({ name: `NORAD ${norad}`, norad, line1: cur, line2: next });
      i += 1;
    }
  }
  return out;
}

interface SatnogsTle {
  tle0: string;
  tle1: string;
  tle2: string;
  norad_cat_id: number;
}

/** SatNOGS DB TLE listesi — CelesTrak erişilemediğinde yedek kaynak */
export function parseSatnogs(json: SatnogsTle[]): SatelliteTle[] {
  const seen = new Set<number>();
  const out: SatelliteTle[] = [];
  for (const t of json) {
    if (!t.tle1?.startsWith('1 ') || !t.tle2?.startsWith('2 ') || seen.has(t.norad_cat_id)) continue;
    seen.add(t.norad_cat_id);
    out.push({ name: t.tle0.replace(/^0 /, '').trim(), norad: t.norad_cat_id, line1: t.tle1.trim(), line2: t.tle2.trim() });
  }
  return out;
}

// ---------------------------------------------------------------- Open-Meteo Geocoding

export const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

export const geocodeUrl = (query: string, language = 'tr') =>
  `${GEOCODE_URL}?${new URLSearchParams({ name: query, count: '8', language, format: 'json' })}`;

interface OpenMeteoPlace {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  country_code?: string;
  admin1?: string;
  population?: number;
  elevation?: number;
  timezone?: string;
}

export function parseGeocode(json: { results?: OpenMeteoPlace[] }): GeocodeResult[] {
  return (json.results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    lat: r.latitude,
    lon: r.longitude,
    country: r.country ?? null,
    countryCode: r.country_code ?? null,
    admin1: r.admin1 ?? null,
    population: r.population ?? null,
    elevation: r.elevation ?? null,
    timezone: r.timezone ?? null,
  }));
}

// ---------------------------------------------------------------- sıkı uçak biçimi (statik mod veri dosyası)

/**
 * Pages sürümünün indirdiği aircraft.json için sıkı biçim: alan adları her kayıtta tekrar etmez,
 * ülke adları sözlükten gelir, sayılar ölçüm hassasiyetine göre yuvarlanır (enlem/boylam ≈ 11 m).
 */
export interface PackedAircraft {
  v: 2;
  /** ölçüm zamanı, unix saniye; konum zamanları buna göre fark olarak tutulur */
  t: number;
  countries: string[];
  /** [icao24, callsign, ülke#, lat, lon, alt, baroAlt, yerde(0/1), hız, rota, dikeyHız, squawk, Δkonum, Δtemas, kategori] */
  rows: (string | number | null)[][];
}

const round = (n: number | null, digits: number) => (n === null ? null : Number(n.toFixed(digits)));

export function packAircraft(list: Aircraft[], observedAtSec: number): PackedAircraft {
  const countries: string[] = [];
  const index = new Map<string, number>();
  const rows = list.map((a) => {
    let c = index.get(a.country);
    if (c === undefined) {
      c = countries.push(a.country) - 1;
      index.set(a.country, c);
    }
    return [
      a.icao24, a.callsign, c, round(a.lat, 4), round(a.lon, 4), round(a.altitudeM, 0), round(a.baroAltitudeM, 0),
      a.onGround ? 1 : 0, round(a.velocity, 1), round(a.heading, 1), round(a.verticalRate, 1), a.squawk,
      observedAtSec - a.positionTime, observedAtSec - a.lastContact, a.category,
    ];
  });
  return { v: 2, t: observedAtSec, countries, rows };
}

export function unpackAircraft(p: PackedAircraft): Aircraft[] {
  return p.rows.map((r) => ({
    icao24: r[0] as string,
    callsign: r[1] as string | null,
    country: p.countries[r[2] as number] ?? '',
    lat: r[3] as number,
    lon: r[4] as number,
    altitudeM: r[5] as number | null,
    baroAltitudeM: r[6] as number | null,
    onGround: r[7] === 1,
    velocity: r[8] as number | null,
    heading: r[9] as number | null,
    verticalRate: r[10] as number | null,
    squawk: r[11] as string | null,
    positionTime: p.t - (r[12] as number),
    lastContact: p.t - (r[13] as number),
    category: r[14] as number | null,
  }));
}
