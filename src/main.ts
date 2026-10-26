import * as THREE from 'three';
import './styles.css';
import { api, Poller } from './data/api.ts';
import { applyStaticTranslations, lang, locale, setLang, t, type Key } from './i18n.ts';
import { Globe } from './globe/Globe.ts';
import { AircraftLayer } from './layers/AircraftLayer.ts';
import { EarthquakeLayer } from './layers/EarthquakeLayer.ts';
import type { Layer, LayerId } from './layers/Layer.ts';
import { EventLayer } from './layers/EventLayer.ts';
import { FireLayer } from './layers/FireLayer.ts';
import { PlateLayer } from './layers/PlateLayer.ts';
import { SatelliteLayer } from './layers/SatelliteLayer.ts';
import { EARTH_RADIUS_KM, formatLat, formatLon, isOccludedByEarth, latLonToVec3, vec3ToLatLon } from './lib/geo.ts';
import { num, relativeTime } from './lib/format.ts';
import { predictPasses, type Observer, type Pass } from './lib/passes.ts';
import { boundaryLengthKm, distanceToBoundaryKm, type PlateData } from './lib/plates.ts';
import { matchAircraft, matchSatellites } from './lib/search.ts';
import { Timeline } from './lib/timeline.ts';
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
  renderPasses,
  renderPlace,
  renderEvent,
  renderFire,
  renderPlateBoundary,
  renderSatellite,
  updateSatelliteLive,
  type PlateBoundaryInfo,
} from './ui/details.ts';
import {
  renderLegend,
  renderSearchResults,
  renderSources,
  renderSourcesSummary,
  setLegendVisible,
  toast,
  type SearchItem,
} from './ui/panels.ts';
import { buildViewHash, parseViewState, type SharedSelection, type ViewState } from './ui/urlState.ts';

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

applyStaticTranslations();
// düğme, geçilecek dili gösterir
$('lang-toggle').textContent = lang === 'tr' ? 'EN' : 'TR';
$('lang-toggle').addEventListener('click', () => setLang(lang === 'tr' ? 'en' : 'tr'));

