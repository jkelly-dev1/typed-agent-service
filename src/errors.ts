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

export function toProblem(err: unknown, requestId: string): ProblemDetails {
  if (err instanceof ValidationError) {
    return {
      type: 'about:blank',
      title: 'Bad Request',
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
      title: err.status >= 500 ? 'Server Error' : 'Request Error',
      status: err.status,
      detail: err.message,
      code: err.code,
      requestId,
    };
  }
  // Unexpected error: do not leak internals to the client.
  return {
    type: 'about:blank',
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected error occurred',
    code: 'internal_error',
    requestId,
  };
}
