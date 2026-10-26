import { locale, t, type Key } from '../i18n.ts';
import type { SatRec } from '../lib/sgp4.ts';
import { formatLat, formatLon } from '../lib/geo.ts';
import { compass, escapeHtml, localString, num, relativeTime, utcString } from '../lib/format.ts';
import { orbitalElements, satelliteState } from '../lib/orbits.ts';
import type { Observer, Pass } from '../lib/passes.ts';
import { ALTITUDE_STOPS, DEPTH_STOPS, eventColor, FRP_STOPS, ORBIT_COLORS, PLATE_COLORS, stopColor } from '../lib/scales.ts';
import type { Aircraft, Earthquake, Fire, GeocodeResult, NaturalEvent, SatelliteTle } from '../lib/types.ts';

const cell = (label: string, value: string, wide = false) =>
  `<div${wide ? ' class="wide"' : ''}><dt>${label}</dt><dd>${value}</dd></div>`;

/** Richter-benzeri açıklama — sismolojide yaygın sınıflandırma */
function magnitudeClass(m: number): string {
  if (m < 2) return t('quake.mag.micro');
  if (m < 4) return t('quake.mag.minor');
  if (m < 5) return t('quake.mag.light');
  if (m < 6) return t('quake.mag.moderate');
  if (m < 7) return t('quake.mag.strong');
  if (m < 8) return t('quake.mag.major');
  return t('quake.mag.great');
}

function depthClass(km: number): string {
  if (km < 70) return t('quake.shallow');
  if (km < 300) return t('quake.intermediate');
  return t('quake.deep');
}

export function renderEarthquake(q: Earthquake): string {
  const color = stopColor(DEPTH_STOPS, q.depthKm);
  // Gutenberg-Richter enerji bağıntısı: log10 E = 1.5 M + 4.8 (joule)
  const energyJ = Math.pow(10, 1.5 * q.magnitude + 4.8);
  const tntTons = energyJ / 4.184e9;
  const alert = q.alert && ['green', 'yellow', 'orange', 'red'].includes(q.alert) ? t(`quake.alert.${q.alert}` as Key) : q.alert;
  const tags = [
    `<span class="tag">${magnitudeClass(q.magnitude)}</span>`,
    `<span class="tag">${depthClass(q.depthKm)}</span>`,
    q.tsunami ? `<span class="tag err">${t('quake.tsunami')}</span>` : '',
    alert ? `<span class="tag warn">PAGER: ${escapeHtml(alert)}</span>` : '',
    q.status === 'reviewed' ? `<span class="tag ok">${t('quake.reviewed')}</span>` : `<span class="tag">${t('quake.automatic')}</span>`,
  ].join('');

  return `
    <div class="d-kind" style="color:${color}"><i style="background:${color}"></i>${t('quake.kind')}</div>
    <h2 class="d-title">${escapeHtml(q.place)}</h2>
    <div class="d-sub">${relativeTime(q.time)} · ${localString(q.time)}</div>
    <div class="d-hero"><span class="big">${q.magnitude.toFixed(1)}</span><span class="unit">${t('quake.magnitude', { type: escapeHtml(q.magType ?? 'M') })}</span></div>
    <div class="d-tags">${tags}</div>
    <dl class="d-grid">
      ${cell(t('common.lat'), formatLat(q.lat))}
      ${cell(t('common.lon'), formatLon(q.lon))}
      ${cell(t('quake.depth'), `${num(q.depthKm, 1)} km`)}
      ${cell(t('quake.sig'), num(q.significance))}
      ${cell(t('quake.felt'), q.felt ? t('quake.feltReports', { n: num(q.felt) }) : '—')}
      ${cell(t('quake.energy'), `≈ ${tntTons >= 1000 ? `${num(tntTons / 1000, 1)} kt` : `${num(tntTons, 1)} t`} TNT`)}
      ${cell(t('quake.time'), utcString(q.time), true)}
      ${cell(t('quake.updated'), relativeTime(q.updated), true)}
    </dl>
    <div class="d-actions">
      <a class="btn primary" href="${escapeHtml(q.url)}" target="_blank" rel="noopener">${t('quake.usgsPage')}</a>
      <button class="btn" data-action="fly">${t('common.flyTo')}</button>
    </div>
    <div class="d-source">${t('quake.source', { id: escapeHtml(q.id) })}</div>
  `;
}

