import type { ZodError } from 'zod';

/**
 * Typed error boundary. Every error that crosses the HTTP surface becomes an
 * RFC 9457 application/problem+json body with a stable machine-readable code.
 * Internal messages never leak for unexpected errors.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

export class ValidationError extends AppError {
  readonly issues: ReadonlyArray<{ path: string; message: string }>;

  constructor(zodError: ZodError) {
    super('validation_failed', 'Request validation failed', 400);
    this.name = 'ValidationError';
    this.issues = zodError.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
  }
}

export class ProviderError extends AppError {
  constructor(message: string) {
    super('provider_error', message, 502);
    this.name = 'ProviderError';
  }
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  requestId: string;
  issues?: ReadonlyArray<{ path: string; message: string }>;
}

/**
 * Reason phrases for the statuses this service emits. 499 is the nginx
 * convention for a client that closed its connection before the response.
 */
const TITLES: Record<number, string> = {
  400: 'Bad Request',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  499: 'Client Closed Request',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  504: 'Gateway Timeout',
};

function titleFor(status: number): string {
  return TITLES[status] ?? (status >= 500 ? 'Server Error' : 'Request Error');
}

/**
 * Fastify rejects a request before any handler runs when its body is not
 * JSON, is empty under application/json, exceeds the body limit, or carries a
 * content type with no parser. Those arrive as FastifyError instances with a
 * 4xx statusCode and a FST_ERR_* code. Each is the client's mistake, so it is
 * reported as one, under a code of this service's own.
 */
const FASTIFY_CODES: Record<string, string> = {
  FST_ERR_CTP_INVALID_JSON_BODY: 'malformed_body',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'empty_body',
  FST_ERR_CTP_BODY_TOO_LARGE: 'payload_too_large',
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'unsupported_media_type',
};

function clientError(err: unknown): { status: number; code: string; detail: string } | undefined {
  if (!(err instanceof Error)) return undefined;
  const { statusCode, code } = err as Error & { statusCode?: unknown; code?: unknown };
  if (typeof statusCode !== 'number' || statusCode < 400 || statusCode > 499) return undefined;
  const known = typeof code === 'string' ? FASTIFY_CODES[code] : undefined;
  return { status: statusCode, code: known ?? 'bad_request', detail: err.message };
}

export function toProblem(err: unknown, requestId: string): ProblemDetails {
  if (err instanceof ValidationError) {
    return {
      type: 'about:blank',
      title: titleFor(err.status),
      status: err.status,
      detail: err.message,
      code: err.code,
      requestId,
      issues: err.issues,
    };
  }
  if (err instanceof AppError) {
    return {
      type: 'about:blank',
      title: titleFor(err.status),
      status: err.status,
      detail: err.message,
      code: err.code,
      requestId,
    };
  }
  const client = clientError(err);
  if (client) {
    return {
      type: 'about:blank',
      title: titleFor(client.status),
      status: client.status,
      detail: client.detail,
      code: client.code,
      requestId,
    };
  }
  // Unexpected error: do not leak internals to the client.
  return {
    type: 'about:blank',
    title: titleFor(500),
    status: 500,
    detail: 'An unexpected error occurred',
    code: 'internal_error',
    requestId,
  };
}
