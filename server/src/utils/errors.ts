import type { FastifyReply } from 'fastify';

/**
 * Stable error codes returned by the API. The frontend maps each code to a
 * localized message. The `message` field is a plain-English fallback that
 * non-i18n clients (curl, scripts) can still display.
 */
export const ERROR_CODES = {
  unauthorized: { status: 401, message: 'Unauthorized' },
  not_found: { status: 404, message: 'Not found' },
  rate_limited: { status: 429, message: 'Too many attempts. Please try again later.' },

  'auth.password_required': { status: 400, message: 'Password is required' },
  'auth.invalid_password': { status: 401, message: 'Invalid password' },

  'project.not_found': { status: 404, message: 'Project not found' },
  'project.name_required': { status: 400, message: 'Project name is required' },
  'project.name_taken': { status: 409, message: 'A project with this name already exists' },

  'source.not_found': { status: 404, message: 'Source not found' },
  'source.fields_required': { status: 400, message: 'project_id, type, label and config are required' },
  'source.test_fields_required': { status: 400, message: 'type and config are required' },

  'backup.not_found': { status: 404, message: 'Backup not found' },
  'backup.files_not_found': { status: 404, message: 'Backup files not found on disk' },
  'backup.restore_failed': { status: 500, message: 'Restore failed' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ApiErrorBody {
  error: {
    code: ErrorCode | string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function sendError(
  reply: FastifyReply,
  code: ErrorCode,
  details?: Record<string, unknown>,
): FastifyReply {
  const def = ERROR_CODES[code];
  return reply.code(def.status).send({
    error: {
      code,
      message: def.message,
      ...(details ? { details } : {}),
    },
  } satisfies ApiErrorBody);
}

/** For 500-class internal errors with a runtime message. */
export function sendInternal(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(500).send({
    error: { code: 'internal_error', message },
  } satisfies ApiErrorBody);
}
