import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth/middleware.js';
import { projectsRepo } from '../database/repositories/projects.repository.js';
import { backupsRepo } from '../database/repositories/backups.repository.js';
import { alertsRepo } from '../database/repositories/alerts.repository.js';
import { getActiveScheduleCount } from '../services/scheduler.service.js';
import { getSmtpStatus, sendTestEmail } from '../services/email.service.js';
import { getTmpStatus, cleanupTmpFolders } from '../services/cleanup.service.js';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/stats', async () => {
    const projects = projectsRepo.findAll();
    const recentBackups = backupsRepo.findRecent(10);
    const totalSize = backupsRepo.getTotalSize();
    const totalCount = backupsRepo.getCount();
    const failedCount = backupsRepo.getFailedCount(7);

    return {
      totalProjects: projects.length,
      totalBackups: totalCount,
      totalSizeBytes: totalSize,
      failedCount,
      activeSchedules: getActiveScheduleCount(),
      recentBackups,
      nextScheduled: null,
    };
  });

  app.get('/alerts', async () => {
    return alertsRepo.findRecent(50);
  });

  app.get('/alerts/unread', async () => {
    return alertsRepo.findUnread();
  });

  app.get('/alerts/count', async () => {
    return { count: alertsRepo.getUnreadCount() };
  });

  app.post('/alerts/read-all', async () => {
    alertsRepo.markAllRead();
    return { success: true };
  });

  app.post<{ Params: { id: string } }>('/alerts/:id/read', async (request) => {
    alertsRepo.markRead(Number(request.params.id));
    return { success: true };
  });

  app.post<{ Params: { id: string } }>('/alerts/:id/unread', async (request) => {
    alertsRepo.markUnread(Number(request.params.id));
    return { success: true };
  });

  app.get('/smtp/status', async () => {
    return getSmtpStatus();
  });

  app.post('/smtp/test', async () => {
    return sendTestEmail();
  });

  app.get('/tmp/status', async () => {
    return getTmpStatus();
  });

  app.post('/tmp/cleanup', async () => {
    const cleaned = cleanupTmpFolders();
    return { cleaned };
  });
}
