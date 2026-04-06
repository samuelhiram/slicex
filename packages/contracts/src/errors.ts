export const ERROR_CODES = {
  AUTH_UNAUTHENTICATED: 'AUTH_UNAUTHENTICATED',
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  TENANT_MEMBERSHIP_REQUIRED: 'TENANT_MEMBERSHIP_REQUIRED',
  TIMELINE_NOT_FOUND: 'TIMELINE_NOT_FOUND',
  TIMELINE_INVALID_DOCUMENT: 'TIMELINE_INVALID_DOCUMENT',
  TIMELINE_REVISION_CONFLICT: 'TIMELINE_REVISION_CONFLICT',
  INPUT_VALIDATION_FAILED: 'INPUT_VALIDATION_FAILED',
  INTERNAL_UNEXPECTED: 'INTERNAL_UNEXPECTED'
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

export function makeErrorEnvelope(code: ErrorCode, message: string, details?: any, requestId?: string) {
  return { requestId, code, message, details };
}

export const ERROR_STATUS: Record<ErrorCode, number> = {
  AUTH_UNAUTHENTICATED: 401,
  AUTH_FORBIDDEN: 403,
  TENANT_NOT_FOUND: 404,
  TENANT_MEMBERSHIP_REQUIRED: 403,
  TIMELINE_NOT_FOUND: 404,
  TIMELINE_INVALID_DOCUMENT: 400,
  TIMELINE_REVISION_CONFLICT: 409,
  INPUT_VALIDATION_FAILED: 400,
  INTERNAL_UNEXPECTED: 500
};

export function statusForError(code: ErrorCode): number {
  return ERROR_STATUS[code] ?? 500;
}

export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: any;
  public readonly requestId?: string;

  constructor(code: ErrorCode, message: string, details?: any, requestId?: string) {
    super(message);
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toEnvelope() {
    return makeErrorEnvelope(this.code, this.message, this.details, this.requestId);
  }

  status() {
    return statusForError(this.code);
  }
}
