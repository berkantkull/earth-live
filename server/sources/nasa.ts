import { EONET_URL, FIRMS_URL, parseEonet, parseFirmsCsv } from '../../src/lib/parsers.ts';
import type { Fire, NaturalEvent } from '../../src/lib/types.ts';
import { UpstreamError } from '../cache.ts';
import { fetchUpstream } from '../http.ts';

export { EONET_URL, FIRMS_URL };

/** NASA FIRMS: MODIS aktif yangın tespitleri, son 24 saat (dosya ~3 saatte bir güncellenir) */
export async function fetchFires(): Promise<Fire[]> {
  const res = await fetchUpstream(FIRMS_URL, { headers: { Accept: 'text/csv' } }, 60_000);
  const fires = parseFirmsCsv(await res.text());
  if (fires.length === 0) throw new UpstreamError('FIRMS: yangın verisi çözümlenemedi');
  return fires;
}

/** NASA EONET: açık doğal olaylar (yangınlar hariç) */
export async function fetchEvents(): Promise<NaturalEvent[]> {
  const res = await fetchUpstream(EONET_URL, { headers: { Accept: 'application/json' } }, 30_000);
  return parseEonet(await res.json());
}
