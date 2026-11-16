import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mapJobSpyEnvelope, type JobSpyEnvelope } from "@applypilot/adapter-jobspy";
import { mapPortalScan, scanReceiptSchema } from "@applypilot/adapter-career-ops";
import { mergeJobs, runDiscovery, runInfo } from "../src/pipeline.ts";

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
  assert.equal(merged.jobs.length, js.jobs.length + co.jobs.length);
  assert.equal(merged.sameIdAcrossSources, 0);
  const adapters = new Set(merged.jobs.map((j) => j.provenance[0]?.adapter));
  assert.deepEqual([...adapters].sort(), ["career-ops", "jobspy"]);

  // The same id seen twice keeps both sightings.
  const twice = mergeJobs([
    { source: "jobspy", result: js },
    { source: "jobspy", result: js },
  ]);
  assert.equal(twice.jobs.length, js.jobs.length);
  assert.equal(twice.sameIdAcrossSources, js.jobs.length);
  assert.equal(twice.jobs[0]?.provenance.length, 2);
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
