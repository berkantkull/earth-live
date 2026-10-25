import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import {
  QUAKE_FEEDS,
  SATELLITE_GROUPS,
  type Aircraft,
  type ApiEnvelope,
  type Earthquake,
  type GeocodeResult,
  type SatelliteTle,
} from '../src/lib/types.ts';
import type { SatelliteFetchResult } from './sources/satellites.ts';
import { SourceCache, UpstreamError, type SourceMeta } from './cache.ts';
import { fetchAircraft, hasOpenSkyCredentials, OPENSKY_STATES_URL, type OpenSkyResult } from './sources/aircraft.ts';
import { fetchEarthquakes, usgsFeedUrl } from './sources/earthquakes.ts';
import { GEOCODE_URL, geocode } from './sources/geocode.ts';
import { celestrakUrl, fetchSatellites, SATELLITE_TTL_SECONDS } from './sources/satellites.ts';

export interface ApiDeps {
  fetchEarthquakes?: (feed: string) => Promise<Earthquake[]>;
  fetchAircraft?: () => Promise<OpenSkyResult>;
  fetchSatellites?: (group: string) => Promise<SatelliteFetchResult>;
  geocode?: (q: string, lang: string) => Promise<GeocodeResult[]>;
  aircraftTtlSeconds?: number;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

function send(req: IncomingMessage, res: ServerResponse, status: number, body: unknown, maxAge = 0) {
  const json = Buffer.from(JSON.stringify(body));
  const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) && json.length > 1024;
  const payload = gzip ? gzipSync(json) : json;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store',
    Vary: 'Accept-Encoding',
    ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
  });
  res.end(payload);
}

function sendError(req: IncomingMessage, res: ServerResponse, err: unknown) {
  const status = err instanceof UpstreamError ? (err.status === 429 || err.status === 503 ? 503 : 502) : 500;
  const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
  send(req, res, status, { error: message });
}

