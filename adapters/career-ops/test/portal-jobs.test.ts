// Contract: Career Ops scan receipt + scan-history.tsv -> CanonicalJob.
// Fixtures are fictional rows in Career Ops' real column layout.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJobSchema } from "@applypilot/job-schema";
import {
  mapPortalScan,
  mapScanHistoryRow,
  parseScanHistory,
  remoteTypeFromLocation,
  scanReceiptSchema,
  sourceForUrl,
  unescapeFormulaCell,
} from "../src/index.ts";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures/career-ops");
const history = readFileSync(join(fixtures, "scan-history.tsv"), "utf8");
const receipt = scanReceiptSchema.parse(JSON.parse(readFileSync(join(fixtures, "receipt.json"), "utf8")));
const run = {
  runId: "run_co_fixture",
  startedAt: "2026-11-15T12:00:00.000Z",
  finishedAt: "2026-11-15T12:01:00.000Z",
  durationMs: 60000,
  upstreamVersion: "career-ops@1.40.0",
};

test("scan history parses by column position, skips the header and tolerates short legacy rows", () => {
  const rows = parseScanHistory(history);
  assert.equal(rows.length, 7);
  assert.equal(rows[0]?.requisition_id, "REQ-7001");
  assert.equal(rows[2]?.title, "=AI Engineer (Agents)", "formula escape undone");
  const legacy = rows[6];
  assert.equal(legacy?.title, "ML Engineer");
  assert.equal(legacy?.posted_at, undefined, "missing trailing cells read as absent");
  assert.equal(unescapeFormulaCell("'plain"), "'plain", "only formula-looking cells are unescaped");
});

test("a scan maps its added URLs to canonical jobs with career-ops provenance", () => {
  const result = mapPortalScan(receipt, history, run);
  assert.equal(result.adapter, "career-ops");
  assert.equal(result.status, "partial", "a failed board makes the run partial");
  assert.deepEqual(result.errors, [{ site: "Parloa", message: "HTTP 404" }]);
  assert.equal(result.metrics.returned, 6);
  assert.equal(result.metrics.mapped, 4);
  assert.equal(result.metrics.rejected, 2);
  assert.match(result.rejected.map((r) => r.reason).join(" | "), /title is missing.*missing from scan-history/);
  assert.equal(result.metrics.bySite["greenhouse-api"]?.mapped, 1);

  for (const job of result.jobs) {
    canonicalJobSchema.parse(job);
    assert.equal(job.provenance[0]?.adapter, "career-ops");
    assert.equal(job.provenance[0]?.upstreamVersion, "career-ops@1.40.0");
    assert.equal(job.provenance[0]?.runId, "run_co_fixture");
    assert.equal(job.discoveredAt, run.finishedAt);
    assert.equal(typeof job.rawSource, "object");
  }
  const [gh, lever, ashby, company] = result.jobs;
  assert.deepEqual(
    [gh?.source, lever?.source, ashby?.source, company?.source],
    ["greenhouse", "lever", "ashby", "company"],
  );
  assert.equal(gh?.externalId, "REQ-7001");
  assert.equal(gh?.postedAt, "2026-11-10");
  assert.equal(gh?.provenance[0]?.site, "greenhouse-api");
  assert.equal(ashby?.title, "=AI Engineer (Agents)");
  assert.deepEqual(result.jobWarnings[company!.id], ["posted_at dropped: not-a-date"]);
});

test("remote type comes only from the posting's own location text", () => {
  assert.equal(remoteTypeFromLocation("Remote - US"), "remote");
  assert.equal(remoteTypeFromLocation("Hybrid - Seattle, WA"), "hybrid");
  assert.equal(remoteTypeFromLocation("Remote-Friendly (Travel-Required) | Austin, TX"), "unknown");
  assert.equal(remoteTypeFromLocation("San Francisco, CA | Remote"), "unknown");
  assert.equal(remoteTypeFromLocation(undefined), "unknown");
});

test("ids are stable for the same posting and differ between postings", () => {
  const rows = parseScanHistory(history);
  const ctx = { runId: "a", discoveredAt: run.finishedAt };
  const a = mapScanHistoryRow(rows[0]!, ctx).job.id;
  assert.equal(a, mapScanHistoryRow(rows[0]!, { runId: "b", discoveredAt: "2026-12-01T00:00:00Z" }).job.id);
  assert.notEqual(a, mapScanHistoryRow(rows[1]!, ctx).job.id);
  assert.equal(sourceForUrl("https://boards.greenhouse.io/x/jobs/1"), "greenhouse");
  assert.equal(sourceForUrl("https://evilgreenhouse.io/x"), "company", "host suffix match is exact");
  assert.throws(() => mapScanHistoryRow({ ...rows[0], url: "javascript:alert(1)" }, ctx), /not http/);
});

test("a scan where every board failed is failed; a clean scan with nothing new is ok", () => {
  const allFailed = mapPortalScan({ ...receipt, scanned: 1, added_urls: [] }, history, run);
  assert.equal(allFailed.status, "failed");
  const quiet = mapPortalScan({ ...receipt, errors: [], added_urls: [] }, "", run);
  assert.equal(quiet.status, "ok");
  assert.equal(quiet.jobs.length, 0);
});
