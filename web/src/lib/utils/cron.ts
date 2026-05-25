import { i18n } from '$lib/i18n/index.svelte';

// ---------- Cron utilities (without external lib) ----------
// Parse simple cron expressions: "m h * * *", "m h * * D", "m h D * *".
export interface ParsedCron {
  minute: number;
  hour: number;
  dom: number | '*';
  dow: number | '*';
}

export function parseCron(cron: string): ParsedCron | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [mStr, hStr, dStr, , wStr] = parts;
  const minute = Number(mStr);
  const hour = Number(hStr);
  if (!Number.isFinite(minute) || !Number.isFinite(hour)) return null;
  const dom = dStr === '*' ? '*' : Number(dStr);
  const dow = wStr === '*' ? '*' : Number(wStr);
  if (dom !== '*' && !Number.isFinite(dom)) return null;
  if (dow !== '*' && !Number.isFinite(dow)) return null;
  return { minute, hour, dom, dow };
}

/**
 * Cron expression → plain sentence (FR/EN depending on the active locale).
 * Falls back to the raw cron string when the shape isn't recognized.
 */
export function humanCron(cron: string | undefined): string {
  if (!cron) return '—';
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [mStr, hStr, dStr, moStr, wStr] = parts;
  const minute = Number(mStr);

  // "*/N" on hours → every N hours
  const everyH = hStr.match(/^\*\/(\d+)$/);
  if (everyH && mStr === '0' && dStr === '*' && moStr === '*' && wStr === '*') {
    return i18n.t('project.cron.every_h', { n: everyH[1] });
  }
  // Hour list "0,12" → every day at 00h00, 12h00
  if (/^\d+(,\d+)+$/.test(hStr) && Number.isFinite(minute) && dStr === '*' && moStr === '*' && wStr === '*') {
    const times = hStr.split(',').map((h) => `${h.padStart(2, '0')}h${String(minute).padStart(2, '0')}`);
    return i18n.t('project.cron.times_at', { times: times.join(', ') });
  }

  const c = parseCron(cron);
  if (!c) return cron;
  const hm = `${String(c.hour).padStart(2, '0')}h${String(c.minute).padStart(2, '0')}`;

  // A specific month is targeted → yearly (e.g. 0 3 1 1 * = January 1st)
  if (moStr !== '*' && Number.isFinite(Number(moStr)) && c.dom !== '*') {
    const monthsFr = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    const monthsEn = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const months = i18n.locale().startsWith('fr') ? monthsFr : monthsEn;
    return i18n.t('project.cron.yearly_at', { d: String(c.dom), month: months[Number(moStr)] ?? moStr, h: hm });
  }

  if (c.dom === '*' && c.dow === '*') return i18n.t('project.cron.daily_at', { h: hm });
  if (c.dom !== '*') return i18n.t('project.cron.monthly_at', { d: String(c.dom), h: hm });
  if (c.dow !== '*') {
    const days = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
    return i18n.t('project.cron.weekly_at', { day: days[c.dow as number] ?? String(c.dow), h: hm });
  }
  return cron;
}
