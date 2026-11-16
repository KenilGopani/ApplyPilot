import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalJobId,
  canonicalJobSchema,
  canonicalizeUrl,
  type CanonicalJob,
  type DiscoveryResult,
  type JobSourceName,
  type MappedJob,
  type RejectedRecord,
  type RemoteType,
  type SiteMetrics,
} from "@applypilot/job-schema";
import { CareerOpsError } from "./errors.ts";
import { scanPortals, type ScanOptions, type ScanReceipt } from "./operations.ts";
import { resolveCareerOpsDataRoot, resolveCareerOpsHome } from "./runtime.ts";

/**
 * Column order of Career Ops' `data/scan-history.tsv`, from its
 * `lib/scan-history-columns.mjs` (append-only: new columns go at the end,
 * older rows may stop short). The smoke test checks this copy against the
 * pinned checkout so an upstream change is caught before it is mis-read.
 */
export const SCAN_HISTORY_COLUMNS = [
  "url",
  "first_seen",
  "portal",
  "title",
  "company",
  "status",
  "location",
  "fingerprint",
  "posted_at",
  "trust_score",
  "trust_flags",
  "normalized_company",
  "requisition_id",
  "language",
  "listing_key",
  "closes_at",
] as const;
export type ScanHistoryRow = Partial<Record<(typeof SCAN_HISTORY_COLUMNS)[number], string>>;

/** Undo Career Ops' spreadsheet-formula escaping (`lib/tsv-formula-escape.mjs`). */
export function unescapeFormulaCell(cell: string): string {
  return cell.startsWith("'") ? cell.replace(/^'(?='*[=+\-@])/, "") : cell;
}

/** Parse scan-history.tsv text by declared column position; the header row is skipped. */
export function parseScanHistory(text: string): ScanHistoryRow[] {
  const rows: ScanHistoryRow[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const cells = line.replace(/\r$/, "").split("\t").map(unescapeFormulaCell);
    if (cells[0] === "url") continue; // header
    const row: ScanHistoryRow = {};
    SCAN_HISTORY_COLUMNS.forEach((name, i) => {
      const value = cells[i]?.trim();
      if (value) row[name] = value;
    });
    rows.push(row);
  }
  return rows;
}

/** ATS host -> platform source. Anything else is the employer's own board. */
export function sourceForUrl(url: string): JobSourceName {
  const host = new URL(url).hostname.toLowerCase();
  if (host === "greenhouse.io" || host.endsWith(".greenhouse.io")) return "greenhouse";
  if (host === "lever.co" || host.endsWith(".lever.co")) return "lever";
  if (host === "ashbyhq.com" || host.endsWith(".ashbyhq.com")) return "ashby";
  if (host === "wellfound.com" || host.endsWith(".wellfound.com")) return "wellfound";
  return "company";
}

/**
 * Remote type from the posting's own location text only. A location that
 * lists offices alongside a remote option ("Remote-Friendly | San Francisco")
 * is left unknown rather than guessed.
 */
export function remoteTypeFromLocation(location: string | undefined): RemoteType {
  if (!location) return "unknown";
  const parts = location.split("|").map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) return "unknown";
  if (parts.every((p) => /\bhybrid\b/.test(p))) return "hybrid";
  if (parts.every((p) => /^(fully )?remote\b/.test(p) && !/friendly|travel/.test(p))) return "remote";
  return "unknown";
}

export interface PortalMappingContext {
  runId: string;
  discoveredAt: string;
  upstreamVersion?: string;
}

/** One scan-history row -> CanonicalJob. Throws with a readable reason. */
export function mapScanHistoryRow(row: ScanHistoryRow, ctx: PortalMappingContext): MappedJob {
  const warnings: string[] = [];
  let url: URL;
  try {
    url = new URL(row.url ?? "");
  } catch {
    throw new Error(`url is not a URL: ${row.url ?? "(missing)"}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`url is not http(s): ${row.url}`);
  if (!row.title) throw new Error("title is missing");
  if (!row.company) throw new Error("company is missing");

  const sourceUrl = url.toString();
  const source = sourceForUrl(sourceUrl);
  const postedAt = /^\d{4}-\d{2}-\d{2}/.test(row.posted_at ?? "") ? row.posted_at!.slice(0, 10) : undefined;
  if (row.posted_at && !postedAt) warnings.push(`posted_at dropped: ${row.posted_at}`);
  const site = row.portal ?? source;

  const job: CanonicalJob = {
    // URL identity: the same posting from the same board always gets the same id.
    id: canonicalJobId(source, canonicalizeUrl(sourceUrl)),
    externalId: row.requisition_id,
    title: row.title,
    company: row.company,
    location: row.location,
    remoteType: remoteTypeFromLocation(row.location),
    source,
    sourceUrl,
    postedAt,
    discoveredAt: ctx.discoveredAt,
    provenance: [
      {
        provider: source,
        site,
        url: sourceUrl,
        externalId: row.requisition_id,
        adapter: "career-ops",
        upstreamVersion: ctx.upstreamVersion,
        runId: ctx.runId,
        discoveredAt: ctx.discoveredAt,
      },
    ],
    rawSource: row,
  };
  const compact = JSON.parse(JSON.stringify(job)) as CanonicalJob;
  const result = canonicalJobSchema.safeParse(compact);
  if (!result.success) {
    throw new Error(
      `invalid canonical job: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
    );
  }
  return { job: result.data, warnings };
}

