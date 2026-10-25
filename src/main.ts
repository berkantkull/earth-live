import * as THREE from 'three';
import './styles.css';
import { api, Poller } from './data/api.ts';
import { Globe } from './globe/Globe.ts';
import { AircraftLayer } from './layers/AircraftLayer.ts';
import { EarthquakeLayer } from './layers/EarthquakeLayer.ts';
import type { Layer, LayerId } from './layers/Layer.ts';
import { SatelliteLayer } from './layers/SatelliteLayer.ts';
import { EARTH_RADIUS_KM, formatLat, formatLon, isOccludedByEarth, latLonToVec3, vec3ToLatLon } from './lib/geo.ts';
import { num, relativeTime } from './lib/format.ts';
import {
  QUAKE_FEEDS,
  SATELLITE_GROUPS,
  type GeocodeResult,
  type SatelliteGroup,
  type SourceMetaDto,
} from './lib/types.ts';
import {
  renderAircraft,
  renderEarthquake,
  renderPlace,
  renderSatellite,
  updateSatelliteLive,
} from './ui/details.ts';
import {
  renderLegend,
  renderSearchResults,
  renderSources,
  renderSourcesSummary,
  setLegendVisible,
  toast,
} from './ui/panels.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const PICK_RADIUS_PX = 12;

// ---------------------------------------------------------------- WebGL kontrolü
function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2'));
  } catch {
    return false;
  }
}

if (!hasWebGL()) {
  $('loader-text').textContent = 'Bu tarayıcı WebGL 2 desteklemiyor — EARTH LIVE görüntülenemiyor.';
  throw new Error('WebGL2 desteklenmiyor');
}

// ---------------------------------------------------------------- sahne
const container = $('globe');
const loader = $('loader');
const globe = new Globe(container, {
  onProgress: (loaded, total) => {
    $('loader-progress').style.width = `${(loaded / total) * 100}%`;
    if (loaded >= total) {
      // dokunun GPU'ya yüklendiği kare çizilsin, sonra perdeyi kaldır
      requestAnimationFrame(() => loader.classList.add('done'));
      setTimeout(() => loader.remove(), 800);
    }
  },
});
// dokular hiç yüklenemezse bile arayüzü aç
setTimeout(() => loader.classList.add('done'), 8000);

const quakes = new EarthquakeLayer();
const aircraft = new AircraftLayer();
const satellites = new SatelliteLayer();
const layers: Record<LayerId, Layer> = { earthquakes: quakes, aircraft, satellites };
for (const l of Object.values(layers)) globe.world.add(l.group);

// ---------------------------------------------------------------- durum
interface LayerState {
  meta: SourceMetaDto | null;
  loading: boolean;
  error: string | null;
  receivedAt: number | null;
}
const state: Record<LayerId, LayerState> = {
  earthquakes: { meta: null, loading: true, error: null, receivedAt: null },
  aircraft: { meta: null, loading: true, error: null, receivedAt: null },
  satellites: { meta: null, loading: true, error: null, receivedAt: null },
};
let aircraftObservedAt = Date.now();

type Selection =
  | { kind: 'layer'; layer: LayerId; key: string }
  | { kind: 'place'; place: GeocodeResult }
  | null;
let selection: Selection = null;
let following = false;

// ---------------------------------------------------------------- veri akışları
const quakeFeedSel = $<HTMLSelectElement>('quake-feed');
for (const [k, v] of Object.entries(QUAKE_FEEDS)) quakeFeedSel.add(new Option(v, k, k === 'all_day', k === 'all_day'));
const satGroupSel = $<HTMLSelectElement>('sat-group');
for (const [k, v] of Object.entries(SATELLITE_GROUPS)) satGroupSel.add(new Option(v, k, k === 'active', k === 'active'));

function failed(id: LayerId, err: Error) {
  state[id].loading = false;
  state[id].error = err.message;
  updateLayerStatus();
  toast($('toasts'), `${{ earthquakes: 'Deprem', aircraft: 'Uçak', satellites: 'Uydu' }[id]} verisi alınamadı: ${err.message}`);
}

