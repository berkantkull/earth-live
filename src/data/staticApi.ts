/**
 * Statik barındırma (GitHub Pages) için veri katmanı — Node sunucusu yoktur.
 *
 * - USGS, Open-Meteo ve CelesTrak CORS'a izin verir → tarayıcıdan doğrudan çekilir.
 * - OpenSky tarayıcıdan erişime izin vermez → uçak verisi ve uydu TLE'leri, GitHub Actions'ın
 *   düzenli olarak güncellediği "data" dalından (raw.githubusercontent.com) okunur.
 */
import {
  celestrakUrl,
  geocodeUrl,
  GEOCODE_URL,
  parseGeocode,
  parseTle,
  parseUsgs,
  usgsFeedUrl,
} from '../lib/parsers.ts';
import {
  QUAKE_FEEDS,
  SATELLITE_GROUPS,
  type ApiEnvelope,
  type Aircraft,
  type Earthquake,
  type GeocodeResult,
  type SatelliteTle,
  type SourceMetaDto,
} from '../lib/types.ts';

export class StaticApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface DataStatus {
  time: number;
  openskyAuthenticated: boolean;
  sources: SourceMetaDto[];
}

const DATA_URL = (import.meta.env.VITE_DATA_URL ?? '').replace(/\/?$/, '/');

/** Tarayıcının doğrudan konuştuğu kaynakların durumu */
const local = new Map<string, SourceMetaDto>();
let remote: DataStatus | null = null;
let remoteAt = 0;

function track(meta: Omit<SourceMetaDto, 'lastAttemptAt' | 'nextRefreshAt'>, nextMs: number | null): SourceMetaDto {
  const now = Date.now();
  const prev = local.get(meta.id);
  const full: SourceMetaDto = {
    ...meta,
    // hata durumunda son başarılı zaman korunur
    fetchedAt: meta.fetchedAt ?? prev?.fetchedAt ?? null,
    count: meta.count ?? prev?.count ?? null,
    lastAttemptAt: now,
    nextRefreshAt: nextMs ? now + nextMs : null,
  };
  local.set(meta.id, full);
  return full;
}

async function request(url: string, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { signal, cache: 'no-cache' });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new StaticApiError(`${new URL(url).host} erişilemedi`, 0);
  }
  if (!res.ok) throw new StaticApiError(`${new URL(url).host}: HTTP ${res.status}`, res.status);
  return res;
}

async function direct<T>(
  id: string,
  name: string,
  url: string,
  ttlSeconds: number,
  load: () => Promise<T[]>,
): Promise<ApiEnvelope<T[]>> {
  try {
    const data = await load();
    const meta = track({ id, name, url, status: 'ok', fetchedAt: Date.now(), count: data.length, error: null, ttlSeconds }, ttlSeconds * 1000);
    return { data, meta };
  } catch (err) {
    track({ id, name, url, status: 'error', fetchedAt: null, count: null, error: (err as Error).message, ttlSeconds }, null);
    throw err;
  }
}

async function earthquakes(feed: string): Promise<ApiEnvelope<Earthquake[]>> {
  const url = usgsFeedUrl(feed);
  return direct(`earthquakes:${feed}`, `USGS Earthquake Hazards — ${QUAKE_FEEDS[feed as keyof typeof QUAKE_FEEDS]}`, url, 60, async () =>
    parseUsgs(await (await request(url)).json()),
  );
}

async function aircraft(): Promise<ApiEnvelope<Aircraft[]>> {
  if (!DATA_URL || DATA_URL === '/') throw new StaticApiError('Uçak veri adresi (VITE_DATA_URL) tanımlı değil', 0);
  const res = await request(`${DATA_URL}aircraft.json`);
  return (await res.json()) as ApiEnvelope<Aircraft[]>;
}

async function satellites(group: string): Promise<ApiEnvelope<SatelliteTle[]>> {
  // 1) Actions'ın hazırladığı anlık görüntü
  if (DATA_URL && DATA_URL !== '/') {
    try {
      const res = await request(`${DATA_URL}satellites-${encodeURIComponent(group)}.json`);
      return (await res.json()) as ApiEnvelope<SatelliteTle[]>;
    } catch {
      // doğrudan CelesTrak'a düş
    }
  }
  // 2) CelesTrak'tan doğrudan (CORS açık)
  const url = celestrakUrl(group);
  const env = await direct(`satellites:${group}`, `CelesTrak GP — ${SATELLITE_GROUPS[group as keyof typeof SATELLITE_GROUPS]}`, url, 7200, async () => {
    const tles = parseTle(await (await request(url)).text());
    if (tles.length === 0) throw new StaticApiError('CelesTrak: TLE bulunamadı', 502);
    return tles;
  });
  return { ...env, provider: 'celestrak' };
}

async function geocode(q: string, signal?: AbortSignal): Promise<ApiEnvelope<GeocodeResult[]>> {
  return direct('geocode', 'Open-Meteo Geocoding (GeoNames)', GEOCODE_URL, 86400, async () =>
    parseGeocode(await (await request(geocodeUrl(q, 'tr'), signal)).json()),
  );
}

async function status(): Promise<DataStatus> {
  if (DATA_URL && DATA_URL !== '/' && Date.now() - remoteAt > 60_000) {
    remoteAt = Date.now();
    try {
      remote = (await (await request(`${DATA_URL}status.json`)).json()) as DataStatus;
    } catch {
      // önceki durum korunur
    }
  }
  const sources = [...local.values()];
  for (const s of remote?.sources ?? []) if (!local.has(s.id)) sources.push(s);
  return { time: Date.now(), openskyAuthenticated: remote?.openskyAuthenticated ?? false, sources };
}

export const staticApi = { earthquakes, aircraft, satellites, geocode, status };
