/**
 * Tektonik plaka sınırları veri dosyasını üretir (public/data/plates.json).
 *
 *   node scripts/build-plates.ts
 *
 * Kaynak: Bird, P. (2003) "An updated digital model of plate boundaries", G³ 4(3), 1027 —
 * PB2002 modelinin GeoJSON'u (github.com/fraxen/tectonicplates, ODC-By 1.0), assets-src/plates altında.
 * Çıktı: plaka adları (Türkçe) + her sınır için [enlem, boylam] düz dizisi, 3 ondalık (~100 m).
 */
import { readFile, writeFile } from 'node:fs/promises';

interface Feature<P, G> {
  properties: P;
  geometry: G;
}

const TR: Record<string, string> = {
  Africa: 'Afrika', Antarctica: 'Antarktika', Somalia: 'Somali', India: 'Hindistan', Australia: 'Avustralya',
  Eurasia: 'Avrasya', 'North America': 'Kuzey Amerika', 'South America': 'Güney Amerika', Pacific: 'Pasifik',
  Arabia: 'Arap', Caribbean: 'Karayip', 'Philippine Sea': 'Filipin Denizi', Okhotsk: 'Ohotsk', 'Aegean Sea': 'Ege',
  Anatolia: 'Anadolu', 'Solomon Sea': 'Solomon Denizi', 'North Andes': 'Kuzey And', 'Molucca Sea': 'Molucca Denizi',
  'Banda Sea': 'Banda Denizi', Easter: 'Paskalya', Galapagos: 'Galapagos', Sandwich: 'Sandwich', Panama: 'Panama',
};

const plates = JSON.parse(await readFile('assets-src/plates/PB2002_plates.json', 'utf8')) as {
  features: Feature<{ Code: string; PlateName: string }, unknown>[];
};
const boundaries = JSON.parse(await readFile('assets-src/plates/PB2002_boundaries.json', 'utf8')) as {
  features: Feature<{ Name: string; PlateA: string; PlateB: string; Type: string; Source: string }, { coordinates: [number, number][] }>[];
};

const names: Record<string, string> = {};
for (const f of plates.features) names[f.properties.Code] = TR[f.properties.PlateName] ?? f.properties.PlateName;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const lines = boundaries.features.map((f) => ({
  a: f.properties.PlateA,
  b: f.properties.PlateB,
  sub: f.properties.Type === 'subduction' ? 1 : 0,
  src: f.properties.Source,
  c: f.geometry.coordinates.flatMap(([lon, lat]) => [r3(lat), r3(lon)]),
}));

const json = JSON.stringify({ names, lines });
await writeFile('public/data/plates.json', json);
console.log(`public/data/plates.json — ${lines.length} sınır, ${(json.length / 1024).toFixed(0)} KB`);
