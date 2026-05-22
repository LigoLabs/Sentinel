import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth/middleware.js';
import { projectsRepo } from '../database/repositories/projects.repository.js';
import { schedulesRepo } from '../database/repositories/schedules.repository.js';
import { sourcesRepo } from '../database/repositories/sources.repository.js';
import { backupsRepo } from '../database/repositories/backups.repository.js';
import { reloadSchedule, stopSchedule } from '../services/scheduler.service.js';
import { config } from '../config.js';
import { slugify } from '../utils/slug.js';
import { sendError } from '../utils/errors.js';

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/', async () => {
    const projects = projectsRepo.findAll();
    const sizesByProject = new Map(
      backupsRepo.getTotalSizeByAllProjects().map((r) => [r.project_id, r.total]),
    );
    return projects.map((p) => {
      const schedule = schedulesRepo.findByProject(p.id);
      const sources = sourcesRepo.findByProject(p.id);
      const backups = backupsRepo.findByProject(p.id, 1);
      const lastBackup = backups[0] || null;
      return {
        ...p,
        schedule,
        sourcesCount: sources.length,
        totalSizeBytes: sizesByProject.get(p.id) || 0,
        lastBackup: lastBackup
          ? { id: lastBackup.id, status: lastBackup.status, started_at: lastBackup.started_at, size_bytes: lastBackup.size_bytes }
          : null,
      };
    });
  });

  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const project = projectsRepo.findById(Number(request.params.id));
    if (!project) return sendError(reply, 'project.not_found');

    const schedule = schedulesRepo.findByProject(project.id);
    const sources = sourcesRepo.findByProject(project.id);
    const backups = backupsRepo.findByProject(project.id, 50);
    const totalSizeBytes = backupsRepo.getTotalSizeByProject(project.id);
    return { ...project, schedule, sources, backups, totalSizeBytes };
  });

  app.post<{
    Body: {
      name: string;
      description?: string;
      schedule?: { cron_expression?: string; retention_count?: number; retention_monthly?: boolean; cron_lifetime?: string | null };
    };
  }>('/', async (request, reply) => {
    const { name, description, schedule } = request.body;
    if (!name?.trim()) return sendError(reply, 'project.name_required');

    const existing = projectsRepo.findByName(name.trim());
    if (existing) return sendError(reply, 'project.name_taken');

    const project = projectsRepo.create({ name: name.trim(), description });
    schedulesRepo.create({
      project_id: project.id,
      cron_expression: schedule?.cron_expression,
      retention_count: schedule?.retention_count,
      retention_monthly: schedule?.retention_monthly,
      cron_lifetime: schedule?.cron_lifetime,
    });

    return reply.code(201).send(project);
  });

  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      description?: string;
      is_active?: boolean;
      schedule?: { cron_expression?: string; retention_count?: number; retention_monthly?: boolean; cron_lifetime?: string | null; is_active?: boolean };
    };
  }>('/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const { name, description, is_active, schedule } = request.body;

    const updated = projectsRepo.update(id, { name, description, is_active });
    if (!updated) return sendError(reply, 'project.not_found');

    if (schedule) {
      const existingSchedule = schedulesRepo.findByProject(id);
      if (existingSchedule) {
        schedulesRepo.update(id, schedule);
      } else {
        schedulesRepo.create({ project_id: id, ...schedule });
      }
      reloadSchedule(id);
    }

    return updated;
  });

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const project = projectsRepo.findById(id);
    if (!project) return sendError(reply, 'project.not_found');

    stopSchedule(id);

    const backups = backupsRepo.findByProject(id, 99999);
    for (const backup of backups) {
      if (backup.file_path && existsSync(backup.file_path)) {
        try { rmSync(backup.file_path, { recursive: true, force: true }); } catch { /* ignore */ }
      }
      backupsRepo.delete(backup.id);
    }

    const projectDir = join(config.BACKUP_DIR, slugify(project.name));
    if (existsSync(projectDir)) {
      try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }

    const sources = sourcesRepo.findByProject(id);
    for (const source of sources) {
      sourcesRepo.delete(source.id);
    }

    schedulesRepo.delete(id);
    projectsRepo.delete(id);

    return reply.code(204).send();
  });
}
