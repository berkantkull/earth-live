/**
 * Uygulama simgeleri (PWA ve iOS ana ekran) — logodan üretilir.
 *
 *   node scripts/build-icons.ts
 *
 * "maskable" simge, Android'in simgeyi daire/yuvarlak kare kırpmasına karşı
 * logoyu güvenli alanın (merkezdeki %80) içinde tutar.
 */
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const logo = (size: number, inset: number) => {
  // inset: logonun kenarlara uzaklığı (0..0.5)
  const s = 32 / (1 - 2 * inset);
  const o = -inset * s;
  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${o} ${o} ${s} ${s}">
  <defs>
    <radialGradient id="g" cx="0.38" cy="0.35" r="0.75">
      <stop offset="0" stop-color="#2f7fbf"/>
      <stop offset="0.6" stop-color="#0d3b66"/>
      <stop offset="1" stop-color="#071a33"/>
    </radialGradient>
  </defs>
  <rect x="${o}" y="${o}" width="${s}" height="${s}" fill="#04070d"/>
  <circle cx="16" cy="16" r="9" fill="url(#g)" stroke="#5ad1ff" stroke-width="1.4"/>
  <ellipse cx="16" cy="16" rx="14" ry="5" fill="none" stroke="#5ad1ff" stroke-width="0.9" opacity=".65" transform="rotate(-24 16 16)"/>
  <circle cx="27.6" cy="10.8" r="1.7" fill="#ffcf5c"/>
</svg>`);
};

await mkdir('public/icons', { recursive: true });
const jobs: [string, number, number][] = [
  ['public/icons/icon-192.png', 192, 0.04],
  ['public/icons/icon-512.png', 512, 0.04],
  ['public/icons/maskable-512.png', 512, 0.14],
  ['public/icons/apple-touch-icon.png', 180, 0.08],
];
for (const [file, size, inset] of jobs) {
  await sharp(logo(size, inset)).png({ compressionLevel: 9 }).toFile(file);
  console.log(file);
}
