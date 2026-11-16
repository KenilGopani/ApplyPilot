import {
  canonicalJobId,
  canonicalJobSchema,
  canonicalizeUrl,
  salaryIntervals,
  type CanonicalJob,
  type JobSourceName,
  type RemoteType,
} from "@applypilot/job-schema";
import { jobSpyRecordSchema, type JobSpyEnvelope, type JobSpyRecord } from "./envelope.ts";

/** JobSpy `site` value -> platform source. Unlisted boards become "other". */
export const siteToSource: Readonly<Record<string, JobSourceName>> = {
  linkedin: "linkedin",
  indeed: "indeed",
  glassdoor: "glassdoor",
  zip_recruiter: "ziprecruiter",
  google: "google",
};

export interface MappingContext {
  runId: string;
  discoveredAt: string;
  upstreamVersion?: string;
}

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

const trimmed = (v: string | undefined) => {
  const t = v?.trim();
  return t ? t : undefined;
};

function safeUrl(v: string | undefined): string | undefined {
  if (!v) return undefined;
  try {
    const url = new URL(v);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function remoteTypeOf(record: JobSpyRecord): RemoteType {
  const wfh = record.work_from_home_type?.toLowerCase() ?? "";
  if (wfh.includes("hybrid")) return "hybrid";
  if (record.is_remote === true) return "remote";
  if (/remote|work from home|wfh/.test(wfh)) return "remote";
  if (/office|on-?site/.test(wfh)) return "onsite";
  // is_remote === false only means "not flagged remote"; it does not prove on-site.
  return "unknown";
}

/**
 * Translate one JobSpy row. Throws with a readable reason when the row cannot
 * become a valid CanonicalJob; the caller records it as rejected.
 */
export function mapJobSpyRecord(raw: unknown, ctx: MappingContext): MappedJob {
  const parsed = jobSpyRecordSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `not a JobSpy record: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
    );
  }
  const record = parsed.data;
  const warnings: string[] = [];
  const sourceUrl = safeUrl(record.job_url);
  if (!sourceUrl) throw new Error(`job_url is not an http(s) URL: ${record.job_url}`);
  const company = trimmed(record.company);
  if (!company) throw new Error("company is missing");
  const title = trimmed(record.title);
  if (!title) throw new Error("title is missing");

  const source = siteToSource[record.site] ?? "other";
  const externalId = trimmed(record.id);
  const applyUrl = safeUrl(record.job_url_direct);
  if (record.job_url_direct && !applyUrl) warnings.push("job_url_direct dropped: not an http(s) URL");

  let salaryMin = record.min_amount;
  let salaryMax = record.max_amount;
  if (salaryMin !== undefined && salaryMax !== undefined && salaryMin > salaryMax) {
    warnings.push(`salary dropped: min ${salaryMin} > max ${salaryMax}`);
    salaryMin = salaryMax = undefined;
  }
  const hasSalary = salaryMin !== undefined || salaryMax !== undefined;
  const interval = (salaryIntervals as readonly string[]).includes(record.interval ?? "")
    ? (record.interval as CanonicalJob["salaryInterval"])
    : undefined;

  const postedAt = /^\d{4}-\d{2}-\d{2}$/.test(record.date_posted ?? "")
    ? record.date_posted
    : undefined;
  if (record.date_posted && !postedAt) warnings.push(`date_posted dropped: ${record.date_posted}`);

  const job: CanonicalJob = {
    id: canonicalJobId(record.site, externalId ?? canonicalizeUrl(sourceUrl)),
    externalId,
    title,
    company,
    location: trimmed(record.location),
    remoteType: remoteTypeOf(record),
    description: trimmed(record.description),
    source,
    sourceUrl,
    postedAt,
    salaryMin,
    salaryMax,
    salaryCurrency: hasSalary ? trimmed(record.currency) : undefined,
    salaryInterval: hasSalary ? interval : undefined,
    employmentType: trimmed(record.job_type),
    discoveredAt: ctx.discoveredAt,
    provenance: [
      {
        provider: source,
        site: record.site,
        url: sourceUrl,
        applyUrl,
        externalId,
        adapter: "jobspy",
        upstreamVersion: ctx.upstreamVersion,
        runId: ctx.runId,
        discoveredAt: ctx.discoveredAt,
      },
    ],
    rawSource: raw,
  };
  // Drop undefined keys so the stored JSON stays minimal and stable.
  const compact = JSON.parse(JSON.stringify(job)) as CanonicalJob;
  compact.rawSource = raw;
  const result = canonicalJobSchema.safeParse(compact);
  if (!result.success) {
    throw new Error(
      `invalid canonical job: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
    );
  }
  return { job: result.data, warnings };
}

