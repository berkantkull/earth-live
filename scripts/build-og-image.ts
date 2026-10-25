/**
 * Paylaşım önizleme görseli (1200×630) — WhatsApp, LinkedIn, X vb. bağlantı kartlarında görünür.
 *
 *   node scripts/build-og-image.ts <sahne-yakalaması.png>
 *
 * Girdi, uygulamanın 3B sahnesinden alınmış 1200×630 bir karedir (Dünya sağda);
 * betik sol tarafa başlık, açıklama ve adresi yerleştirip public/og-image.jpg üretir.
 */
import { stat } from 'node:fs/promises';
import sharp from 'sharp';

const input = process.argv[2];
if (!input) {
  console.error('Kullanım: node scripts/build-og-image.ts <sahne-yakalaması.png>');
  process.exit(1);
}

const W = 1200;
const H = 630;
const font = "'Segoe UI', 'Inter', 'Helvetica Neue', Arial, sans-serif";
const mono = "'Cascadia Mono', 'JetBrains Mono', Consolas, monospace";

const overlay = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fade" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#03060c" stop-opacity="0.92"/>
      <stop offset="0.42" stop-color="#03060c" stop-opacity="0.55"/>
      <stop offset="0.62" stop-color="#03060c" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#fade)"/>

  <g transform="translate(72 150)">
    <circle cx="22" cy="22" r="15" fill="none" stroke="#5ad1ff" stroke-width="2.4"/>
    <ellipse cx="22" cy="22" rx="24" ry="8.5" fill="none" stroke="#5ad1ff" stroke-width="1.4" opacity="0.6" transform="rotate(-24 22 22)"/>
    <circle cx="42" cy="13" r="3" fill="#ffcf5c"/>
    <text x="64" y="33" font-family="${font}" font-size="30" font-weight="700" letter-spacing="7" fill="#e6eef8">EARTH LIVE</text>
  </g>

  <text x="72" y="262" font-family="${font}" font-size="50" font-weight="700" fill="#ffffff">Dünya'yı canlı izle.</text>
  <text x="72" y="318" font-family="${font}" font-size="25" fill="#b9c7d8">Depremler, uçaklar ve uydular —</text>
  <text x="72" y="352" font-family="${font}" font-size="25" fill="#b9c7d8">gerçek zamanlı, 3B gezegen üzerinde.</text>

  <g font-family="${mono}" font-size="17" font-weight="600" letter-spacing="1">
    <g transform="translate(72 410)">
      <rect width="148" height="38" rx="9" fill="#ff6b4a" fill-opacity="0.14" stroke="#ff6b4a" stroke-opacity="0.55"/>
      <circle cx="22" cy="19" r="5" fill="#ff6b4a"/>
      <text x="38" y="25" fill="#ffb4a3">DEPREMLER</text>
    </g>
    <g transform="translate(232 410)">
      <rect width="124" height="38" rx="9" fill="#ffe066" fill-opacity="0.12" stroke="#ffe066" stroke-opacity="0.5"/>
      <circle cx="22" cy="19" r="5" fill="#ffe066"/>
      <text x="38" y="25" fill="#fff0b3">UÇAKLAR</text>
    </g>
    <g transform="translate(368 410)">
      <rect width="130" height="38" rx="9" fill="#6ee7ff" fill-opacity="0.12" stroke="#6ee7ff" stroke-opacity="0.5"/>
      <circle cx="22" cy="19" r="5" fill="#6ee7ff"/>
      <text x="38" y="25" fill="#bff4ff">UYDULAR</text>
    </g>
  </g>

  <text x="72" y="540" font-family="${mono}" font-size="18" fill="#7f91a8">berkantkull.github.io/earth-live</text>
  <text x="72" y="570" font-family="${mono}" font-size="15" fill="#5c6b80">© Berkant Kul</text>
</svg>`;

await sharp(input)
  .resize(W, H, { fit: 'cover' })
  .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
  .jpeg({ quality: 86, mozjpeg: true })
  .toFile('public/og-image.jpg');

const { size } = await stat('public/og-image.jpg');
console.log(`public/og-image.jpg ${(size / 1024).toFixed(0)} KB`);
