/**
 * Görünümün adres çubuğundaki (#...) karşılığı — bağlantıyı açan kişi aynı görünümü görür.
 *
 *   #c=41.01,28.98,3500&s=a:4b1805&f=2.5_week&g=stations&m=4
 *
 *   c  kamera: enlem, boylam, irtifa (km)
 *   s  seçim: q:<deprem kimliği> · a:<uçak icao24> · u:<uydu NORAD> · p:<enlem>,<boylam>,<ad>
 *   f  deprem akışı · g  uydu grubu · m  en küçük büyüklük
 */
import type { LayerId } from '../layers/Layer.ts';
import { QUAKE_FEEDS, SATELLITE_GROUPS, type QuakeFeed, type SatelliteGroup } from '../lib/types.ts';

export type SharedSelection =
  | { kind: 'layer'; layer: LayerId; key: string }
  | { kind: 'place'; lat: number; lon: number; name: string };

export interface ViewState {
  camera?: { lat: number; lon: number; altKm: number };
  selection?: SharedSelection;
  feed?: QuakeFeed;
  group?: SatelliteGroup;
  minMagnitude?: number;
}

export const DEFAULT_FEED: QuakeFeed = 'all_day';
export const DEFAULT_GROUP: SatelliteGroup = 'active';

const LAYER_CODE: Record<LayerId, string> = { earthquakes: 'q', aircraft: 'a', satellites: 'u' };
const CODE_LAYER: Record<string, LayerId> = { q: 'earthquakes', a: 'aircraft', u: 'satellites' };

const finite = (...n: number[]) => n.every(Number.isFinite);

export function parseViewState(hash: string): ViewState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const out: ViewState = {};

  const c = p.get('c')?.split(',').map(Number);
  if (c && c.length === 3 && finite(...c) && Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 180 && c[2] > 0) {
    out.camera = { lat: c[0], lon: c[1], altKm: Math.min(80_000, c[2]) };
  }

  const s = p.get('s');
  if (s) {
    const i = s.indexOf(':');
    const code = s.slice(0, i);
    const rest = s.slice(i + 1);
    if (code === 'p') {
      const [lat, lon, ...name] = rest.split(',');
      const la = Number(lat);
      const lo = Number(lon);
      if (finite(la, lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
        out.selection = { kind: 'place', lat: la, lon: lo, name: name.join(',').slice(0, 80) || 'Konum' };
      }
    } else if (CODE_LAYER[code] && rest && rest.length <= 40) {
      out.selection = { kind: 'layer', layer: CODE_LAYER[code], key: rest };
    }
  }

  const f = p.get('f');
  if (f && f in QUAKE_FEEDS) out.feed = f as QuakeFeed;
  const g = p.get('g');
  if (g && g in SATELLITE_GROUPS) out.group = g as SatelliteGroup;
  const m = Number(p.get('m'));
  if (p.has('m') && Number.isFinite(m) && m > 0 && m <= 10) out.minMagnitude = m;
  return out;
}

export function buildViewHash(v: ViewState): string {
  // URLSearchParams virgülü kodlar; okunaklı kalsın diye elle birleştiriyoruz
  const parts: string[] = [];
  if (v.camera) parts.push(`c=${v.camera.lat.toFixed(2)},${v.camera.lon.toFixed(2)},${Math.round(v.camera.altKm)}`);
  if (v.selection) {
    const s = v.selection;
    const value =
      s.kind === 'place'
        ? `p:${s.lat.toFixed(4)},${s.lon.toFixed(4)},${s.name}`
        : `${LAYER_CODE[s.layer]}:${s.key}`;
    parts.push(`s=${encodeURIComponent(value).replace(/%2C/g, ',').replace(/%3A/g, ':')}`);
  }
  if (v.feed && v.feed !== DEFAULT_FEED) parts.push(`f=${v.feed}`);
  if (v.group && v.group !== DEFAULT_GROUP) parts.push(`g=${v.group}`);
  if (v.minMagnitude && v.minMagnitude > 0) parts.push(`m=${v.minMagnitude}`);
  return parts.length ? `#${parts.join('&')}` : '';
}