export interface SiteMetrics {
  returned: number;
  mapped: number;
  rejected: number;
  error: string | null;
  warnings: string[];
}

export interface DiscoveryResult {
  status: "ok" | "partial" | "failed";
  runId: string;
  upstreamVersion: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  metrics: {
    requestedPerSite: number;
    returned: number;
    mapped: number;
    rejected: number;
    /** Same posting returned twice by one board in one run (kept once). */
    duplicates: number;
    bySite: Record<string, SiteMetrics>;
  };
  jobs: CanonicalJob[];
  jobWarnings: Record<string, string[]>;
  rejected: RejectedRecord[];
  errors: { site: string; message: string }[];
}

/** Translate a whole worker envelope. Never drops a record silently. */
export function mapJobSpyEnvelope(envelope: JobSpyEnvelope): DiscoveryResult {
  const ctx: MappingContext = {
    runId: envelope.run_id,
    discoveredAt: envelope.finished_at ?? envelope.started_at,
    upstreamVersion: envelope.upstream.version
      ? `${envelope.upstream.package}@${envelope.upstream.version}`
      : undefined,
  };
  const bySite: Record<string, SiteMetrics> = {};
  for (const [site, m] of Object.entries(envelope.metrics.by_site)) {
    bySite[site] = { returned: m.returned, mapped: 0, rejected: 0, error: m.error, warnings: m.warnings };
  }
  const siteOf = (raw: unknown) =>
    typeof raw === "object" && raw && typeof (raw as { site?: unknown }).site === "string"
      ? (raw as { site: string }).site
      : "unknown";
  const bump = (site: string, key: "mapped" | "rejected") => {
    bySite[site] ??= { returned: 0, mapped: 0, rejected: 0, error: null, warnings: [] };
    bySite[site][key] += 1;
  };

  const jobs: CanonicalJob[] = [];
  const jobWarnings: Record<string, string[]> = {};
  const rejected: RejectedRecord[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  envelope.records.forEach((raw, index) => {
    const site = siteOf(raw);
    try {
      const { job, warnings } = mapJobSpyRecord(raw, ctx);
      if (seen.has(job.id)) {
        duplicates += 1;
        return;
      }
      seen.add(job.id);
      jobs.push(job);
      if (warnings.length) jobWarnings[job.id] = warnings;
      bump(site, "mapped");
    } catch (error) {
      rejected.push({ index, reason: (error as Error).message, record: raw });
      bump(site, "rejected");
    }
  });

  const errors = Object.entries(bySite)
    .filter(([, m]) => m.error)
    .map(([site, m]) => ({ site, message: m.error as string }));
  const sites = Object.keys(envelope.metrics.by_site);
  const failedSites = sites.filter((s) => envelope.metrics.by_site[s]?.error);
  const status =
    sites.length > 0 && failedSites.length === sites.length
      ? "failed"
      : failedSites.length > 0 || rejected.length > 0
        ? "partial"
        : "ok";

  return {
    status,
    runId: envelope.run_id,
    upstreamVersion: envelope.upstream.version,
    startedAt: envelope.started_at,
    finishedAt: envelope.finished_at,
    durationMs: envelope.duration_ms,
    metrics: {
      requestedPerSite: envelope.metrics.requested_per_site,
      returned: envelope.records.length,
      mapped: jobs.length,
      rejected: rejected.length,
      duplicates,
      bySite,
    },
    jobs,
    jobWarnings,
    rejected,
    errors,
  };
}
