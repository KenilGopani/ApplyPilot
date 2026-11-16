import { canonicalJobSchema, type CanonicalJob } from "@applypilot/job-schema";

export const DEFAULT_ROLECRAFT_URL = "http://127.0.0.1:5173";
/** Rolecraft accepts at most 200 jobs per request; smaller keeps bodies modest. */
export const DEFAULT_BATCH_SIZE = 50;

export interface DiscoveryRunInfo {
  runId: string;
  adapter: string;
  status: "ok" | "partial" | "failed";
  startedAt: string;
  finishedAt: string | null;
  metrics: Record<string, unknown>;
}

export interface PushOptions {
  baseUrl?: string;
  batchSize?: number;
  fetch?: typeof fetch;
}

export interface PushResult {
  received: number;
  created: number;
  updated: number;
  /** Jobs Rolecraft merged into a job it already held (same posting, another source). */
  merged: number;
  batches: number;
}

export class RolecraftError extends Error {
  readonly status: number | null;
  /** Jobs already stored by earlier batches when this one failed. */
  readonly imported: number;

  constructor(message: string, status: number | null, imported: number) {
    super(message);
    this.name = "RolecraftError";
    this.status = status;
    this.imported = imported;
  }
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * Only a local Rolecraft is supported. Its development server signs loopback
 * requests in as the local user through the `__sites_local_auth` cookie; a
 * hosted Rolecraft needs real authentication, and refusing other hosts keeps
 * job data from being sent anywhere by mistake.
 */
export function resolveRolecraftUrl(raw = DEFAULT_ROLECRAFT_URL): URL {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || !LOOPBACK.has(url.hostname)) {
    throw new RolecraftError(
      `Rolecraft URL must be a local address (127.0.0.1 or localhost), got ${url.origin}`,
      null,
      0,
    );
  }
  return new URL(url.origin);
}

/**
 * Import canonical jobs into Rolecraft's Discovered inbox, in batches. Every
 * job is validated first, so a bad record fails before anything is sent.
 * Importing is idempotent: Rolecraft keeps inbox decisions and merges
 * provenance when it sees a job again.
 */
export async function pushDiscovery(
  run: DiscoveryRunInfo,
  jobs: CanonicalJob[],
  options: PushOptions = {},
): Promise<PushResult> {
  const base = resolveRolecraftUrl(options.baseUrl);
  const doFetch = options.fetch ?? fetch;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 200) {
    throw new RolecraftError("batchSize must be between 1 and 200", null, 0);
  }
  jobs.forEach((job, i) => {
    const parsed = canonicalJobSchema.safeParse(job);
    if (!parsed.success) {
      throw new RolecraftError(
        `job ${i} (${job?.id ?? "no id"}) is not a valid CanonicalJob: ${parsed.error.issues[0]?.message}`,
        null,
        0,
      );
    }
  });

  const total: PushResult = { received: 0, created: 0, updated: 0, merged: 0, batches: 0 };
  const endpoint = new URL("/api/discovered-jobs", base);
  // An empty run is still sent once, so Rolecraft records that it happened.
  const batches: CanonicalJob[][] = [];
  for (let i = 0; i < jobs.length; i += batchSize) batches.push(jobs.slice(i, i + batchSize));
  if (batches.length === 0) batches.push([]);
  for (const batch of batches) {
    let response: Response;
    try {
      response = await doFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "__sites_local_auth=1",
          Origin: base.origin,
        },
        body: JSON.stringify({ run, jobs: batch }),
      });
    } catch (error) {
      throw new RolecraftError(
        `cannot reach Rolecraft at ${base.origin} (is \`npm run dev\` running in KenilJobBoard?): ${(error as Error).message}`,
        null,
        total.received,
      );
    }
    const body = (await response.json().catch(() => ({}))) as {
      received?: number;
      created?: number;
      updated?: number;
      merged?: number;
      error?: string;
      issues?: string[];
    };
    if (!response.ok) {
      const detail = [body.error, ...(body.issues ?? []).slice(0, 3)].filter(Boolean).join("; ");
      throw new RolecraftError(
        `Rolecraft rejected batch ${total.batches + 1} (HTTP ${response.status}): ${detail || response.statusText}`,
        response.status,
        total.received,
      );
    }
    total.received += body.received ?? 0;
    total.created += body.created ?? 0;
    total.updated += body.updated ?? 0;
    total.merged += body.merged ?? 0;
    total.batches += 1;
  }
  return total;
}

