/**
 * GitHub Pages sürümü için veri anlık görüntüsü üretir (GitHub Actions'ta çalışır).
 *
 *   node scripts/fetch-data.ts <çıktı-klasörü>
 *
 * - aircraft.json            OpenSky durum vektörleri (her çalıştırmada)
 * - satellites-<grup>.json   CelesTrak TLE'leri (CelesTrak kuralı gereği grup başına en fazla 2 saatte bir)
 * - status.json              kaynak durumları (arayüzdeki "Veri kaynakları" paneli)
 *
 * Bir kaynak hata verirse önceki dosya korunur ve hata status.json'a yazılır.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { celestrakUrl, OPENSKY_STATES_URL, packAircraft, SATNOGS_TLE_URL } from '../src/lib/parsers.ts';
import { SATELLITE_GROUPS, type ApiEnvelope, type SourceMetaDto } from '../src/lib/types.ts';
import { fetchAircraft, hasOpenSkyCredentials } from '../server/sources/aircraft.ts';
import { fetchCelestrak, fetchSatnogs, SATELLITE_TTL_SECONDS } from '../server/sources/satellites.ts';

const out = process.argv[2];
if (!out) {
  console.error('Kullanım: node scripts/fetch-data.ts <çıktı-klasörü>');
  process.exit(1);
}
await mkdir(out, { recursive: true });

/** Kendini yenileyen iş akışı zinciri ~5 dakikada bir çalışır */
const AIRCRAFT_INTERVAL_S = 5 * 60;

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(join(out, file), 'utf8')) as T;
  } catch {
    return null;
  }
}

async function ageSeconds(file: string): Promise<number> {
  const prev = await readJson<ApiEnvelope<unknown>>(file);
  if (prev?.meta?.fetchedAt) return (Date.now() - prev.meta.fetchedAt) / 1000;
  try {
    return (Date.now() - (await stat(join(out, file))).mtimeMs) / 1000;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const write = (file: string, data: unknown) => writeFile(join(out, file), JSON.stringify(data));

function meta(partial: Partial<SourceMetaDto> & Pick<SourceMetaDto, 'id' | 'name' | 'url' | 'ttlSeconds'>): SourceMetaDto {
  return { status: 'ok', fetchedAt: null, lastAttemptAt: Date.now(), nextRefreshAt: null, count: null, error: null, ...partial };
}

const prevStatus = await readJson<{ sources: SourceMetaDto[] }>('status.json');
const sources = new Map<string, SourceMetaDto>((prevStatus?.sources ?? []).map((s) => [s.id, s]));

// ---------------------------------------------------------------- uçaklar
{
  const id = 'aircraft';
  const base = { id, name: 'OpenSky Network — ADS-B durum vektörleri', url: OPENSKY_STATES_URL, ttlSeconds: AIRCRAFT_INTERVAL_S };
  try {
    const r = await fetchAircraft();
    const m = meta({ ...base, fetchedAt: Date.now(), count: r.aircraft.length, nextRefreshAt: Date.now() + AIRCRAFT_INTERVAL_S * 1000 });
    await write('aircraft.json', { data: packAircraft(r.aircraft, r.time), meta: m, observedAt: r.time * 1000 } satisfies ApiEnvelope<unknown>);
    sources.set(id, m);
    console.log(`uçaklar: ${r.aircraft.length}`);
  } catch (err) {
    const prev = sources.get(id);
    sources.set(id, meta({ ...base, ...prev, status: prev?.fetchedAt ? 'stale' : 'error', error: (err as Error).message, lastAttemptAt: Date.now() }));
    console.warn(`uçaklar alınamadı: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------- uydular
for (const group of Object.keys(SATELLITE_GROUPS) as (keyof typeof SATELLITE_GROUPS)[]) {
  const file = `satellites-${group}.json`;
  const id = `satellites:${group}`;
  const prev = await readJson<ApiEnvelope<unknown[]> & { provider?: string }>(file);
  // yedek kaynaktan gelmiş veriyi CelesTrak'tan daha sık yenilemeyi dene
  const minAge = prev?.provider === 'satnogs' ? 20 * 60 : SATELLITE_TTL_SECONDS;
  if ((await ageSeconds(file)) < minAge) continue;

  const base = { id, name: `CelesTrak GP — ${SATELLITE_GROUPS[group]}`, url: celestrakUrl(group), ttlSeconds: SATELLITE_TTL_SECONDS };
  try {
    const { tles } = await fetchCelestrak(group);
    const m = meta({ ...base, fetchedAt: Date.now(), count: tles.length, nextRefreshAt: Date.now() + SATELLITE_TTL_SECONDS * 1000 });
    await write(file, { data: tles, meta: m, provider: 'celestrak' });
    sources.set(id, m);
    console.log(`${group}: ${tles.length}`);
  } catch (err) {
    const message = (err as Error).message;
    if (!prev && group === 'active') {
      try {
        const tles = await fetchSatnogs();
        const m = meta({ ...base, name: 'SatNOGS DB — aktif uydular (yedek kaynak)', url: SATNOGS_TLE_URL, fetchedAt: Date.now(), count: tles.length, ttlSeconds: 20 * 60 });
        await write(file, { data: tles, meta: m, provider: 'satnogs' });
        sources.set(id, m);
        console.log(`${group}: SatNOGS yedeği, ${tles.length}`);
        continue;
      } catch (e) {
        console.warn(`SatNOGS alınamadı: ${(e as Error).message}`);
      }
    }
    const p = sources.get(id);
    sources.set(id, meta({ ...base, ...p, status: prev ? 'stale' : 'error', error: message, lastAttemptAt: Date.now() }));
    console.warn(`${group} alınamadı: ${message}`);
  }
}

await write('status.json', { time: Date.now(), openskyAuthenticated: hasOpenSkyCredentials(), sources: [...sources.values()] });
console.log('tamam');
