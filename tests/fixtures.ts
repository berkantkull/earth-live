import type { SatelliteTle } from '../src/lib/types.ts';

/** CelesTrak'tan alınmış gerçek TLE'ler (epoch: 2026-10-24) */
export const ISS: SatelliteTle = {
  name: 'ISS (ZARYA)',
  norad: 25544,
  line1: '1 25544U 98067A   26297.20915682  .00007800  00000+0  14938-3 0  9991',
  line2: '2 25544  51.6335  21.6229 0006884 302.9098  57.1228 15.49030149591752',
};

export const GOES16: SatelliteTle = {
  name: 'GOES 16',
  norad: 41866,
  line1: '1 41866U 16071A   26297.32641111 -.00000078  00000+0  00000+0 0  9999',
  line2: '2 41866   0.6548  83.7099 0002503 156.8552 165.0306  1.00272105 36398',
};

export const TLE_TEXT = `ISS (ZARYA)
${ISS.line1}
${ISS.line2}
GOES 16
${GOES16.line1}
${GOES16.line2}
`;

export const USGS_SAMPLE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'us7000abcd',
      geometry: { type: 'Point', coordinates: [28.97, 41.01, 10.5] },
      properties: {
        mag: 5.4, magType: 'mww', place: '10 km S of Istanbul, Turkey', time: 1_760_000_000_000,
        updated: 1_760_000_500_000, tsunami: 0, felt: 120, alert: 'green', sig: 449, status: 'reviewed',
        url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd',
      },
    },
    {
      type: 'Feature',
      id: 'ak0001',
      geometry: { type: 'Point', coordinates: [-150.1, 61.2, 80] },
      properties: {
        mag: null, place: null, title: 'M ? - Alaska', time: 1_760_000_100_000, updated: 1_760_000_100_000,
        tsunami: 1, url: 'https://example.org/ak0001',
      },
    },
    { type: 'Feature', id: 'broken', geometry: null, properties: { mag: 1, place: 'x', time: 0, updated: 0, url: '' } },
  ],
};

export const OPENSKY_SAMPLE = {
  time: 1_760_000_000,
  states: [
    ['4b1805', 'SWR123  ', 'Switzerland', 1_759_999_995, 1_759_999_999, 8.55, 47.45, 10972.8, false, 230.5, 87.2, 0.0, null, 11010.9, '1000', false, 0, 3],
    ['abc123', null, 'United States', null, 1_759_999_990, -73.78, 40.64, null, true, 0, 180, null, null, null, null, false, 0],
    ['dead00', 'NOPOS', 'Germany', null, 1_759_999_990, null, null, null, false, null, null, null, null, null, null, false, 0],
  ],
};
