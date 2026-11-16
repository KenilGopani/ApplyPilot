import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mapJobSpyEnvelope, type JobSpyEnvelope } from "@applypilot/adapter-jobspy";
import { mapPortalScan, scanReceiptSchema } from "@applypilot/adapter-career-ops";
import { mergeJobs, runDiscovery, runInfo, screenJobs, withDedup } from "../src/pipeline.ts";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures");
const at = "2026-11-15T12:00:00.000Z";

function jobspyResult() {
  const records = ["linkedin", "indeed"].flatMap((s) =>
    JSON.parse(readFileSync(join(fixtures, "jobspy", `${s}.json`), "utf8")),
  );
  const envelope: JobSpyEnvelope = {
    version: "applypilot.jobspy.result@1",
    run_id: "run_js",
    started_at: at,
    finished_at: at,
    duration_ms: 1,
    upstream: { package: "python-jobspy", version: "1.4.1" },
    request: {},
    metrics: { requested_per_site: 15, returned: records.length, by_site: {} },
    records,
    error: null,
  };
  return mapJobSpyEnvelope(envelope);
}

function careerOpsResult() {
  const receipt = scanReceiptSchema.parse(
    JSON.parse(readFileSync(join(fixtures, "career-ops", "receipt.json"), "utf8")),
  );
  const history = readFileSync(join(fixtures, "career-ops", "scan-history.tsv"), "utf8");
  return mapPortalScan(receipt, history, {
    runId: "run_co",
    startedAt: at,
    finishedAt: at,
    durationMs: 1,
    upstreamVersion: "career-ops@1.40.0",
  });
}

test("both sources merge into one canonical job list without losing provenance", () => {
  const js = jobspyResult();
  const co = careerOpsResult();
  const merged = mergeJobs([
    { source: "jobspy", result: js },
    { source: "career-ops", result: co },
  ]);
  // The fixtures share one posting: LinkedIn li-4000000001 applies at Greenhouse 7001,
  // which Career Ops found directly.
  assert.equal(merged.jobs.length, js.jobs.length + co.jobs.length - 1);
  assert.equal(merged.crossSourceMerges.length, 1);
  const both = merged.jobs.find((j) => j.id === merged.crossSourceMerges[0]?.into)!;
  assert.deepEqual(both.provenance.map((p) => p.adapter).sort(), ["career-ops", "jobspy"]);
  assert.equal(both.source, "greenhouse");
  const adapters = new Set(merged.jobs.flatMap((j) => j.provenance.map((p) => p.adapter)));
  assert.deepEqual([...adapters].sort(), ["career-ops", "jobspy"]);
});

test("each run is deduplicated and every job carries identity keys before it is pushed", () => {
  const js = jobspyResult();
  const { result, merges } = withDedup({ ...js, jobs: [...js.jobs, ...js.jobs] });
  assert.equal(result.jobs.length, js.jobs.length);
  assert.equal(merges.length, 0, "identical ids collapse without a merge record");
  assert.ok(result.jobs.every((j) => j.dedupKeys?.includes(`id:${j.id}`)));
});

test("a failed source is reported and never blocks the others", async () => {
  const merged = await runDiscovery({ sources: ["jobspy"] });
  assert.equal(merged.outcomes[0]?.result, undefined);
  assert.match(merged.outcomes[0]?.error ?? "", /needs a search request/);
  assert.deepEqual(merged.jobs, []);
});

test("each run is reported to Rolecraft under its own adapter", () => {
  assert.equal(runInfo(jobspyResult()).adapter, "jobspy");
  const co = runInfo(careerOpsResult());
  assert.equal(co.adapter, "career-ops");
  assert.equal(co.status, "partial");
  assert.equal(co.metrics.requestedPerSite, null);
});

test("screening fetches missing descriptions, rejects closed postings with evidence, and counts verdicts", async () => {
  const co = careerOpsResult();
  const fetched: string[] = [];
  const { jobs, summary } = await screenJobs(co.jobs, {
    policy: {
      countries: ["United States"],
      excludedTitleKeywords: ["Staff", "Principal"],
      reviewTitleKeywords: ["Senior"],
      roleFamilyKeywords: ["Engineer"],
      maxRequiredYears: 4,
      reviewRequiredYears: 2,
      needsSponsorship: true,
      excludedCompanies: [],
      excludedKeywords: [],
    },
    now: new Date("2026-11-16T00:00:00Z"),
    fetcher: async (url) => {
      fetched.push(url);
      if (url.includes("lever")) return { status: "closed", evidence: "No longer accepting applications" };
      if (url.includes("ashby")) return { status: "found", text: "We are not able to sponsor visas." };
      return { status: "unavailable" };
    },
  });
  assert.equal(fetched.length, co.jobs.length, "every job without a description was fetched");
  const lever = jobs.find((j) => j.source === "lever")!;
  assert.equal(lever.screening?.verdict, "reject");
  assert.equal(lever.screening?.checks[0]?.rule, "posting-closed");
  assert.equal(lever.screening?.checks[0]?.evidence, "No longer accepting applications");
  const ashby = jobs.find((j) => j.source === "ashby")!;
  assert.equal(ashby.description, "We are not able to sponsor visas.");
  assert.equal(ashby.screening?.authorization, "incompatible");
  assert.equal(summary.closed, 1);
  assert.equal(summary.descriptionsFetched, 1);
  assert.equal(summary.verdicts.pass + summary.verdicts.review + summary.verdicts.reject, jobs.length);
});
