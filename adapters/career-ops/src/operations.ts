import { z } from "zod";
import { CareerOpsError } from "./errors.ts";
import { lastJsonLine, runCareerOps, type CareerOpsRunOptions } from "./runtime.ts";

// ---------------------------------------------------------------- doctor

/** The subset of `doctor.mjs --json` the platform relies on. */
export const doctorStateSchema = z
  .object({
    onboardingNeeded: z.boolean(),
    missing: z.array(z.string()),
    unpersonalized: z.array(z.unknown()),
    warnings: z.array(z.string()),
    plugins: z
      .array(z.object({ id: z.string(), enabled: z.boolean() }).passthrough())
      .optional(),
  })
  .passthrough();

export interface CareerOpsHealth {
  ready: boolean;
  onboardingNeeded: boolean;
  missing: string[];
  unpersonalized: string[];
  warnings: string[];
  enabledPlugins: string[];
}

/**
 * Read-only setup state of the isolated data root (`doctor.mjs --json`).
 * `ready` means the four onboarding files exist; unpersonalized templates are
 * reported but do not block, matching Career Ops' own rule.
 */
export async function careerOpsHealth(options: CareerOpsRunOptions = {}): Promise<CareerOpsHealth> {
  const result = await runCareerOps("doctor.mjs", ["--json"], options);
  const parsed = doctorStateSchema.safeParse(lastJsonLine(result));
  if (!parsed.success) {
    throw new CareerOpsError("CAREER_OPS_PROTOCOL_ERROR", "doctor --json output changed shape", parsed.error.issues);
  }
  const state = parsed.data;
  return {
    ready: !state.onboardingNeeded,
    onboardingNeeded: state.onboardingNeeded,
    missing: state.missing,
    unpersonalized: state.unpersonalized.map((u) =>
      typeof u === "object" && u && "path" in u ? String((u as { path: unknown }).path) : String(u),
    ),
    warnings: state.warnings,
    enabledPlugins: (state.plugins ?? []).filter((p) => p.enabled).map((p) => p.id),
  };
}

// ------------------------------------------------------- verify-pipeline

export interface PipelineCheck {
  level: "pass" | "warn" | "error";
  message: string;
}
export interface PipelineVerification {
  ok: boolean;
  errors: number;
  warnings: number;
  checks: PipelineCheck[];
}

const MARKS: [string, PipelineCheck["level"]][] = [
  ["✅", "pass"],
  ["⚠️", "warn"],
  ["❌", "error"],
];

/** Parse verify-pipeline's human output: one ✅ / ⚠️ / ❌ line per finding. */
export function parseVerifyOutput(stdout: string): PipelineCheck[] {
  const checks: PipelineCheck[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    const mark = MARKS.find(([m]) => line.startsWith(m));
    if (mark) checks.push({ level: mark[1], message: line.slice(mark[0].length).trim() });
  }
  return checks;
}

/**
 * `verify-pipeline.mjs`: integrity of the tracker, reports and pipeline in
 * the data root. It has no JSON mode, so its marked lines are parsed; the exit
 * code (1 = errors) stays authoritative.
 */
export async function verifyCareerOpsPipeline(options: CareerOpsRunOptions = {}): Promise<PipelineVerification> {
  const result = await runCareerOps("verify-pipeline.mjs", ["--no-hints"], options);
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new CareerOpsError("CAREER_OPS_PROTOCOL_ERROR", `verify-pipeline exited ${result.exitCode}`, {
      stderrTail: result.stderr.slice(-1000),
    });
  }
  const checks = parseVerifyOutput(result.stdout);
  const errors = checks.filter((c) => c.level === "error").length;
  return {
    ok: result.exitCode === 0,
    errors,
    warnings: checks.filter((c) => c.level === "warn").length,
    checks,
  };
}

// ------------------------------------------------------------------ scan

/** `scan.mjs --json` receipt, `careerops.scan.receipt@1`. */
export const scanReceiptSchema = z
  .object({
    version: z.literal("careerops.scan.receipt@1"),
    date: z.string(),
    scanned: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    found: z.number().int().nonnegative(),
    filtered: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    added_urls: z.array(z.string()),
    errors: z.array(z.object({ company: z.string(), error: z.string() }).passthrough()),
    unverified_zero: z.array(z.unknown()),
    partial: z.array(z.unknown()),
    dry_run: z.boolean(),
  })
  .passthrough();