export function renderAircraft(a: Aircraft, est: { lat: number; lon: number }, observedAt: number): string {
  const color = a.onGround ? ALTITUDE_STOPS[0].color : stopColor(ALTITUDE_STOPS, Math.max(1, a.altitudeM ?? 1));
  const kmh = a.velocity !== null ? a.velocity * 3.6 : null;
  const knots = a.velocity !== null ? a.velocity * 1.943844 : null;
  const ft = a.altitudeM !== null ? a.altitudeM * 3.28084 : null;
  const vr = a.verticalRate;
  const fpm = t('ac.fpm');
  const trend =
    vr === null ? '—' : Math.abs(vr) < 0.5 ? t('ac.level') : vr > 0 ? `↑ ${num(vr * 196.85)} ${fpm}` : `↓ ${num(-vr * 196.85)} ${fpm}`;
  const squawkTag =
    a.squawk === '7700' ? `<span class="tag err">${t('ac.7700')}</span>` :
    a.squawk === '7600' ? `<span class="tag warn">${t('ac.7600')}</span>` :
    a.squawk === '7500' ? `<span class="tag err">${t('ac.7500')}</span>` : '';
  const callsign = a.callsign ?? a.icao24.toUpperCase();
  return `
    <div class="d-kind" style="color:${color}"><i style="background:${color}"></i>${t('ac.kind')}</div>
    <h2 class="d-title">${escapeHtml(callsign)}</h2>
    <div class="d-sub">${t('ac.registered', { country: escapeHtml(a.country), icao: escapeHtml(a.icao24.toUpperCase()) })}</div>
    <div class="d-hero"><span class="big">${a.onGround ? t('ac.ground') : num(ft)}</span><span class="unit">${a.onGround ? t('ac.onGround') : t('ac.altitudeFt')}</span></div>
    <div class="d-tags">
      <span class="tag">${a.onGround ? t('ac.tagGround') : t('ac.tagAir')}</span>
      ${squawkTag}
      ${a.squawk ? `<span class="tag">SQUAWK ${escapeHtml(a.squawk)}</span>` : ''}
    </div>
    <dl class="d-grid">
      ${cell(t('ac.estLat'), formatLat(est.lat))}
      ${cell(t('ac.estLon'), formatLon(est.lon))}
      ${cell(t('ac.speed'), kmh !== null ? `${num(kmh)} ${t('ac.kmh')} · ${num(knots)} kt` : '—', true)}
      ${cell(t('ac.track'), a.heading !== null ? `${num(a.heading)}° ${compass(a.heading)}` : '—')}
      ${cell(t('ac.vrate'), trend)}
      ${cell(t('ac.geoAlt'), a.altitudeM !== null ? `${num(a.altitudeM)} m` : '—')}
      ${cell(t('ac.baroAlt'), a.baroAltitudeM !== null ? `${num(a.baroAltitudeM)} m` : '—')}
      ${cell(t('ac.lastReport'), t('ac.relMeasure', { ago: relativeTime(a.positionTime * 1000, observedAt) }), true)}
    </dl>
    <div class="d-actions">
      <a class="btn primary" href="https://globe.adsbexchange.com/?icao=${encodeURIComponent(a.icao24)}" target="_blank" rel="noopener">ADS-B Exchange ↗</a>
      <a class="btn" href="https://opensky-network.org/aircraft-profile?icao24=${encodeURIComponent(a.icao24)}" target="_blank" rel="noopener">${t('ac.profile')}</a>
      <button class="btn" data-action="fly">${t('common.follow')}</button>
    </div>
    <div class="d-source">${t('ac.source')}</div>
  `;
}

