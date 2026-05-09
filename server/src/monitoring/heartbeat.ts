import cron from 'node-cron';
import { config } from '../config.js';

let heartbeatTask: cron.ScheduledTask | null = null;

async function ping(suffix = ''): Promise<void> {
  const url = config.HEALTHCHECKS_PING_URL;
  if (!url) return;

  try {
    await fetch(`${url}${suffix}`, { method: 'GET', signal: AbortSignal.timeout(10000) });
  } catch (err) {
    console.error('[Heartbeat] Ping failed:', err);
  }
}

export function startHeartbeat(): void {
  if (!config.HEALTHCHECKS_PING_URL) {
    console.log('[Heartbeat] No HEALTHCHECKS_PING_URL configured, skipping');
    return;
  }

  ping();

  heartbeatTask = cron.schedule('*/5 * * * *', () => {
    ping();
  });

  console.log('[Heartbeat] Monitoring active, pinging every 5 minutes');
}

/** Stop and re-evaluate heartbeat after config change. */
export function reloadHeartbeat(): void {
  stopHeartbeat();
  startHeartbeat();
}

export async function pingBackupStart(): Promise<void> {
  await ping('/start');
}

export async function pingBackupSuccess(): Promise<void> {
  await ping();
}

export async function pingBackupFailure(): Promise<void> {
  await ping('/fail');
}

export function stopHeartbeat(): void {
  if (heartbeatTask) {
    heartbeatTask.stop();
    heartbeatTask = null;
  }
}
