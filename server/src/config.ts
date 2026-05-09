import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { ensureSecrets } from './bootstrap.js';

const PROJECT_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

ensureSecrets();
dotenv.config({ path: resolve(PROJECT_ROOT, '.env') });

function resolvePath(envValue: string | undefined, fallback: string): string {
  const raw = envValue || fallback;
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) return raw;
  return resolve(PROJECT_ROOT, raw);
}

export interface Config {
  NODE_ENV: string;
  PORT: number;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  ADMIN_PASSWORD: string;
  DATA_DIR: string;
  BACKUP_DIR: string;
  LOG_LEVEL: string;
  HEALTHCHECKS_PING_URL: string;
  SMTP_ENABLED: boolean;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_SECURE: boolean;
  SMTP_USER: string;
  SMTP_PASS: string;
  SMTP_FROM: string;
  SMTP_FROM_NAME: string;
  ALERT_EMAIL: string;
}

function buildConfig(): Config {
  return {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: parseInt(process.env.PORT || '8082', 10),
    JWT_SECRET: process.env.JWT_SECRET as string,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY as string,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'sentinel',
    DATA_DIR: resolvePath(process.env.DATA_DIR, './data'),
    BACKUP_DIR: resolvePath(process.env.BACKUP_DIR, './data/backups'),
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    HEALTHCHECKS_PING_URL: process.env.HEALTHCHECKS_PING_URL || '',
    SMTP_ENABLED: process.env.SMTP_ENABLED === 'true',
    SMTP_HOST: process.env.SMTP_HOST || '',
    SMTP_PORT: parseInt(process.env.SMTP_PORT || '465', 10),
    SMTP_SECURE: process.env.SMTP_SECURE !== 'false',
    SMTP_USER: process.env.SMTP_USER || '',
    SMTP_PASS: process.env.SMTP_PASS || '',
    SMTP_FROM: process.env.SMTP_FROM || '',
    SMTP_FROM_NAME: process.env.SMTP_FROM_NAME || 'Sentinel',
    ALERT_EMAIL: process.env.ALERT_EMAIL || '',
  };
}

export const config: Config = buildConfig();

/** Re-read config from process.env. Call after process.env was updated. */
export function reloadConfig(): void {
  Object.assign(config, buildConfig());
}

export function ensureDirectories(): void {
  const dirs = [config.DATA_DIR, config.BACKUP_DIR];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

export const ENV_PATH = resolve(PROJECT_ROOT, '.env');
