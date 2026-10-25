/** Sunucu ve istemcinin paylaştığı normalize veri tipleri. */

export interface Earthquake {
  id: string;
  lat: number;
  lon: number;
  depthKm: number;
  magnitude: number;
  magType: string | null;
  place: string;
  time: number;
  updated: number;
  tsunami: boolean;
  felt: number | null;
  alert: string | null;
  significance: number | null;
  status: string | null;
  url: string;
}

export interface Aircraft {
  icao24: string;
  callsign: string | null;
  country: string;
  lat: number;
  lon: number;
  /** metre; geometrik irtifa yoksa barometrik */
  altitudeM: number | null;
  baroAltitudeM: number | null;
  onGround: boolean;
  /** m/s */
  velocity: number | null;
  /** derece, kuzeyden saat yönünde */
  heading: number | null;
  /** m/s */
  verticalRate: number | null;
  squawk: string | null;
  /** unix saniye */
  positionTime: number;
  lastContact: number;
  category: number | null;
}

export interface SatelliteTle {
  name: string;
  norad: number;
  line1: string;
  line2: string;
}

export interface GeocodeResult {
  id: number;
  name: string;
  lat: number;
  lon: number;
  country: string | null;
  countryCode: string | null;
  admin1: string | null;
  population: number | null;
  elevation: number | null;
  timezone: string | null;
}

export type SourceStatus = 'idle' | 'ok' | 'stale' | 'error';

export interface SourceMetaDto {
  id: string;
  name: string;
  url: string;
  status: SourceStatus;
  fetchedAt: number | null;
  lastAttemptAt: number | null;
  nextRefreshAt: number | null;
  count: number | null;
  error: string | null;
  ttlSeconds: number;
}

export interface ApiEnvelope<T> {
  data: T;
  meta: SourceMetaDto;
  /** Verinin kendi gözlem zamanı (ör. OpenSky "time"), unix ms */
  observedAt?: number | null;
  /** Verinin gerçek sağlayıcısı, birincil kaynaktan farklıysa (ör. yedek kaynak) */
  provider?: string;
}

export const SATELLITE_GROUPS = {
  stations: 'Uzay istasyonları',
  visual: 'En parlak 100',
  'gps-ops': 'GPS',
  galileo: 'Galileo',
  weather: 'Meteoroloji',
  science: 'Bilim',
  starlink: 'Starlink',
  active: 'Tüm aktif uydular',
} as const;

export type SatelliteGroup = keyof typeof SATELLITE_GROUPS;

export const QUAKE_FEEDS = {
  all_hour: 'Son 1 saat (tümü)',
  all_day: 'Son 24 saat (tümü)',
  '2.5_week': 'Son 7 gün (M2.5+)',
  '4.5_month': 'Son 30 gün (M4.5+)',
  significant_month: 'Son 30 gün (önemli)',
} as const;

export type QuakeFeed = keyof typeof QUAKE_FEEDS;
