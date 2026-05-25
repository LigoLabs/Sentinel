import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth/middleware.js';
import { backupsRepo } from '../database/repositories/backups.repository.js';
import { projectsRepo } from '../database/repositories/projects.repository.js';
import { runBackup } from '../services/backup.service.js';
import { restoreBackup } from '../services/restore.service.js';
import { getProgress } from '../services/progress.service.js';
import { existsSync, createReadStream, statSync, rmSync, readdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { config } from '../config.js';
import { sendError, sendInternal } from '../utils/errors.js';

function pruneEmptyParents(filePath: string): void {
  const backupsRoot = resolve(config.BACKUP_DIR);
  let dir = dirname(filePath);
  while (dir.length > backupsRoot.length && dir.startsWith(backupsRoot)) {
    try {
      const entries = readdirSync(dir);
      if (entries.length > 0) break;
      rmSync(dir, { recursive: true, force: true });
      dir = dirname(dir);
    } catch { break; }
  }
}

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get<{ Params: { projectId: string } }>(
    '/project/:projectId',
    async (request, reply) => {
      const projectId = Number(request.params.projectId);
      const project = projectsRepo.findById(projectId);
      if (!project) return sendError(reply, 'project.not_found');
      return backupsRepo.findByProject(projectId);
    },
  );

  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const backup = backupsRepo.findByIdWithProject(Number(request.params.id));
    if (!backup) return sendError(reply, 'backup.not_found');

    let metadata = {};
    try {
      metadata = JSON.parse(backup.metadata || '{}');
    } catch { /* ignore */ }

    return { ...backup, metadata };
  });

  app.post<{ Body: { project_id: number; type?: 'daily' | 'monthly' | 'manual' } }>(
    '/trigger',
    async (request, reply) => {
      const { project_id, type = 'manual' } = request.body;
      const project = projectsRepo.findById(project_id);
      if (!project) return sendError(reply, 'project.not_found');

      runBackup(project_id, type).catch((err) => {
        console.error('[backup] Async backup failed:', err);
      });

      return reply.code(202).send({ projectId: project_id, started: true });
    },
  );

  app.get<{ Params: { projectId: string } }>('/progress/:projectId', { logLevel: 'silent' }, async (request) => {
    const projectId = Number(request.params.projectId);
    const progress = getProgress(projectId);
    if (!progress) {
      return { projectId, phase: 'idle', message: 'Aucun backup en cours' };
    }
    return progress;
  });

  app.get<{ Params: { id: string } }>('/:id/download', async (request, reply) => {
    const backup = backupsRepo.findByIdWithProject(Number(request.params.id));
    if (!backup) return sendError(reply, 'backup.not_found');
    if (!backup.file_path || !existsSync(backup.file_path)) {
      return sendError(reply, 'backup.files_not_found');
    }

    const filename = basename(backup.file_path);
    const size = statSync(backup.file_path).size;

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Length', size);
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);

    const stream = createReadStream(backup.file_path);
    return reply.send(stream);
  });

  app.post<{ Params: { id: string } }>('/:id/restore', async (request, reply) => {
    const backup = backupsRepo.findById(Number(request.params.id));
    if (!backup) return sendError(reply, 'backup.not_found');

    try {
      const result = await restoreBackup(backup.id);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendInternal(reply, msg);
    }
  });

  // Relance une sauvegarde « sur place » : même projet, même type/config, en
  // écrasant le dump existant (même ligne, même fichier).
  app.post<{ Params: { id: string } }>('/:id/rerun', async (request, reply) => {
    const backup = backupsRepo.findById(Number(request.params.id));
    if (!backup) return sendError(reply, 'backup.not_found');
    const project = projectsRepo.findById(backup.project_id);
    if (!project) return sendError(reply, 'project.not_found');

    // On refuse si une sauvegarde tourne déjà pour ce projet (la relance réinitialise la ligne).
    // getProgress ne renvoie une valeur que pendant un run ; 'done' précède le clear.
    const active = getProgress(backup.project_id);
    if (active && active.phase !== 'done') {
      return sendError(reply, 'backup.already_running');
    }

    const allowed = ['daily', 'monthly', 'manual'];
    const type = (allowed.includes(backup.type) ? backup.type : 'manual') as 'daily' | 'monthly' | 'manual';

    runBackup(backup.project_id, type, { reuseBackupId: backup.id }).catch((err) => {
      console.error('[backup] Async rerun failed:', err);
    });

    return reply.code(202).send({ projectId: backup.project_id, backupId: backup.id, started: true });
  });

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const backup = backupsRepo.findById(Number(request.params.id));
    if (!backup) return sendError(reply, 'backup.not_found');

    if (backup.file_path) {
      try {
        rmSync(backup.file_path, { force: true });
        pruneEmptyParents(backup.file_path);
      } catch { /* ignore */ }
    }

    backupsRepo.delete(backup.id);
    return reply.code(204).send();
  });
}
