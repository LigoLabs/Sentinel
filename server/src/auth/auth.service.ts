import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

function hash(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function verifyPassword(password: string): boolean {
  if (typeof password !== 'string') return false;
  const provided = hash(password);
  const expected = hash(config.ADMIN_PASSWORD);
  return timingSafeEqual(provided, expected);
}