function received(id: LayerId, meta: SourceMetaDto) {
  Object.assign(state[id], { meta, loading: false, error: null, receivedAt: Date.now() });
  updateLayerStatus();
  if (selection?.kind === 'layer' && selection.layer === id) refreshSelection();
}

const quakePoller = new Poller(
  () => api.earthquakes(quakeFeedSel.value),
  60_000,
  (r) => {
    quakes.setData(r.data);
    received('earthquakes', r.meta);
  },
  (e) => failed('earthquakes', e),
);

const aircraftPoller = new Poller(
  () => api.aircraft(),
  30_000,
  (r) => {
    // aynı önbellek kaydı tekrar geldiyse yeniden kurmaya gerek yok
    if (r.meta.fetchedAt !== state.aircraft.meta?.fetchedAt || aircraft.data.length === 0) {
      aircraftObservedAt = r.observedAt ?? Date.now();
      aircraft.setData(r.data, aircraftObservedAt);
    }
    received('aircraft', r.meta);
  },
  (e) => failed('aircraft', e),
);

const satellitePoller = new Poller(
  () => api.satellites(satGroupSel.value),
  2 * 3600_000,
  (r) => {
    if (r.meta.fetchedAt !== state.satellites.meta?.fetchedAt || satellites.data.length === 0) satellites.setData(r.data);
    received('satellites', r.meta);
    if (r.provider === 'satnogs') {
      toast(
        $('toasts'),
        `CelesTrak şu an bu grubu vermiyor; yedek kaynak SatNOGS DB'den ${num(r.data.length)} uydu gösteriliyor. CelesTrak birazdan tekrar denenecek.`,
        'info',
        9000,
      );
      // yedek veriyle 2 saat beklemek yerine CelesTrak'ı 20 dk sonra tekrar dene
      setTimeout(() => satellitePoller.refresh(), 20 * 60_000);
    }
  },
  (e) => {
    // seçili grup alınamıyorsa ve ekranda hiç uydu yoksa daha küçük bir gruba geç
    const fallback = SATELLITE_FALLBACKS.find((g) => g !== satGroupSel.value && !triedSatGroups.has(g));
    triedSatGroups.add(satGroupSel.value);
    if (satellites.data.length === 0 && fallback) {
      toast(
        $('toasts'),
        `"${SATELLITE_GROUPS[satGroupSel.value as SatelliteGroup]}" grubu şu an alınamadı (${e.message}). "${SATELLITE_GROUPS[fallback]}" grubu gösteriliyor.`,
        'info',
        9000,
      );
      satGroupSel.value = fallback;
      satellitePoller.refresh();
      return;
    }
    failed('satellites', e);
  },
);
const SATELLITE_FALLBACKS: SatelliteGroup[] = ['visual', 'stations', 'science'];
const triedSatGroups = new Set<string>();
satellites.onLoaded = () => updateLayerStatus();
satellites.onSelectionRestored = (idx) => {
  if (selection?.kind === 'layer' && selection.layer === 'satellites') {
    satellites.select(idx);
    refreshSelection();
  }
};

let openskyAuth = false;
const statusPoller = new Poller(
  () => api.status(),
  10_000,
  (r) => {
    openskyAuth = r.openskyAuthenticated;
    lastSources = r.sources;
    renderSourcesView();
  },
  () => {},
);
let lastSources: SourceMetaDto[] = [];

quakePoller.start();
aircraftPoller.start();
satellitePoller.start();
statusPoller.start();

