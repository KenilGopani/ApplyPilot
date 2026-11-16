import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dueSearches, runSearch, scheduleSchema, type Search } from "../src/scheduler.ts";

const search: Search = scheduleSchema.parse({
  searches: [{ name: "morning", at: "08:30", sources: ["jobspy"], query: "ai engineer" }],
}).searches[0]!;

test("schedules are validated: unique names, a query for jobspy, real times", () => {
  assert.equal(scheduleSchema.safeParse({ searches: [{ ...search, at: "25:00" }] }).success, false);
  assert.equal(scheduleSchema.safeParse({ searches: [{ ...search, query: undefined }] }).success, false);
  assert.equal(scheduleSchema.safeParse({ searches: [search, search] }).success, false);
  assert.equal(scheduleSchema.safeParse({ searches: [{ name: "portals", at: "07:00", sources: ["career-ops"] }] }).success, true);
});

test("a search is due once per day after its time, including after the machine slept", () => {
  const schedule = { searches: [search, { ...search, name: "afternoon", at: "15:00" }] };
  const at = (h: number, m: number) => new Date(2026, 10, 16, h, m);
  assert.deepEqual(dueSearches(schedule, {}, at(8, 0)).map((s) => s.name), []);
  assert.deepEqual(dueSearches(schedule, {}, at(8, 30)).map((s) => s.name), ["morning"]);
  assert.deepEqual(dueSearches(schedule, { morning: "2026-11-16" }, at(16, 0)).map((s) => s.name), ["afternoon"]);
  assert.deepEqual(dueSearches(schedule, { morning: "2026-11-15" }, at(9, 0)).map((s) => s.name), ["morning"]);
});

test("a run records found, new, duplicate, filtered and errors, and never quick-checks unless asked", async () => {
  const logDir = mkdtempSync(join(tmpdir(), "applypilot-sched-"));
  let evaluated = false;
  const result = {
    adapter: "jobspy" as const,
    status: "partial" as const,
    runId: "run_sched_test",
    upstreamVersion: null,
    startedAt: "2026-11-16T08:30:00.000Z",
    finishedAt: "2026-11-16T08:31:00.000Z",
    durationMs: 1,
    metrics: { requestedPerSite: 15, returned: 10, mapped: 9, rejected: 1, duplicates: 1, bySite: {} },
    jobs: [],
    jobWarnings: {},
    rejected: [],
    errors: [{ site: "linkedin", message: "429" }],
  };
  const record = await runSearch(search, {
    logDir,
    runsDir: logDir,
    policy: null,
    now: () => new Date("2026-11-16T08:30:00Z"),
    discover: async (req) => {
      assert.equal(req.jobspy?.search_term, "ai engineer");
      return {
        outcomes: [
          { source: "jobspy", result, screening: { descriptionsFetched: 0, descriptionsUnavailable: 0, closed: 0, verdicts: { pass: 5, review: 1, reject: 3 } } },
          { source: "career-ops", error: "CAREER_OPS_CONFIG_ERROR: no portals" },
        ],
        jobs: [],
        crossSourceMerges: [],
        possibleDuplicates: [],
      };
    },
    push: async () => ({ received: 9, created: 6, updated: 2, merged: 1, batches: 1 }),
    evaluate: async () => {
      evaluated = true;
      throw new Error("must not run");
    },
  });
  assert.equal(evaluated, false);
  assert.deepEqual(
    [record.jobs_found, record.jobs_new, record.jobs_duplicate, record.jobs_filtered, record.jobs_evaluated],
    [10, 6, 4, 3, 0],
  );
  assert.deepEqual([...record.errors].sort(), ["career-ops: CAREER_OPS_CONFIG_ERROR: no portals", "jobspy linkedin: 429"]);
  const logged = JSON.parse(readFileSync(join(logDir, "schedule-runs.jsonl"), "utf8").trim());
  assert.equal(logged.search, "morning");
  assert.ok(logged.started_at && logged.completed_at);
});