export type ScanReceipt = z.infer<typeof scanReceiptSchema>;

export interface ScanOptions extends CareerOpsRunOptions {
  /** Preview only: Career Ops writes nothing (no pipeline, history or caches). */
  dryRun?: boolean;
  /** Scan one company from portals.yml. */
  company?: string;
  /** Only postings from the last N days. */
  sinceDays?: number;
}

export interface PortalScanResult {
  status: "ok" | "partial" | "failed";
  receipt: ScanReceipt;
  durationMs: number;
}

/**
 * `scan.mjs --json`: scan the ATS portals in the data root's portals.yml.
 * Without dryRun, Career Ops appends new postings to its own
 * data/pipeline.md and data/scan-history.tsv in the data root; turning those
 * rows into CanonicalJob is the portal discovery adapter (plan Phase 9).
 */
export async function scanPortals(options: ScanOptions = {}): Promise<PortalScanResult> {
  const args = ["--json", "--quiet"];
  if (options.dryRun) args.push("--dry-run");
  if (options.company) args.push("--company", options.company);
  if (options.sinceDays !== undefined) {
    if (!Number.isInteger(options.sinceDays) || options.sinceDays < 1) {
      throw new CareerOpsError("CAREER_OPS_CONFIG_ERROR", "sinceDays must be a positive integer");
    }
    args.push("--since", String(options.sinceDays));
  }
  const result = await runCareerOps("scan.mjs", args, { timeoutMs: 900_000, ...options });
  if (result.exitCode === 1) {
    const reason = result.stderr.trim().split("\n").filter(Boolean).pop() ?? "configuration error";
    throw new CareerOpsError("CAREER_OPS_CONFIG_ERROR", `scan refused to run: ${reason}`);
  }
  const parsed = scanReceiptSchema.safeParse(lastJsonLine(result));
  if (!parsed.success) {
    throw new CareerOpsError("CAREER_OPS_PROTOCOL_ERROR", "scan receipt changed shape", parsed.error.issues);
  }
  const receipt = parsed.data;
  // Exit 2 with --json means at least one target failed; the receipt says which.
  const failed = receipt.errors.length;
  const status =
    failed === 0 ? "ok" : receipt.scanned > 0 && failed >= receipt.scanned ? "failed" : "partial";
  return { status, receipt, durationMs: result.durationMs };
}

// --------------------------------------------------------- capabilities

export type CapabilityState = "available" | "not-exposed";

/**
 * The adapter operations from the integration plan and whether they are
 * exposed yet. A capability is exposed only once its native behaviour and
 * output format are understood and tested.
 */
export const careerOpsCapabilities: Record<string, { state: CapabilityState; via: string; note: string }> = {
  health: { state: "available", via: "doctor.mjs --json", note: "read-only onboarding/setup state" },
  verify_pipeline: { state: "available", via: "verify-pipeline.mjs", note: "integrity checks over tracker, reports, pipeline" },
  scan_portals: { state: "available", via: "scan.mjs --json", note: "new postings mapped to CanonicalJob (Phase 9)" },
  fetch_job_description: { state: "available", via: "fetch-jd.mjs", note: "zero-token JD from ATS APIs / JSON-LD; detects closed postings" },
  evaluate_job: { state: "not-exposed", via: "modes/oferta.md via an AI CLI, or *-eval.mjs", note: "needs an LLM provider decision (risk R3); Phase 13" },
  tailor_resume: { state: "not-exposed", via: "modes/pdf.md, openai-tailor.mjs", note: "needs an LLM; Phase 15" },
  prepare_application: { state: "not-exposed", via: "prepare-application.mjs, modes/apply.md", note: "Phase 18" },
  research_company: { state: "not-exposed", via: "modes/deep.md", note: "agent-driven; Phase 18" },
  research_contacts: { state: "not-exposed", via: "modes/contacto.md, contact-lookup.mjs", note: "agent-driven; Phase 18" },
};
