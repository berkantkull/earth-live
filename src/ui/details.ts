import type { SatRec } from '../lib/sgp4.ts';
import { formatLat, formatLon } from '../lib/geo.ts';
import { compass, escapeHtml, localString, num, relativeTime, utcString } from '../lib/format.ts';
import { orbitalElements, satelliteState } from '../lib/orbits.ts';
import type { Observer, Pass } from '../lib/passes.ts';
import { ALTITUDE_STOPS, DEPTH_STOPS, eventColor, FRP_STOPS, ORBIT_COLORS, PLATE_COLORS, stopColor } from '../lib/scales.ts';
import {
  EVENT_CATEGORIES,
  type Aircraft,
  type Earthquake,
  type Fire,
  type GeocodeResult,
  type NaturalEvent,
  type SatelliteTle,
} from '../lib/types.ts';

const cell = (label: string, value: string, wide = false) =>
  `<div${wide ? ' class="wide"' : ''}><dt>${label}</dt><dd>${value}</dd></div>`;

const ALERT_LABEL: Record<string, string> = { green: 'Yeşil', yellow: 'Sarı', orange: 'Turuncu', red: 'Kırmızı' };

/** Richter-benzeri açıklama — sismolojide yaygın sınıflandırma */
function magnitudeClass(m: number): string {
  if (m < 2) return 'Mikro';
  if (m < 4) return 'Küçük';
  if (m < 5) return 'Hafif';
  if (m < 6) return 'Orta';
  if (m < 7) return 'Güçlü';
  if (m < 8) return 'Büyük';
  return 'Çok büyük';
}

function depthClass(km: number): string {
  if (km < 70) return 'Sığ odaklı';
  if (km < 300) return 'Orta derinlik';
  return 'Derin odaklı';
}

export function renderEarthquake(q: Earthquake): string {
  const color = stopColor(DEPTH_STOPS, q.depthKm);
  // Gutenberg-Richter enerji bağıntısı: log10 E = 1.5 M + 4.8 (joule)
  const energyJ = Math.pow(10, 1.5 * q.magnitude + 4.8);
  const tntTons = energyJ / 4.184e9;
  const tags = [
    `<span class="tag">${magnitudeClass(q.magnitude)}</span>`,
    `<span class="tag">${depthClass(q.depthKm)}</span>`,
    q.tsunami ? '<span class="tag err">TSUNAMI UYARISI</span>' : '',
    q.alert ? `<span class="tag warn">PAGER: ${ALERT_LABEL[q.alert] ?? q.alert}</span>` : '',
    q.status === 'reviewed' ? '<span class="tag ok">İNCELENDİ</span>' : '<span class="tag">OTOMATİK</span>',
  ].join('');

  return `
    <div class="d-kind" style="color:${color}"><i style="background:${color}"></i>Sismik olay</div>
    <h2 class="d-title">${escapeHtml(q.place)}</h2>
    <div class="d-sub">${relativeTime(q.time)} · ${localString(q.time)}</div>
    <div class="d-hero"><span class="big">${q.magnitude.toFixed(1)}</span><span class="unit">${escapeHtml(q.magType ?? 'M')} büyüklük</span></div>
    <div class="d-tags">${tags}</div>
    <dl class="d-grid">
      ${cell('Enlem', formatLat(q.lat))}
      ${cell('Boylam', formatLon(q.lon))}
      ${cell('Odak derinliği', `${num(q.depthKm, 1)} km`)}
      ${cell('Önem (sig)', num(q.significance))}
      ${cell('Hissedildi', q.felt ? `${num(q.felt)} bildirim` : '—')}
      ${cell('Açığa çıkan enerji', `≈ ${tntTons >= 1000 ? `${num(tntTons / 1000, 1)} kt` : `${num(tntTons, 1)} t`} TNT`)}
      ${cell('Oluş zamanı (UTC)', utcString(q.time), true)}
      ${cell('Son güncelleme', `${relativeTime(q.updated)}`, true)}
    </dl>
    <div class="d-actions">
      <a class="btn primary" href="${escapeHtml(q.url)}" target="_blank" rel="noopener">USGS olay sayfası ↗</a>
      <button class="btn" data-action="fly">Konuma git</button>
    </div>
    <div class="d-source">Kaynak: USGS Earthquake Hazards Program · Olay kimliği ${escapeHtml(q.id)}</div>
  `;
}

