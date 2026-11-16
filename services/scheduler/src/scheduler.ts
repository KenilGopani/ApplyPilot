import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadCandidateProfile, toFilterPolicy } from "@applypilot/candidate-profile";
import { runDiscovery, runInfo, saveRun, type DiscoverySource, type MergedDiscovery } from "@applypilot/discovery";
import { evaluateInbox } from "@applypilot/evaluation";
import { pushDiscovery, type PushOptions } from "@applypilot/rolecraft-client";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const SCHEDULE_FILE = join(repoRoot, "runtime", "schedule.json");
export const LOG_DIR = join(repoRoot, "runtime", "logs");

export const searchSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  /** Local time HH:MM. */
  at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  sources: z.array(z.enum(["jobspy", "career-ops"])).min(1),
  query: z.string().min(1).max(200).optional(),
  sites: z.array(z.string()).default(["indeed", "linkedin"]),
  location: z.string().max(200).optional(),
  results: z.number().int().min(1).max(200).default(15),
  hoursOld: z.number().int().min(1).max(720).optional(),
  /** Quick checks after the run (uses your Claude login); 0 = none. Full evaluations are never automatic. */
  triageLimit: z.number().int().min(0).max(40).default(0),
});
export const scheduleSchema = z
  .object({ searches: z.array(searchSchema).min(1) })
  .refine((s) => new Set(s.searches.map((x) => x.name)).size === s.searches.length, "search names must be unique")
  .refine(
    (s) => s.searches.every((x) => !x.sources.includes("jobspy") || x.query),
    "a search that uses jobspy needs a query",
  );
export type Search = z.infer<typeof searchSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;

export function loadSchedule(path = SCHEDULE_FILE): Schedule {
  if (!existsSync(path)) {
    throw new Error(`No schedule at ${path}. Copy config/schedule.example.json there and edit it.`);
  }
  return scheduleSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** One line in runtime/logs/schedule-runs.jsonl (the plan's search-run record). */
export interface ScheduledRunRecord {
  search: string;
  started_at: string;
  completed_at: string;
  sources: DiscoverySource[];
  queries: string[];
  jobs_found: number;
  jobs_new: number;
  jobs_duplicate: number;
  jobs_filtered: number;
  jobs_evaluated: number;
  errors: string[];
}

export interface RunDeps {
  discover?: typeof runDiscovery;
  push?: typeof pushDiscovery;
  evaluate?: typeof evaluateInbox;
  policy?: ReturnType<typeof toFilterPolicy> | null;
  rolecraft?: PushOptions;
  logDir?: string;
  /** Where run files go (default runtime/discovery). */
  runsDir?: string;
  now?: () => Date;
}

/**
 * Run one scheduled search: discover, screen, push to Rolecraft, then
 * (only if configured) quick-check new jobs. Inbox statuses and application
 * decisions are never changed.
 */
export async function runSearch(search: Search, deps: RunDeps = {}): Promise<ScheduledRunRecord> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();
  let policy = deps.policy;
  if (policy === undefined) {
    try {
      policy = toFilterPolicy(loadCandidateProfile());
    } catch {
      policy = null;
    }
  }
  const merged: MergedDiscovery = await (deps.discover ?? runDiscovery)({
    sources: search.sources,
    jobspy: search.sources.includes("jobspy")
      ? {
          site_name: search.sites,
          search_term: search.query,
          location: search.location,
          results_wanted: search.results,
          hours_old: search.hoursOld,
        }
      : undefined,
    screening: policy ? { policy } : undefined,
  });
  const record: ScheduledRunRecord = {
    search: search.name,
    started_at: startedAt,
    completed_at: startedAt,
    sources: search.sources,
    queries: search.query ? [search.query] : [],
    jobs_found: 0,
    jobs_new: 0,
    jobs_duplicate: 0,
    jobs_filtered: 0,
    jobs_evaluated: 0,
    errors: [],
  };
  for (const outcome of merged.outcomes) {
    if (!outcome.result) {
      record.errors.push(`${outcome.source}: ${outcome.error}`);
      continue;
    }
    const r = outcome.result;
    saveRun(r, {}, deps.runsDir);
    record.jobs_found += r.metrics.returned;
    record.jobs_duplicate += r.metrics.duplicates;
    record.jobs_filtered += outcome.screening?.verdicts.reject ?? 0;
    for (const e of r.errors) record.errors.push(`${outcome.source} ${e.site}: ${e.message}`);
    try {
      const pushed = await (deps.push ?? pushDiscovery)(runInfo(r), r.jobs, deps.rolecraft);
      record.jobs_new += pushed.created;
      record.jobs_duplicate += pushed.updated + pushed.merged;
    } catch (error) {
      record.errors.push(`push ${outcome.source}: ${(error as Error).message}`);
    }
  }
  if (search.triageLimit > 0) {
    try {
      const evaluated = await (deps.evaluate ?? evaluateInbox)({
        triageLimit: search.triageLimit,
        limit: 0,
        rolecraft: deps.rolecraft,
      });
      record.jobs_evaluated = evaluated.triaged.length;
      if (evaluated.stoppedByLimit) record.errors.push(`quick check stopped: ${evaluated.stoppedByLimit}`);
    } catch (error) {
      record.errors.push(`quick check: ${(error as Error).message}`);
    }
  }
  record.completed_at = now().toISOString();
  const logDir = deps.logDir ?? LOG_DIR;
  mkdirSync(logDir, { recursive: true });
  appendFileSync(join(logDir, "schedule-runs.jsonl"), `${JSON.stringify(record)}\n`);
  return record;
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Searches whose time has passed today and that have not run today. */
export function dueSearches(schedule: Schedule, lastRun: Record<string, string>, now: Date): Search[] {
  const today = localDay(now);
  return schedule.searches.filter((s) => localTime(now) >= s.at && lastRun[s.name] !== today);
}

/**
 * Keep running, checking every minute for due searches. A search that was
 * missed while the machine slept runs once when it wakes, never repeatedly.
 */
export async function startScheduler(options: { onRun?: (r: ScheduledRunRecord) => void; signal?: AbortSignal; deps?: RunDeps } = {}) {
  const stateFile = join(options.deps?.logDir ?? LOG_DIR, "schedule-state.json");
  const readState = (): Record<string, string> => {
    try {
      return JSON.parse(readFileSync(stateFile, "utf8"));
    } catch {
      return {};
    }
  };
  while (!options.signal?.aborted) {
    const schedule = loadSchedule();
    const state = readState();
    for (const search of dueSearches(schedule, state, new Date())) {
      const record = await runSearch(search, options.deps);
      state[search.name] = localDay(new Date());
      mkdirSync(dirname(stateFile), { recursive: true });
      writeFileSync(stateFile, JSON.stringify(state));
      options.onRun?.(record);
    }
    await new Promise((r) => setTimeout(r, 60_000));
  }
}