// ---------------------------------------------------------------- katman kontrolleri
function updateLayerStatus() {
  for (const id of Object.keys(layers) as LayerId[]) {
    const s = state[id];
    const el = $(`status-${id}`);
    const layer = layers[id];
    $(`count-${id}`).textContent = s.meta || layer.visibleCount ? num(layer.visibleCount) : '—';
    let cls = 'idle';
    let text = 'Bekleniyor…';
    if (s.loading && !s.meta) {
      cls = 'loading';
      text = 'Yükleniyor…';
    } else if (s.error && !s.meta) {
      cls = 'error';
      text = `Hata: ${s.error}`;
    } else if (s.meta) {
      cls = s.error ? 'stale' : s.meta.status === 'stale' ? 'stale' : 'ok';
      const fetched = s.meta.fetchedAt ? relativeTime(s.meta.fetchedAt) : '—';
      text = `${cls === 'ok' ? 'Güncel' : 'Bayat'} · veri ${fetched}`;
      if (id === 'aircraft') text += ` · ölçüm ${relativeTime(aircraftObservedAt)}`;
      if (id === 'satellites' && satellites.visibleCount === 0 && satellites.data.length > 0) text = 'Yörüngeler hesaplanıyor…';
    }
    el.className = `layer-status ${cls}`;
    el.textContent = text;
  }
  const degraded = Object.values(state).some((s) => s.error || s.meta?.status === 'stale');
  document.querySelector('.live-badge')?.classList.toggle('degraded', degraded);
}

function bindLayerToggle(id: LayerId) {
  const input = $<HTMLInputElement>(`toggle-${id}`);
  const card = document.querySelector<HTMLElement>(`.layer-card[data-layer="${id}"]`)!;
  input.addEventListener('change', () => {
    layers[id].setVisible(input.checked);
    card.classList.toggle('off', !input.checked);
    setLegendVisible($('legend'), id, input.checked);
    if (!input.checked && selection?.kind === 'layer' && selection.layer === id) clearSelection();
  });
}
(Object.keys(layers) as LayerId[]).forEach(bindLayerToggle);

quakeFeedSel.addEventListener('change', () => {
  state.earthquakes.loading = true;
  state.earthquakes.meta = null;
  updateLayerStatus();
  quakePoller.refresh();
});
const quakeMin = $<HTMLInputElement>('quake-min');
quakeMin.addEventListener('input', () => {
  $('quake-min-out').textContent = `M${Number(quakeMin.value).toFixed(1)}`;
  quakes.setFilter({ minMagnitude: Number(quakeMin.value) });
  updateLayerStatus();
});
$<HTMLInputElement>('aircraft-ground').addEventListener('change', (e) => {
  aircraft.setFilter({ showOnGround: (e.target as HTMLInputElement).checked });
  updateLayerStatus();
});
satGroupSel.addEventListener('change', () => {
  triedSatGroups.clear();
  state.satellites.loading = true;
  state.satellites.meta = null;
  if (selection?.kind === 'layer' && selection.layer === 'satellites') clearSelection();
  updateLayerStatus();
  satellitePoller.refresh();
});

$<HTMLInputElement>('opt-rotate').addEventListener('change', (e) => (globe.autoRotate = (e.target as HTMLInputElement).checked));
$<HTMLInputElement>('opt-lighting').addEventListener('change', (e) => globe.setRealLighting((e.target as HTMLInputElement).checked));
$<HTMLInputElement>('opt-clouds').addEventListener('change', (e) => globe.setCloudsVisible((e.target as HTMLInputElement).checked));
$<HTMLInputElement>('opt-atmosphere').addEventListener('change', (e) => globe.setAtmosphereVisible((e.target as HTMLInputElement).checked));

$('toggle-layers').addEventListener('click', () => $('layers-panel').classList.toggle('open'));

renderLegend($('legend'));
$('copyright-year').textContent = String(Math.max(2026, new Date().getFullYear()));

// ---------------------------------------------------------------- veri kaynakları paneli
const sourcesPanel = $('sources-panel');
const sourcesBody = $('sources-body');
$('sources-toggle').addEventListener('click', () => {
  const open = sourcesBody.hidden;
  sourcesBody.hidden = !open;
  sourcesPanel.classList.toggle('open', open);
  $('sources-toggle').setAttribute('aria-expanded', String(open));
  renderSourcesView();
});
function renderSourcesView() {
  renderSourcesSummary($('sources-summary'), lastSources);
  if (!sourcesBody.hidden) renderSources(sourcesBody, lastSources, openskyAuth);
}