export function renderSatellite(tle: SatelliteTle, rec: SatRec | null): string {
  if (!rec) {
    return `<h2 class="d-title">${escapeHtml(tle.name)}</h2><p>${t('sat.badTle')}</p>`;
  }
  const el = orbitalElements(rec);
  const st = satelliteState(rec, new Date());
  const color = ORBIT_COLORS[el.orbitClass];
  const epochAgeDays = (Date.now() - el.epoch.getTime()) / 86400000;
  const intl = tle.line1.slice(9, 17).trim();
  const kms = (v: number) => `${num(v, 2)} km/s`;
  return `
    <div class="d-kind" style="color:${color}"><i style="background:${color}"></i>${t('sat.kind', { cls: el.orbitClass })}</div>
    <h2 class="d-title">${escapeHtml(tle.name)}</h2>
    <div class="d-sub">NORAD ${tle.norad}${intl ? ` · COSPAR ${escapeHtml(intl)}` : ''} · ${t(`sat.class.${el.orbitClass}`)}</div>
    <div class="d-hero"><span class="big" data-live="sat-alt">${st ? num(st.altKm) : '—'}</span><span class="unit">${t('sat.altitude')}</span></div>
    <div class="d-tags">
      <span class="tag">${el.orbitClass}</span>
      ${epochAgeDays > 14 ? `<span class="tag warn">${t('sat.oldTle')}</span>` : `<span class="tag ok">${t('sat.freshTle')}</span>`}
      ${el.inclinationDeg > 96 && el.inclinationDeg < 102 && el.orbitClass === 'LEO' ? `<span class="tag">${t('sat.sso')}</span>` : ''}
    </div>
    <dl class="d-grid">
      ${cell(t('sat.subLat'), `<span data-live="sat-lat">${st ? formatLat(st.lat) : '—'}</span>`)}
      ${cell(t('sat.subLon'), `<span data-live="sat-lon">${st ? formatLon(st.lon) : '—'}</span>`)}
      ${cell(t('sat.speed'), `<span data-live="sat-speed">${st ? kms(st.speedKms) : '—'}</span>`)}
      ${cell(t('sat.period'), `${num(el.periodMin, 1)} ${t('sat.minutes')}`)}
      ${cell(t('sat.inclination'), `${num(el.inclinationDeg, 2)}°`)}
      ${cell(t('sat.eccentricity'), el.eccentricity.toFixed(5))}
      ${cell(t('sat.apogee'), `${num(el.apogeeKm)} km`)}
      ${cell(t('sat.perigee'), `${num(el.perigeeKm)} km`)}
      ${cell(t('sat.sma'), `${num(el.semiMajorAxisKm)} km`)}
      ${cell(t('sat.revs'), num(1440 / el.periodMin, 2))}
      ${cell(t('sat.epoch'), `${utcString(el.epoch.getTime())} (${relativeTime(el.epoch.getTime())})`, true)}
    </dl>
    <div id="passes"></div>
    <div class="d-section">${t('sat.tle')}</div>
    <div class="d-tle">${escapeHtml(tle.line1)}\n${escapeHtml(tle.line2)}</div>
    <div class="d-actions" style="margin-top:12px">
      <a class="btn primary" href="https://celestrak.org/satcat/table-satcat.php?CATNR=${tle.norad}" target="_blank" rel="noopener">CelesTrak SATCAT ↗</a>
      <a class="btn" href="https://www.n2yo.com/satellite/?s=${tle.norad}" target="_blank" rel="noopener">N2YO ↗</a>
      <button class="btn" data-action="fly">${t('common.follow')}</button>
    </div>
    <div class="d-source">${t('sat.source')}</div>
  `;
}

export function updateSatelliteLive(root: HTMLElement, rec: SatRec) {
  const st = satelliteState(rec, new Date());
  if (!st) return;
  const set = (k: string, v: string) => {
    const el = root.querySelector(`[data-live="${k}"]`);
    if (el) el.textContent = v;
  };
  set('sat-alt', num(st.altKm));
  set('sat-lat', formatLat(st.lat));
  set('sat-lon', formatLon(st.lon));
  set('sat-speed', `${num(st.speedKms, 2)} km/s`);
}

// ---------------------------------------------------------------- NASA: yangın ve doğal olay

function frpClass(frp: number): string {
  if (frp < 10) return t('fire.low');
  if (frp < 50) return t('fire.moderate');
  if (frp < 200) return t('fire.high');
  return t('fire.veryHigh');
}

export function renderFire(f: Fire): string {
  const color = stopColor(FRP_STOPS, f.frp);
  const conf = f.confidence >= 80 ? t('fire.conf.high') : f.confidence >= 30 ? t('fire.conf.nominal') : t('fire.conf.low');
  return `
    <div class="d-kind" style="color:${color}"><i style="background:${color}"></i>${t('fire.kind')}</div>
    <h2 class="d-title">${formatLat(f.lat, 3)}, ${formatLon(f.lon, 3)}</h2>
    <div class="d-sub">${relativeTime(f.time)} · ${localString(f.time)}</div>
    <div class="d-hero"><span class="big">${num(f.frp, 1)}</span><span class="unit">${t('fire.frp')}</span></div>
    <div class="d-tags">
      <span class="tag">${frpClass(f.frp)}</span>
      <span class="tag">${f.day ? t('fire.dayPass') : t('fire.nightPass')}</span>
      <span class="tag ${f.confidence >= 80 ? 'ok' : f.confidence < 30 ? 'warn' : ''}">${t('fire.confTag', { n: f.confidence })}</span>
    </div>
    <dl class="d-grid">
      ${cell(t('fire.brightness'), `${num(f.brightness)} K · ${num(f.brightness - 273.15)} °C`, true)}
      ${cell(t('fire.confidence'), `${conf} (${f.confidence}%)`)}
      ${cell(t('fire.satellite'), `${f.satellite} · MODIS`)}
      ${cell(t('fire.time'), utcString(f.time), true)}
    </dl>
    <p class="d-note muted">${t('fire.note')}</p>
    <div class="d-actions">
      <a class="btn primary" href="https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${f.lon.toFixed(3)},${f.lat.toFixed(3)},10.0z" target="_blank" rel="noopener">${t('fire.map')}</a>
      <button class="btn" data-action="fly">${t('common.flyTo')}</button>
    </div>
    <div class="d-source">${t('fire.source')}</div>
  `;
}