export function createApiHandler(deps: ApiDeps = {}): Handler {
  const getQuakes = deps.fetchEarthquakes ?? fetchEarthquakes;
  const getAircraft = deps.fetchAircraft ?? fetchAircraft;
  const getSatellites = deps.fetchSatellites ?? fetchSatellites;
  const doGeocode = deps.geocode ?? geocode;
  const aircraftTtl =
    deps.aircraftTtlSeconds ?? (Number(process.env.AIRCRAFT_TTL) || (hasOpenSkyCredentials() ? 60 : 300));

  const quakeCaches = new Map<string, SourceCache<Earthquake[]>>();
  const satCaches = new Map<string, SourceCache<SatelliteFetchResult>>();
  const geoCache = new Map<string, { at: number; data: GeocodeResult[] }>();

  const aircraftCache = new SourceCache<OpenSkyResult>({
    id: 'aircraft',
    name: 'OpenSky Network — ADS-B durum vektörleri',
    url: OPENSKY_STATES_URL,
    ttlSeconds: aircraftTtl,
    fetcher: getAircraft,
    count: (d) => d.aircraft.length,
  });

  const quakeCache = (feed: string) => {
    let c = quakeCaches.get(feed);
    if (!c) {
      c = new SourceCache({
        id: `earthquakes:${feed}`,
        name: `USGS Earthquake Hazards — ${QUAKE_FEEDS[feed as keyof typeof QUAKE_FEEDS]}`,
        url: usgsFeedUrl(feed),
        ttlSeconds: 60,
        fetcher: () => getQuakes(feed),
        count: (d) => d.length,
      });
      quakeCaches.set(feed, c);
    }
    return c;
  };

  const satCache = (group: string) => {
    let c = satCaches.get(group);
    if (!c) {
      c = new SourceCache({
        id: `satellites:${group}`,
        name: `CelesTrak GP — ${SATELLITE_GROUPS[group as keyof typeof SATELLITE_GROUPS]}`,
        url: celestrakUrl(group),
        ttlSeconds: SATELLITE_TTL_SECONDS,
        fetcher: () => getSatellites(group),
        count: (d) => d.tles.length,
        // yedek kaynaktan gelen veri: CelesTrak'ı 20 dk sonra tekrar dene
        ttlFor: (d) => (d.provider === 'satnogs' ? 20 * 60 : SATELLITE_TTL_SECONDS),
      });
      satCaches.set(group, c);
    }
    return c;
  };

  const geocodeMeta: SourceMeta = {
    id: 'geocode',
    name: 'Open-Meteo Geocoding (GeoNames)',
    url: GEOCODE_URL,
    status: 'idle',
    fetchedAt: null,
    lastAttemptAt: null,
    nextRefreshAt: null,
    count: null,
    error: null,
    ttlSeconds: 86400,
  };

  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(req, res, 405, { error: 'Yalnızca GET desteklenir' });
    }

    try {
      switch (url.pathname) {
        case '/api/health':
          return send(req, res, 200, { ok: true, time: Date.now() });

        case '/api/earthquakes': {
          const feed = url.searchParams.get('feed') ?? 'all_day';
          if (!(feed in QUAKE_FEEDS)) return send(req, res, 400, { error: `Geçersiz feed: ${feed}` });
          const { data, meta } = await quakeCache(feed).get();
          return send(req, res, 200, { data, meta } satisfies ApiEnvelope<Earthquake[]>);
        }

        case '/api/aircraft': {
          const { data, meta } = await aircraftCache.get();
          return send(req, res, 200, {
            data: data.aircraft,
            meta,
            observedAt: data.time * 1000,
          } satisfies ApiEnvelope<Aircraft[]>);
        }

        case '/api/satellites': {
          const group = url.searchParams.get('group') ?? 'visual';
          if (!(group in SATELLITE_GROUPS)) return send(req, res, 400, { error: `Geçersiz grup: ${group}` });
          const { data, meta } = await satCache(group).get();
          return send(
            req,
            res,
            200,
            { data: data.tles, meta, provider: data.provider } satisfies ApiEnvelope<SatelliteTle[]>,
            data.provider === 'satnogs' ? 0 : 600,
          );
        }

        case '/api/geocode': {
          const q = (url.searchParams.get('q') ?? '').trim();
          const lang = (url.searchParams.get('lang') ?? 'tr').slice(0, 5);
          if (q.length < 2) return send(req, res, 400, { error: 'Arama en az 2 karakter olmalı' });
          if (q.length > 100) return send(req, res, 400, { error: 'Arama çok uzun' });
          const key = `${lang}:${q.toLocaleLowerCase('tr')}`;
          const hit = geoCache.get(key);
          if (hit && Date.now() - hit.at < 86400_000) {
            return send(req, res, 200, { data: hit.data, meta: { ...geocodeMeta } }, 3600);
          }
          geocodeMeta.lastAttemptAt = Date.now();
          try {
            const data = await doGeocode(q, lang);
            if (geoCache.size > 500) geoCache.clear();
            geoCache.set(key, { at: Date.now(), data });
            Object.assign(geocodeMeta, { status: 'ok', fetchedAt: Date.now(), count: data.length, error: null });
            return send(req, res, 200, { data, meta: { ...geocodeMeta } }, 3600);
          } catch (err) {
            Object.assign(geocodeMeta, { status: 'error', error: (err as Error).message });
            throw err;
          }
        }

        case '/api/status': {
          const sources = [
            ...[...quakeCaches.values()].map((c) => c.meta),
            aircraftCache.meta,
            ...[...satCaches.values()].map((c) => c.meta),
            geocodeMeta,
          ];
          return send(req, res, 200, { time: Date.now(), openskyAuthenticated: hasOpenSkyCredentials(), sources });
        }

        default:
          return send(req, res, 404, { error: 'Bulunamadı' });
      }
    } catch (err) {
      return sendError(req, res, err);
    }
  };
}
