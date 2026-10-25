# EARTH LIVE — Global Observation & Monitoring System

Gerçek Dünya gözlem verilerini fotogerçekçi bir 3B gezegen üzerinde gösteren bilimsel izleme arayüzü.

**Canlı:** https://berkantkull.github.io/earth-live/

- **Depremler** — USGS Earthquake Hazards Program GeoJSON akışları (son 1 saat → son 30 gün). Renk derinliği, boyut büyüklüğü gösterir; son 3 saatteki olaylar nabız halkasıyla işaretlenir. Detayda PAGER/tsunami bilgisi ve açığa çıkan enerji yer alır.
- **Uçaklar** — OpenSky Network ADS-B durum vektörleri (~12 bin uçak). Konumlar, ölçüm anından itibaren hız ve rota ile ileri tahmin edilir (dead reckoning); veri yenilemeleri arasında uçaklar akıcı hareket eder.
- **Uydular** — CelesTrak GP/TLE verisi; yörüngeler tarayıcıda, ayrı bir Web Worker içinde SGP4 ile hesaplanır. Seçilen uydu için bir periyotluk yörünge izi, canlı irtifa/hız/alt-uydu noktası ve yörünge elemanları gösterilir. CelesTrak bir grubu veremezse "tüm aktif uydular" için SatNOGS DB yedek kaynak olarak kullanılır.
- **Şehir arama** — Open-Meteo Geocoding (GeoNames); kamera konuma uçar, yerel saat ve güneş yüksekliği gösterilir.
- **Gerçek aydınlatma** — Güneş-altı noktası astronomik formüllerle hesaplanır; gece/gündüz sınırı, şehir ışıkları, okyanus parlaması, bulut gölgeleri ve atmosfer gerçek zamana göre çizilir.
- **Veri kaynakları paneli** — her kaynağın durumu, son güncelleme, sonraki yenileme, öğe sayısı ve hata mesajları.

## İki çalışma modu

| | Sunucu modu (`npm run dev` / `npm start`) | Statik mod (GitHub Pages) |
| --- | --- | --- |
| Depremler, arama | Node sunucusu üzerinden, önbellekli | Tarayıcıdan doğrudan (CORS açık) |
| Uydular | Sunucu, disk önbelleği | `data` dalındaki anlık görüntü, yoksa doğrudan CelesTrak |
| Uçaklar | Sunucu, OpenSky | `data` dalındaki anlık görüntü (~5 dk'da bir) |

OpenSky tarayıcıdan doğrudan erişime izin vermediği için Pages sürümünde uçak ve uydu verisi
`.github/workflows/data.yml` iş akışıyla yaklaşık 5 dakikada bir toplanır ve `data` dalına tek commit olarak
yazılır (geçmiş birikmez). İş akışı her çalışmanın sonunda bir sonrakini kendisi başlatır; GitHub zamanlayıcısı
zincir koparsa yeniden başlatan bir yedektir. Arayüz bu dosyaları `raw.githubusercontent.com` üzerinden okur.

## Geliştirme

Gereksinim: Node.js ≥ 22.18 (sunucu TypeScript'i doğrudan çalıştırır).

```bash
npm install
npm run dev        # http://localhost:5173 — Vite + API aynı süreçte
npm test           # birim ve API testleri
npm run typecheck
```

Üretim (sunucu modu):

```bash
npm run build
npm start          # http://localhost:8787
```

## Yapılandırma

Yerelde `.env.example` dosyasını `.env` olarak kopyalayın. GitHub Pages sürümü için aynı OpenSky bilgilerini
depo ayarlarında **Settings → Secrets and variables → Actions** altına `OPENSKY_CLIENT_ID` ve
`OPENSKY_CLIENT_SECRET` olarak ekleyin.

| Değişken | Açıklama |
| --- | --- |
| `PORT` | Sunucu portu (varsayılan 8787) |
| `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET` | OpenSky OAuth2 API istemcisi. Anonim erişim günde ~400 kredi ile sınırlıdır; hesapla 4000 krediye çıkar. |
| `AIRCRAFT_TTL` | Sunucu modunda uçak verisi önbellek süresi, saniye (varsayılan: kimlikli 60, anonim 300) |

## Mimari

```
server/            Node http sunucusu (çalışma zamanı bağımlılığı yok)
  api.ts           /api/earthquakes, /api/aircraft, /api/satellites, /api/geocode, /api/status, /api/health
  cache.ts         TTL önbellek: istek birleştirme, hata durumunda bayat veri, Retry-After'a uyan geri çekilme
  sources/         USGS, OpenSky (OAuth2), CelesTrak + SatNOGS (disk önbelleği), Open-Meteo
scripts/
  fetch-data.ts    Pages sürümü için veri anlık görüntüsü (GitHub Actions'ta çalışır)
src/
  data/            Sunucu ve statik mod veri katmanları
  globe/           Three.js sahnesi, Dünya/bulut/atmosfer shader'ları, kamera uçuşu
  layers/          Deprem, uçak ve uydu katmanları
  workers/         SGP4 hesabı için Web Worker
  lib/             Ayrıştırıcılar, koordinat dönüşümleri, güneş konumu, yörünge mekaniği
  ui/              Detay, kaynak, lejant ve arama panelleri
tests/             Vitest: geometri, güneş/yörünge, ayrıştırıcılar, önbellek, API uç noktaları
```

## Veri ve doku kaynakları

- USGS deprem verisi — kamu malı (U.S. Government).
- OpenSky Network — [kullanım koşulları](https://opensky-network.org/about/terms-of-use), ticari olmayan kullanım.
- CelesTrak GP verisi — [celestrak.org](https://celestrak.org); SatNOGS DB — CC BY-SA 4.0.
- Open-Meteo Geocoding — CC BY 4.0, GeoNames verisi.
- Dünya dokuları — [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0, NASA Blue Marble/Black Marble türevleri); normal ve speküler haritalar three.js örnek dokularından.

## Lisans

© 2026 Berkant Kul. Tüm hakları saklıdır. Ayrıntılar için [LICENSE](LICENSE).
