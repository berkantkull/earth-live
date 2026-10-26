import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApiHandler } from '../server/api.ts';
import { UpstreamError } from '../server/cache.ts';
import { parseOpenSky, parseUsgs, type StateVector } from '../src/lib/parsers.ts';
import { ISS, OPENSKY_SAMPLE, USGS_SAMPLE } from './fixtures.ts';

const deps = {
  fetchEarthquakes: vi.fn(async (_feed: string) => parseUsgs(USGS_SAMPLE as never)),
  fetchAircraft: vi.fn(async () => parseOpenSky(OPENSKY_SAMPLE as { time: number; states: StateVector[] })),
  fetchSatellites: vi.fn(async (_group: string) => ({ tles: [ISS], provider: 'celestrak' as const })),
  geocode: vi.fn(async (q: string) => [
    { id: 1, name: q, lat: 41, lon: 29, country: 'Türkiye', countryCode: 'TR', admin1: null, population: null, elevation: null, timezone: 'Europe/Istanbul' },
  ]),
  fetchFires: vi.fn(async () => [
    { lat: 37.1, lon: 29, frp: 120, brightness: 345, confidence: 95, time: 1_760_000_000_000, satellite: 'Terra' as const, day: true },
  ]),
  fetchEvents: vi.fn(async () => [
    {
      id: 'EONET_2', title: 'Etna', category: 'volcanoes' as const, lat: 37.75, lon: 14.99, date: 1, start: 1,
      magnitude: null, magnitudeUnit: null, track: [[37.75, 14.99, 1]] as [number, number, number][], sources: [], link: '',
    },
  ]),
  aircraftTtlSeconds: 60,
};

let server: Server;
let base: string;

beforeAll(async () => {
  const handler = createApiHandler(deps);
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const get = async (path: string) => {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json(), headers: res.headers };
};

describe('API', () => {
  it('/api/health', async () => {
    const r = await get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('/api/earthquakes normalize veri + meta döner ve önbelleğe alır', async () => {
    const a = await get('/api/earthquakes?feed=all_day');
    const b = await get('/api/earthquakes?feed=all_day');
    expect(a.status).toBe(200);
    expect(a.body.data).toHaveLength(2);
    expect(a.body.meta).toMatchObject({ id: 'earthquakes:all_day', status: 'ok', count: 2 });
    expect(b.body.meta.fetchedAt).toBe(a.body.meta.fetchedAt);
    expect(deps.fetchEarthquakes).toHaveBeenCalledTimes(1);
  });

  it('geçersiz feed 400 döner', async () => {
    const r = await get('/api/earthquakes?feed=../../etc');
    expect(r.status).toBe(400);
  });

  it('/api/aircraft gözlem zamanını ms olarak verir', async () => {
    const r = await get('/api/aircraft');
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(2);
    expect(r.body.observedAt).toBe(1_760_000_000_000);
  });

  it('/api/satellites grup doğrular', async () => {
    expect((await get('/api/satellites?group=stations')).body.data[0].norad).toBe(25544);
    expect((await get('/api/satellites?group=hack')).status).toBe(400);
  });

  it('/api/geocode kısa sorguyu reddeder, sonuçları önbelleğe alır', async () => {
    expect((await get('/api/geocode?q=a')).status).toBe(400);
    const r1 = await get('/api/geocode?q=Ankara');
    await get('/api/geocode?q=ankara');
    expect(r1.body.data[0].name).toBe('Ankara');
    expect(deps.geocode).toHaveBeenCalledTimes(1);
  });

  it('/api/status tüm kaynakların durumunu listeler', async () => {
    const r = await get('/api/status');
    const ids = r.body.sources.map((s: { id: string }) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['earthquakes:all_day', 'aircraft', 'satellites:stations', 'geocode']));
  });

  it('upstream hatası veri yoksa 502, rate limit ise 503 olur', async () => {
    const handler = createApiHandler({
      ...deps,
      fetchEarthquakes: async () => {
        throw new UpstreamError('USGS down');
      },
      fetchAircraft: async () => {
        throw new UpstreamError('limit', 429, 60);
      },
    });
    const s = createServer((req, res) => void handler(req, res));
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    const q = await fetch(`${url}/api/earthquakes`);
    const a = await fetch(`${url}/api/aircraft`);
    expect(q.status).toBe(502);
    expect((await q.json()).error).toBe('USGS down');
    expect(a.status).toBe(503);
    await new Promise<void>((r) => s.close(() => r()));
  });

  it('büyük yanıtları gzip ile sıkıştırır', async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ ...parseUsgs(USGS_SAMPLE as never)[1], id: `q${i}` }));
    const handler = createApiHandler({ ...deps, fetchEarthquakes: async () => many });
    const s = createServer((req, res) => void handler(req, res));
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    const res = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/api/earthquakes`, {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect((await res.json()).data).toHaveLength(50);
    await new Promise<void>((r) => s.close(() => r()));
  });

  it('/api/fires ve /api/events NASA verisini önbellekli döner', async () => {
    const f = await get('/api/fires');
    await get('/api/fires');
    expect(f.body.data[0]).toMatchObject({ frp: 120, satellite: 'Terra' });
    expect(f.body.meta).toMatchObject({ id: 'fires', status: 'ok', count: 1 });
    expect(deps.fetchFires).toHaveBeenCalledTimes(1);
    const e = await get('/api/events');
    expect(e.body.data[0]).toMatchObject({ title: 'Etna', category: 'volcanoes' });
  });

  it('bilinmeyen yol 404', async () => {
    expect((await get('/api/nope')).status).toBe(404);
  });
});
