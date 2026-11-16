import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Where a posting was found. JobSpy boards that the platform does not track
 * individually (bayt, naukri, bdjobs, hellowork) map to "other"; the exact
 * upstream site name is kept in {@link CanonicalJobSource.site}.
 */
export const jobSources = [
  "linkedin",
  "indeed",
  "glassdoor",
  "ziprecruiter",
  "google",
  "greenhouse",
  "lever",
  "ashby",
  "wellfound",
  "company",
  "manual",
  "other",
] as const;
export type JobSourceName = (typeof jobSources)[number];

export const remoteTypes = ["remote", "hybrid", "onsite", "unknown"] as const;
export type RemoteType = (typeof remoteTypes)[number];

export const salaryIntervals = [
  "yearly",
  "monthly",
  "weekly",
  "daily",
  "hourly",
] as const;

/** Which engine produced a record. */
export const adapterNames = ["jobspy", "career-ops", "manual"] as const;

const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine(
    (v) => new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v,
    "Use a real calendar date",
  );

export const httpUrl = z
  .string()
  .max(2000)
  .refine((v) => {
    try {
      const url = new URL(v);
      return (url.protocol === "http:" || url.protocol === "https:") && !!url.hostname;
    } catch {
      return false;
    }
  }, "Use a valid http or https URL");

/**
 * One sighting of a posting in one upstream system. A canonical job keeps every
 * sighting (provenance is never discarded, even after deduplication).
 */
export const canonicalJobSourceSchema = z.object({
  provider: z.enum(jobSources),
  /** Exact upstream site/portal name, e.g. "zip_recruiter" or "greenhouse:acme". */
  site: z.string().min(1).max(100),
  url: httpUrl,
  /** Direct employer/ATS URL when the board exposes one. */
  applyUrl: httpUrl.optional(),
  externalId: z.string().min(1).max(200).optional(),
  adapter: z.enum(adapterNames),
  /** Version of the upstream engine that produced the record, e.g. "python-jobspy@1.4.1". */
  upstreamVersion: z.string().max(100).optional(),
  runId: z.string().min(1).max(100).optional(),
  discoveredAt: isoDateTime,
});
export type CanonicalJobSource = z.infer<typeof canonicalJobSourceSchema>;

export const canonicalJobSchema = z
  .object({
    id: z.string().regex(/^job_[0-9a-f]{16}$/),
    externalId: z.string().min(1).max(200).optional(),

    title: z.string().trim().min(1).max(300),
    company: z.string().trim().min(1).max(200),
    location: z.string().max(300).optional(),
    remoteType: z.enum(remoteTypes),
    description: z.string().max(200_000).optional(),

    source: z.enum(jobSources),
    sourceUrl: httpUrl,

    postedAt: isoDate.optional(),

    salaryMin: z.number().nonnegative().finite().optional(),
    salaryMax: z.number().nonnegative().finite().optional(),
    salaryCurrency: z.string().min(1).max(10).optional(),
    salaryInterval: z.enum(salaryIntervals).optional(),

    employmentType: z.string().max(200).optional(),

    discoveredAt: isoDateTime,

    /** Every system this posting was seen in; the first entry is the primary source. */
    provenance: z.array(canonicalJobSourceSchema).min(1),

    /** The untouched upstream record, kept for traceability and re-mapping. */
    rawSource: z.unknown().optional(),
  })
  .superRefine((job, ctx) => {
    if (
      job.salaryMin !== undefined &&
      job.salaryMax !== undefined &&
      job.salaryMin > job.salaryMax
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["salaryMax"],
        message: "salaryMax must be at least salaryMin",
      });
    }
    const primary = job.provenance[0];
    if (primary && (primary.provider !== job.source || primary.url !== job.sourceUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provenance", 0],
        message: "The first provenance entry must match source and sourceUrl",
      });
    }
  });
export type CanonicalJob = z.infer<typeof canonicalJobSchema>;

/**
 * Status of a discovered posting in the inbox. Deliberately separate from the
 * application stages: a discovered job is not an application.
 */
export const discoveryStatuses = ["new", "review", "saved", "skip", "applied"] as const;
export type DiscoveryStatus = (typeof discoveryStatuses)[number];

/**
 * Normalize a URL for identity: lowercase host, drop the fragment, tracking
 * parameters and a trailing slash. Other query parameters are kept because
 * some boards identify the posting by them (e.g. Indeed's `jk`).
 */
export function canonicalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|ref$|refid$|trk|tracking|src$|source$|gh_src$|lever-source)/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

/**
 * Deterministic job id: the same posting from the same source always gets the
 * same id, so re-running discovery is idempotent. Cross-source merging is the
 * deduplication engine's job (Phase 10), not the id's.
 */
export function canonicalJobId(source: string, externalIdOrUrl: string): string {
  const digest = createHash("sha256")
    .update(`${source}\u0000${externalIdOrUrl}`)
    .digest("hex");
  return `job_${digest.slice(0, 16)}`;
}