if (!hasWebGL()) {
  $('loader-text').textContent = t('app.webgl');
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
const plates = new PlateLayer();
const fires = new FireLayer();
const events = new EventLayer();
const layers: Record<LayerId, Layer> = { earthquakes: quakes, aircraft, satellites, plates, fires, events };
for (const l of Object.values(layers)) globe.world.add(l.group);

/** Bildirim ve ipuçlarında kullanılan katman adları */
const layerNoun = (id: LayerId) => t(`layer.noun.${id}`);
const layerTag = (id: LayerId) => t(`layer.tag.${id}`);

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
  plates: { meta: null, loading: true, error: null, receivedAt: null },
  fires: { meta: null, loading: true, error: null, receivedAt: null },
  events: { meta: null, loading: true, error: null, receivedAt: null },
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
for (const k of Object.keys(QUAKE_FEEDS)) quakeFeedSel.add(new Option(t(`feed.${k}` as Key), k, k === 'all_day', k === 'all_day'));
const satGroupSel = $<HTMLSelectElement>('sat-group');
for (const k of Object.keys(SATELLITE_GROUPS)) satGroupSel.add(new Option(t(`group.${k}` as Key), k, k === 'active', k === 'active'));

// ---------------------------------------------------------------- paylaşılan bağlantı (#...)
const initialView = parseViewState(location.hash);
if (initialView.feed) quakeFeedSel.value = initialView.feed;
if (initialView.group) satGroupSel.value = initialView.group;
if (initialView.camera) {
  const { lat, lon, altKm } = initialView.camera;
  const p = latLonToVec3(lat, lon, Math.max(1.09, 1 + altKm / EARTH_RADIUS_KM));
  globe.camera.position.set(p.x, p.y, p.z);
  globe.pauseAutoRotate(20000);
}
/** bağlantıdaki seçim, ilgili veri gelince uygulanır */
let pendingShared: SharedSelection | null = initialView.selection ?? null;
// Uygulama açıkken başka bir paylaşım bağlantısı yapıştırılırsa (yalnızca # değişir) o görünümle yeniden aç.
// replaceState ile yaptığımız güncellemeler bu olayı tetiklemez.
window.addEventListener('hashchange', () => location.reload());
/** seçilen nesnenin konumu hesaplanınca kamerayı oraya götür */
let pendingFly = false;

function failed(id: LayerId, err: Error) {
  state[id].loading = false;
  state[id].error = err.message;
  updateLayerStatus();
  toast($('toasts'), t('status.failed', { layer: layerNoun(id), msg: err.message }));
}

function received(id: LayerId, meta: SourceMetaDto) {
  Object.assign(state[id], { meta, loading: false, error: null, receivedAt: Date.now() });
  updateLayerStatus();
  if (selection?.kind === 'layer' && selection.layer === id) refreshSelection();
  // plaka detayındaki "yakın depremler" sayısı deprem verisine bağlı
  if (id === 'earthquakes' && selection?.kind === 'layer' && selection.layer === 'plates') refreshSelection();
  resolvePendingShared(id);
}

function resolvePendingShared(id: LayerId) {
  if (!pendingShared || pendingShared.kind !== 'layer' || pendingShared.layer !== id) return;
  const idx = layers[id].indexOfKey(pendingShared.key);
  pendingShared = null;
  if (idx < 0) {
    toast($('toasts'), t('shared.notFound', { what: t(`shared.${id}`) }), 'info');
    return;
  }
  selectLayerItem(id, idx);
  if (!initialView.camera) pendingFly = true;
}

const quakePoller = new Poller(
  () => api.earthquakes(quakeFeedSel.value),
  60_000,
  (r) => {
    quakes.setData(r.data);
    received('earthquakes', r.meta);
    if (timelineOpen) {
      syncTimelineRange();
      renderTimeline();
    }
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
      toast($('toasts'), t('sat.satnogs', { count: num(r.data.length) }), 'info', 9000);
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
        t('sat.fallback', { group: t(`group.${satGroupSel.value}` as Key), msg: e.message, fallback: t(`group.${fallback}`) }),
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

// Tektonik plakalar: değişmeyen veri, sitenin kendi dosyasından bir kez yüklenir
let platesMeta: SourceMetaDto | null = null;
async function loadPlates() {
  const url = `${import.meta.env.BASE_URL}data/plates.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as PlateData;
    plates.setData(data);
    platesMeta = {
      id: 'plates',
      name: t('src.plates'),
      url: 'https://github.com/fraxen/tectonicplates',
      status: 'ok',
      fetchedAt: Date.now(),
      lastAttemptAt: Date.now(),
      nextRefreshAt: null,
      count: data.lines.length,
      error: null,
      ttlSeconds: 0,
    };
    received('plates', platesMeta);
  } catch (err) {
    failed('plates', err as Error);
  }
}
void loadPlates();

// NASA: aktif yangınlar (FIRMS ~3 saatte bir günceller) ve doğal olaylar (EONET)
const firePoller = new Poller(
  () => api.fires(),
  10 * 60_000,
  (r) => {
    if (r.meta.fetchedAt !== state.fires.meta?.fetchedAt || fires.data.length === 0) fires.setData(r.data);
    received('fires', r.meta);
  },
  (e) => failed('fires', e),
);
const eventPoller = new Poller(
  () => api.events(),
  30 * 60_000,
  (r) => {
    events.setData(r.data);
    received('events', r.meta);
  },
  (e) => failed('events', e),
);
firePoller.start();
eventPoller.start();

// ---------------------------------------------------------------- katman kontrolleri
function updateLayerStatus() {
  for (const id of Object.keys(layers) as LayerId[]) {
    const s = state[id];
    const el = $(`status-${id}`);
    const layer = layers[id];
    $(`count-${id}`).textContent = s.meta || layer.visibleCount ? num(layer.visibleCount) : '—';
    let cls = 'idle';
    let text = t('status.waiting');
    if (s.loading && !s.meta) {
      cls = 'loading';
      text = t('status.loading');
    } else if (s.error && !s.meta) {
      cls = 'error';
      text = t('status.error', { msg: s.error });
    } else if (s.meta) {
      cls = s.error ? 'stale' : s.meta.status === 'stale' ? 'stale' : 'ok';
      const ago = s.meta.fetchedAt ? relativeTime(s.meta.fetchedAt) : '—';
      text = t('status.line', { state: cls === 'ok' ? t('status.fresh') : t('status.stale'), ago });
      if (id === 'aircraft') text += t('status.measured', { ago: relativeTime(aircraftObservedAt) });
      if (id === 'satellites' && satellites.visibleCount === 0 && satellites.data.length > 0) text = t('status.computing');
      if (id === 'plates') text = t('status.plates');
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
  if (selection?.kind === 'layer' && selection.layer === 'plates') refreshSelection();
});
if (initialView.minMagnitude) {
  quakeMin.value = String(initialView.minMagnitude);
  quakeMin.dispatchEvent(new Event('input'));
}

// ---------------------------------------------------------------- deprem zaman çizelgesi
const timeline = new Timeline();
const timelineEl = $('timeline');
const tlRange = $<HTMLInputElement>('tl-range');
const tlDateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
let timelineOpen = false;
let tlLabelAt = 0;

function syncTimelineRange() {
  const r = quakes.timeRange;
  if (!r) return;
  // aralığın sonu "şimdi": son depremden sonraki sessiz dönem de görünsün
  timeline.setRange(r.start, Math.max(r.end, Date.now()));
  $('tl-start').textContent = tlDateFmt.format(timeline.start);
  $('tl-end').textContent = tlDateFmt.format(timeline.end);
}

function renderTimeline() {
  quakes.setTimeCursor(timeline.cursor, Math.max(600, timeline.span / 1000 / 12));
  tlRange.value = String(Math.round(timeline.fraction * 1000));
  timelineEl.classList.toggle('playing', timeline.playing);
  $('tl-play').setAttribute('aria-label', timeline.playing ? t('tl.pause') : t('tl.play'));
  $('tl-time').textContent = tlDateFmt.format(timeline.cursor);
  $('tl-count').textContent = t('tl.count', { n: num(quakes.countAtCursor) });
}

function openTimeline() {
  if (!quakes.timeRange) {
    toast($('toasts'), t('tl.noData'), 'info');
    return;
  }
  timelineOpen = true;
  timelineEl.hidden = false;
  syncTimelineRange();
  timeline.seek(0);
  timeline.play();
  globe.pauseAutoRotate(60_000);
  renderTimeline();
}

function closeTimeline() {
  timelineOpen = false;
  timeline.pause();
  timelineEl.hidden = true;
  quakes.setTimeCursor(null);
  updateLayerStatus();
}

$('quake-replay').addEventListener('click', openTimeline);
$('tl-close').addEventListener('click', closeTimeline);
$('tl-play').addEventListener('click', () => {
  timeline.toggle();
  renderTimeline();
});
tlRange.addEventListener('input', () => {
  timeline.pause();
  timeline.seek(Number(tlRange.value) / 1000);
  renderTimeline();
});
$<HTMLSelectElement>('tl-speed').addEventListener('change', (e) => {
  timeline.sweepSeconds = Number((e.target as HTMLSelectElement).value);
});
window.addEventListener('keydown', (e) => {
  // boşluk tuşu: zaman çizelgesi açıkken oynat/duraklat (yazı alanında değilken)
  if (!timelineOpen || e.key !== ' ' || (e.target as HTMLElement).closest('input, select, textarea, button')) return;
  e.preventDefault();
  timeline.toggle();
  renderTimeline();
});

/** her karede: oynatılıyorsa imleci ilerlet */
function stepTimeline(dt: number, now: number) {
  if (!timelineOpen || !timeline.playing) return;
  timeline.step(dt);
  quakes.setTimeCursor(timeline.cursor, Math.max(600, timeline.span / 1000 / 12));
  // metin ve kaydırıcıyı saniyede ~12 kez güncelle
  if (now - tlLabelAt > 80 || !timeline.playing) {
    tlLabelAt = now;
    renderTimeline();
  }
}
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

// Katmanlar paneli: geniş ekranda varsayılan açık (gizlenebilir), dar ekranda varsayılan kapalı (açılabilir)
const layersPanel = $('layers-panel');
const layersBtn = $('toggle-layers');
const narrowScreen = matchMedia('(max-width: 860px)');
const layersVisible = () =>
  narrowScreen.matches ? layersPanel.classList.contains('open') : !layersPanel.classList.contains('collapsed');
function syncLayersButton() {
  const open = layersVisible();
  const label = open ? t('layers.hide') : t('layers.show');
  layersBtn.setAttribute('aria-expanded', String(open));
  layersBtn.setAttribute('aria-label', label);
  layersBtn.title = label;
}
function setLayersVisible(open: boolean) {
  if (narrowScreen.matches) layersPanel.classList.toggle('open', open);
  else layersPanel.classList.toggle('collapsed', !open);
  syncLayersButton();
}
layersBtn.addEventListener('click', () => setLayersVisible(!layersVisible()));
narrowScreen.addEventListener('change', syncLayersButton);
// dar ekranda Dünya'ya dokununca panel kapanır, gezegen görünür
container.addEventListener('pointerdown', () => {
  if (narrowScreen.matches && layersVisible()) setLayersVisible(false);
});
syncLayersButton();

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
  const all = platesMeta ? [...lastSources, platesMeta] : lastSources;
  renderSourcesSummary($('sources-summary'), all);
  if (!sourcesBody.hidden) renderSources(sourcesBody, all, openskyAuth);
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
  // uydular ve uçaklar küçük; depremlere göre hafif öncelik ver.
  // Plaka çizgileri en altta: yalnızca üstünde başka nesne yoksa seçilir.
  const bias: Record<LayerId, number> = { events: 0, satellites: 0, aircraft: 0, earthquakes: 3, fires: 4, plates: 6 };

  for (const id of ['events', 'satellites', 'aircraft', 'earthquakes', 'fires', 'plates'] as LayerId[]) {
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
      tooltip.innerHTML = `<b>${layerTag(hit.layer)}</b>`;
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
  } else if (id === 'plates') {
    detailsContent.innerHTML = renderPlateBoundary(plateInfo(idx));
  } else if (id === 'fires') {
    detailsContent.innerHTML = renderFire(fires.item(idx)!);
  } else if (id === 'events') {
    detailsContent.innerHTML = renderEvent(events.item(idx)!);
  } else {
    detailsContent.innerHTML = renderSatellite(satellites.item(idx)!, satellites.satrec(idx));
    renderPassSection();
  }
  details.hidden = false;
}

/** Plaka sınırı + seçili zaman aralığında bu sınıra 100 km içindeki depremler */
function plateInfo(idx: number): PlateBoundaryInfo {
  const line = plates.plateData!.lines[idx];
  const parts = plates.partsOf(idx);
  const near = quakes.data.filter((q) => distanceToBoundaryKm(q.lat, q.lon, parts) <= 100);
  const strongest = near.reduce<(typeof near)[number] | null>((a, b) => (!a || b.magnitude > a.magnitude ? b : a), null);
  return {
    title: plates.title(idx),
    subduction: line.sub === 1,
    source: line.src,
    lengthKm: boundaryLengthKm(line.c),
    nearbyQuakes: near.length,
    strongest: strongest ? { magnitude: strongest.magnitude, place: strongest.place } : null,
    feedLabel: t(`feed.${quakeFeedSel.value}` as Key),
    minMagnitude: Number(quakeMin.value),
  };
}

$('details-close').addEventListener('click', clearSelection);
/** Kamerayı seçili nesneye götürür; uçak ve uydularda varınca takibe geçer */
function flyToSelection(follow: boolean): boolean {
  if (!selection || selection.kind !== 'layer') return false;
  const idx = layers[selection.layer].indexOfKey(selection.key);
  if (idx < 0 || !layers[selection.layer].positionOf(idx, tmp)) return false;
  const ll = vec3ToLatLon(tmp);
  const dist =
    selection.layer === 'satellites' ? Math.max(ll.radius + 0.8, 1.6) : selection.layer === 'plates' ? 1.9 : 1.45;
  globe.flyTo(ll.lat, ll.lon, dist);
  following = false;
  if (follow && (selection.layer === 'aircraft' || selection.layer === 'satellites')) {
    const target = selection.key;
    setTimeout(() => {
      following = selection?.kind === 'layer' && selection.key === target;
    }, 1900);
  }
  return true;
}

detailsContent.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'fly') flyToSelection(true);
  else if (btn.dataset.action === 'locate') locateObserver();
});

// ---------------------------------------------------------------- gözlemci konumu ve geçiş tahmini
const OBSERVER_KEY = 'earthlive.observer';
let observer: Observer | null = (() => {
  try {
    const o = JSON.parse(localStorage.getItem(OBSERVER_KEY) ?? 'null');
    return o && Number.isFinite(o.lat) && Number.isFinite(o.lon) ? (o as Observer) : null;
  } catch {
    return null;
  }
})();
let passCache: { key: string; at: number; passes: Pass[] } | null = null;

function setObserver(o: Observer) {
  observer = o;
  passCache = null;
  try {
    localStorage.setItem(OBSERVER_KEY, JSON.stringify(o));
  } catch {
    // gizli pencere vb. — yalnızca bu oturum için geçerli
  }
  renderPassSection();
}

function locateObserver() {
  if (!('geolocation' in navigator)) {
    toast($('toasts'), t('geo.unsupported'), 'info');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setObserver({ lat: pos.coords.latitude, lon: pos.coords.longitude, elevationM: pos.coords.altitude ?? 0, name: t('geo.yours') });
      toast($('toasts'), t('geo.privacy'), 'info', 4000);
    },
    (err) => {
      const msg = err.code === err.PERMISSION_DENIED ? t('geo.denied') : t('geo.failed');
      toast($('toasts'), t('geo.alternative', { msg }), 'info');
    },
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
  );
}

/** Seçili uydu için gözlem yerine göre geçiş listesini çizer (10 dk önbellekli) */
function renderPassSection() {
  const el = detailsContent.querySelector<HTMLElement>('#passes');
  if (!el || selection?.kind !== 'layer' || selection.layer !== 'satellites') return;
  const idx = satellites.indexOfKey(selection.key);
  const rec = satellites.satrec(idx);
  const cls = satellites.orbitClassOf(idx);
  let passes: Pass[] | null = null;
  if (observer && rec && cls !== 'GEO') {
    const key = `${selection.key}|${observer.lat.toFixed(3)},${observer.lon.toFixed(3)}`;
    if (!passCache || passCache.key !== key || Date.now() - passCache.at > 600_000) {
      passCache = { key, at: Date.now(), passes: predictPasses(rec, observer, Date.now(), { hours: 72, maxPasses: 8 }) };
    }
    passes = passCache.passes;
  }
  el.innerHTML = renderPasses(observer, passes, cls);
}

// ---------------------------------------------------------------- paylaşma
function currentViewState(): ViewState {
  const ll = vec3ToLatLon(globe.camera.position);
  const v: ViewState = {
    camera: { lat: ll.lat, lon: ll.lon, altKm: (ll.radius - 1) * EARTH_RADIUS_KM },
    feed: quakeFeedSel.value as ViewState['feed'],
    group: satGroupSel.value as ViewState['group'],
    minMagnitude: Number(quakeMin.value),
  };
  if (selection?.kind === 'layer') v.selection = { kind: 'layer', layer: selection.layer, key: selection.key };
  else if (selection?.kind === 'place') {
    v.selection = { kind: 'place', lat: selection.place.lat, lon: selection.place.lon, name: selection.place.name };
  } else if (pendingShared) v.selection = pendingShared;
  return v;
}

function writeUrl() {
  const hash = buildViewHash(currentViewState());
  if (hash !== location.hash) history.replaceState(null, '', hash || location.pathname + location.search);
}

async function shareCurrentView() {
  writeUrl();
  const url = location.href;
  const sel = selection?.kind === 'layer' ? selection : null;
  const label = sel ? layers[sel.layer].label(layers[sel.layer].indexOfKey(sel.key)) : null;
  const text = label ? t('share.text', { label }) : t('share.default');
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: 'EARTH LIVE', text, url });
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast($('toasts'), t('share.copied'), 'info', 4000);
  } catch {
    toast($('toasts'), t('share.link', { url }), 'info', 12000);
  }
}
$('share-view').addEventListener('click', () => void shareCurrentView());
$('details-share').addEventListener('click', () => void shareCurrentView());

// ---------------------------------------------------------------- arama
const searchInput = $<HTMLInputElement>('search-input');
const searchResults = $('search-results');
let results: SearchItem[] = [];
let activeResult = 0;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let searchAbort: AbortController | null = null;

function closeResults() {
  searchResults.hidden = true;
  searchInput.setAttribute('aria-expanded', 'false');
}

function showResults(items: SearchItem[], placesPending: boolean) {
  results = items;
  activeResult = Math.min(activeResult, Math.max(0, items.length - 1));
  renderSearchResults(searchResults, results, activeResult, placesPending);
  searchResults.hidden = false;
  searchInput.setAttribute('aria-expanded', 'true');
}

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  if (searchTimer) clearTimeout(searchTimer);
  if (q.length < 2) {
    closeResults();
    return;
  }
  // uçak ve uydu eşleşmeleri eldeki veriden anında; yerler ağdan biraz sonra gelir
  activeResult = 0;
  showResults(objectMatches(q), true);
  searchTimer = setTimeout(async () => {
    searchAbort?.abort();
    searchAbort = new AbortController();
    try {
      const r = await api.geocode(q, searchAbort.signal);
      // veri bu arada gelmiş olabilir: nesne eşleşmelerini yeniden hesapla
      showResults([...objectMatches(q), ...r.data.map((place) => ({ kind: 'place' as const, place }))], false);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      showResults(objectMatches(q), false);
      toast($('toasts'), t('search.failed', { msg: (err as Error).message }));
    }
  }, 250);
});

function objectMatches(q: string): SearchItem[] {
  return [...matchAircraft(aircraft.data, q), ...matchSatellites(satellites.data, q)].map((m) => ({ kind: 'object', ...m }));
}

function chooseResult(item: SearchItem | undefined) {
  if (!item) return;
  if (item.kind === 'place') {
    choosePlace(item.place);
    return;
  }
  closeResults();
  searchInput.value = item.title;
  searchInput.blur();
  const idx = layers[item.layer].indexOfKey(item.key);
  if (idx < 0) {
    toast($('toasts'), t('search.gone', { name: item.title }), 'info');
    return;
  }
  // katman kapalıysa aç: seçilen nesne görünmeli
  const toggle = $<HTMLInputElement>(`toggle-${item.layer}`);
  if (!toggle.checked) {
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
  }
  selectLayerItem(item.layer, idx);
  // konum bir sonraki karede hesaplanır; hazır olunca kamera oraya gider
  pendingFly = true;
}

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
    chooseResult(results[activeResult]);
  }
});

searchResults.addEventListener('pointerdown', (e) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-index]');
  if (!li) return;
  e.preventDefault();
  chooseResult(results[Number(li.dataset.index)]);
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

function choosePlace(p: GeocodeResult | undefined, fly = true) {
  if (!p) return;
  closeResults();
  searchInput.value = p.name;
  searchInput.blur();
  clearSelection();
  if (fly) globe.flyTo(p.lat, p.lon, 1.55);
  // aranan yer, uydu geçiş tahminlerinde gözlem noktası olur
  setObserver({ lat: p.lat, lon: p.lon, elevationM: p.elevation ?? 0, name: p.name });

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

if (pendingShared?.kind === 'place') {
  const s = pendingShared;
  pendingShared = null;
  const place: GeocodeResult = {
    id: 0, name: s.name, lat: s.lat, lon: s.lon,
    country: null, countryCode: null, admin1: null, population: null, elevation: null, timezone: null,
  };
  choosePlace(place, !initialView.camera);
}

// ---------------------------------------------------------------- kare döngüsü
let lastSlowTick = 0;
globe.onFrame((dt, now) => {
  const zs = globe.zoomScale;
  quakes.update(zs, now);
  aircraft.update(zs, now);
  satellites.update(zs, now);
  fires.update(zs);
  events.update(zs, now);
  stepTimeline(dt, now);

  // seçili nesneyi işaretleyen nişangah + takip modu
  if (selection?.kind === 'layer') {
    const layer = layers[selection.layer];
    const idx = layer.indexOfKey(selection.key);
    if (idx >= 0 && layer.positionOf(idx, tmp)) {
      if (pendingFly) {
        pendingFly = false;
        flyToSelection(false);
      }
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
  $('clock-local').textContent = d.toLocaleString(locale, { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const altKm = (globe.camera.position.length() - 1) * EARTH_RADIUS_KM;
  $('hud-alt').textContent = `${num(altKm)} km`;
  const sun = globe.subsolar;
  $('hud-sun').textContent = `${formatLat(sun.lat, 1)} ${formatLon(sun.lon, 1)}`;
  updateLayerStatus();
  writeUrl();

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
  const pollers = [quakePoller, aircraftPoller, statusPoller, firePoller, eventPoller];
  if (document.hidden) pollers.forEach((p) => p.stop());
  else pollers.forEach((p) => p.refresh());
});

// ---------------------------------------------------------------- uygulama olarak kurulum (PWA)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch((err) => {
      console.warn('Service worker kaydedilemedi', err);
    });
  });
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let installPrompt: InstallPromptEvent | null = null;
const installBtn = $('install-app');
// tarayıcı kurulumu teklif edebildiğinde düğme görünür (Chrome, Edge, Android)
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as InstallPromptEvent;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  installBtn.hidden = true;
  if (outcome === 'accepted') toast($('toasts'), t('app.installed'), 'info', 4000);
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  installBtn.hidden = true;
});

// geliştirme sırasında konsoldan inceleme için
if (import.meta.env.DEV) Object.assign(window, { __earthlive: { globe, layers, pickAt, selectLayerItem } });
