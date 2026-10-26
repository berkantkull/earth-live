/** Upstream veri biçimlerinin ayrıştırıcıları — hem Node sunucusu hem tarayıcı (statik mod) kullanır. */
import {
  EVENT_CATEGORIES,
  type Aircraft,
  type Earthquake,
  type EventCategory,
  type Fire,
  type GeocodeResult,
  type NaturalEvent,
  type SatelliteTle,
} from './types.ts';

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

// ---------------------------------------------------------------- NASA FIRMS aktif yangınlar (MODIS, son 24 saat)

export const FIRMS_URL = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv';

/**
 * FIRMS CSV: latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,confidence,version,bright_t31,frp,daynight
 * Sütunlar başlıktan okunur; sıralama değişse de çalışır.
 */
export function parseFirmsCsv(text: string): Fire[] {
  const lines = text.split(/\r?\n/);
  const head = lines[0]?.split(',') ?? [];
  const col = (name: string) => head.indexOf(name);
  const iLat = col('latitude');
  const iLon = col('longitude');
  const iBright = col('brightness');
  const iDate = col('acq_date');
  const iTime = col('acq_time');
  const iSat = col('satellite');
  const iConf = col('confidence');
  const iFrp = col('frp');
  const iDay = col('daynight');
  if ([iLat, iLon, iDate, iTime, iFrp].some((i) => i < 0)) return [];

  const out: Fire[] = [];
  for (let k = 1; k < lines.length; k++) {
    const c = lines[k].split(',');
    if (c.length < head.length) continue;
    const lat = Number(c[iLat]);
    const lon = Number(c[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const hhmm = c[iTime].padStart(4, '0');
    const time = Date.parse(`${c[iDate]}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
    out.push({
      lat,
      lon,
      frp: Number(c[iFrp]) || 0,
      brightness: Number(c[iBright]) || 0,
      confidence: Number(c[iConf]) || 0,
      time: Number.isFinite(time) ? time : 0,
      satellite: c[iSat] === 'T' ? 'Terra' : 'Aqua',
      day: c[iDay] === 'D',
    });
  }
  return out;
}

/** Statik mod veri dosyası için sıkı biçim: [enlem, boylam, FRP, parlaklık, güven, Δzaman(dk), uydu(0 Aqua/1 Terra), gündüz(0/1)] */
export interface PackedFires {
  v: 1;
  /** en yeni tespit, unix ms */
  t: number;
  rows: number[][];
}

export function packFires(fires: Fire[]): PackedFires {
  const t = fires.reduce((m, f) => Math.max(m, f.time), 0);
  return {
    v: 1,
    t,
    rows: fires.map((f) => [
      Math.round(f.lat * 1000) / 1000,
      Math.round(f.lon * 1000) / 1000,
      Math.round(f.frp * 10) / 10,
      Math.round(f.brightness),
      f.confidence,
      Math.round((t - f.time) / 60000),
      f.satellite === 'Terra' ? 1 : 0,
      f.day ? 1 : 0,
    ]),
  };
}

export function unpackFires(p: PackedFires): Fire[] {
  return p.rows.map((r) => ({
    lat: r[0],
    lon: r[1],
    frp: r[2],
    brightness: r[3],
    confidence: r[4],
    time: p.t - r[5] * 60000,
    satellite: r[6] === 1 ? 'Terra' : 'Aqua',
    day: r[7] === 1,
  }));
}

// ---------------------------------------------------------------- NASA EONET doğal olaylar

/** Yangınlar FIRMS katmanından geldiği için EONET'ten diğer kategoriler istenir */
export const EONET_URL =
  'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=volcanoes,severeStorms,seaLakeIce,floods,landslides,dustHaze,snow,tempExtremes,drought,manmade,waterColor';

interface EonetGeometry {
  date: string;
  type: string;
  coordinates: unknown;
  magnitudeValue?: number | null;
  magnitudeUnit?: string | null;
}

interface EonetEvent {
  id: string;
  title: string;
  link: string;
  categories: { id: string }[];
  sources?: { id: string; url: string }[];
  geometry: EonetGeometry[];
}

/** Nokta için koordinat, çokgen için ilk halkanın ağırlık merkezi */
function geometryPoint(g: EonetGeometry): [number, number] | null {
  if (g.type === 'Point') {
    const [lon, lat] = g.coordinates as [number, number];
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
  }
  if (g.type === 'Polygon') {
    const ring = (g.coordinates as [number, number][][])[0] ?? [];
    if (!ring.length) return null;
    const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    return [lat, lon];
  }
  return null;
}

export function parseEonet(json: { events?: EonetEvent[] }): NaturalEvent[] {
  const out: NaturalEvent[] = [];
  for (const e of json.events ?? []) {
    const cat = e.categories[0]?.id;
    if (!cat || !(cat in EVENT_CATEGORIES)) continue;
    const track: [number, number, number][] = [];
    for (const g of e.geometry ?? []) {
      const p = geometryPoint(g);
      const t = Date.parse(g.date);
      if (p && Number.isFinite(t)) track.push([p[0], p[1], t]);
    }
    if (!track.length) continue;
    track.sort((a, b) => a[2] - b[2]);
    const last = track[track.length - 1];
    const lastGeom = [...e.geometry].reverse().find((g) => g.magnitudeValue != null);
    out.push({
      id: e.id,
      title: e.title,
      category: cat as EventCategory,
      lat: last[0],
      lon: last[1],
      date: last[2],
      start: track[0][2],
      magnitude: lastGeom?.magnitudeValue ?? null,
      magnitudeUnit: lastGeom?.magnitudeUnit ?? null,
      track,
      sources: e.sources ?? [],
      link: e.link,
    });
  }
  return out.sort((a, b) => b.date - a.date);
}
