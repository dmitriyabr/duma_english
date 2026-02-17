export const ATTEMPT_STATUS = {
  CREATED: "created",
  UPLOADED: "uploaded",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
  NEEDS_RETRY: "needs_retry",
} as const;

export type AttemptStatus = (typeof ATTEMPT_STATUS)[keyof typeof ATTEMPT_STATUS];

export type AttemptTerminalStatus =
  | typeof ATTEMPT_STATUS.COMPLETED
  | typeof ATTEMPT_STATUS.FAILED
  | typeof ATTEMPT_STATUS.NEEDS_RETRY;

const TERMINAL_STATUSES = new Set<string>([
  ATTEMPT_STATUS.COMPLETED,
  ATTEMPT_STATUS.FAILED,
  ATTEMPT_STATUS.NEEDS_RETRY,
]);

export function isAttemptTerminalStatus(status: string): status is AttemptTerminalStatus {
  return TERMINAL_STATUSES.has(status);
}

export function isAttemptRetryStatus(status: string): status is typeof ATTEMPT_STATUS.NEEDS_RETRY {
  return status === ATTEMPT_STATUS.NEEDS_RETRY;
}
