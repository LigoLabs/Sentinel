import { ApiError } from '$lib/api';
import { i18n } from './index.svelte';
import type { TranslationKey } from './dict';

/**
 * Translate an error thrown anywhere in the app. Recognised codes from the
 * backend are translated via the i18n dictionary; everything else falls back
 * to the message provided by the backend (or a generic localized string).
 */
export function translateError(err: unknown): string {
  if (err instanceof ApiError) {
    const key = `error.${err.code}` as TranslationKey;
    const translated = i18n.t(key);
    if (translated !== key) return translated;
    if (err.message) return err.message;
    return i18n.t('error.unknown');
  }
  if (err instanceof Error) return err.message;
  return i18n.t('error.unknown');
}
