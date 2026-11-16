import { createHash } from "node:crypto";
import { canonicalizeUrl, type CanonicalJob } from "@applypilot/job-schema";
import { normalizeCity, normalizeCompany, normalizeDescription, normalizeTitle } from "./normalize.ts";

/**
 * Key kinds, strongest first. Strong kinds merge automatically; `ct`
 * (company + title, no location) is too weak to merge on and only flags a
 * possible duplicate.
 *
 *   id    the job's own canonical id (lets Rolecraft fold a previously stored copy)
 *   url   a canonical posting or apply URL
 *   ats   an ATS job identity parsed from any URL (greenhouse / lever / ashby)
 *   req   a company's requisition id
 *   fp    a fingerprint of a long description
 *   cctl  company + title + city
 *   ct    company + title (weak)
 */
export const KEY_KINDS = ["id", "url", "ats", "req", "fp", "cctl", "ct"] as const;
export type KeyKind = (typeof KEY_KINDS)[number];
export const STRONG_KINDS: ReadonlySet<KeyKind> = new Set(["id", "url", "ats", "req", "fp", "cctl"]);

/**
 * Kinds that identify ONE opening. Two jobs carrying different values of the
 * same conflict scope are different openings and are never merged, whatever
 * else they share (two "Software Engineer, SF" reqs at one company).
 */
export function conflictScope(key: string): string | null {
  if (key.startsWith("ats:")) return key.slice(0, key.indexOf(":", 4) + 1); // "ats:greenhouse:"
  if (key.startsWith("req:")) return key.slice(0, key.lastIndexOf(":") + 1); // "req:<company>:"
  return null;
}

export function keyKind(key: string): KeyKind {
  return key.slice(0, key.indexOf(":")) as KeyKind;
}

const MIN_FINGERPRINT_CHARS = 300;

/** Parse an ATS job identity out of a URL. Unknown hosts give nothing. */
export function atsIdentity(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "greenhouse.io" || host.endsWith(".greenhouse.io")) {
    // /{board}/jobs/{id}, or the embed form /embed/job_app?for={board}&token={id}
    const i = parts.indexOf("jobs");
    const id = i >= 0 ? parts[i + 1] : url.searchParams.get("token");
    return id && /^\d+$/.test(id) ? `greenhouse:${id}` : undefined;
  }
  // Employer career pages that embed Greenhouse carry the id as ?gh_jid=
  const ghJid = url.searchParams.get("gh_jid");
  if (ghJid && /^\d{5,}$/.test(ghJid)) return `greenhouse:${ghJid}`;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (host === "jobs.lever.co" && parts[1] && uuid.test(parts[1])) return `lever:${parts[1].toLowerCase()}`;
  if (host === "jobs.ashbyhq.com" && parts[1] && uuid.test(parts[1])) return `ashby:${parts[1].toLowerCase()}`;
  return undefined;
}

function safeCanonical(url: string): string | undefined {
  try {
    return canonicalizeUrl(url);
  } catch {
    return undefined;
  }
}

export interface JobKeys {
  strong: string[];
  weak: string[];
}

/** All identity keys of one job, from every sighting in its provenance. */
export function jobKeys(job: CanonicalJob): JobKeys {
  const strong = new Set<string>([`id:${job.id}`]);
  const urls = [job.sourceUrl, ...job.provenance.flatMap((p) => [p.url, p.applyUrl ?? ""])].filter(Boolean);
  for (const u of urls) {
    const canonical = safeCanonical(u);
    if (canonical) strong.add(`url:${canonical}`);
    const ats = atsIdentity(u);
    if (ats) strong.add(`ats:${ats}`);
  }
  const company = normalizeCompany(job.company);
  // Career Ops' externalId is the employer's requisition id; board ids
  // (JobSpy's "in-…", "li-…") are already covered by the URL key.
  for (const p of job.provenance) {
    if (p.adapter === "career-ops" && p.externalId && company) {
      strong.add(`req:${company}:${p.externalId.trim().toLowerCase()}`);
    }
  }
  const description = normalizeDescription(job.description);
  if (description.length >= MIN_FINGERPRINT_CHARS) {
    strong.add(`fp:${createHash("sha256").update(description).digest("hex").slice(0, 20)}`);
  }
  const title = normalizeTitle(job.title);
  const city = normalizeCity(job.location);
  const weak: string[] = [];
  if (company && title) {
    if (city) strong.add(`cctl:${company}|${title}|${city}`);
    weak.push(`ct:${company}|${title}`);
  }
  return { strong: [...strong], weak };
}

/** True when the two key sets name different openings (conflicting ATS or requisition ids). */
export function keysConflict(a: Iterable<string>, b: Iterable<string>): boolean {
  const scoped = new Map<string, Set<string>>();
  for (const key of a) {
    const scope = conflictScope(key);
    if (scope) (scoped.get(scope) ?? scoped.set(scope, new Set()).get(scope)!).add(key);
  }
  for (const key of b) {
    const scope = conflictScope(key);
    const mine = scope ? scoped.get(scope) : undefined;
    if (mine && !mine.has(key)) return true;
  }
  return false;
}
