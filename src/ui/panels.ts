import { t, type Key } from '../i18n.ts';
import { escapeHtml, num, relativeTime, utcString } from '../lib/format.ts';
import { ALTITUDE_STOPS, DEPTH_STOPS, EVENT_COLORS, FRP_STOPS, ORBIT_COLORS, PLATE_COLORS } from '../lib/scales.ts';
import { QUAKE_FEEDS, SATELLITE_GROUPS, type GeocodeResult, type SourceMetaDto } from '../lib/types.ts';
import { formatLat, formatLon } from '../lib/geo.ts';
import type { ObjectMatch } from '../lib/search.ts';

const statusLabel = (s: string) =>
  ['ok', 'stale', 'error', 'idle'].includes(s) ? t(`sources.st.${s}` as Key) : s;

/** Kaynak adı arayüz dilinde; sunucunun gönderdiği ad yalnızca bilinmeyen kaynaklar için kullanılır */
export function sourceName(s: SourceMetaDto): string {
  const [kind, arg] = s.id.split(':');
  if (kind === 'earthquakes' && arg && arg in QUAKE_FEEDS) return t('src.earthquakes', { feed: t(`feed.${arg}` as Key) });
  if (kind === 'satellites' && arg && arg in SATELLITE_GROUPS) {
    return s.url.includes('satnogs') ? t('src.satnogs') : t('src.satellites', { group: t(`group.${arg}` as Key) });
  }
  if (['aircraft', 'fires', 'events', 'geocode', 'plates'].includes(kind)) return t(`src.${kind}` as Key);
  return s.name;
}

export function renderSources(el: HTMLElement, sources: SourceMetaDto[], openskyAuth: boolean) {
  const rows = sources
    .map((s) => {
      const cache =
        s.ttlSeconds >= 3600 ? t('sources.hours', { n: num(s.ttlSeconds / 3600, 0) }) : t('sources.seconds', { n: s.ttlSeconds });
      const meta = [
        t('sources.state', { s: statusLabel(s.status) }),
        s.fetchedAt ? t('sources.last', { ago: relativeTime(s.fetchedAt), utc: utcString(s.fetchedAt) }) : t('sources.lastNone'),
        s.nextRefreshAt && s.nextRefreshAt > Date.now() ? t('sources.next', { in: relativeTime(s.nextRefreshAt) }) : '',
        s.ttlSeconds > 0 ? t('sources.cache', { v: cache }) : '',
      ].filter(Boolean);
      return `
        <div class="src-row">
          <span class="dot ${s.status}"></span>
          <strong>${escapeHtml(sourceName(s))}</strong>
          <span class="src-count">${s.count !== null ? num(s.count) : ''}</span>
          <div class="src-meta">${meta.map((m) => `<span>${m}</span>`).join('')}<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.url)}</a></div>
          ${s.error ? `<div class="src-err">⚠ ${escapeHtml(s.error)}</div>` : ''}
        </div>`;
    })
    .join('');
  el.innerHTML = `${rows}
    <div class="src-note">${t('sources.note', { auth: openskyAuth ? t('sources.auth.yes') : t('sources.auth.no') })}</div>`;
}

/** Tek satırlık özet: en kötü durumun rengi + sayı (ayrıntılar panel açılınca) */
export function renderSourcesSummary(el: HTMLElement, sources: SourceMetaDto[]) {
  const active = sources.filter((s) => s.status !== 'idle');
  const errors = active.filter((s) => s.status === 'error').length;
  const stale = active.filter((s) => s.status === 'stale').length;
  const [cls, text] =
    errors > 0
      ? ['error', t('sources.summary.error', { n: errors, total: active.length })]
      : stale > 0
        ? ['stale', t('sources.summary.stale', { n: stale, total: active.length })]
        : ['ok', t('sources.summary.ok', { n: active.length })];
  el.title = active.map((s) => `${sourceName(s)}: ${statusLabel(s.status)}`).join('\n');
  el.innerHTML = active.length ? `<i class="${cls}"></i><span>${text}</span>` : '';
}

export function renderLegend(el: HTMLElement) {
  const group = (id: string, title: string, items: { color: string; label: string }[]) => `
    <div data-legend="${id}">
      <h4>${title}</h4>
      <ul>${items.map((i) => `<li><i style="background:${i.color}"></i>${i.label}</li>`).join('')}</ul>
    </div>`;
  el.innerHTML = [
    group('earthquakes', t('legend.depth'), DEPTH_STOPS),
    group(
      'aircraft',
      t('legend.altitude'),
      ALTITUDE_STOPS.map((s, i) => (i === 0 ? { ...s, label: t('legend.onGround') } : s)),
    ),
    group('satellites', t('legend.orbit'), [
      { color: ORBIT_COLORS.LEO, label: t('legend.leo') },
      { color: ORBIT_COLORS.MEO, label: 'MEO' },
      { color: ORBIT_COLORS.GEO, label: t('legend.geo') },
      { color: ORBIT_COLORS.HEO, label: t('legend.heo') },
    ]),
    group('plates', t('legend.plates'), [
      { color: PLATE_COLORS.subduction, label: t('legend.subduction') },
      { color: PLATE_COLORS.boundary, label: t('legend.otherBoundary') },
    ]),
    group('fires', t('legend.fires'), FRP_STOPS),
    group('events', t('legend.events'), [
      { color: EVENT_COLORS.volcanoes, label: t('cat.volcanoes') },
      { color: EVENT_COLORS.severeStorms, label: t('legend.storm') },
      { color: EVENT_COLORS.seaLakeIce, label: t('legend.ice') },
      { color: EVENT_COLORS.default, label: t('legend.other') },
    ]),
  ].join('');
}

export function setLegendVisible(el: HTMLElement, id: string, on: boolean) {
  el.querySelector<HTMLElement>(`[data-legend="${id}"]`)?.classList.toggle('hidden-group', !on);
}

export type SearchItem = { kind: 'place'; place: GeocodeResult } | ({ kind: 'object' } & ObjectMatch);

export function renderSearchResults(ul: HTMLElement, results: SearchItem[], active: number, placesPending = false) {
  if (results.length === 0) {
    ul.innerHTML = `<li class="r-empty">${placesPending ? t('search.searching') : t('search.none')}</li>`;
    return;
  }
  ul.innerHTML = results
    .map((r, i) => {
      if (r.kind === 'object') {
        return `
      <li role="option" data-index="${i}" aria-selected="${i === active}">
        <div>
          <div class="r-name">${escapeHtml(r.title)}</div>
          <div class="r-sub">${escapeHtml(r.sub)}</div>
        </div>
        <span class="r-tag ${r.layer}">${t(`search.tag.${r.layer}`)}</span>
      </li>`;
      }
      const p = r.place;
      return `
      <li role="option" data-index="${i}" aria-selected="${i === active}">
        <div>
          <div class="r-name">${escapeHtml(p.name)}</div>
          <div class="r-sub">${escapeHtml([p.admin1, p.country].filter(Boolean).join(', '))}</div>
        </div>
        <span class="r-coord">${formatLat(p.lat, 2)}<br>${formatLon(p.lon, 2)}</span>
      </li>`;
    })
    .join('');
}

export function toast(container: HTMLElement, message: string, kind: 'error' | 'info' = 'error', ms = 6000) {
  // aynı mesaj zaten görünüyorsa tekrar etme
  for (const el of container.children) if (el.textContent === message) return;
  const el = document.createElement('div');
  el.className = `toast ${kind === 'info' ? 'info' : ''}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