export function renderEvent(e: NaturalEvent): string {
  const color = eventColor(e.category);
  const moving = e.track.length > 1;
  const magnitude =
    e.magnitude !== null
      ? e.magnitudeUnit === 'kts'
        ? `${num(e.magnitude)} kt · ${num(e.magnitude * 1.852)} ${t('ac.kmh')}`
        : e.magnitudeUnit === 'NM^2'
          ? `${num(e.magnitude, 1)} NM² · ${num(e.magnitude * 3.43)} km²`
          : `${num(e.magnitude, 1)} ${escapeHtml(e.magnitudeUnit ?? '')}`
      : null;
  const sources = e.sources
    .map((s) => `<a class="btn" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.id)} ↗</a>`)
    .join('');
  return `
    <div class="d-kind" style="color:${color}"><i style="background:${color}"></i>${t(`cat.${e.category}`)} · NASA EONET</div>
    <h2 class="d-title">${escapeHtml(e.title)}</h2>
    <div class="d-sub">${t('event.lastSeen', { ago: relativeTime(e.date), date: localString(e.date) })}</div>
    ${magnitude ? `<div class="d-hero"><span class="big">${magnitude.split(' · ')[0]}</span><span class="unit">${e.category === 'severeStorms' ? t('event.maxWind') : t('event.magnitude')}</span></div>` : ''}
    <dl class="d-grid">
      ${cell(t('common.lat'), formatLat(e.lat))}
      ${cell(t('common.lon'), formatLon(e.lon))}
      ${magnitude ? cell(t('event.size'), magnitude, true) : ''}
      ${cell(t('event.firstSeen'), `${localString(e.start)} (${relativeTime(e.start)})`, true)}
      ${moving ? cell(t('event.track'), t('event.trackValue', { n: e.track.length }), true) : ''}
    </dl>
    <div class="d-actions">${sources}<button class="btn" data-action="fly">${t('common.flyTo')}</button></div>
    <div class="d-source">${t('event.source', { id: escapeHtml(e.id) })}</div>
  `;
}

export function renderPlace(p: GeocodeResult, sun: { lat: number; lon: number }): string {
  // yerel güneş yüksekliği — gündüz mü gece mi?
  const toRad = Math.PI / 180;
  const cosZ =
    Math.sin(p.lat * toRad) * Math.sin(sun.lat * toRad) +
    Math.cos(p.lat * toRad) * Math.cos(sun.lat * toRad) * Math.cos((p.lon - sun.lon) * toRad);
  const elevation = 90 - Math.acos(Math.max(-1, Math.min(1, cosZ))) / toRad;
  const phase =
    elevation > 0 ? t('place.day') : elevation > -6 ? t('place.civil') : elevation > -18 ? t('place.twilight') : t('place.night');
  const localTime = p.timezone
    ? new Date().toLocaleTimeString(locale, { timeZone: p.timezone, hour: '2-digit', minute: '2-digit' })
    : '—';
  return `
    <div class="d-kind" style="color:var(--accent)"><i style="background:var(--accent)"></i>${t('place.kind')}</div>
    <h2 class="d-title">${escapeHtml(p.name)}</h2>
    <div class="d-sub">${escapeHtml([p.admin1, p.country].filter(Boolean).join(', '))}</div>
    <dl class="d-grid">
      ${cell(t('common.lat'), formatLat(p.lat, 4))}
      ${cell(t('common.lon'), formatLon(p.lon, 4))}
      ${cell(t('place.elevation'), p.elevation !== null ? `${num(p.elevation)} m` : '—')}
      ${cell(t('place.population'), num(p.population))}
      ${cell(t('place.localTime'), `${localTime}${p.timezone ? ` · ${escapeHtml(p.timezone)}` : ''}`, true)}
      ${cell(t('place.sun'), `${num(elevation, 1)}° · ${phase}`, true)}
    </dl>
    <div class="d-source">${t('place.source')}</div>
  `;
}

