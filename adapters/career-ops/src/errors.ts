export const careerOpsErrorCodes = [
  /** The checkout or its node_modules is missing. */
  "CAREER_OPS_UNAVAILABLE",
  /** The data root would put user data inside the Career Ops checkout. */
  "CAREER_OPS_UNSAFE_DATA_ROOT",
  /** A script that the adapter does not expose was requested. */
  "CAREER_OPS_NOT_EXPOSED",
  /** Career Ops refused its configuration (exit 1), e.g. no portals.yml. */
  "CAREER_OPS_CONFIG_ERROR",
  "CAREER_OPS_TIMEOUT",
  /** The script's output did not match the documented machine format. */
  "CAREER_OPS_PROTOCOL_ERROR",
] as const;
export type CareerOpsErrorCode = (typeof careerOpsErrorCodes)[number];

export class CareerOpsError extends Error {
  readonly code: CareerOpsErrorCode;
  readonly details?: unknown;

  constructor(code: CareerOpsErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "CareerOpsError";
    this.code = code;
    this.details = details;
  }
}
