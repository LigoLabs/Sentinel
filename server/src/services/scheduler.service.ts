import cron from 'node-cron';
import { schedulesRepo } from '../database/repositories/schedules.repository.js';
import { runBackup } from './backup.service.js';

// Chaque projet a deux tâches potentielles :
//  - disposable : sauvegardes avec rétention en jours (type 'daily' en BDD)
//  - lifetime   : snapshots conservés à vie (type 'monthly' en BDD)
interface ProjectTasks {
  disposable: cron.ScheduledTask | null;
  lifetime: cron.ScheduledTask | null;
}

const activeTasks = new Map<number, ProjectTasks>();

function stopProject(projectId: number): void {
  const existing = activeTasks.get(projectId);
  if (!existing) return;
  existing.disposable?.stop();
  existing.lifetime?.stop();
  activeTasks.delete(projectId);
}

function scheduleOne(
  cronExpression: string,
  projectId: number,
  projectName: string,
  type: 'daily' | 'monthly',
): cron.ScheduledTask | null {
  if (!cronExpression?.trim()) return null;
  if (!cron.validate(cronExpression)) {
    console.error(`[Scheduler] Invalid cron for "${projectName}" (${type}): ${cronExpression}`);
    return null;
  }
  const label = type === 'monthly' ? 'lifetime' : 'disposable';
  const task = cron.schedule(cronExpression, async () => {
    console.log(`[Scheduler] Starting ${label} backup for "${projectName}" (project ${projectId})`);
    try {
      const result = await runBackup(projectId, type);
      console.log(`[Scheduler] Backup ${result.backupId} completed: ${result.status} (${result.duration}ms)`);
    } catch (err) {
      console.error(`[Scheduler] Backup failed for "${projectName}":`, err);
    }
  });
  console.log(`[Scheduler] Scheduled "${projectName}" (${label}) with cron: ${cronExpression}`);
  return task;
}

function scheduleProject(
  projectId: number,
  cronDisposable: string,
  cronLifetime: string | null,
  projectName: string,
): void {
  stopProject(projectId);
  activeTasks.set(projectId, {
    disposable: scheduleOne(cronDisposable, projectId, projectName, 'daily'),
    lifetime: cronLifetime ? scheduleOne(cronLifetime, projectId, projectName, 'monthly') : null,
  });
}

export function initScheduler(): void {
  const schedules = schedulesRepo.findAllActive();
  console.log(`[Scheduler] Initializing ${schedules.length} schedule(s)`);

  for (const schedule of schedules) {
    scheduleProject(
      schedule.project_id,
      schedule.cron_expression,
      schedule.cron_lifetime,
      schedule.project_name,
    );
  }
}

export function reloadSchedule(projectId: number): void {
  stopProject(projectId);
  const schedules = schedulesRepo.findAllActive();
  const schedule = schedules.find((s) => s.project_id === projectId);
  if (schedule) {
    scheduleProject(
      schedule.project_id,
      schedule.cron_expression,
      schedule.cron_lifetime,
      schedule.project_name,
    );
  }
}

export function stopSchedule(projectId: number): void {
  if (activeTasks.has(projectId)) {
    stopProject(projectId);
    console.log(`[Scheduler] Stopped schedule for project ${projectId}`);
  }
}

export function getActiveScheduleCount(): number {
  return activeTasks.size;
}
