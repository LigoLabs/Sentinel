const API_BASE = '/api';

export class ApiError extends Error {
  /**
   * Stable error code from the backend (e.g. `auth.invalid_password`).
   * Falls back to a generic value when the response shape is unexpected.
   */
  public code: string;
  public details?: Record<string, unknown>;

  constructor(
    public status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

interface BackendErrorBody {
  error: string | { code: string; message: string; details?: Record<string, unknown> };
}

function parseError(status: number, body: unknown): ApiError {
  const b = body as Partial<BackendErrorBody>;
  if (b && typeof b.error === 'object' && b.error !== null && 'code' in b.error) {
    const e = b.error as { code: string; message: string; details?: Record<string, unknown> };
    return new ApiError(status, e.code, e.message || e.code, e.details);
  }
  if (b && typeof b.error === 'string') {
    return new ApiError(status, 'unknown_error', b.error);
  }
  return new ApiError(status, 'unknown_error', `HTTP ${status}`);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers as Record<string, string> };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw parseError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
