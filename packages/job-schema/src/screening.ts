import { z } from "zod";
import { authorizationSignals } from "./evaluation.ts";

/**
 * Result of the cheap, rule-based hard filters (plan Phase 11), run before
 * any model-based evaluation. A missing signal is "unknown", never guessed.
 */
export const screeningVerdicts = ["pass", "review", "reject"] as const;
export type ScreeningVerdict = (typeof screeningVerdicts)[number];

export const screeningCheckSchema = z.object({
  rule: z.string().min(1).max(50),
  status: z.enum(authorizationSignals),
  reason: z.string().max(500),
  /** Verbatim text from the posting that triggered the result. */
  evidence: z.string().max(500).optional(),
});
export type ScreeningCheck = z.infer<typeof screeningCheckSchema>;

export const canonicalScreeningSchema = z.object({
  /** reject: a check is incompatible; review: a check needs a human; pass otherwise. */
  verdict: z.enum(screeningVerdicts),
  /** The work-authorization / sponsorship check on its own, for display. */
  authorization: z.enum(authorizationSignals),
  checks: z.array(screeningCheckSchema).max(30),
  screenedAt: z.string().datetime({ offset: true }),
  policyVersion: z.string().max(50),
});
export type CanonicalScreening = z.infer<typeof canonicalScreeningSchema>;
