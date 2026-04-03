/**
 * Structured error types for the agent runtime.
 *
 * Usage:
 *   throw new NotFoundError('session', sessionId);
 *   throw new ValidationError('Missing session id');
 *   throw new PayloadTooLargeError(limit);
 */

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      'NOT_FOUND',
      id ? `${resource} not found: ${id}` : `${resource} not found`,
      404,
    );
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message, 400);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(limit: number) {
    super(
      'PAYLOAD_TOO_LARGE',
      `Request body exceeds limit of ${limit} bytes`,
      413,
    );
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message, 403);
  }
}

export class TimeoutError extends AppError {
  constructor(message = 'Request timed out') {
    super('TIMEOUT', message, 504);
  }
}

/** Extract a human-readable message from any thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Map an AppError (or generic Error) to an HTTP status code. */
export function httpStatusFromError(error: unknown): number {
  if (error instanceof AppError) return error.statusCode;
  if (error instanceof SyntaxError && error.message.includes('JSON')) return 400;
  return 500;
}
