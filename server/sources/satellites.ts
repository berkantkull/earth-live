import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { celestrakUrl, parseSatnogs, parseTle, SATNOGS_TLE_URL } from '../../src/lib/parsers.ts';
import type { SatelliteTle } from '../../src/lib/types.ts';
import { UpstreamError } from '../cache.ts';
import { fetchUpstream } from '../http.ts';

export { celestrakUrl, parseTle };

const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache');
/** CelesTrak aynı grubun 2 saatten sık indirilmemesini istiyor. */
export const SATELLITE_TTL_SECONDS = 2 * 60 * 60;

export interface SatelliteFetchResult {
  tles: SatelliteTle[];
  /** verinin gerçekte nereden geldiği (panelde gösterilir) */
  provider: 'celestrak' | 'celestrak-cache' | 'satnogs';
}

async function readDiskCache(group: string, maxAgeMs: number): Promise<string | null> {
  const file = join(CACHE_DIR, `tle-${group}.txt`);
  try {
    const s = await stat(file);
    if (Date.now() - s.mtimeMs > maxAgeMs) return null;
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** CelesTrak'tan bir grubu indirir. Değişmemiş veri 2 saat içinde tekrar istenirse 403 döner. */
export async function fetchCelestrak(group: string): Promise<{ text: string; tles: SatelliteTle[] }> {
  const res = await fetchUpstream(celestrakUrl(group), { headers: { Accept: 'text/plain' } }, 45_000, [403]);
  if (res.status === 403) {
    const body = await res.text();
    if (/has not updated/i.test(body)) {
      throw new UpstreamError(`CelesTrak "${group}" grubunu son 2 saatte bu IP'ye zaten verdi`, 503, 15 * 60);
    }
    throw new UpstreamError('celestrak.org: HTTP 403');
  }
  const text = await res.text();
  const tles = parseTle(text);
  if (tles.length === 0) throw new UpstreamError(`CelesTrak: "${group}" için TLE bulunamadı`);
  return { text, tles };
}

export async function fetchSatnogs(): Promise<SatelliteTle[]> {
  const res = await fetchUpstream(SATNOGS_TLE_URL, { headers: { Accept: 'application/json' } }, 45_000);
  const tles = parseSatnogs(await res.json());
  if (tles.length === 0) throw new UpstreamError('SatNOGS: TLE bulunamadı');
  return tles;
}

export async function fetchSatellites(group: string): Promise<SatelliteFetchResult> {
  const cached = await readDiskCache(group, SATELLITE_TTL_SECONDS * 1000);
  if (cached) return { tles: parseTle(cached), provider: 'celestrak-cache' };
  try {
    const { text, tles } = await fetchCelestrak(group);
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(join(CACHE_DIR, `tle-${group}.txt`), text, 'utf8');
    return { tles, provider: 'celestrak' };
  } catch (err) {
    // 1) birkaç günlük TLE bile hala makul doğrulukta konum verir
    const old = await readDiskCache(group, 7 * 24 * 3600 * 1000);
    if (old) return { tles: parseTle(old), provider: 'celestrak-cache' };
    // 2) "tüm aktif uydular" için bağımsız ikinci kaynak: SatNOGS DB
    if (group === 'active') return { tles: await fetchSatnogs(), provider: 'satnogs' };
    throw err;
  }
}
