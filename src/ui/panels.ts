import { escapeHtml, num, relativeTime, utcString } from '../lib/format.ts';
import { ALTITUDE_STOPS, DEPTH_STOPS, ORBIT_COLORS, PLATE_COLORS } from '../lib/scales.ts';
import type { GeocodeResult, SourceMetaDto } from '../lib/types.ts';
import { formatLat, formatLon } from '../lib/geo.ts';
import type { ObjectMatch } from '../lib/search.ts';

const STATUS_LABEL: Record<string, string> = {
  ok: 'Güncel',
  stale: 'Bayat veri',
  error: 'Hata',
  idle: 'Henüz istenmedi',
};

export function renderSources(el: HTMLElement, sources: SourceMetaDto[], openskyAuth: boolean) {
  const rows = sources
    .map((s) => {
      const meta = [
        `Durum: ${STATUS_LABEL[s.status] ?? s.status}`,
        s.fetchedAt ? `Son veri: ${relativeTime(s.fetchedAt)} · ${utcString(s.fetchedAt)}` : 'Son veri: —',
        s.nextRefreshAt && s.nextRefreshAt > Date.now() ? `Sonraki yenileme: ${relativeTime(s.nextRefreshAt)}` : '',
        `Önbellek: ${s.ttlSeconds >= 3600 ? `${num(s.ttlSeconds / 3600, 0)} sa` : `${s.ttlSeconds} sn`}`,
      ].filter(Boolean);
      return `
        <div class="src-row">
          <span class="dot ${s.status}"></span>
          <strong>${escapeHtml(s.name)}</strong>
          <span class="src-count">${s.count !== null ? num(s.count) : ''}</span>
          <div class="src-meta">${meta.map((m) => `<span>${m}</span>`).join('')}<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.url)}</a></div>
          ${s.error ? `<div class="src-err">⚠ ${escapeHtml(s.error)}</div>` : ''}
        </div>`;
    })
    .join('');
  el.innerHTML = `${rows}
    <div class="src-note">
      Tüm upstream istekleri EARTH LIVE sunucusu üzerinden önbelleğe alınarak yapılır.
      OpenSky erişimi: ${openskyAuth ? 'kimlikli (OAuth2)' : 'anonim — günlük kredi sınırlı; .env ile OPENSKY_CLIENT_ID/SECRET tanımlanabilir'}.
      Uydu konumları SGP4 ile istemcide hesaplanır. Plaka sınırları: Bird (2003) PB2002 (ODC-By 1.0).
      Dokular: Solar System Scope (CC BY 4.0), NASA Blue Marble / Black Marble türevleri.
    </div>`;
}

export function renderSourcesSummary(el: HTMLElement, sources: SourceMetaDto[]) {
  el.innerHTML = sources
    .filter((s) => s.id !== 'geocode' || s.status !== 'idle')
    .map((s) => `<i class="${s.status}" title="${escapeHtml(s.name)}: ${STATUS_LABEL[s.status]}"></i>`)
    .join('');
}

export function renderLegend(el: HTMLElement) {
  const group = (id: string, title: string, items: { color: string; label: string }[]) => `
    <div data-legend="${id}">
      <h4>${title}</h4>
      <ul>${items.map((i) => `<li><i style="background:${i.color}"></i>${i.label}</li>`).join('')}</ul>
    </div>`;
  el.innerHTML = [
    group('earthquakes', 'Deprem derinliği', DEPTH_STOPS),
    group('aircraft', 'Uçak irtifası', ALTITUDE_STOPS),
    group('satellites', 'Yörünge sınıfı', [
      { color: ORBIT_COLORS.LEO, label: 'LEO < 2.000 km' },
      { color: ORBIT_COLORS.MEO, label: 'MEO' },
      { color: ORBIT_COLORS.GEO, label: 'GEO ≈ 35.786 km' },
      { color: ORBIT_COLORS.HEO, label: 'HEO (eliptik)' },
    ]),
    group('plates', 'Plaka sınırı', [
      { color: PLATE_COLORS.subduction, label: 'Dalma-batma' },
      { color: PLATE_COLORS.boundary, label: 'Diğer sınırlar' },
    ]),
  ].join('');
}

export function setLegendVisible(el: HTMLElement, id: string, on: boolean) {
  el.querySelector<HTMLElement>(`[data-legend="${id}"]`)?.classList.toggle('hidden-group', !on);
}

export type SearchItem = { kind: 'place'; place: GeocodeResult } | ({ kind: 'object' } & ObjectMatch);

export function renderSearchResults(ul: HTMLElement, results: SearchItem[], active: number, placesPending = false) {
  if (results.length === 0) {
    ul.innerHTML = `<li class="r-empty">${placesPending ? 'Aranıyor…' : 'Sonuç bulunamadı'}</li>`;
    return;
  }
  ul.innerHTML = results
    .map((r, i) => {
      if (r.kind === 'object') {
        const tag = r.layer === 'aircraft' ? 'UÇAK' : 'UYDU';
        return `
      <li role="option" data-index="${i}" aria-selected="${i === active}">
        <div>
          <div class="r-name">${escapeHtml(r.title)}</div>
          <div class="r-sub">${escapeHtml(r.sub)}</div>
        </div>
        <span class="r-tag ${r.layer}">${tag}</span>
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
  for (const t of container.children) if (t.textContent === message) return;
  const el = document.createElement('div');
  el.className = `toast ${kind === 'info' ? 'info' : ''}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
