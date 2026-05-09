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
