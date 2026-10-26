import type {
  ApiEnvelope,
  Aircraft,
  Earthquake,
  Fire,
  GeocodeResult,
  NaturalEvent,
  SatelliteTle,
  SourceMetaDto,
} from '../lib/types.ts';
import { lang } from '../i18n.ts';
import { staticApi } from './staticApi.ts';

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('Sunucuya ulaşılamadı', 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status);
  return body as T;
}

/** GitHub Pages derlemesinde (VITE_STATIC=1) sunucu yoktur; veri doğrudan kaynaklardan gelir. */
export const STATIC_MODE = import.meta.env.VITE_STATIC === '1';

const serverApi = {
  earthquakes: (feed: string) => getJson<ApiEnvelope<Earthquake[]>>(`/api/earthquakes?feed=${encodeURIComponent(feed)}`),
  aircraft: () => getJson<ApiEnvelope<Aircraft[]>>('/api/aircraft'),
  satellites: (group: string) => getJson<ApiEnvelope<SatelliteTle[]>>(`/api/satellites?group=${encodeURIComponent(group)}`),
  fires: () => getJson<ApiEnvelope<Fire[]>>('/api/fires'),
  events: () => getJson<ApiEnvelope<NaturalEvent[]>>('/api/events'),
  geocode: (q: string, signal?: AbortSignal) =>
    getJson<ApiEnvelope<GeocodeResult[]>>(`/api/geocode?q=${encodeURIComponent(q)}&lang=${lang}`, signal),
  status: () => getJson<{ time: number; openskyAuthenticated: boolean; sources: SourceMetaDto[] }>('/api/status'),
};

export const api: typeof serverApi = STATIC_MODE ? staticApi : serverApi;

/**
 * Periyodik veri çekici. Hata olursa son başarılı veri ekranda kalır,
 * bir sonraki deneme artan aralıkla yapılır.
 */
export class Poller<T> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private running = false;
  /** refresh() sırasında uçuştaki eski isteğin sonucunu yok saymak için */
  private gen = 0;
  private readonly load: () => Promise<T>;
  private readonly intervalMs: number;
  private readonly onData: (data: T) => void;
  private readonly onError: (err: Error) => void;

  constructor(load: () => Promise<T>, intervalMs: number, onData: (data: T) => void, onError: (err: Error) => void) {
    this.load = load;
    this.intervalMs = intervalMs;
    this.onData = onData;
    this.onError = onError;
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.tick(++this.gen);
  }

  stop() {
    this.running = false;
    this.gen++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Hemen yenile (ör. filtre değişince) */
  refresh() {
    if (this.timer) clearTimeout(this.timer);
    this.running = true;
    void this.tick(++this.gen);
  }

  private async tick(gen: number) {
    try {
      const data = await this.load();
      if (gen !== this.gen) return;
      this.failures = 0;
      this.onData(data);
    } catch (err) {
      if (gen !== this.gen) return;
      this.failures++;
      this.onError(err as Error);
    }
    if (!this.running || gen !== this.gen) return;
    const delay = this.failures === 0 ? this.intervalMs : Math.min(this.intervalMs * 4, 15_000 * 2 ** (this.failures - 1));
    this.timer = setTimeout(() => void this.tick(gen), delay);
  }
}
