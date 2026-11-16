import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanonicalJob, DiscoveryResult } from "@applypilot/job-schema";
import { runJobSpyDiscovery, type JobSpyDiscoveryRequest } from "@applypilot/adapter-jobspy";
import { discoverPortalJobs } from "@applypilot/adapter-career-ops";

export const discoverySources = ["jobspy", "career-ops"] as const;
export type DiscoverySource = (typeof discoverySources)[number];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface DiscoveryRequest {
  sources: DiscoverySource[];
  /** Required when jobspy is a source. */
  jobspy?: JobSpyDiscoveryRequest;
  careerOps?: { company?: string; sinceDays?: number };
  onLog?: (source: DiscoverySource, line: string) => void;
}

export interface SourceOutcome {
  source: DiscoverySource;
  /** Present when the source ran; absent when it threw. */
  result?: DiscoveryResult;
  error?: string;
}

export interface MergedDiscovery {
  outcomes: SourceOutcome[];
  /** Every canonical job across sources, one entry per id. */
  jobs: CanonicalJob[];
  /** Jobs present in more than one source with the same id (cross-source dedup is Phase 10). */
  sameIdAcrossSources: number;
}

/** The run summary Rolecraft stores with an import. */
export function runInfo(result: DiscoveryResult) {
  return {
    runId: result.runId,
    adapter: result.adapter,
    status: result.status,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    metrics: {
      ...result.metrics,
      upstreamVersion: result.upstreamVersion,
      durationMs: result.durationMs,
      errors: result.errors,
    },
  };
}

/**
 * Run the requested sources independently (one failing never stops the
 * other), then merge their canonical jobs. Raw engine records never leave the
 * adapters: only DiscoveryResults reach this layer.
 */
export async function runDiscovery(request: DiscoveryRequest): Promise<MergedDiscovery> {
  const tasks = request.sources.map(async (source): Promise<SourceOutcome> => {
    try {
      if (source === "jobspy") {
        if (!request.jobspy) throw new Error("jobspy needs a search request");
        const result = await runJobSpyDiscovery(request.jobspy, {
          onLog: (l) => request.onLog?.("jobspy", l),
        });
        return { source, result };
      }
      const result = await discoverPortalJobs(request.careerOps ?? {});
      return { source, result };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      const message = error instanceof Error ? error.message : String(error);
      return { source, error: typeof code === "string" ? `${code}: ${message}` : message };
    }
  });
  const outcomes = await Promise.all(tasks);
  return { outcomes, ...mergeJobs(outcomes) };
}

export function mergeJobs(outcomes: SourceOutcome[]): Pick<MergedDiscovery, "jobs" | "sameIdAcrossSources"> {
  const byId = new Map<string, CanonicalJob>();
  let sameIdAcrossSources = 0;
  for (const { result } of outcomes) {
    for (const job of result?.jobs ?? []) {
      const existing = byId.get(job.id);
      if (!existing) {
        byId.set(job.id, job);
        continue;
      }
      sameIdAcrossSources += 1;
      // Keep both sightings; provenance is never discarded.
      byId.set(job.id, { ...existing, provenance: [...existing.provenance, ...job.provenance] });
    }
  }
  return { jobs: [...byId.values()], sameIdAcrossSources };
}

/** Save one source's run to runtime/discovery/<runId>.json and return the path. */
export function saveRun(result: DiscoveryResult, extra: Record<string, unknown> = {}, dir = join(repoRoot, "runtime", "discovery")): string {
  const path = join(dir, `${result.runId}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...extra, ...result }, null, 2)}\n`);
  return path;
}
