import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config, ensureDirectories } from './config.js';
import { loggerConfig } from './utils/logger.js';
import { initDatabase } from './database/connection.js';
import { authRoutes } from './routes/auth.routes.js';
import { projectRoutes } from './routes/projects.routes.js';
import { sourceRoutes } from './routes/sources.routes.js';
import { backupRoutes } from './routes/backups.routes.js';
import { dashboardRoutes } from './routes/dashboard.routes.js';
import { settingsRoutes } from './routes/settings.routes.js';
import { initScheduler } from './services/scheduler.service.js';
import { startHeartbeat } from './monitoring/heartbeat.js';
import { startupCleanup } from './services/cleanup.service.js';
import { sendError } from './utils/errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

ensureDirectories();

const app = Fastify({ logger: loggerConfig });

await app.register(cors, {
  origin: config.NODE_ENV === 'production' ? false : 'http://localhost:8081',
  credentials: true,
});
await app.register(fastifyCookie);
await app.register(fastifyJwt, {
  secret: config.JWT_SECRET,
  cookie: {
    cookieName: 'sentinel_token',
    signed: false,
  },
});

app.decorate('authenticate', async function (request: any, reply: any) {
  try {
    await request.jwtVerify();
  } catch {
    sendError(reply, 'unauthorized');
  }
});

await initDatabase();
startupCleanup();

await app.register(authRoutes, { prefix: '/api/auth' });
await app.register(projectRoutes, { prefix: '/api/projects' });
await app.register(sourceRoutes, { prefix: '/api/sources' });
await app.register(backupRoutes, { prefix: '/api/backups' });
await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
await app.register(settingsRoutes, { prefix: '/api/settings' });

app.get('/api/health', { logLevel: 'silent' }, async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
}));

if (config.NODE_ENV === 'production') {
  await app.register(fastifyStatic, {
    root: join(__dirname, '../../web/build'),
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) {
      return sendError(reply, 'not_found');
    }
    return reply.sendFile('index.html');
  });
}

initScheduler();
startHeartbeat();

try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info(`Sentinel démarré sur le port ${config.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export { app };
