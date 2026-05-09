import type { FastifyRequest, FastifyReply } from 'fastify';
import { sendError } from '../utils/errors.js';

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    sendError(reply, 'unauthorized');
  }
}
