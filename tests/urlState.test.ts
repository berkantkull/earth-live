import { describe, expect, it } from 'vitest';
import { buildViewHash, parseViewState, type ViewState } from '../src/ui/urlState.ts';

describe('görünüm bağlantısı', () => {
  it('tam durumu gidiş-dönüşte korur', () => {
    const v: ViewState = {
      camera: { lat: 41.01, lon: 28.98, altKm: 3500 },
      selection: { kind: 'layer', layer: 'satellites', key: '25544' },
      feed: '2.5_week',
      group: 'stations',
      minMagnitude: 4.5,
    };
    const hash = buildViewHash(v);
    expect(hash).toBe('#c=41.01,28.98,3500&s=u:25544&f=2.5_week&g=stations&m=4.5');
    expect(parseViewState(hash)).toEqual(v);
  });

  it('Türkçe karakterli yer adlarını korur', () => {
    const v: ViewState = { selection: { kind: 'place', lat: 38.4237, lon: 27.1428, name: 'İzmir, Türkiye' } };
    expect(parseViewState(buildViewHash(v))).toEqual(v);
  });

  it('varsayılan değerleri bağlantıya yazmaz', () => {
    expect(buildViewHash({ feed: 'all_day', group: 'active', minMagnitude: 0 })).toBe('');
  });

  it('bozuk veya kötü niyetli değerleri yok sayar', () => {
    expect(parseViewState('#c=999,0,10&s=x:abc&f=../../etc&g=<script>&m=-3')).toEqual({});
    expect(parseViewState('#c=a,b,c&s=p:abc,def,X')).toEqual({});
    expect(parseViewState('')).toEqual({});
  });

  it('deprem ve uçak seçimlerini çözer', () => {
    expect(parseViewState('#s=q:us7000abcd').selection).toEqual({ kind: 'layer', layer: 'earthquakes', key: 'us7000abcd' });
    expect(parseViewState('#s=a:4b1805').selection).toEqual({ kind: 'layer', layer: 'aircraft', key: '4b1805' });
  });
});
