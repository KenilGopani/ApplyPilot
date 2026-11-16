import type { CanonicalJob } from "./job.ts";

/**
 * The result every discovery adapter returns for one run, whatever the engine
 * (JobSpy, Career Ops). Only canonical jobs leave an adapter; records that
 * could not be mapped are listed with a reason, never dropped silently.
 */

export interface MappedJob {
  job: CanonicalJob;
  /** Data dropped or adjusted during mapping, e.g. an inverted salary range. */
  warnings: string[];
}

export interface RejectedRecord {
  index: number;
  reason: string;
  record: unknown;
}

export interface SiteMetrics {
  returned: number;
  mapped: number;
  rejected: number;
  error: string | null;
  warnings: string[];
}

export interface DiscoveryResult {
  adapter: "jobspy" | "career-ops";
  status: "ok" | "partial" | "failed";
  runId: string;
  upstreamVersion: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  metrics: {
    /** results_wanted per board (JobSpy); null when the engine has no such limit. */
    requestedPerSite: number | null;
    returned: number;
    mapped: number;
    rejected: number;
    /** Same posting returned twice in one run (kept once). */
    duplicates: number;
    bySite: Record<string, SiteMetrics>;
  };
  jobs: CanonicalJob[];
  jobWarnings: Record<string, string[]>;
  rejected: RejectedRecord[];
  errors: { site: string; message: string }[];
}
