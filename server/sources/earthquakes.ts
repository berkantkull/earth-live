import { parseUsgs, usgsFeedUrl } from '../../src/lib/parsers.ts';
import type { Earthquake } from '../../src/lib/types.ts';
import { fetchUpstream } from '../http.ts';

export { parseUsgs, usgsFeedUrl };

export async function fetchEarthquakes(feed: string): Promise<Earthquake[]> {
  const res = await fetchUpstream(usgsFeedUrl(feed), { headers: { Accept: 'application/geo+json' } });
  return parseUsgs(await res.json());
}