export function renderAircraft(a: Aircraft, est: { lat: number; lon: number }, observedAt: number): string {
  const color = a.onGround ? ALTITUDE_STOPS[0].color : stopColor(ALTITUDE_STOPS, Math.max(1, a.altitudeM ?? 1));
  const kmh = a.velocity !== null ? a.velocity * 3.6 : null;
  const knots = a.velocity !== null ? a.velocity * 1.943844 : null;
  const ft = a.altitudeM !== null ? a.altitudeM * 3.28084 : null;
  const vr = a.verticalRate;
  const trend = vr === null ? '—' : Math.abs(vr) < 0.5 ? 'Seviye uçuş' : vr > 0 ? `↑ ${num(vr * 196.85)} ft/dk` : `↓ ${num(-vr * 196.85)} ft/dk`;
  const squawkTag =
    a.squawk === '7700' ? '<span class="tag err">7700 · ACİL DURUM</span>' :
    a.squawk === '7600' ? '<span class="tag warn">7600 · TELSİZ ARIZASI</span>' :
    a.squawk === '7500' ? '<span class="tag err">7500 · YASADIŞI MÜDAHALE</span>' : '';
  const callsign = a.callsign ?? a.icao24.toUpperCase();
  return `
    <div class="d-kind" style="color:${color}"><i style="background:${color}"></i>Hava aracı · ADS-B</div>
    <h2 class="d-title">${escapeHtml(callsign)}</h2>
    <div class="d-sub">${escapeHtml(a.country)} tescilli · ICAO24 ${escapeHtml(a.icao24.toUpperCase())}</div>
    <div class="d-hero"><span class="big">${a.onGround ? 'YER' : num(ft)}</span><span class="unit">${a.onGround ? 'yerde' : 'ft irtifa'}</span></div>
    <div class="d-tags">
      <span class="tag">${a.onGround ? 'YERDE' : 'HAVADA'}</span>
      ${squawkTag}
      ${a.squawk ? `<span class="tag">SQUAWK ${escapeHtml(a.squawk)}</span>` : ''}
    </div>
    <dl class="d-grid">
      ${cell('Tahmini enlem', formatLat(est.lat))}
      ${cell('Tahmini boylam', formatLon(est.lon))}
      ${cell('Yer hızı', kmh !== null ? `${num(kmh)} km/s · ${num(knots)} kt` : '—', true)}
      ${cell('Rota', a.heading !== null ? `${num(a.heading)}° ${compass(a.heading)}` : '—')}
      ${cell('Dikey hız', trend)}
      ${cell('Geometrik irtifa', a.altitudeM !== null ? `${num(a.altitudeM)} m` : '—')}
      ${cell('Barometrik irtifa', a.baroAltitudeM !== null ? `${num(a.baroAltitudeM)} m` : '—')}
      ${cell('Son konum raporu', relativeTime(a.positionTime * 1000, observedAt) + ' (ölçüm anına göre)', true)}
    </dl>
    <div class="d-actions">
      <a class="btn primary" href="https://globe.adsbexchange.com/?icao=${encodeURIComponent(a.icao24)}" target="_blank" rel="noopener">ADS-B Exchange ↗</a>
      <a class="btn" href="https://opensky-network.org/aircraft-profile?icao24=${encodeURIComponent(a.icao24)}" target="_blank" rel="noopener">OpenSky profili ↗</a>
      <button class="btn" data-action="fly">Takip et</button>
    </div>
    <div class="d-source">Kaynak: OpenSky Network · Konum, son rapordan itibaren hız ve rota ile ileri tahmin edilir (dead reckoning).</div>
  `;
}

