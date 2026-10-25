import { UpstreamError } from './cache.ts';

const USER_AGENT = 'EarthLive/1.0 (scientific visualization)';

/** passStatus: çağıranın kendisinin yorumlayacağı HTTP hata kodları */
export async function fetchUpstream(
  url: string,
  init: RequestInit = {},
  timeoutMs = 20000,
  passStatus: number[] = [],
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'zaman aşımı' : (err as Error).message;
    throw new UpstreamError(`Upstream erişilemedi (${new URL(url).host}): ${reason}`);
  }
  if (!res.ok && !passStatus.includes(res.status)) {
    const retryHeader = res.headers.get('x-rate-limit-retry-after-seconds') ?? res.headers.get('retry-after');
    const retryAfter = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) : null;
    const label = res.status === 429 ? 'istek limiti aşıldı' : `HTTP ${res.status}`;
    throw new UpstreamError(`${new URL(url).host}: ${label}`, res.status, retryAfter);
  }
  return res;
}
