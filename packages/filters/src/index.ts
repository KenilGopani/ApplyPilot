import type { CanonicalJob, CanonicalScreening, ScreeningCheck } from "@applypilot/job-schema";
import { POLICY_VERSION, type FilterPolicy } from "./policy.ts";
import {
  ageCheck,
  authorizationCheck,
  exclusionChecks,
  experienceCheck,
  locationCheck,
  salaryCheck,
  titleChecks,
} from "./rules.ts";

export * from "./policy.ts";
export * from "./rules.ts";

/**
 * Screen one job against the policy. Cheap and deterministic: no network, no
 * model. Any incompatible check rejects; any check needing a human makes it
 * "review"; unknowns never reject.
 */
export function screenJob(job: CanonicalJob, policy: FilterPolicy, now = new Date()): CanonicalScreening {
  const authorization = authorizationCheck(job, policy);
  const checks: ScreeningCheck[] = [
    locationCheck(job, policy),
    ageCheck(job, policy, now),
    ...titleChecks(job, policy),
    experienceCheck(job, policy),
    authorization,
    salaryCheck(job, policy),
    ...exclusionChecks(job, policy),
  ].filter((c): c is ScreeningCheck => c !== null);
  const verdict = checks.some((c) => c.status === "incompatible")
    ? "reject"
    : checks.some((c) => c.status === "manual-review")
      ? "review"
      : "pass";
  return {
    verdict,
    authorization: authorization.status,
    checks,
    screenedAt: now.toISOString(),
    policyVersion: POLICY_VERSION,
  };
}

export function screenJobs(jobs: CanonicalJob[], policy: FilterPolicy, now = new Date()): CanonicalJob[] {
  return jobs.map((job) => ({ ...job, screening: screenJob(job, policy, now) }));
}
