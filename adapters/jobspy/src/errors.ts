export const platformErrorCodes = [
  "DISCOVERY_INVALID_REQUEST",
  "DISCOVERY_WORKER_UNAVAILABLE",
  "DISCOVERY_WORKER_CRASHED",
  "DISCOVERY_WORKER_TIMEOUT",
  "DISCOVERY_PROTOCOL_ERROR",
] as const;
export type PlatformErrorCode = (typeof platformErrorCodes)[number];

/**
 * A failure of the discovery run as a whole. Per-site failures (a board that
 * answered 429) are not thrown: they are reported in the run result so the
 * other boards' jobs still arrive.
 */
export class PlatformError extends Error {
  readonly code: PlatformErrorCode;
  readonly details?: unknown;

  constructor(code: PlatformErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "PlatformError";
    this.code = code;
    this.details = details;
  }
}