// ---------------------------------------------------------------- seçim (picking)
const tmp = new THREE.Vector3();
const projected = new THREE.Vector3();

interface Hit {
  layer: LayerId;
  index: number;
  dist: number;
}

function pickAt(clientX: number, clientY: number): Hit | null {
  const rect = globe.renderer.domElement.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const cam = globe.camera;
  cam.updateMatrixWorld();
  const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
  const w2 = rect.width / 2;
  const h2 = rect.height / 2;
  const camPos = cam.position;
  let best: Hit | null = null;
  // uydular ve uçaklar küçük; depremlere göre hafif öncelik ver
  const bias: Record<LayerId, number> = { satellites: 0, aircraft: 0, earthquakes: 3 };

  for (const id of ['satellites', 'aircraft', 'earthquakes'] as LayerId[]) {
    layers[id].forEachPickable((index, p) => {
      const cw = vp[3] * p.x + vp[7] * p.y + vp[11] * p.z + vp[15];
      if (cw <= 0) return;
      const sx = ((vp[0] * p.x + vp[4] * p.y + vp[8] * p.z + vp[12]) / cw) * w2 + w2;
      const sy = (-(vp[1] * p.x + vp[5] * p.y + vp[9] * p.z + vp[13]) / cw) * h2 + h2;
      const dx = sx - x;
      const dy = sy - y;
      if (Math.abs(dx) > PICK_RADIUS_PX || Math.abs(dy) > PICK_RADIUS_PX) return;
      const d = Math.hypot(dx, dy) + bias[id];
      if (d > PICK_RADIUS_PX || (best && d >= best.dist)) return;
      if (isOccludedByEarth(camPos, p)) return;
      best = { layer: id, index, dist: d };
    });
  }
  return best;
}

const tooltip = $('tooltip');
let hoverFrame = 0;
let lastPointer: PointerEvent | null = null;

container.addEventListener('pointermove', (e) => {
  lastPointer = e;
  if (hoverFrame) return;
  hoverFrame = requestAnimationFrame(() => {
    hoverFrame = 0;
    const ev = lastPointer!;
    const rect = container.getBoundingClientRect();
    const ndcX = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    const surf = globe.pickSurface(ndcX, ndcY);
    $('hud-cursor').textContent = surf ? `${formatLat(surf.lat, 2)} ${formatLon(surf.lon, 2)}` : '—';

    if (ev.buttons !== 0) {
      tooltip.hidden = true;
      return;
    }
    const hit = pickAt(ev.clientX, ev.clientY);
    container.classList.toggle('hovering', Boolean(hit));
    if (hit) {
      const kind = { earthquakes: 'DEPREM', aircraft: 'UÇAK', satellites: 'UYDU' }[hit.layer];
      tooltip.innerHTML = `<b>${kind}</b>`;
      tooltip.append(layers[hit.layer].label(hit.index));
      tooltip.style.left = `${ev.clientX}px`;
      tooltip.style.top = `${ev.clientY}px`;
      tooltip.hidden = false;
    } else tooltip.hidden = true;
  });
});
container.addEventListener('pointerleave', () => {
  tooltip.hidden = true;
  $('hud-cursor').textContent = '—';
});

let downAt: { x: number; y: number; t: number } | null = null;
container.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
});
container.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 5) return;
  const hit = pickAt(e.clientX, e.clientY);
  if (hit) selectLayerItem(hit.layer, hit.index);
  else if (selection) clearSelection();
});

globe.controls.addEventListener('start', () => {
  following = false;
});

// ---------------------------------------------------------------- detay paneli
const details = $('details-panel');
const detailsContent = $('details-content');
const reticle = $('reticle');

function selectLayerItem(id: LayerId, index: number) {
  for (const l of Object.values(layers)) if (l.id !== id) l.select(null);
  layers[id].select(index);
  selection = { kind: 'layer', layer: id, key: layers[id].keyOf(index) };
  following = false;
  removePlaceMarker();
  globe.pauseAutoRotate(30000);
  refreshSelection();
}

