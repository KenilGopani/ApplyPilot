import type { CanonicalJob, CanonicalJobSource, JobSourceName } from "@applypilot/job-schema";
import { KEY_KINDS, jobKeys, keyKind, keysConflict, type KeyKind } from "./keys.ts";

/**
 * Which sighting becomes the primary record of a merged job: the employer's
 * own posting first, job boards after, so the canonical URL is the one the
 * candidate should apply through.
 */
const SOURCE_RANK: Record<JobSourceName, number> = {
  greenhouse: 0,
  lever: 0,
  ashby: 0,
  company: 0,
  wellfound: 1,
  linkedin: 2,
  indeed: 2,
  glassdoor: 2,
  ziprecruiter: 2,
  google: 3,
  manual: 4,
  other: 4,
};

export interface Merge {
  /** The surviving id. */
  into: string;
  /** Ids folded into it. */
  from: string[];
  /** Strongest key kind that linked them. */
  by: KeyKind;
}

export interface PossibleDuplicate {
  a: string;
  b: string;
  key: string;
}

export interface DedupeResult {
  /** One job per real posting, each carrying `dedupKeys` (strong keys of all members). */
  jobs: CanonicalJob[];
  merges: Merge[];
  /** Same company and title, but not enough evidence (or a conflicting id) to merge. */
  possibleDuplicates: PossibleDuplicate[];
}

function provenanceKey(p: CanonicalJobSource): string {
  return `${p.site}\u0000${p.url}\u0000${p.runId ?? ""}`;
}

/**
 * Merge a cluster into its primary: the primary's fields win; any field the
 * primary lacks is filled from the next best member; every sighting is kept.
 * The primary's raw record is kept on the job; every member's raw record stays
 * in its saved run file, which each provenance entry's runId points to.
 */
export function mergeCluster(members: CanonicalJob[]): CanonicalJob {
  const ranked = [...members].sort(
    (a, b) =>
      SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
      a.discoveredAt.localeCompare(b.discoveredAt) ||
      a.id.localeCompare(b.id),
  );
  const primary = ranked[0]!;
  const merged: CanonicalJob = { ...primary };
  const fill = <K extends keyof CanonicalJob>(field: K) => {
    if (merged[field] !== undefined) return;
    const donor = ranked.find((m) => m[field] !== undefined);
    if (donor) merged[field] = donor[field];
  };
  for (const field of [
    "externalId", "location", "description", "postedAt", "employmentType",
  ] as const) fill(field);
  // Salary travels as a unit so min/max/currency/interval never mix sources.
  if (merged.salaryMin === undefined && merged.salaryMax === undefined) {
    const donor = ranked.find((m) => m.salaryMin !== undefined || m.salaryMax !== undefined);
    if (donor) {
      merged.salaryMin = donor.salaryMin;
      merged.salaryMax = donor.salaryMax;
      merged.salaryCurrency = donor.salaryCurrency;
      merged.salaryInterval = donor.salaryInterval;
    }
  }
  if (merged.remoteType === "unknown") {
    merged.remoteType = ranked.find((m) => m.remoteType !== "unknown")?.remoteType ?? "unknown";
  }
  const seen = new Set<string>();
  merged.provenance = ranked
    .flatMap((m) => m.provenance)
    .filter((p) => !seen.has(provenanceKey(p)) && seen.add(provenanceKey(p)));
  merged.discoveredAt = ranked.map((m) => m.discoveredAt).sort()[0]!;
  return JSON.parse(JSON.stringify(merged)) as CanonicalJob;
}

/**
 * Deduplicate one batch of canonical jobs. Strong keys are applied strongest
 * kind first; a link is refused when it would join two different openings
 * (conflicting ATS or requisition ids anywhere in either cluster).
 */
export function dedupeJobs(jobs: CanonicalJob[]): DedupeResult {
  const keys = jobs.map((j) => jobKeys(j));
  const parent = jobs.map((_, i) => i);
  const clusterKeys = keys.map((k) => new Set(k.strong));
  const linkedBy = new Map<number, KeyKind>();
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));

  for (const kind of KEY_KINDS) {
    if (kind === "ct") continue;
    const owner = new Map<string, number>();
    keys.forEach((k, i) => {
      for (const key of k.strong) {
        if (keyKind(key) !== kind) continue;
        const other = owner.get(key);
        if (other === undefined) {
          owner.set(key, i);
          continue;
        }
        const a = find(other);
        const b = find(i);
        if (a === b || keysConflict(clusterKeys[a]!, clusterKeys[b]!)) continue;
        parent[b] = a;
        for (const key2 of clusterKeys[b]!) clusterKeys[a]!.add(key2);
        if (!linkedBy.has(a)) linkedBy.set(a, kind);
      }
    });
  }

  const clusters = new Map<number, number[]>();
  jobs.forEach((_, i) => {
    const root = find(i);
    (clusters.get(root) ?? clusters.set(root, []).get(root)!).push(i);
  });

  const out: CanonicalJob[] = [];
  const merges: Merge[] = [];
  const rootOfJob = new Map<string, number>();
  for (const [root, members] of clusters) {
    const memberJobs = members.map((i) => jobs[i]!);
    const merged = members.length > 1 ? mergeCluster(memberJobs) : { ...memberJobs[0]! };
    merged.dedupKeys = [...clusterKeys[root]!].sort();
    out.push(merged);
    for (const j of memberJobs) rootOfJob.set(j.id, root);
    // Copies with the same id (one posting returned twice) collapse silently.
    const from = [...new Set(memberJobs.map((j) => j.id))].filter((id) => id !== merged.id);
    if (from.length) merges.push({ into: merged.id, from, by: linkedBy.get(root) ?? "id" });
  }

  // Weak matches across clusters are reported, never merged.
  const possibleDuplicates: PossibleDuplicate[] = [];
  const weakOwner = new Map<string, number>();
  keys.forEach((k, i) => {
    for (const key of k.weak) {
      const other = weakOwner.get(key);
      if (other === undefined) weakOwner.set(key, i);
      else if (find(other) !== find(i)) {
        possibleDuplicates.push({ a: jobs[other]!.id, b: jobs[i]!.id, key });
      }
    }
  });
  return { jobs: out, merges, possibleDuplicates };
}
