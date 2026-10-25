import { OPENSKY_STATES_URL, parseOpenSky, type OpenSkyResult, type StateVector } from '../../src/lib/parsers.ts';
import { UpstreamError } from '../cache.ts';
import { fetchUpstream } from '../http.ts';

export { OPENSKY_STATES_URL, parseOpenSky, type OpenSkyResult, type StateVector };

const OPENSKY_TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

let token: { value: string; expiresAt: number } | null = null;

export const hasOpenSkyCredentials = () =>
  Boolean(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET);

async function getToken(): Promise<string | null> {
  if (!hasOpenSkyCredentials()) return null;
  if (token && token.expiresAt > Date.now() + 30_000) return token.value;
  const res = await fetchUpstream(OPENSKY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.OPENSKY_CLIENT_ID!,
      client_secret: process.env.OPENSKY_CLIENT_SECRET!,
    }),
  });
  const json = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return token.value;
}

export async function fetchAircraft(): Promise<OpenSkyResult> {
  const bearer = await getToken().catch(() => null);
  const res = await fetchUpstream(
    `${OPENSKY_STATES_URL}?extended=1`,
    { headers: { Accept: 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) } },
    30_000,
  );
  const json = await res.json();
  if (!json || typeof json.time !== 'number') throw new UpstreamError('OpenSky: beklenmeyen yanıt');
  return parseOpenSky(json);
}