function clearSelection() {
  for (const l of Object.values(layers)) l.select(null);
  selection = null;
  following = false;
  details.hidden = true;
  reticle.hidden = true;
  removePlaceMarker();
}

/** Seçili nesnenin detaylarını (veri yenilendiyse yeni dizinle) yeniden çizer */
function refreshSelection() {
  if (!selection) return;
  if (selection.kind === 'place') {
    detailsContent.innerHTML = renderPlace(selection.place, globe.subsolar);
    details.hidden = false;
    return;
  }
  const { layer: id, key } = selection;
  const idx = layers[id].indexOfKey(key);
  if (idx < 0) {
    // filtre veya yenileme sonrası nesne artık yok
    if (id !== 'satellites' || satellites.data.length > 0) {
      details.hidden = true;
      reticle.hidden = true;
    }
    return;
  }
  layers[id].select(idx);
  if (id === 'earthquakes') detailsContent.innerHTML = renderEarthquake(quakes.item(idx)!);
  else if (id === 'aircraft') {
    const a = aircraft.item(idx)!;
    detailsContent.innerHTML = renderAircraft(a, aircraft.estimate(a, Date.now()), aircraftObservedAt);
  } else detailsContent.innerHTML = renderSatellite(satellites.item(idx)!, satellites.satrec(idx));
  details.hidden = false;
}

$('details-close').addEventListener('click', clearSelection);
detailsContent.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action="fly"]');
  if (!btn || !selection || selection.kind !== 'layer') return;
  const idx = layers[selection.layer].indexOfKey(selection.key);
  if (idx < 0 || !layers[selection.layer].positionOf(idx, tmp)) return;
  const ll = vec3ToLatLon(tmp);
  const dist = selection.layer === 'satellites' ? Math.max(ll.radius + 0.8, 1.6) : 1.45;
  globe.flyTo(ll.lat, ll.lon, dist);
  following = selection.layer !== 'earthquakes';
  if (following) setTimeout(() => (following = selection !== null && following), 1900);
});

// ---------------------------------------------------------------- arama
const searchInput = $<HTMLInputElement>('search-input');
const searchResults = $('search-results');
let results: GeocodeResult[] = [];
let activeResult = 0;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let searchAbort: AbortController | null = null;

function closeResults() {
  searchResults.hidden = true;
  searchInput.setAttribute('aria-expanded', 'false');
}

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  if (searchTimer) clearTimeout(searchTimer);
  if (q.length < 2) {
    closeResults();
    return;
  }
  searchTimer = setTimeout(async () => {
    searchAbort?.abort();
    searchAbort = new AbortController();
    try {
      const r = await api.geocode(q, searchAbort.signal);
      results = r.data;
      activeResult = 0;
      renderSearchResults(searchResults, results, activeResult);
      searchResults.hidden = false;
      searchInput.setAttribute('aria-expanded', 'true');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') toast($('toasts'), `Arama başarısız: ${(err as Error).message}`);
    }
  }, 250);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeResults();
    searchInput.blur();
    return;
  }
  if (searchResults.hidden || results.length === 0) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    activeResult = (activeResult + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
    renderSearchResults(searchResults, results, activeResult);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    choosePlace(results[activeResult]);
  }
});

searchResults.addEventListener('pointerdown', (e) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-index]');
  if (!li) return;
  e.preventDefault();
  choosePlace(results[Number(li.dataset.index)]);
});
searchInput.addEventListener('blur', () => setTimeout(closeResults, 150));
searchInput.addEventListener('focus', () => {
  if (results.length && searchInput.value.trim().length >= 2) {
    searchResults.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
  }
});
window.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== searchInput) {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  } else if (e.key === 'Escape' && selection && document.activeElement !== searchInput) clearSelection();
});

let placeMarker: THREE.Group | null = null;
function removePlaceMarker() {
  if (!placeMarker) return;
  globe.world.remove(placeMarker);
  placeMarker.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Line) o.geometry.dispose();
  });
  placeMarker = null;
}

