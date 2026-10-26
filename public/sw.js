/*
 * EARTH LIVE service worker — uygulamayı kurulabilir ve çevrimdışı açılabilir yapar.
 *
 *  - Sayfa (HTML): önce ağ, yoksa önbellek → yeni sürümler hemen gelir, çevrimdışıyken son sürüm açılır
 *  - Derlenmiş dosyalar (assets/, adları içerik özetli): önce önbellek, değişmezler
 *  - Dokular, simgeler, plaka verisi: önbellekten hemen, arkadan tazele
 *  - Canlı veri (deprem, uçak, uydu, yangın, olay): önce ağ, yoksa son kaydedilen veri
 *  - Konum araması ve diğer her şey: yalnızca ağ
 */
const VERSION = 'v2';
const SHELL = `earthlive-shell-${VERSION}`;
const STATIC = `earthlive-static-${VERSION}`;
const DATA = `earthlive-data-${VERSION}`;
const KEEP = [SHELL, STATIC, DATA];

const scope = new URL(self.registration.scope);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll([scope.href, new URL('manifest.webmanifest', scope).href]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('earthlive-') && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const LIVE_DATA = [
  /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/data\//,
  /^https:\/\/earthquake\.usgs\.gov\//,
  /^https:\/\/eonet\.gsfc\.nasa\.gov\//,
  /^https:\/\/celestrak\.org\//,
];

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    // Sayfa: tarayıcı önbelleğini (Pages max-age=600) atla, sunucuya ETag ile sor —
    // yeni sürüm yayınlanınca hemen gelir, değişmediyse yalnızca 304 döner
    const res = request.mode === 'navigate' ? await fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' }) : await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const shell = await caches.match(scope.href);
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) (await caches.open(STATIC)).put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit);
  if (hit) {
    event.waitUntil(refresh);
    return hit;
  }
  return refresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate' && url.href.startsWith(scope.href)) {
    event.respondWith(networkFirst(request, SHELL));
    return;
  }

  if (url.origin === scope.origin) {
    const path = url.pathname.slice(scope.pathname.length);
    if (path.startsWith('api/')) {
      // sunucu modunda canlı API: önce ağ, çevrimdışıysa son yanıt (konum araması hariç)
      if (!path.startsWith('api/geocode')) event.respondWith(networkFirst(request, DATA));
      return;
    }
    if (path.startsWith('assets/')) {
      event.respondWith(cacheFirst(request));
      return;
    }
    if (/^(textures|icons|data)\/|^(favicon\.svg|og-image\.jpg|manifest\.webmanifest)$/.test(path)) {
      event.respondWith(staleWhileRevalidate(request, event));
    }
    return;
  }

  if (LIVE_DATA.some((re) => re.test(url.href))) {
    event.respondWith(networkFirst(request, DATA));
  }
});
