import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth/middleware.js';
import { sourcesRepo } from '../database/repositories/sources.repository.js';
import { projectsRepo } from '../database/repositories/projects.repository.js';
import { getDatabaseConnector } from '../connectors/database/registry.js';
import { getStorageConnector } from '../connectors/storage/registry.js';
import { getDatabaseConnectorTypes } from '../connectors/database/registry.js';
import { getStorageConnectorTypes } from '../connectors/storage/registry.js';
import { sendError } from '../utils/errors.js';

const DB_TYPES = new Set(['turso', 'sqlite', 'postgres', 'postgres-ssh', 'mysql', 'mysql-ssh', 'wordpress']);

export async function sourceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/types', async () => ({
    database: getDatabaseConnectorTypes(),
    storage: getStorageConnectorTypes(),
  }));

  app.get<{ Params: { projectId: string } }>('/project/:projectId', async (request, reply) => {
    const projectId = Number(request.params.projectId);
    const project = projectsRepo.findById(projectId);
    if (!project) return sendError(reply, 'project.not_found');
    return sourcesRepo.findByProject(projectId);
  });

  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const source = sourcesRepo.findByIdDecrypted(Number(request.params.id));
    if (!source) return sendError(reply, 'source.not_found');
    return source;
  });

  app.post<{
    Body: {
      project_id: number;
      type: string;
      label: string;
      config: Record<string, unknown>;
    };
  }>('/', async (request, reply) => {
    const { project_id, type, label, config } = request.body;
    if (!project_id || !type || !label || !config) {
      return sendError(reply, 'source.fields_required');
    }

    const project = projectsRepo.findById(project_id);
    if (!project) return sendError(reply, 'project.not_found');

    const source = sourcesRepo.create({ project_id, type, label, config });
    return reply.code(201).send(source);
  });

  app.put<{
    Params: { id: string };
    Body: { type?: string; label?: string; config?: Record<string, unknown> };
  }>('/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const updated = sourcesRepo.update(id, request.body);
    if (!updated) return sendError(reply, 'source.not_found');
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const deleted = sourcesRepo.delete(id);
    if (!deleted) return sendError(reply, 'source.not_found');
    return reply.code(204).send();
  });

  app.post<{
    Body: { type: string; config: Record<string, unknown> };
  }>('/test', async (request, reply) => {
    const { type, config } = request.body;
    if (!type || !config) {
      return sendError(reply, 'source.test_fields_required');
    }

    try {
      let success: boolean;
      if (DB_TYPES.has(type)) {
        const connector = getDatabaseConnector(type);
        success = await connector.testConnection(config);
      } else {
        const connector = getStorageConnector(type);
        success = await connector.testConnection(config);
      }
      return success
        ? { success: true }
        : { success: false, error: 'La connexion a échoué (aucun détail disponible)' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });
}