// ------------------------------------------------------------ reading back

/** The inbox row Rolecraft returns (subset ApplyPilot uses). */
export interface DiscoveredJobSummary {
  id: string;
  status: string;
  title: string;
  company: string;
  location: string | null;
  sourceUrl: string;
  postedAt: string | null;
  sites: string[];
  screeningVerdict: "pass" | "review" | "reject" | null;
  authorization: string | null;
  evaluationStage: "triage" | "full" | null;
  evaluationScore: number | null;
  evaluationDecision: string | null;
}

export interface DiscoveredJobDetail extends DiscoveredJobSummary {
  description: string | null;
  provenance: { site: string; url: string; applyUrl?: string }[];
  /** The stored triage or full evaluation, as ApplyPilot sent it. */
  evaluation?: {
    stage: "triage" | "full";
    evaluation?: { missing?: { text: string; category?: string }[]; roleClassification?: string };
    resumeRouting?: { recommended: "core-swe" | "applied-ai" | "hybrid" };
  } | null;
}

async function call<T>(
  path: string,
  init: RequestInit & { baseUrl?: string; fetch?: typeof fetch } = {},
): Promise<T> {
  const base = resolveRolecraftUrl(init.baseUrl);
  const doFetch = init.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(new URL(path, base), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Cookie: "__sites_local_auth=1",
        Origin: base.origin,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch (error) {
    throw new RolecraftError(`cannot reach Rolecraft at ${base.origin}: ${(error as Error).message}`, null, 0);
  }
  const body = (await response.json().catch(() => ({}))) as T & { error?: string; issues?: string[] };
  if (!response.ok) {
    const detail = [body.error, ...(body.issues ?? []).slice(0, 3)].filter(Boolean).join("; ");
    throw new RolecraftError(`Rolecraft ${path} failed (HTTP ${response.status}): ${detail}`, response.status, 0);
  }
  return body;
}

/** Inbox jobs with a status, optionally only those the hard filters kept. */
export async function listDiscoveredJobs(
  query: { status?: string; screening?: "kept" | "rejected" },
  options: PushOptions = {},
): Promise<DiscoveredJobSummary[]> {
  const params = new URLSearchParams({ limit: "500" });
  if (query.status) params.set("status", query.status);
  if (query.screening) params.set("screening", query.screening);
  const body = await call<{ jobs: DiscoveredJobSummary[] }>(`/api/discovered-jobs?${params}`, options);
  return body.jobs;
}

export async function getDiscoveredJob(id: string, options: PushOptions = {}): Promise<DiscoveredJobDetail> {
  const body = await call<{ job: DiscoveredJobDetail }>(`/api/discovered-jobs/${encodeURIComponent(id)}`, options);
  return body.job;
}

/** Store a triage line or a full evaluation on a discovered job. */
export async function putEvaluation(
  id: string,
  payload: object,
  options: PushOptions = {},
): Promise<"stored" | "kept-full"> {
  const body = await call<{ result: "stored" | "kept-full" }>(
    `/api/discovered-jobs/${encodeURIComponent(id)}/evaluation`,
    { ...options, method: "PUT", body: JSON.stringify(payload) },
  );
  return body.result;
}

/** Store an application preparation bundle on a discovered job. */
export async function putPreparation(id: string, bundle: object, options: PushOptions = {}): Promise<void> {
  await call<{ ok: boolean }>(`/api/discovered-jobs/${encodeURIComponent(id)}/preparation`, {
    ...options,
    method: "PUT",
    body: JSON.stringify(bundle),
  });
}
