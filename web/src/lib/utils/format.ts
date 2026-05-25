import { i18n } from '$lib/i18n/index.svelte';
import type { TranslationKey } from '$lib/i18n/dict';

/**
 * Format a byte count as a human-readable string with French-style decimal comma.
 * "0 B", "423 B", "12,4 Ko", "4,2 Go", etc.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(Math.abs(bytes)) / Math.log(k)));
  const value = bytes / Math.pow(k, i);
  const str = value >= 100 ? value.toFixed(0) : value.toFixed(1);
  return str.replace('.', ',') + ' ' + sizes[i];
}

/**
 * Format a number with a French thousands separator (narrow no-break space).
 */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat('fr-FR').format(n);
}

/**
 * Return the basename (without extension) of a backup file_path, with cross-platform
 * path handling. Returns `backup_<id>` as fallback.
 */
export function backupBasename(filePath: string | null, id: number): string {
  if (!filePath) return `backup_${id}`;
  const parts = filePath.replace(/\\/g, '/').split('/');
  const name = parts[parts.length - 1] || `backup_${id}`;
  return name.replace(/\.zip$/i, '');
}

/**
 * Localized label for a backup's retention type. The internal values stay
 * 'daily' / 'monthly' / 'manual' (DB + cron logic), but the UI speaks in terms
 * of retention: temporaire (gets pruned) / permanente (kept forever) / manuelle.
 * Falls back to the raw type for unknown values.
 */
export function backupTypeLabel(type: string): string {
  const key = `backup.type.${type}` as TranslationKey;
  const label = i18n.t(key);
  return label === key ? type : label;
}
