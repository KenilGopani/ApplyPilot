import { CareerOpsError } from "./errors.ts";
import { runCareerOps, type CareerOpsRunOptions } from "./runtime.ts";

export type JobDescriptionResult =
  | { status: "found"; text: string }
  /** The posting itself says it is closed; `evidence` is Career Ops' quote. */
  | { status: "closed"; evidence: string }
  /** No public API or JSON-LD covered it. Never a guess. */
  | { status: "unavailable" };

/**
 * `fetch-jd.mjs <url>`: the JD from the ATS's public API (Greenhouse, Lever,
 * Ashby, Workable, …) or the page's schema.org JobPosting. Zero tokens.
 */
export async function fetchJobDescription(
  url: string,
  options: CareerOpsRunOptions = {},
): Promise<JobDescriptionResult> {
  const result = await runCareerOps("fetch-jd.mjs", [url], { timeoutMs: 45_000, ...options });
  if (result.exitCode === 0 && result.stdout.trim()) return { status: "found", text: result.stdout.trim() };
  if (result.exitCode === 3) {
    return { status: "closed", evidence: result.stdout.replace(/^CLOSED_POSTING\s*/, "").trim().slice(0, 500) };
  }
  if (result.exitCode === 1 || result.exitCode === 0) return { status: "unavailable" };
  throw new CareerOpsError("CAREER_OPS_PROTOCOL_ERROR", `fetch-jd exited ${result.exitCode}`, {
    stderrTail: result.stderr.slice(-500),
  });
}
