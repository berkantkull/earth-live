import { lang, locale, t, type Key } from '../i18n.ts';

const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
const nf = new Intl.NumberFormat(locale);

export function relativeTime(ts: number, now = Date.now()): string {
  const diff = (ts - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 5) return t('common.now');
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export function utcString(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

export function localString(ts: number): string {
  return new Date(ts).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'medium' });
}

export function num(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return digits === 0 ? nf.format(Math.round(n)) : n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Pusula yönü (8 bölge), arayüz dilinde */
export function compass(deg: number): string {
  return t(`dir.${DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]}` as Key);
}
