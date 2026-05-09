import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const ENV_PATH = resolve(PROJECT_ROOT, '.env');
const ENV_EXAMPLE_PATH = resolve(PROJECT_ROOT, '.env.example');

const PLACEHOLDERS = new Set([
  '',
  'change-me',
  'change-me-in-production',
  'change-me-generate-a-random-string',
  'change-me-generate-a-64-char-hex-string',
]);

function generateHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

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

function setEnvValue(content: string, key: string, value: string): string {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) {
    return content.replace(re, `${key}=${value}`);
  }
  const sep = content.endsWith('\n') || content.length === 0 ? '' : '\n';
  return `${content}${sep}${key}=${value}\n`;
}

export function ensureSecrets(): { generated: string[] } {
  if (!existsSync(ENV_PATH)) {
    if (existsSync(ENV_EXAMPLE_PATH)) {
      copyFileSync(ENV_EXAMPLE_PATH, ENV_PATH);
      console.log('[bootstrap] .env created from .env.example');
    } else {
      writeFileSync(ENV_PATH, '');
      console.log('[bootstrap] .env created (empty)');
    }
  }

  let content = readFileSync(ENV_PATH, 'utf8');
  const env = parseEnv(content);
  const generated: string[] = [];

  const jwt = env.get('JWT_SECRET');
  if (jwt === undefined || PLACEHOLDERS.has(jwt)) {
    const value = generateHex(32);
    content = setEnvValue(content, 'JWT_SECRET', value);
    process.env.JWT_SECRET = value;
    generated.push('JWT_SECRET');
  }

  const enc = env.get('ENCRYPTION_KEY');
  if (enc === undefined || PLACEHOLDERS.has(enc) || enc.length !== 64) {
    const value = generateHex(32);
    content = setEnvValue(content, 'ENCRYPTION_KEY', value);
    process.env.ENCRYPTION_KEY = value;
    generated.push('ENCRYPTION_KEY');
  }

  if (generated.length > 0) {
    writeFileSync(ENV_PATH, content);
    console.log(`[bootstrap] Generated and persisted: ${generated.join(', ')}`);
  }

  return { generated };
}
