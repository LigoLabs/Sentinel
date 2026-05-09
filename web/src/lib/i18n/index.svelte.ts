import { browser } from '$app/environment';
import { dict, LANGUAGES, type Lang, type TranslationKey } from './dict.js';

const STORAGE_KEY = 'sentinel.lang';
const FALLBACK_LANG: Lang = 'en';
const DEFAULT_LANG: Lang = 'en';

function detectInitial(): Lang {
  if (!browser) return FALLBACK_LANG;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'fr' || stored === 'en') return stored;
  } catch { /* ignore */ }

  const candidates = navigator.languages && navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language || ''];

  for (const raw of candidates) {
    const code = raw.slice(0, 2).toLowerCase();
    if (code === 'fr') return 'fr';
  }
  return 'en';
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? `{${key}}` : String(v);
  });
}

function lookup(lang: Lang, key: string): string | undefined {
  return (dict[lang] as Record<string, string>)[key];
}

function createI18n() {
  const initial = detectInitial();
  let lang = $state<Lang>(initial);

  if (browser) {
    document.documentElement.lang = initial;
  }

  function setLang(next: Lang): void {
    lang = next;
    if (browser) {
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
      document.documentElement.lang = next;
    }
  }

  function t(key: TranslationKey, vars?: Record<string, string | number>): string {
    const raw = lookup(lang, key) ?? lookup(DEFAULT_LANG, key) ?? key;
    return interpolate(raw, vars);
  }

  /** Plural helper: looks up `${key}_one` or `${key}_other` based on n. */
  function tn(key: string, n: number, vars?: Record<string, string | number>): string {
    const suffix = n === 1 ? '_one' : '_other';
    const raw = lookup(lang, key + suffix) ?? lookup(DEFAULT_LANG, key + suffix) ?? key + suffix;
    return interpolate(raw, { n, ...(vars || {}) });
  }

  function locale(): string {
    return lang === 'fr' ? 'fr-FR' : 'en-US';
  }

  return {
    get lang() { return lang; },
    setLang,
    t,
    tn,
    locale,
    languages: LANGUAGES,
  };
}

export const i18n = createI18n();
export type { Lang, TranslationKey } from './dict.js';
