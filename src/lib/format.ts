/** Presentation helpers shared across views. */

const BYTE_UNITS = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ', 'ПБ'];

/** Human-readable byte count. `1536` becomes `1.5 КБ`. */
export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return `0 ${BYTE_UNITS[0]}`;

  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  // Whole units read better without a decimal point.
  const digits = exponent === 0 ? 0 : fractionDigits;
  return `${value.toFixed(digits)} ${BYTE_UNITS[exponent]}`;
}

/** Per-second throughput, e.g. `2.4 МБ/с`. */
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/с`;
}

/** Elapsed time as `1:02:03`, or `02:03` under an hour. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';

  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Absolute date for a unix-seconds timestamp. */
export function formatDate(unixSeconds: number, locale = 'ru-RU'): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Coarse "time ago" for last-updated stamps. */
export function formatRelative(unixSeconds: number, locale = 'ru-RU'): string {
  const deltaSeconds = unixSeconds - Date.now() / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
  ];

  let value = deltaSeconds;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return rtf.format(Math.round(value), unit);
    value /= size;
  }
  return rtf.format(Math.round(value), 'year');
}

/** Days remaining until a subscription expires; negative once past. */
export function daysUntil(unixSeconds: number): number {
  return Math.ceil((unixSeconds - Date.now() / 1000) / 86400);
}

/** Bucket a latency into a quality band the palette keys off. */
export function latencyBand(ms: number | null | undefined): 'good' | 'fair' | 'poor' | 'none' {
  if (ms === null || ms === undefined) return 'none';
  if (ms < 200) return 'good';
  if (ms < 600) return 'fair';
  return 'poor';
}

/**
 * Two-letter country code guessed from a node name.
 *
 * Panels almost always prefix names with a flag emoji or a country code, so
 * this turns the common cases into a badge without pretending to be geo-IP.
 */
export function guessRegion(name: string): string | null {
  const flag = name.match(/\p{Regional_Indicator}{2}/u)?.[0];
  if (flag) {
    return [...flag]
      .map((c) => String.fromCharCode(c.codePointAt(0)! - 0x1f1e6 + 65))
      .join('');
  }

  const code = name.match(/\b([A-Z]{2})\b/)?.[1];
  return code ?? null;
}