export function renderSatellite(tle: SatelliteTle, rec: SatRec | null): string {
  if (!rec) {
    return `<h2 class="d-title">${escapeHtml(tle.name)}</h2><p>Bu uydunun TLE verisi çözümlenemedi.</p>`;
  }
  const el = orbitalElements(rec);
  const st = satelliteState(rec, new Date());
  const color = ORBIT_COLORS[el.orbitClass];
  const epochAgeDays = (Date.now() - el.epoch.getTime()) / 86400000;
  const classLabel = { LEO: 'Alçak Dünya yörüngesi', MEO: 'Orta Dünya yörüngesi', GEO: 'Yer eşzamanlı yörünge', HEO: 'Yüksek eliptik yörünge' }[el.orbitClass];
  const intl = tle.line1.slice(9, 17).trim();
  return `
    <div class="d-kind" style="color:${color}"><i style="background:${color}"></i>Yapay uydu · ${el.orbitClass}</div>
    <h2 class="d-title">${escapeHtml(tle.name)}</h2>
    <div class="d-sub">NORAD ${tle.norad}${intl ? ` · COSPAR ${escapeHtml(intl)}` : ''} · ${classLabel}</div>
    <div class="d-hero"><span class="big" data-live="sat-alt">${st ? num(st.altKm) : '—'}</span><span class="unit">km irtifa</span></div>
    <div class="d-tags">
      <span class="tag">${el.orbitClass}</span>
      ${epochAgeDays > 14 ? '<span class="tag warn">ESKİ TLE</span>' : '<span class="tag ok">GÜNCEL TLE</span>'}
      ${el.inclinationDeg > 96 && el.inclinationDeg < 102 && el.orbitClass === 'LEO' ? '<span class="tag">GÜNEŞ EŞZAMANLI</span>' : ''}
    </div>
    <dl class="d-grid">
      ${cell('Alt-uydu enlemi', `<span data-live="sat-lat">${st ? formatLat(st.lat) : '—'}</span>`)}
      ${cell('Alt-uydu boylamı', `<span data-live="sat-lon">${st ? formatLon(st.lon) : '—'}</span>`)}
      ${cell('Yörünge hızı', `<span data-live="sat-speed">${st ? `${num(st.speedKms, 2)} km/s` : '—'}</span>`)}
      ${cell('Periyot', `${num(el.periodMin, 1)} dk`)}
      ${cell('Eğim (inklinasyon)', `${num(el.inclinationDeg, 2)}°`)}
      ${cell('Dışmerkezlik', el.eccentricity.toFixed(5))}
      ${cell('Apoje', `${num(el.apogeeKm)} km`)}
      ${cell('Perije', `${num(el.perigeeKm)} km`)}
      ${cell('Yarı büyük eksen', `${num(el.semiMajorAxisKm)} km`)}
      ${cell('Günlük tur', num(1440 / el.periodMin, 2))}
      ${cell('TLE epoch', `${utcString(el.epoch.getTime())} (${relativeTime(el.epoch.getTime())})`, true)}
    </dl>
    <div id="passes"></div>
    <div class="d-section">İki satırlı element seti (TLE)</div>
    <div class="d-tle">${escapeHtml(tle.line1)}\n${escapeHtml(tle.line2)}</div>
    <div class="d-actions" style="margin-top:12px">
      <a class="btn primary" href="https://celestrak.org/satcat/table-satcat.php?CATNR=${tle.norad}" target="_blank" rel="noopener">CelesTrak SATCAT ↗</a>
      <a class="btn" href="https://www.n2yo.com/satellite/?s=${tle.norad}" target="_blank" rel="noopener">N2YO ↗</a>
      <button class="btn" data-action="fly">Takip et</button>
    </div>
    <div class="d-source">Kaynak: CelesTrak GP verisi · Konum SGP4 modeliyle tarayıcıda hesaplanır. Yörünge çizgisi: bir periyot (soluk = geçmiş).</div>
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
  if (frp < 10) return 'Düşük yoğunluk';
  if (frp < 50) return 'Orta yoğunluk';
  if (frp < 200) return 'Yüksek yoğunluk';
  return 'Çok yüksek yoğunluk';
}

export function renderFire(f: Fire): string {
  const color = stopColor(FRP_STOPS, f.frp);
  const conf = f.confidence >= 80 ? 'Yüksek' : f.confidence >= 30 ? 'Nominal' : 'Düşük';
  return `
    <div class="d-kind" style="color:${color}"><i style="background:${color}"></i>Aktif yangın · uydu tespiti</div>
    <h2 class="d-title">${formatLat(f.lat, 3)}, ${formatLon(f.lon, 3)}</h2>
    <div class="d-sub">${relativeTime(f.time)} · ${localString(f.time)}</div>
    <div class="d-hero"><span class="big">${num(f.frp, 1)}</span><span class="unit">MW ışınım gücü (FRP)</span></div>
    <div class="d-tags">
      <span class="tag">${frpClass(f.frp)}</span>
      <span class="tag">${f.day ? 'GÜNDÜZ GEÇİŞİ' : 'GECE GEÇİŞİ'}</span>
      <span class="tag ${f.confidence >= 80 ? 'ok' : f.confidence < 30 ? 'warn' : ''}">GÜVEN %${f.confidence}</span>
    </div>
    <dl class="d-grid">
      ${cell('Parlaklık sıcaklığı', `${num(f.brightness)} K · ${num(f.brightness - 273.15)} °C`, true)}
      ${cell('Tespit güveni', `${conf} (%${f.confidence})`)}
      ${cell('Uydu', `${f.satellite} · MODIS`)}
      ${cell('Tespit zamanı (UTC)', utcString(f.time), true)}
    </dl>
    <p class="d-note muted">FRP, yangının yaydığı ısı enerjisinin anlık ölçüsüdür; yanan biyokütle miktarıyla doğrudan ilişkilidir. Bir piksel yaklaşık 1 km² alanı temsil eder; tek bir yangın birden fazla tespit üretebilir. Sanayi tesisleri ve volkanlar da tespit edilebilir.</p>
    <div class="d-actions">
      <a class="btn primary" href="https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${f.lon.toFixed(3)},${f.lat.toFixed(3)},10.0z" target="_blank" rel="noopener">NASA FIRMS haritası ↗</a>
      <button class="btn" data-action="fly">Konuma git</button>
    </div>
    <div class="d-source">Kaynak: NASA FIRMS (Fire Information for Resource Management System) · MODIS Collection 6.1 NRT</div>
  `;
}

export function renderEvent(e: NaturalEvent): string {
  const color = eventColor(e.category);
  const moving = e.track.length > 1;
  const magnitude =
    e.magnitude !== null
      ? e.magnitudeUnit === 'kts'
        ? `${num(e.magnitude)} kt · ${num(e.magnitude * 1.852)} km/s`
        : e.magnitudeUnit === 'NM^2'
          ? `${num(e.magnitude, 1)} NM² · ${num(e.magnitude * 3.43)} km²`
          : `${num(e.magnitude, 1)} ${escapeHtml(e.magnitudeUnit ?? '')}`
      : null;
  const sources = e.sources
    .map((s) => `<a class="btn" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.id)} ↗</a>`)
    .join('');
  return `
    <div class="d-kind" style="color:${color}"><i style="background:${color}"></i>${EVENT_CATEGORIES[e.category]} · NASA EONET</div>
    <h2 class="d-title">${escapeHtml(e.title)}</h2>
    <div class="d-sub">Son gözlem ${relativeTime(e.date)} · ${localString(e.date)}</div>
    ${magnitude ? `<div class="d-hero"><span class="big">${magnitude.split(' · ')[0]}</span><span class="unit">${e.category === 'severeStorms' ? 'azami sürekli rüzgâr' : 'büyüklük'}</span></div>` : ''}
    <dl class="d-grid">
      ${cell('Enlem', formatLat(e.lat))}
      ${cell('Boylam', formatLon(e.lon))}
      ${magnitude ? cell('Büyüklük', magnitude, true) : ''}
      ${cell('İlk gözlem', `${localString(e.start)} (${relativeTime(e.start)})`, true)}
      ${moving ? cell('İz', `${e.track.length} gözlem noktası · haritada çizgi olarak gösteriliyor`, true) : ''}
    </dl>
    <div class="d-actions">${sources}<button class="btn" data-action="fly">Konuma git</button></div>
    <div class="d-source">Kaynak: NASA Earth Observatory Natural Event Tracker (EONET) · ${escapeHtml(e.id)}</div>
  `;
}

export function renderPlace(p: GeocodeResult, sun: { lat: number; lon: number }): string {
  // yerel güneş yüksekliği — gündüz mü gece mi?
  const toRad = Math.PI / 180;
  const cosZ =
    Math.sin(p.lat * toRad) * Math.sin(sun.lat * toRad) +
    Math.cos(p.lat * toRad) * Math.cos(sun.lat * toRad) * Math.cos((p.lon - sun.lon) * toRad);
  const elevation = 90 - Math.acos(Math.max(-1, Math.min(1, cosZ))) / toRad;
  const phase = elevation > 0 ? 'Gündüz' : elevation > -6 ? 'Sivil alacakaranlık' : elevation > -18 ? 'Alacakaranlık' : 'Gece';
  const localTime = p.timezone
    ? new Date().toLocaleTimeString('tr-TR', { timeZone: p.timezone, hour: '2-digit', minute: '2-digit' })
    : '—';
  return `
    <div class="d-kind" style="color:var(--accent)"><i style="background:var(--accent)"></i>Konum</div>
    <h2 class="d-title">${escapeHtml(p.name)}</h2>
    <div class="d-sub">${escapeHtml([p.admin1, p.country].filter(Boolean).join(', '))}</div>
    <dl class="d-grid">
      ${cell('Enlem', formatLat(p.lat, 4))}
      ${cell('Boylam', formatLon(p.lon, 4))}
      ${cell('Yükselti', p.elevation !== null ? `${num(p.elevation)} m` : '—')}
      ${cell('Nüfus', num(p.population))}
      ${cell('Yerel saat', `${localTime}${p.timezone ? ` · ${escapeHtml(p.timezone)}` : ''}`, true)}
      ${cell('Güneş yüksekliği', `${num(elevation, 1)}° · ${phase}`, true)}
    </dl>
    <div class="d-source">Kaynak: Open-Meteo Geocoding API (GeoNames)</div>
  `;
}

// ---------------------------------------------------------------- geçiş tahmini

const timeFmt = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' });

export function renderPasses(obs: Observer | null, passes: Pass[] | null, orbitClass: string): string {
  const head = '<div class="d-section">Gökyüzünden görünüm</div>';
  if (orbitClass === 'GEO') {
    return `${head}<p class="d-note">Yer eşzamanlı uydular Dünya ile birlikte döner; gökyüzünde hep aynı noktada durur, "geçiş" yapmaz.</p>`;
  }
  if (!obs) {
    return `${head}
      <p class="d-note">Bu uydunun bulunduğunuz yerin üzerinden ne zaman geçeceğini ve çıplak gözle görünüp görünmeyeceğini hesaplayalım.</p>
      <div class="d-actions"><button class="btn primary" data-action="locate">Konumumu kullan</button></div>
      <p class="d-note muted">ya da yukarıdan bir şehir arayın.</p>`;
  }
  const where = `<p class="d-note">Gözlem yeri: <strong>${escapeHtml(obs.name)}</strong> · <button class="link-btn" data-action="locate">konumumu kullan</button></p>`;
  if (!passes || passes.length === 0) {
    return `${head}${where}<p class="d-note">Önümüzdeki 3 gün içinde ufkun 10° üstüne çıkan bir geçiş yok.</p>`;
  }
  const nextVisible = passes.find((p) => p.visible);
  const hero = nextVisible
    ? `<div class="pass-hero">
        <span class="tag ok">ÇIPLAK GÖZLE GÖRÜNÜR</span>
        <strong>${dayFmt.format(nextVisible.max)} · ${timeFmt.format(nextVisible.start)}</strong>
        <span>${compass(nextVisible.startAzimuthDeg)} yönünden doğar, en fazla <b>${num(nextVisible.maxElevationDeg)}°</b> yükselir,
        ${compass(nextVisible.endAzimuthDeg)} yönünde kaybolur · ${num((nextVisible.end - nextVisible.start) / 60000)} dk</span>
      </div>`
    : '<p class="d-note">Aşağıdaki geçişlerin hiçbiri çıplak gözle görülemiyor (uydu ya gündüz geçiyor ya da Dünya\'nın gölgesinde kalıyor).</p>';
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
      <thead><tr><th>Gün</th><th>Saat</th><th>Tepe</th><th>Yön</th><th title="Çıplak gözle görünür">👁</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="d-note muted">Saatler cihazınızın saat diliminde. Görünürlük: gökyüzü karanlık ve uydu Güneş ışığı alıyor.</p>`;
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
  const kind = p.subduction
    ? 'Dalma-batma zonu: plakalardan biri diğerinin altına dalarak mantoya iniyor. Dünyadaki en büyük depremlerin ve volkanların çoğu bu kuşaklarda oluşur.'
    : 'Plakaların yan yana kaydığı (yanal atımlı fay), birbirinden uzaklaştığı (okyanus ortası sırtı) ya da çarpıştığı bir sınır.';
  const filter = p.minMagnitude > 0 ? `, M${p.minMagnitude.toFixed(1)}+` : '';
  return `
    <div class="d-kind" style="color:${color}"><i style="background:${color}"></i>Tektonik plaka sınırı</div>
    <h2 class="d-title">${escapeHtml(p.title)}</h2>
    <div class="d-sub">${p.subduction ? 'Dalma-batma zonu' : 'Plaka sınırı'}</div>
    <p class="d-note">${kind}</p>
    <div class="d-hero"><span class="big">${num(p.nearbyQuakes)}</span><span class="unit">deprem, sınıra 100 km içinde</span></div>
    <dl class="d-grid">
      ${cell('Sınır uzunluğu', `${num(p.lengthKm)} km`)}
      ${cell('Tür', p.subduction ? 'Dalma-batma' : 'Diğer')}
      ${cell('Yakın depremler', `${num(p.nearbyQuakes)} · ${escapeHtml(p.feedLabel)}${filter}`, true)}
      ${cell('En büyüğü', p.strongest ? `M${p.strongest.magnitude.toFixed(1)} · ${escapeHtml(p.strongest.place)}` : '—', true)}
      ${cell('Sınırı tanımlayan çalışma', escapeHtml(p.source || '—'), true)}
    </dl>
    <div class="d-actions"><button class="btn" data-action="fly">Sınıra git</button></div>
    <div class="d-source">Kaynak: Bird, P. (2003) "An updated digital model of plate boundaries", Geochemistry, Geophysics, Geosystems 4(3) — PB2002 modeli (ODC-By 1.0).</div>
  `;
}
