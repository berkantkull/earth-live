import { describe, expect, it } from 'vitest';
import {
  packAircraft,
  parseGeocode,
  parseOpenSky,
  parseSatnogs,
  parseTle,
  parseUsgs,
  unpackAircraft,
  type StateVector,
} from '../src/lib/parsers.ts';
import { ISS, OPENSKY_SAMPLE, TLE_TEXT, USGS_SAMPLE } from './fixtures.ts';

describe('parseUsgs', () => {
  const quakes = parseUsgs(USGS_SAMPLE as never);

  it('geometrisi olmayan olayları atlar ve yeniden eskiye sıralar', () => {
    expect(quakes.map((q) => q.id)).toEqual(['ak0001', 'us7000abcd']);
  });

  it('alanları normalize eder', () => {
    const q = quakes.find((x) => x.id === 'us7000abcd')!;
    expect(q).toMatchObject({ lat: 41.01, lon: 28.97, depthKm: 10.5, magnitude: 5.4, tsunami: false, alert: 'green', felt: 120 });
  });

  it('eksik alanlara güvenli varsayılan verir', () => {
    const q = quakes.find((x) => x.id === 'ak0001')!;
    expect(q.magnitude).toBe(0);
    expect(q.place).toBe('M ? - Alaska');
    expect(q.tsunami).toBe(true);
    expect(q.felt).toBeNull();
  });
});

describe('parseOpenSky', () => {
  const r = parseOpenSky(OPENSKY_SAMPLE as { time: number; states: StateVector[] });

  it('konumu olmayan durum vektörlerini atlar', () => {
    expect(r.aircraft).toHaveLength(2);
    expect(r.time).toBe(1_760_000_000);
  });

  it('çağrı işaretini kırpar, geometrik irtifayı tercih eder', () => {
    const a = r.aircraft[0];
    expect(a.callsign).toBe('SWR123');
    expect(a.altitudeM).toBeCloseTo(11010.9);
    expect(a.baroAltitudeM).toBeCloseTo(10972.8);
    expect(a.heading).toBeCloseTo(87.2);
    expect(a.category).toBe(3);
  });

  it('eksik zaman ve irtifada son temas/barometrik değere düşer', () => {
    const b = r.aircraft[1];
    expect(b.callsign).toBeNull();
    expect(b.positionTime).toBe(1_759_999_990);
    expect(b.altitudeM).toBeNull();
    expect(b.onGround).toBe(true);
    expect(b.category).toBeNull();
  });

  it('states null ise boş liste döner', () => {
    expect(parseOpenSky({ time: 1, states: null }).aircraft).toEqual([]);
  });
});

describe('parseTle', () => {
  it('3 satırlı formatı çözer ve isimleri kırpar', () => {
    const t = parseTle(TLE_TEXT);
    expect(t).toHaveLength(2);
    expect(t[0]).toEqual(ISS);
    expect(t[1].norad).toBe(41866);
  });

  it('CRLF ve isimsiz 2 satırlı formatı destekler', () => {
    const t = parseTle(`${ISS.line1}\r\n${ISS.line2}\r\n`);
    expect(t).toEqual([{ ...ISS, name: 'NORAD 25544' }]);
  });

  it('bozuk girdide boş döner', () => {
    expect(parseTle('<html>error</html>')).toEqual([]);
  });
});

describe('parseGeocode', () => {
  it('Open-Meteo sonuçlarını eşler', () => {
    const r = parseGeocode({
      results: [{ id: 745044, name: 'İstanbul', latitude: 41.01384, longitude: 28.94966, country: 'Türkiye', country_code: 'TR', admin1: 'İstanbul', population: 14804116, elevation: 39, timezone: 'Europe/Istanbul' }],
    });
    expect(r[0]).toMatchObject({ name: 'İstanbul', lat: 41.01384, lon: 28.94966, countryCode: 'TR', timezone: 'Europe/Istanbul' });
  });
  it('sonuç yoksa boş dizi', () => {
    expect(parseGeocode({})).toEqual([]);
  });
});

describe('parseSatnogs', () => {
  it('SatNOGS JSON’unu çözer, "0 " önekini ve tekrarları temizler', () => {
    const r = parseSatnogs([
      { tle0: '0 ISS', tle1: ISS.line1, tle2: ISS.line2, norad_cat_id: 25544 },
      { tle0: 'ISS dup', tle1: ISS.line1, tle2: ISS.line2, norad_cat_id: 25544 },
      { tle0: 'BAD', tle1: 'x', tle2: 'y', norad_cat_id: 1 },
    ]);
    expect(r).toEqual([{ ...ISS, name: 'ISS' }]);
  });
});

describe('packAircraft / unpackAircraft', () => {
  const { time, aircraft } = parseOpenSky(OPENSKY_SAMPLE as { time: number; states: StateVector[] });

  it('gidiş-dönüşte veriyi (yuvarlama hassasiyetinde) korur', () => {
    const back = unpackAircraft(JSON.parse(JSON.stringify(packAircraft(aircraft, time))));
    expect(back).toHaveLength(aircraft.length);
    back.forEach((b, i) => {
      const a = aircraft[i];
      expect(b).toMatchObject({ icao24: a.icao24, callsign: a.callsign, country: a.country, onGround: a.onGround, squawk: a.squawk });
      expect(b.lat).toBeCloseTo(a.lat, 4);
      expect(b.lon).toBeCloseTo(a.lon, 4);
      expect(b.positionTime).toBe(a.positionTime);
      expect(b.lastContact).toBe(a.lastContact);
      expect(b.altitudeM === null ? null : Math.round(b.altitudeM)).toBe(a.altitudeM === null ? null : Math.round(a.altitudeM));
    });
  });

  it('ülke adlarını sözlükte bir kez tutar', () => {
    const twice = [...aircraft, { ...aircraft[0], icao24: 'zzz999' }];
    expect(packAircraft(twice, time).countries).toEqual(['Switzerland', 'United States']);
  });
});
