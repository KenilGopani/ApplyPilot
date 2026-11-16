import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanonicalJob, DiscoveryResult } from "@applypilot/job-schema";
import { dedupeJobs, type Merge, type PossibleDuplicate } from "@applypilot/dedup";
import { runJobSpyDiscovery, type JobSpyDiscoveryRequest } from "@applypilot/adapter-jobspy";
import {
  discoverPortalJobs,
  fetchJobDescription,
  type JobDescriptionResult,
} from "@applypilot/adapter-career-ops";
import { screenJob, type FilterPolicy } from "@applypilot/filters";

export const discoverySources = ["jobspy", "career-ops"] as const;
export type DiscoverySource = (typeof discoverySources)[number];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface DiscoveryRequest {
  sources: DiscoverySource[];
  /** Required when jobspy is a source. */
  jobspy?: JobSpyDiscoveryRequest;
  careerOps?: { company?: string; sinceDays?: number };
  /** Hard filters (Phase 11). Without it, jobs are imported unscreened. */
  screening?: ScreeningOptions;
  onLog?: (source: DiscoverySource, line: string) => void;
}

export interface ScreeningOptions {
  policy: FilterPolicy;
  /** Fetch missing descriptions through Career Ops' fetch-jd (zero tokens). Default true. */
  fetchDescriptions?: boolean;
  fetcher?: (url: string) => Promise<JobDescriptionResult>;
  now?: Date;
}

export interface ScreeningSummary {
  descriptionsFetched: number;
  descriptionsUnavailable: number;
  closed: number;
  verdicts: Record<"pass" | "review" | "reject", number>;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/**
 * Fill missing descriptions, then run the hard filters. A posting whose page
 * says it is closed is rejected with that quote as evidence.
 */
export async function screenJobs(
  jobs: CanonicalJob[],
  options: ScreeningOptions,
): Promise<{ jobs: CanonicalJob[]; summary: ScreeningSummary }> {
  const fetcher = options.fetcher ?? ((url: string) => fetchJobDescription(url));
  const summary: ScreeningSummary = {
    descriptionsFetched: 0,
    descriptionsUnavailable: 0,
    closed: 0,
    verdicts: { pass: 0, review: 0, reject: 0 },
  };
  const enriched = await mapLimit(jobs, 4, async (job) => {
    if (job.description || options.fetchDescriptions === false) return { job, closed: undefined };
    // Prefer the employer's posting: it is the URL fetch-jd can read.
    const url = job.provenance.find((p) => p.applyUrl)?.applyUrl ?? job.sourceUrl;
    try {
      const jd = await fetcher(url);
      if (jd.status === "found") {
        summary.descriptionsFetched += 1;
        return { job: { ...job, description: jd.text.slice(0, 200_000) }, closed: undefined };
      }
      if (jd.status === "closed") {
        summary.closed += 1;
        return { job, closed: jd.evidence };
      }
    } catch {
      // A failed fetch leaves the job unscreened on description-based rules, never dropped.
    }
    summary.descriptionsUnavailable += 1;
    return { job, closed: undefined };
  });
  const screened = enriched.map(({ job, closed }) => {
    const screening = screenJob(job, options.policy, options.now);
    if (closed !== undefined) {
      screening.checks.unshift({
        rule: "posting-closed",
        status: "incompatible",
        reason: "The posting says it is closed",
        ...(closed ? { evidence: closed } : {}),
      });
      screening.verdict = "reject";
    }
    summary.verdicts[screening.verdict] += 1;
    return { ...job, screening };
  });
  return { jobs: screened, summary };
}

export interface SourceOutcome {
  source: DiscoverySource;
  /** Present when the source ran; absent when it threw. Jobs are deduplicated and carry dedupKeys. */
  result?: DiscoveryResult;
  /** Copies of one posting merged inside this run (e.g. LinkedIn + Indeed). */
  merges?: Merge[];
  screening?: ScreeningSummary;
  error?: string;
}

export interface MergedDiscovery {
  outcomes: SourceOutcome[];
  /** One canonical job per real posting across all sources. */
  jobs: CanonicalJob[];
  /** Postings found by more than one source in this discovery, merged. */
  crossSourceMerges: Merge[];
  /** Same company and title but not enough evidence to merge: reported only. */
  possibleDuplicates: PossibleDuplicate[];
}

/**
 * Deduplicate one run's jobs and attach identity keys. Rolecraft uses the
 * keys to merge these jobs with ones it already holds from earlier runs.
 */
export function withDedup(result: DiscoveryResult): { result: DiscoveryResult; merges: Merge[] } {
  const { jobs, merges } = dedupeJobs(result.jobs);
  const folded = merges.reduce((n, m) => n + m.from.length, 0);
  return {
    result: { ...result, jobs, metrics: { ...result.metrics, duplicates: result.metrics.duplicates + folded } },
    merges,
  };
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
        return screenOutcome(source, withDedup(result));
      }
      const result = await discoverPortalJobs(request.careerOps ?? {});
      return screenOutcome(source, withDedup(result));
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      const message = error instanceof Error ? error.message : String(error);
      return { source, error: typeof code === "string" ? `${code}: ${message}` : message };
    }
  });
  async function screenOutcome(
    source: DiscoverySource,
    deduped: { result: DiscoveryResult; merges: Merge[] },
  ): Promise<SourceOutcome> {
    if (!request.screening) return { source, ...deduped };
    const { jobs, summary } = await screenJobs(deduped.result.jobs, request.screening);
    return { source, result: { ...deduped.result, jobs }, merges: deduped.merges, screening: summary };
  }
  const outcomes = await Promise.all(tasks);
  return { outcomes, ...mergeJobs(outcomes) };
}

export function mergeJobs(
  outcomes: SourceOutcome[],
): Pick<MergedDiscovery, "jobs" | "crossSourceMerges" | "possibleDuplicates"> {
  const { jobs, merges, possibleDuplicates } = dedupeJobs(outcomes.flatMap((o) => o.result?.jobs ?? []));
  return { jobs, crossSourceMerges: merges, possibleDuplicates };
}

/** Save one source's run to runtime/discovery/<runId>.json and return the path. */
export function saveRun(result: DiscoveryResult, extra: Record<string, unknown> = {}, dir = join(repoRoot, "runtime", "discovery")): string {
  const path = join(dir, `${result.runId}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...extra, ...result }, null, 2)}\n`);
  return path;
}
