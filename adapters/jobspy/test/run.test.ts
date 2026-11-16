// Runner error mapping. The "worker" here is a tiny Node script run with the
// current Node binary, so these tests need neither Python nor the network.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PlatformError, runJobSpyDiscovery } from "../src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "applypilot-jobspy-"));
const linkedin = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures/jobspy/linkedin.json"),
  "utf8",
);

function fakeWorker(name: string, body: string): string {
  const path = join(dir, `${name}.mjs`);
  writeFileSync(path, body);
  return path;
}

const envelopeFor = (extra: string) => `
let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const request = JSON.parse(input);
  console.error("log line from jobspy");
  const env = {
    version: "applypilot.jobspy.result@1", run_id: "run_fake",
    started_at: "2026-11-15T12:00:00.000Z", finished_at: "2026-11-15T12:00:01.000Z",
    duration_ms: 1000, upstream: { package: "python-jobspy", version: "1.4.1" },
    request, metrics: { requested_per_site: 2, returned: 2,
      by_site: { linkedin: { returned: 2, error: null, warnings: [] } } },
    // A later duplicate key wins, so \`extra\` can override error.
    records: ${linkedin}, error: null, ${extra}
  };
  process.stdout.write(JSON.stringify(env) + "\\n");
});`;

const run = (workerPath: string, timeoutMs?: number) =>
  runJobSpyDiscovery({ site_name: ["linkedin"] }, { python: process.execPath, workerPath, timeoutMs });

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PlatformError, String(error));
    assert.equal(error.code, code);
    return true;
  });
}

test("a successful worker run returns canonical jobs and forwards logs", async () => {
  const logs: string[] = [];
  const result = await runJobSpyDiscovery(
    { site_name: ["linkedin"], search_term: "ai" },
    { python: process.execPath, workerPath: fakeWorker("ok", envelopeFor("")), onLog: (l) => logs.push(l) },
  );
  assert.equal(result.status, "ok");
  assert.equal(result.jobs.length, 2);
  assert.equal(result.jobs[0]?.provenance[0]?.runId, "run_fake");
  assert.deepEqual(logs, ["log line from jobspy"]);
});

test("worker-reported errors become platform errors", async () => {
  await rejectsWith(
    run(fakeWorker("invalid", envelopeFor(`error: { code: "INVALID_REQUEST", message: "bad site" }`))),
    "DISCOVERY_INVALID_REQUEST",
  );
  await rejectsWith(
    run(fakeWorker("crash", envelopeFor(`error: { code: "WORKER_CRASHED", message: "boom" }`))),
    "DISCOVERY_WORKER_CRASHED",
  );
});

test("garbage output, wrong shapes, hangs and missing interpreters are distinct failures", async () => {
  await rejectsWith(run(fakeWorker("garbage", `console.log("not json"); process.exit(3);`)), "DISCOVERY_PROTOCOL_ERROR");
  await rejectsWith(run(fakeWorker("shape", `console.log(JSON.stringify({ version: "other" }));`)), "DISCOVERY_PROTOCOL_ERROR");
  await rejectsWith(run(fakeWorker("hang", `setInterval(() => {}, 1000);`), 300), "DISCOVERY_WORKER_TIMEOUT");
  await rejectsWith(
    runJobSpyDiscovery({ site_name: ["linkedin"] }, { python: join(dir, "missing", "python") }),
    "DISCOVERY_WORKER_UNAVAILABLE",
  );
});
