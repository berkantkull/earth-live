import { GEOCODE_URL, geocodeUrl, parseGeocode } from '../../src/lib/parsers.ts';
import type { GeocodeResult } from '../../src/lib/types.ts';
import { fetchUpstream } from '../http.ts';

export { GEOCODE_URL, parseGeocode };

export async function geocode(query: string, language = 'tr'): Promise<GeocodeResult[]> {
  const res = await fetchUpstream(geocodeUrl(query, language), { headers: { Accept: 'application/json' } }, 10_000);
  return parseGeocode(await res.json());
}
