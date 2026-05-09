import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth/middleware.js';
import { readEnvView, updateEnv } from '../services/env-config.service.js';
import { sendInternal } from '../utils/errors.js';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/env', async () => ({ keys: readEnvView() }));

  app.put<{ Body: { updates: Record<string, string> } }>('/env', async (request, reply) => {
    const { updates } = request.body ?? ({} as { updates?: Record<string, string> });
    if (!updates || typeof updates !== 'object') {
      return reply.code(400).send({
        error: { code: 'settings.invalid_body', message: 'Expected { updates: { KEY: value } }' },
      });
    }

    try {
      const result = await updateEnv(updates);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendInternal(reply, msg);
    }
  });
}
