/**
 * assets-src/textures altındaki orijinal dokulardan web için optimize WebP kademeleri üretir.
 *
 *   npm run textures
 *
 * Açılışta yalnızca küçük 2K dokular beklenir; 4K arkadan yüklenir, 8K yalnızca yakınlaşınca indirilir.
 */
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const SRC = 'assets-src/textures';
const OUT = 'public/textures';

interface Job {
  src: string;
  out: string;
  width: number;
  quality: number;
  grayscale?: boolean;
}

const jobs: Job[] = [
  { src: 'earth_day_8k.jpg', out: 'earth_day_2k.webp', width: 2048, quality: 82 },
  { src: 'earth_day_8k.jpg', out: 'earth_day_4k.webp', width: 4096, quality: 80 },
  { src: 'earth_day_8k.jpg', out: 'earth_day_8k.webp', width: 8192, quality: 78 },
  { src: 'earth_night_8k.jpg', out: 'earth_night_2k.webp', width: 2048, quality: 80 },
  { src: 'earth_night_8k.jpg', out: 'earth_night_4k.webp', width: 4096, quality: 78 },
  { src: 'earth_clouds_2k.jpg', out: 'earth_clouds_2k.webp', width: 2048, quality: 75, grayscale: true },
  { src: 'earth_normal_2k.jpg', out: 'earth_normal_2k.webp', width: 2048, quality: 85 },
  { src: 'earth_specular_2k.jpg', out: 'earth_specular_1k.webp', width: 1024, quality: 80, grayscale: true },
  { src: 'stars_milky_way_2k.jpg', out: 'stars_milky_way_2k.webp', width: 2048, quality: 70 },
];

await mkdir(OUT, { recursive: true });
for (const j of jobs) {
  let img = sharp(join(SRC, j.src)).resize({ width: j.width, withoutEnlargement: true });
  if (j.grayscale) img = img.grayscale();
  await img.webp({ quality: j.quality, effort: 6, smartSubsample: true }).toFile(join(OUT, j.out));
  const size = (await stat(join(OUT, j.out))).size;
  console.log(`${j.out.padEnd(26)} ${(size / 1024).toFixed(0).padStart(6)} KB`);
}
