import { i18n } from '$lib/i18n/index.svelte';

function toUtcDate(dateStr: string): Date {
  const s = dateStr.trim();
  if (s.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(s)) return new Date(s);
  return new Date(s + 'Z');
}

export function formatDate(dateStr: string): string {
  return toUtcDate(dateStr).toLocaleString(i18n.locale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateFull(dateStr: string): string {
  return toUtcDate(dateStr).toLocaleString(i18n.locale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const RELATIVE_UNITS: { limit: number; div: number; fr: [string, string]; en: [string, string] }[] = [
  { limit: 60, div: 1, fr: ['s', 's'], en: ['s', 's'] },
  { limit: 60 * 60, div: 60, fr: ['min', 'min'], en: ['min', 'min'] },
  { limit: 60 * 60 * 24, div: 60 * 60, fr: ['h', 'h'], en: ['h', 'h'] },
  { limit: 60 * 60 * 24 * 30, div: 60 * 60 * 24, fr: ['j', 'j'], en: ['d', 'd'] },
  { limit: 60 * 60 * 24 * 365, div: 60 * 60 * 24 * 30, fr: ['mois', 'mois'], en: ['mo', 'mo'] },
  { limit: Infinity, div: 60 * 60 * 24 * 365, fr: ['an', 'ans'], en: ['y', 'y'] },
];

/**
 * Returns a compact relative time like "il y a 4 h" / "il y a 12 j".
 * Negative diffs (future) become "dans X".
 */
export function formatRelative(dateStr: string): string {
  const lang = i18n.locale().startsWith('fr') ? 'fr' : 'en';
  const now = Date.now();
  const then = toUtcDate(dateStr).getTime();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  const future = then > now;
  const absSec = Math.abs(Math.floor((now - then) / 1000));

  if (absSec < 30) return lang === 'fr' ? "à l'instant" : 'just now';

  for (const u of RELATIVE_UNITS) {
    if (absSec < u.limit) {
      const n = Math.floor(absSec / u.div);
      const label = n > 1 ? u[lang][1] : u[lang][0];
      if (future) return lang === 'fr' ? `dans ${n} ${label}` : `in ${n}${label}`;
      return lang === 'fr' ? `il y a ${n} ${label}` : `${n}${label} ago`;
    }
  }
  return formatDate(dateStr);
}

/**
 * Duration between two ISO date strings, formatted as "62 s", "2 min 14 s",
 * "1 h 04 min 32 s". Returns "—" if either date is missing/invalid.
 */
export function formatDuration(startedAt: string | null | undefined, completedAt: string | null | undefined): string {
  if (!startedAt || !completedAt) return '—';
  const s = toUtcDate(startedAt).getTime();
  const e = toUtcDate(completedAt).getTime();
  const ms = e - s;
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return formatDurationMs(ms);
}

export function formatDurationMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min ${String(s).padStart(2, '0')} s`;
  if (m > 0) return `${m} min ${String(s).padStart(2, '0')} s`;
  return `${s} s`;
}

export function formatDurationCompact(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total} s`;
  if (total < 3600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return s ? `${m} min ${s} s` : `${m} min`;
  }
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}
