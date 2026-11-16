// JobSpy fixtures -> adapter -> CanonicalJob -> Rolecraft Discovered inbox.
//
// Needs a local Rolecraft dev server with the discovered-jobs migration
// applied. Skipped unless ROLECRAFT_URL is set:
//   ROLECRAFT_URL=http://127.0.0.1:5173 npm run test:integration
// Uses only fictional fixture jobs and deletes them afterwards.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mapJobSpyEnvelope, type JobSpyEnvelope } from "@applypilot/adapter-jobspy";
import { pushDiscovery, resolveRolecraftUrl } from "@applypilot/rolecraft-client";
import { runInfo } from "../../services/discovery/src/cli.ts";

const base = process.env.ROLECRAFT_URL;
const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/jobspy");

function fixtureEnvelope(runId: string): JobSpyEnvelope {
  const sites = readdirSync(fixtures)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
  const records = sites.flatMap((s) => JSON.parse(readFileSync(join(fixtures, `${s}.json`), "utf8")));
  const now = new Date().toISOString();
  return {
    version: "applypilot.jobspy.result@1",
    run_id: runId,
    started_at: now,
    finished_at: now,
    duration_ms: 1,
    upstream: { package: "python-jobspy", version: "1.4.1" },
    request: { site_name: sites },
    metrics: {
      requested_per_site: 15,
      returned: records.length,
      by_site: Object.fromEntries(
        sites.map((s) => [
          s,
          { returned: records.filter((r) => r.site === s).length, error: null, warnings: [] },
        ]),
      ),
    },
    records,
    error: null,
  };
}

test("discovered fixture jobs land in Rolecraft with provenance and raw data intact", { skip: !base && "set ROLECRAFT_URL to run" }, async () => {
  const origin = resolveRolecraftUrl(base).origin;
  const headers = { Cookie: "__sites_local_auth=1", Origin: origin, "Content-Type": "application/json" };
  const api = (path: string, init: RequestInit = {}) =>
    fetch(`${origin}/api/discovered-jobs${path}`, { ...init, headers });

  const runId = `run_it_${Date.now().toString(36)}`;
  const result = mapJobSpyEnvelope(fixtureEnvelope(runId));
  assert.equal(result.status, "ok");
  assert.ok(result.jobs.length >= 9);

  try {
    const first = await pushDiscovery(runInfo(result), result.jobs, { baseUrl: origin, batchSize: 4 });
    assert.equal(first.received, result.jobs.length);
    assert.equal(first.created + first.updated, result.jobs.length);
    assert.equal(first.batches, Math.ceil(result.jobs.length / 4));

    // Idempotent: a second import of the same run creates nothing.
    const again = await pushDiscovery(runInfo(result), result.jobs, { baseUrl: origin });
    assert.equal(again.created, 0);

    for (const job of result.jobs) {
      const res = await api(`/${job.id}`);
      assert.equal(res.status, 200, job.id);
      const { job: stored } = (await res.json()) as { job: Record<string, unknown> };
      assert.equal(stored.title, job.title);
      assert.equal(stored.company, job.company);
      assert.equal(stored.source, job.source);
      assert.equal(stored.sourceUrl, job.sourceUrl);
      assert.equal(stored.remoteType, job.remoteType);
      assert.equal(stored.postedAt ?? undefined, job.postedAt);
      assert.equal(stored.salaryInterval ?? undefined, job.salaryInterval);
      assert.equal(stored.status, "new");
      assert.deepEqual(stored.rawSource, job.rawSource, "raw upstream record survives");
      const provenance = stored.provenance as { site: string; runId: string; upstreamVersion: string }[];
      assert.equal(provenance.length, 1, "re-import of the same run adds no sighting");
      assert.equal(provenance[0]?.runId, runId);
      assert.equal(provenance[0]?.upstreamVersion, "python-jobspy@1.4.1");
    }

    const list = (await (await api("?status=new")).json()) as {
      runs: { runId: string; jobsReceived: number; status: string }[];
    };
    const recorded = list.runs.find((r) => r.runId === runId);
    assert.equal(recorded?.jobsReceived, result.jobs.length, "re-importing a run does not double its count");
    assert.equal(recorded?.status, "ok");
  } finally {
    for (const job of result.jobs) await api(`/${job.id}`, { method: "DELETE" });
    await api(`/runs/${runId}`, { method: "DELETE" });
  }
});
