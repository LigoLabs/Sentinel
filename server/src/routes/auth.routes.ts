import type { FastifyInstance } from 'fastify';
import { verifyPassword } from '../auth/auth.service.js';
import { check, recordFailure, recordSuccess } from '../auth/rate-limit.js';
import { config } from '../config.js';
import { sendError, ERROR_CODES, type ApiErrorBody } from '../utils/errors.js';

const isProd = config.NODE_ENV === 'production';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me', async (request, reply) => {
    try {
      await request.jwtVerify();
      return { authenticated: true };
    } catch {
      return reply.code(401).send({ authenticated: false });
    }
  });

  app.post<{ Body: { password: string } }>('/login', async (request, reply) => {
    const ip = request.ip || 'unknown';

    const limit = check(ip);
    if (!limit.ok) {
      reply.header('Retry-After', String(limit.retryAfterSeconds ?? 900));
      const body: ApiErrorBody = {
        error: {
          code: 'rate_limited',
          message: ERROR_CODES.rate_limited.message,
          details: { retryAfterSeconds: limit.retryAfterSeconds },
        },
      };
      return reply.code(429).send(body);
    }

    const { password } = request.body ?? ({} as { password?: string });
    if (!password) {
      recordFailure(ip);
      return sendError(reply, 'auth.password_required');
    }

    if (!verifyPassword(password)) {
      recordFailure(ip);
      return sendError(reply, 'auth.invalid_password');
    }

    recordSuccess(ip);

    const token = app.jwt.sign({ role: 'admin' }, { expiresIn: '7d' });
    reply.setCookie('sentinel_token', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: isProd,
      maxAge: 7 * 24 * 60 * 60,
    });
    return { success: true };
  });

  app.post('/logout', async (_request, reply) => {
    reply.clearCookie('sentinel_token', { path: '/' });
    return { success: true };
  });
}
