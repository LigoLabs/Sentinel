import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ENV_PATH, reloadConfig } from '../config.js';
import { resetEmailTransporter } from './email.service.js';
import { reloadHeartbeat } from '../monitoring/heartbeat.js';

export type EnvCategory = 'editable' | 'secret' | 'readonly';

export interface EnvKeyDescriptor {
  key: string;
  category: EnvCategory;
  /** Hide value from the API response (still allows updates if editable). */
  sensitive?: boolean;
  /** Services to hot-reload after this key changes. */
  reload?: ('email' | 'heartbeat' | 'config')[];
}

export const ENV_SCHEMA: EnvKeyDescriptor[] = [
  // Read-only — set via process env / docker, not editable from UI
  { key: 'NODE_ENV', category: 'readonly' },
  { key: 'PORT', category: 'readonly' },
  { key: 'DATA_DIR', category: 'readonly' },
  { key: 'BACKUP_DIR', category: 'readonly' },
  { key: 'LOG_LEVEL', category: 'readonly' },

  // Secrets — never editable from UI, value masked in API
  { key: 'JWT_SECRET', category: 'secret', sensitive: true },
  { key: 'ENCRYPTION_KEY', category: 'secret', sensitive: true },
  { key: 'ADMIN_PASSWORD', category: 'secret', sensitive: true },

  // Editable
  { key: 'HEALTHCHECKS_PING_URL', category: 'editable', reload: ['heartbeat', 'config'] },
  { key: 'SMTP_ENABLED', category: 'editable', reload: ['email', 'config'] },
  { key: 'SMTP_HOST', category: 'editable', reload: ['email', 'config'] },
  { key: 'SMTP_PORT', category: 'editable', reload: ['email', 'config'] },
  { key: 'SMTP_SECURE', category: 'editable', reload: ['email', 'config'] },
  { key: 'SMTP_USER', category: 'editable', reload: ['email', 'config'] },
  { key: 'SMTP_PASS', category: 'editable', sensitive: true, reload: ['email', 'config'] },
  { key: 'SMTP_FROM', category: 'editable', reload: ['email', 'config'] },
  { key: 'SMTP_FROM_NAME', category: 'editable', reload: ['email', 'config'] },
  { key: 'ALERT_EMAIL', category: 'editable', reload: ['config'] },
];

const SCHEMA_BY_KEY = new Map(ENV_SCHEMA.map((d) => [d.key, d]));

function maskValue(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return `${value.slice(0, 2)}${'•'.repeat(Math.min(value.length - 4, 12))}${value.slice(-2)}`;
}

/** Parse a raw .env file content into a key=value map. */
function parseEnv(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    map.set(key, value);
  }
  return map;
}

/** Replace or append a key in raw .env content while preserving comments and order. */
function setEnvLine(content: string, key: string, value: string): string {
  const escaped = value.replace(/\n/g, '\\n');
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) return content.replace(re, `${key}=${escaped}`);
  const sep = content.length === 0 || content.endsWith('\n') ? '' : '\n';
  return `${content}${sep}${key}=${escaped}\n`;
}

export interface EnvKeyView {
  key: string;
  category: EnvCategory;
  sensitive: boolean;
  /** Real value (omitted for sensitive keys). */
  value?: string;
  /** Masked preview (e.g. "ab••••cd") — always present even for sensitive values. */
  preview: string;
  /** True when a non-empty value is set. */
  isSet: boolean;
}

/** Read .env and return a categorized view, masking sensitive values. */
export function readEnvView(): EnvKeyView[] {
  const content = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const env = parseEnv(content);
  return ENV_SCHEMA.map((descriptor) => {
    const raw = env.get(descriptor.key) ?? '';
    const isSet = raw.length > 0;
    const sensitive = !!descriptor.sensitive;
    return {
      key: descriptor.key,
      category: descriptor.category,
      sensitive,
      value: sensitive ? undefined : raw,
      preview: sensitive ? (isSet ? maskValue(raw) : '') : raw,
      isSet,
    };
  });
}

export interface UpdateResult {
  updated: string[];
  reloaded: string[];
}

/**
 * Update one or more editable keys, persist to .env, sync process.env, and
 * hot-reload affected services. Throws if any key is not editable.
 */
export async function updateEnv(updates: Record<string, string>): Promise<UpdateResult> {
  const reloads = new Set<'email' | 'heartbeat' | 'config'>();
  const updated: string[] = [];

  for (const key of Object.keys(updates)) {
    const descriptor = SCHEMA_BY_KEY.get(key);
    if (!descriptor) throw new Error(`Unknown env key: ${key}`);
    if (descriptor.category !== 'editable') {
      throw new Error(`Env key not editable: ${key}`);
    }
  }

  let content = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';

  for (const [key, value] of Object.entries(updates)) {
    content = setEnvLine(content, key, value);
    process.env[key] = value;
    updated.push(key);
    const descriptor = SCHEMA_BY_KEY.get(key)!;
    for (const r of descriptor.reload ?? []) reloads.add(r);
  }

  writeFileSync(ENV_PATH, content);

  if (reloads.has('config')) reloadConfig();
  if (reloads.has('email')) resetEmailTransporter();
  if (reloads.has('heartbeat')) reloadHeartbeat();

  return { updated, reloaded: [...reloads] };
}