/**
 * Turn one scan's receipt plus the scan-history it appended into a
 * DiscoveryResult. Only the URLs the receipt says were added belong to this
 * run; each is looked up in scan-history (latest `added` row wins). A URL the
 * receipt names but the history lacks is reported as rejected.
 */
export function mapPortalScan(
  receipt: ScanReceipt,
  historyText: string,
  run: { runId: string; startedAt: string; finishedAt: string; durationMs: number; upstreamVersion: string | null },
): DiscoveryResult {
  const byUrl = new Map<string, ScanHistoryRow>();
  for (const row of parseScanHistory(historyText)) {
    if (row.url && row.status === "added") byUrl.set(row.url, row);
  }
  const ctx: PortalMappingContext = {
    runId: run.runId,
    discoveredAt: run.finishedAt,
    upstreamVersion: run.upstreamVersion ?? undefined,
  };
  const bySite: Record<string, SiteMetrics> = {};
  const bump = (site: string, key: "returned" | "mapped" | "rejected") => {
    bySite[site] ??= { returned: 0, mapped: 0, rejected: 0, error: null, warnings: [] };
    bySite[site][key] += 1;
  };
  const jobs: CanonicalJob[] = [];
  const jobWarnings: Record<string, string[]> = {};
  const rejected: RejectedRecord[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  receipt.added_urls.forEach((url, index) => {
    const row = byUrl.get(url);
    const site = row?.portal ?? "unknown";
    bump(site, "returned");
    if (!row) {
      rejected.push({ index, reason: "added by the scan but missing from scan-history.tsv", record: { url } });
      bump(site, "rejected");
      return;
    }
    try {
      const { job, warnings } = mapScanHistoryRow(row, ctx);
      if (seen.has(job.id)) {
        duplicates += 1;
        return;
      }
      seen.add(job.id);
      jobs.push(job);
      if (warnings.length) jobWarnings[job.id] = warnings;
      bump(site, "mapped");
    } catch (error) {
      rejected.push({ index, reason: (error as Error).message, record: row });
      bump(site, "rejected");
    }
  });

  const errors = receipt.errors.map((e) => ({ site: e.company, message: e.error }));
  const failedAll = receipt.scanned > 0 && receipt.errors.length >= receipt.scanned;
  return {
    adapter: "career-ops",
    status: failedAll ? "failed" : errors.length || rejected.length ? "partial" : "ok",
    runId: run.runId,
    upstreamVersion: run.upstreamVersion,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    metrics: {
      requestedPerSite: null,
      returned: receipt.added_urls.length,
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

export function careerOpsVersion(home = resolveCareerOpsHome()): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(home, "package.json"), "utf8")) as { version?: string };
    return pkg.version ? `career-ops@${pkg.version}` : null;
  } catch {
    return null;
  }
}

/**
 * Run a real portal scan (Career Ops records it in its own pipeline and
 * history) and return the newly added postings as canonical jobs. Postings a
 * previous scan already added are not returned again: Career Ops deduplicates
 * against its history, and they are already in Rolecraft.
 */
export async function discoverPortalJobs(
  options: Omit<ScanOptions, "dryRun"> = {},
): Promise<DiscoveryResult & { receipt: ScanReceipt }> {
  const dataRoot = options.dataRoot ?? resolveCareerOpsDataRoot();
  const startedAt = new Date().toISOString();
  const scan = await scanPortals({ ...options, dataRoot, dryRun: false });
  const finishedAt = new Date().toISOString();
  const historyPath = join(dataRoot, "data", "scan-history.tsv");
  if (scan.receipt.added > 0 && !existsSync(historyPath)) {
    throw new CareerOpsError("CAREER_OPS_PROTOCOL_ERROR", `scan added postings but ${historyPath} does not exist`);
  }
  const history = existsSync(historyPath) ? readFileSync(historyPath, "utf8") : "";
  const result = mapPortalScan(scan.receipt, history, {
    runId: `run_co_${randomBytes(6).toString("hex")}`,
    startedAt,
    finishedAt,
    durationMs: scan.durationMs,
    upstreamVersion: careerOpsVersion(options.home),
  });
  return { ...result, receipt: scan.receipt };
}
