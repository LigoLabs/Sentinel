import cron from 'node-cron';
import { schedulesRepo } from '../database/repositories/schedules.repository.js';
import { runBackup } from './backup.service.js';

const activeTasks = new Map<number, cron.ScheduledTask>();

function getBackupType(): 'daily' | 'monthly' {
  const today = new Date();
  return today.getDate() === 1 ? 'monthly' : 'daily';
}

function scheduleProject(projectId: number, cronExpression: string, projectName: string): void {
  const existing = activeTasks.get(projectId);
  if (existing) {
    existing.stop();
  }

  if (!cron.validate(cronExpression)) {
    console.error(`Invalid cron expression for project ${projectName}: ${cronExpression}`);
    return;
  }

  const task = cron.schedule(cronExpression, async () => {
    const type = getBackupType();
    console.log(`[Scheduler] Starting ${type} backup for "${projectName}" (project ${projectId})`);
    try {
      const result = await runBackup(projectId, type);
      console.log(`[Scheduler] Backup ${result.backupId} completed: ${result.status} (${result.duration}ms)`);
    } catch (err) {
      console.error(`[Scheduler] Backup failed for "${projectName}":`, err);
    }
  });

  activeTasks.set(projectId, task);
  console.log(`[Scheduler] Scheduled "${projectName}" with cron: ${cronExpression}`);
}

export function initScheduler(): void {
  const schedules = schedulesRepo.findAllActive();
  console.log(`[Scheduler] Initializing ${schedules.length} schedule(s)`);

  for (const schedule of schedules) {
    scheduleProject(schedule.project_id, schedule.cron_expression, schedule.project_name);
  }
}

export function reloadSchedule(projectId: number): void {
  const existing = activeTasks.get(projectId);
  if (existing) {
    existing.stop();
    activeTasks.delete(projectId);
  }

  const schedules = schedulesRepo.findAllActive();
  const schedule = schedules.find((s) => s.project_id === projectId);
  if (schedule) {
    scheduleProject(schedule.project_id, schedule.cron_expression, schedule.project_name);
  }
}

export function stopSchedule(projectId: number): void {
  const existing = activeTasks.get(projectId);
  if (existing) {
    existing.stop();
    activeTasks.delete(projectId);
    console.log(`[Scheduler] Stopped schedule for project ${projectId}`);
  }
}

export function getActiveScheduleCount(): number {
  return activeTasks.size;
}
