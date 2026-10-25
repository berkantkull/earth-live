import { describe, expect, it } from 'vitest';
import { matchAircraft, matchSatellites } from '../src/lib/search.ts';
import type { Aircraft, SatelliteTle } from '../src/lib/types.ts';

const plane = (icao24: string, callsign: string | null, extra: Partial<Aircraft> = {}): Aircraft => ({
  icao24, callsign, country: 'Turkey', lat: 41, lon: 29, altitudeM: 11000, baroAltitudeM: 10900, onGround: false,
  velocity: 240, heading: 90, verticalRate: 0, squawk: null, positionTime: 0, lastContact: 0, category: null, ...extra,
});

const sat = (name: string, norad: number): SatelliteTle => ({ name, norad, line1: '', line2: '' });

describe('matchAircraft', () => {
  const list = [plane('4ba9c1', 'THY1C'), plane('4bb1a2', 'THY12'), plane('4ba001', 'THY'), plane('a1b2c3', 'UAL900'), plane('4b0000', null)];

  it('çağrı işaretinin başıyla eşleşir, tam eşleşme ve kısa olanlar önce', () => {
    expect(matchAircraft(list, 'thy').map((m) => m.title)).toEqual(['THY', 'THY1C', 'THY12']);
  });

  it('boşlukları ve büyük/küçük harfi önemsemez', () => {
    expect(matchAircraft(list, 'thy 1c')[0].key).toBe('4ba9c1');
  });

  it('ICAO24 adresiyle de bulur; çağrı işareti yoksa adres başlık olur', () => {
    const m = matchAircraft(list, '4b0000');
    expect(m[0].title).toBe('4B0000');
  });

  it('en az 2 karakter ister ve sınırı uygular', () => {
    expect(matchAircraft(list, 't')).toEqual([]);
    expect(matchAircraft(list, '4b', 2)).toHaveLength(2);
  });
});

describe('matchSatellites', () => {
  const list = [sat('STARLINK-1007', 44713), sat('ISS (ZARYA)', 25544), sat('ISS DEB', 99999), sat('HST', 20580), sat('CSS (TIANHE)', 48274)];

  it('adı sorguyla başlayanları önce getirir, enkazı (DEB) geriye atar', () => {
    expect(matchSatellites(list, 'iss').map((m) => m.key)).toEqual(['25544', '99999']);
  });

  it('NORAD numarasıyla tam eşleşir', () => {
    expect(matchSatellites(list, '25544')[0].title).toBe('ISS (ZARYA)');
  });

  it('ad içinde geçen metni bulur', () => {
    expect(matchSatellites(list, 'tianhe')[0].key).toBe('48274');
  });
});
