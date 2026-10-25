/**
 * Upstream veri kaynakları için önbellek:
 * - TTL dolana kadar aynı veriyi döndürür
 * - Aynı anda gelen istekleri tek upstream çağrısında birleştirir
 * - Upstream hata verirse eldeki (bayat) veriyi işaretleyerek sunar
 * - Upstream "şu kadar saniye bekle" derse o süre boyunca tekrar denemez
 */

export interface SourceMeta {
  id: string;
  name: string;
  url: string;
  status: 'idle' | 'ok' | 'stale' | 'error';
  fetchedAt: number | null;
  lastAttemptAt: number | null;
  nextRefreshAt: number | null;
  count: number | null;
  error: string | null;
  ttlSeconds: number;
}

export interface CacheEntry<T> {
  data: T;
  meta: SourceMeta;
}

export class UpstreamError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  constructor(message: string, status = 502, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface SourceCacheOptions<T> {
  id: string;
  name: string;
  url: string;
  ttlSeconds: number;
  fetcher: () => Promise<T>;
  count?: (data: T) => number;
  /** veriye göre farklı TTL (ör. yedek kaynaktan gelen veri daha kısa tutulur) */
  ttlFor?: (data: T) => number;
  now?: () => number;
}

export class SourceCache<T> {
  private data: T | null = null;
  private inflight: Promise<CacheEntry<T>> | null = null;
  private blockedUntil = 0;
  private lastError: unknown = null;
  private readonly opts: SourceCacheOptions<T>;
  private readonly now: () => number;
  readonly meta: SourceMeta;

  constructor(opts: SourceCacheOptions<T>) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.meta = {
      id: opts.id,
      name: opts.name,
      url: opts.url,
      status: 'idle',
      fetchedAt: null,
      lastAttemptAt: null,
      nextRefreshAt: null,
      count: null,
      error: null,
      ttlSeconds: opts.ttlSeconds,
    };
  }

  private ttlSeconds(): number {
    return this.data !== null && this.opts.ttlFor ? this.opts.ttlFor(this.data) : this.opts.ttlSeconds;
  }

  private isFresh(): boolean {
    return this.data !== null && this.meta.fetchedAt !== null &&
      this.now() - this.meta.fetchedAt < this.ttlSeconds() * 1000;
  }

  private snapshot(): CacheEntry<T> {
    return { data: this.data as T, meta: { ...this.meta } };
  }

  async get(): Promise<CacheEntry<T>> {
    if (this.isFresh()) return this.snapshot();
    if (this.now() < this.blockedUntil) {
      // geri çekilme süresinde upstream'e gitme: bayat veri ya da son hata
      if (this.data !== null) return this.snapshot();
      if (this.lastError) throw this.lastError;
    }
    if (this.inflight) return this.inflight;

    this.inflight = this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refresh(): Promise<CacheEntry<T>> {
    const started = this.now();
    this.meta.lastAttemptAt = started;
    try {
      const data = await this.opts.fetcher();
      this.data = data;
      this.meta.status = 'ok';
      this.meta.fetchedAt = this.now();
      this.meta.error = null;
      this.meta.count = this.opts.count ? this.opts.count(data) : null;
      this.meta.ttlSeconds = this.ttlSeconds();
      this.meta.nextRefreshAt = this.meta.fetchedAt + this.meta.ttlSeconds * 1000;
      this.blockedUntil = 0;
      this.lastError = null;
      return this.snapshot();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryAfter = err instanceof UpstreamError ? err.retryAfterSeconds : null;
      // Hata sonrası upstream'i dövmemek için en az 30 sn (veya upstream'in istediği kadar) bekle
      const backoffMs = Math.max(30, retryAfter ?? 0) * 1000;
      this.blockedUntil = started + backoffMs;
      this.lastError = err;
      this.meta.error = message;
      this.meta.nextRefreshAt = this.blockedUntil;
      if (this.data !== null) {
        this.meta.status = 'stale';
        return this.snapshot();
      }
      this.meta.status = 'error';
      throw err;
    }
  }
}