function choosePlace(p: GeocodeResult | undefined) {
  if (!p) return;
  closeResults();
  searchInput.value = p.name;
  searchInput.blur();
  clearSelection();
  globe.flyTo(p.lat, p.lon, 1.55);

  const g = new THREE.Group();
  const base = new THREE.Vector3().copy(latLonToVec3(p.lat, p.lon, 1.0015) as THREE.Vector3);
  const up = base.clone().normalize();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.006, 0.0085, 48),
    new THREE.MeshBasicMaterial({ color: 0x5ad1ff, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.position.copy(base);
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
  const stem = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([base, up.clone().multiplyScalar(1.045)]),
    new THREE.LineBasicMaterial({ color: 0x5ad1ff, transparent: true, opacity: 0.85 }),
  );
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 16, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  head.position.copy(up.clone().multiplyScalar(1.045));
  g.add(ring, stem, head);
  globe.world.add(g);
  placeMarker = g;
  selection = { kind: 'place', place: p };
  refreshSelection();
}

// ---------------------------------------------------------------- kare döngüsü
let lastSlowTick = 0;
globe.onFrame((_dt, now) => {
  const zs = globe.zoomScale;
  quakes.update(zs, now);
  aircraft.update(zs, now);
  satellites.update(zs, now);

  // seçili nesneyi işaretleyen nişangah + takip modu
  if (selection?.kind === 'layer') {
    const layer = layers[selection.layer];
    const idx = layer.indexOfKey(selection.key);
    if (idx >= 0 && layer.positionOf(idx, tmp)) {
      if (following) {
        const d = globe.camera.position.length();
        globe.camera.position.copy(tmp).normalize().multiplyScalar(d);
        globe.pauseAutoRotate(5000);
      }
      projected.copy(tmp).project(globe.camera);
      const visible = projected.z < 1 && !isOccludedByEarth(globe.camera.position, tmp);
      reticle.hidden = !visible;
      if (visible) {
        const rect = container.getBoundingClientRect();
        reticle.style.transform = `translate(${((projected.x + 1) / 2) * rect.width}px, ${((1 - projected.y) / 2) * rect.height}px)`;
      }
    } else reticle.hidden = true;
  } else reticle.hidden = true;

  if (now - lastSlowTick > 1000) {
    lastSlowTick = now;
    slowTick(now);
  }
});

let lastAircraftDetail = 0;
function slowTick(now: number) {
  const d = new Date(now);
  $('clock-utc').textContent = `${d.toISOString().slice(11, 19)} UTC`;
  $('clock-local').textContent = d.toLocaleString('tr-TR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const altKm = (globe.camera.position.length() - 1) * EARTH_RADIUS_KM;
  $('hud-alt').textContent = `${num(altKm)} km`;
  const sun = globe.subsolar;
  $('hud-sun').textContent = `${formatLat(sun.lat, 1)} ${formatLon(sun.lon, 1)}`;
  updateLayerStatus();

  if (selection?.kind === 'layer' && selection.layer === 'satellites') {
    const rec = satellites.satrec(satellites.indexOfKey(selection.key));
    if (rec) updateSatelliteLive(detailsContent, rec);
  }
  if (selection?.kind === 'layer' && selection.layer === 'aircraft' && now - lastAircraftDetail > 3000) {
    lastAircraftDetail = now;
    const scroll = details.scrollTop;
    refreshSelection();
    details.scrollTop = scroll;
  }
}

// sekme görünmezken ağ isteklerini durdur
document.addEventListener('visibilitychange', () => {
  const pollers = [quakePoller, aircraftPoller, statusPoller];
  if (document.hidden) pollers.forEach((p) => p.stop());
  else pollers.forEach((p) => p.refresh());
});

// geliştirme sırasında konsoldan inceleme için
if (import.meta.env.DEV) Object.assign(window, { __earthlive: { globe, layers, pickAt, selectLayerItem } });
