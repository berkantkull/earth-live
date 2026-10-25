import { describe, expect, it, vi } from 'vitest';
import { SourceCache, UpstreamError } from '../server/cache.ts';

function setup(ttlSeconds = 60) {
  let now = 1_000_000;
  const fetcher = vi.fn<() => Promise<number[]>>();
  const cache = new SourceCache({
    id: 't',
    name: 'Test',
    url: 'https://example.org',
    ttlSeconds,
    fetcher,
    count: (d) => d.length,
    now: () => now,
  });
  return { cache, fetcher, advance: (ms: number) => (now += ms) };
}

describe('SourceCache', () => {
  it('TTL dolana kadar upstream’e tekrar gitmez', async () => {
    const { cache, fetcher, advance } = setup();
    fetcher.mockResolvedValue([1, 2, 3]);
    const a = await cache.get();
    advance(30_000);
    const b = await cache.get();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a.data).toEqual([1, 2, 3]);
    expect(b.meta).toMatchObject({ status: 'ok', count: 3 });
    advance(31_000);
    await cache.get();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('eşzamanlı istekleri tek upstream çağrısında birleştirir', async () => {
    const { cache, fetcher } = setup();
    fetcher.mockImplementation(() => new Promise((r) => setTimeout(() => r([1]), 10)));
    const all = await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(all.every((x) => x.data[0] === 1)).toBe(true);
  });

  it('hata olursa eldeki veriyi "stale" olarak sunar', async () => {
    const { cache, fetcher, advance } = setup();
    fetcher.mockResolvedValueOnce([7]);
    await cache.get();
    advance(61_000);
    fetcher.mockRejectedValueOnce(new UpstreamError('HTTP 500'));
    const r = await cache.get();
    expect(r.data).toEqual([7]);
    expect(r.meta.status).toBe('stale');
    expect(r.meta.error).toBe('HTTP 500');
  });

  it('hiç veri yokken hatayı fırlatır', async () => {
    const { cache, fetcher } = setup();
    fetcher.mockRejectedValueOnce(new UpstreamError('down'));
    await expect(cache.get()).rejects.toThrow('down');
    expect(cache.meta.status).toBe('error');
  });

  it('429 sonrası Retry-After süresince upstream’i tekrar denemez', async () => {
    const { cache, fetcher, advance } = setup(10);
    fetcher.mockResolvedValueOnce([1]);
    await cache.get();
    advance(11_000);
    fetcher.mockRejectedValueOnce(new UpstreamError('limit', 429, 120));
    await cache.get();
    expect(fetcher).toHaveBeenCalledTimes(2);
    advance(60_000);
    const r = await cache.get();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(r.meta.status).toBe('stale');
    advance(61_000);
    fetcher.mockResolvedValueOnce([2]);
    const r2 = await cache.get();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(r2.data).toEqual([2]);
    expect(r2.meta.status).toBe('ok');
  });

  it('veri yokken de geri çekilme süresinde upstream’e tekrar gitmez', async () => {
    const { cache, fetcher, advance } = setup();
    fetcher.mockRejectedValue(new UpstreamError('down', 503, 900));
    await expect(cache.get()).rejects.toThrow('down');
    advance(60_000);
    await expect(cache.get()).rejects.toThrow('down');
    expect(fetcher).toHaveBeenCalledTimes(1);
    advance(900_000);
    fetcher.mockResolvedValueOnce([1]);
    expect((await cache.get()).data).toEqual([1]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
