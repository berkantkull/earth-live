import { describe, expect, it } from 'vitest';
import { packFires, parseEonet, parseFirmsCsv, unpackFires } from '../src/lib/parsers.ts';

const CSV = `latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,confidence,version,bright_t31,frp,daynight
-14.81656,48.86149,300.16,1.46,1.19,2026-10-24,0005,A,20,6.1NRT,288.78,8.2,N
37.12345,28.98765,345.5,1.0,1.0,2026-10-24,1130,T,95,6.1NRT,300.1,120.55,D
bozuk,satır
`;

describe('parseFirmsCsv', () => {
  const fires = parseFirmsCsv(CSV);

  it('geçerli satırları çözer, bozukları atlar', () => {
    expect(fires).toHaveLength(2);
  });

  it('alanları ve UTC zamanını doğru eşler', () => {
    expect(fires[1]).toEqual({
      lat: 37.12345, lon: 28.98765, frp: 120.55, brightness: 345.5, confidence: 95,
      time: Date.parse('2026-10-24T11:30:00Z'), satellite: 'Terra', day: true,
    });
    expect(fires[0]).toMatchObject({ satellite: 'Aqua', day: false, time: Date.parse('2026-10-24T00:05:00Z') });
  });

  it('başlık eksikse boş döner', () => {
    expect(parseFirmsCsv('a,b,c\n1,2,3')).toEqual([]);
  });

  it('sıkı biçim gidiş-dönüşte veriyi korur', () => {
    const back = unpackFires(JSON.parse(JSON.stringify(packFires(fires))));
    expect(back).toHaveLength(2);
    expect(back[1].lat).toBeCloseTo(37.123, 3);
    expect(back[1].frp).toBeCloseTo(120.6, 1);
    expect(back[1].time).toBe(fires[1].time);
    expect(back[0].time).toBe(fires[0].time);
    expect(back[0].satellite).toBe('Aqua');
  });
});

describe('parseEonet', () => {
  const json = {
    events: [
      {
        id: 'EONET_1', title: 'Hurricane Vance', link: 'https://eonet/1', categories: [{ id: 'severeStorms' }],
        sources: [{ id: 'JTWC', url: 'https://jtwc' }],
        geometry: [
          { date: '2026-10-22T00:00:00Z', type: 'Point', coordinates: [-100, 9.5], magnitudeValue: 35, magnitudeUnit: 'kts' },
          { date: '2026-10-21T18:00:00Z', type: 'Point', coordinates: [-99.5, 9.4], magnitudeValue: 30, magnitudeUnit: 'kts' },
          { date: '2026-10-22T06:00:00Z', type: 'Point', coordinates: [-100.5, 9.6], magnitudeValue: 45, magnitudeUnit: 'kts' },
        ],
      },
      {
        id: 'EONET_2', title: 'Etna', link: 'https://eonet/2', categories: [{ id: 'volcanoes' }],
        geometry: [{ date: '2026-06-15T00:00:00Z', type: 'Polygon', coordinates: [[[14, 37], [15, 37], [15, 38], [14, 38]]] }],
      },
      { id: 'EONET_3', title: 'Bilinmeyen', link: '', categories: [{ id: 'aliens' }], geometry: [] },
    ],
  };
  const events = parseEonet(json);

  it('bilinmeyen kategorileri atlar, yeniden eskiye sıralar', () => {
    expect(events.map((e) => e.id)).toEqual(['EONET_1', 'EONET_2']);
  });

  it('izi zamana göre sıralar; konum ve şiddet son gözlemdir', () => {
    const s = events[0];
    expect(s.track.map((p) => p[1])).toEqual([-99.5, -100, -100.5]);
    expect(s).toMatchObject({ lat: 9.6, lon: -100.5, magnitude: 45, magnitudeUnit: 'kts', category: 'severeStorms' });
    expect(s.start).toBe(Date.parse('2026-10-21T18:00:00Z'));
  });

  it('çokgen için ağırlık merkezini kullanır', () => {
    expect(events[1]).toMatchObject({ lat: 37.5, lon: 14.5, magnitude: null, sources: [] });
  });
});
