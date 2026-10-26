/** Önemli deprem uyarısı: hangi deprem için bildirim gösterileceğine karar verir. Saf mantık. */
import type { Earthquake } from './types.ts';

/** Bu büyüklükten itibaren uyarı gösterilir */
export const ALERT_MIN_MAGNITUDE = 6;
/** Yalnızca bu kadar yeni depremler için uyarı (ms) */
export const ALERT_WINDOW_MS = 60 * 60_000;

export type AlertLevel = 'tsunami' | 'major' | 'strong';

export interface QuakeAlert {
  quake: Earthquake;
  level: AlertLevel;
}

export function alertLevel(q: Earthquake): AlertLevel | null {
  if (q.tsunami) return 'tsunami';
  if (q.magnitude >= 7) return 'major';
  if (q.magnitude >= ALERT_MIN_MAGNITUDE) return 'strong';
  return null;
}

/**
 * Gösterilecek uyarı: son bir saatteki, daha önce gösterilmemiş, uyarı eşiğini geçen depremlerden
 * en önemlisi (tsunami > M7+ > M6+, eşitse en büyük, o da eşitse en yeni).
 */
export function pickAlert(quakes: readonly Earthquake[], now: number, seen: ReadonlySet<string>): QuakeAlert | null {
  const rank: Record<AlertLevel, number> = { tsunami: 3, major: 2, strong: 1 };
  let best: QuakeAlert | null = null;
  for (const q of quakes) {
    if (seen.has(q.id) || now - q.time > ALERT_WINDOW_MS || q.time > now + 60_000) continue;
    const level = alertLevel(q);
    if (!level) continue;
    if (
      !best ||
      rank[level] > rank[best.level] ||
      (rank[level] === rank[best.level] &&
        (q.magnitude > best.quake.magnitude || (q.magnitude === best.quake.magnitude && q.time > best.quake.time)))
    ) {
      best = { quake: q, level };
    }
  }
  return best;
}
