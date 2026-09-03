import { AppError } from '../errors.js';

export class WorkspaceUnavailableError extends AppError {
  constructor(message: string, public readonly details?: Record<string, unknown>) {
    super('WORKSPACE_UNAVAILABLE', message, 422);
  }
}
