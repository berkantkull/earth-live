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