// ---------------------------------------------------------------- geçiş tahmini

const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' });

export function renderPasses(obs: Observer | null, passes: Pass[] | null, orbitClass: string): string {
  const head = `<div class="d-section">${t('pass.heading')}</div>`;
  if (orbitClass === 'GEO') {
    return `${head}<p class="d-note">${t('pass.geo')}</p>`;
  }
  if (!obs) {
    return `${head}
      <p class="d-note">${t('pass.intro')}</p>
      <div class="d-actions"><button class="btn primary" data-action="locate">${t('pass.useLocation')}</button></div>
      <p class="d-note muted">${t('pass.orSearch')}</p>`;
  }
  const where = `<p class="d-note">${t('pass.observer')}: <strong>${escapeHtml(obs.name)}</strong> · <button class="link-btn" data-action="locate">${t('pass.useLocationLink')}</button></p>`;
  if (!passes || passes.length === 0) {
    return `${head}${where}<p class="d-note">${t('pass.none')}</p>`;
  }
  const next = passes.find((p) => p.visible);
  const hero = next
    ? `<div class="pass-hero">
        <span class="tag ok">${t('pass.visible')}</span>
        <strong>${dayFmt.format(next.max)} · ${timeFmt.format(next.start)}</strong>
        <span>${t('pass.path', {
          from: compass(next.startAzimuthDeg),
          max: num(next.maxElevationDeg),
          to: compass(next.endAzimuthDeg),
          min: num((next.end - next.start) / 60000),
        })}</span>
      </div>`
    : `<p class="d-note">${t('pass.noneVisible')}</p>`;
  const rows = passes
    .map(
      (p) => `<tr class="${p.visible ? 'vis' : ''}">
        <td>${dayFmt.format(p.start)}</td>
        <td>${timeFmt.format(p.start)}–${timeFmt.format(p.end)}</td>
        <td>${num(p.maxElevationDeg)}°</td>
        <td>${compass(p.startAzimuthDeg)}→${compass(p.endAzimuthDeg)}</td>
        <td>${p.visible ? '●' : ''}</td>
      </tr>`,
    )
    .join('');
  return `${head}${where}${hero}
    <table class="pass-table">
      <thead><tr><th>${t('pass.day')}</th><th>${t('pass.time')}</th><th>${t('pass.max')}</th><th>${t('pass.dir')}</th><th title="${t('pass.eye')}">👁</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="d-note muted">${t('pass.note')}</p>`;
}

// ---------------------------------------------------------------- tektonik plaka sınırı

export interface PlateBoundaryInfo {
  title: string;
  subduction: boolean;
  source: string;
  lengthKm: number;
  nearbyQuakes: number;
  strongest: { magnitude: number; place: string } | null;
  feedLabel: string;
  minMagnitude: number;
}

export function renderPlateBoundary(p: PlateBoundaryInfo): string {
  const color = p.subduction ? PLATE_COLORS.subduction : PLATE_COLORS.boundary;
  const filter = p.minMagnitude > 0 ? `, M${p.minMagnitude.toFixed(1)}+` : '';
  return `
    <div class="d-kind" style="color:${color}"><i style="background:${color}"></i>${t('plate.kind')}</div>
    <h2 class="d-title">${escapeHtml(p.title)}</h2>
    <div class="d-sub">${p.subduction ? t('plate.subZone') : t('plate.boundary')}</div>
    <p class="d-note">${p.subduction ? t('plate.subText') : t('plate.otherText')}</p>
    <div class="d-hero"><span class="big">${num(p.nearbyQuakes)}</span><span class="unit">${t('plate.nearby')}</span></div>
    <dl class="d-grid">
      ${cell(t('plate.length'), `${num(p.lengthKm)} km`)}
      ${cell(t('plate.type'), p.subduction ? t('plate.typeSub') : t('plate.typeOther'))}
      ${cell(t('plate.nearbyQuakes'), `${num(p.nearbyQuakes)} · ${escapeHtml(p.feedLabel)}${filter}`, true)}
      ${cell(t('plate.strongest'), p.strongest ? `M${p.strongest.magnitude.toFixed(1)} · ${escapeHtml(p.strongest.place)}` : '—', true)}
      ${cell(t('plate.study'), escapeHtml(p.source || '—'), true)}
    </dl>
    <div class="d-actions"><button class="btn" data-action="fly">${t('plate.goto')}</button></div>
    <div class="d-source">${t('plate.source')}</div>
  `;
}
