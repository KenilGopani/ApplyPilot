import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { canonicalJobId, type CanonicalJob } from "@applypilot/job-schema";
import { RolecraftError, pushDiscovery, resolveRolecraftUrl } from "../src/index.ts";

const at = "2026-11-15T12:00:00.000Z";
const run = { runId: "run_t", adapter: "jobspy", status: "ok" as const, startedAt: at, finishedAt: at, metrics: {} };

function job(n: number): CanonicalJob {
  const url = `https://www.indeed.com/viewjob?jk=t${n}`;
  return {
    id: canonicalJobId("indeed", `in-t${n}`),
    title: `Engineer ${n}`,
    company: "Fictional Co",
    remoteType: "unknown",
    source: "indeed",
    sourceUrl: url,
    discoveredAt: at,
    provenance: [{ provider: "indeed", site: "indeed", url, adapter: "jobspy", discoveredAt: at }],
  };
}

type Seen = { headers: IncomingMessage["headers"]; body: { run: unknown; jobs: CanonicalJob[] } };

async function fakeRolecraft(respond: (seen: Seen, n: number) => [number, unknown]) {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const entry = { headers: req.headers, body: JSON.parse(raw) };
      seen.push(entry);
      const [status, body] = respond(entry, seen.length);
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen, close: () => server.close() };
}

const ok = (s: Seen): [number, unknown] => [
  200,
  { received: s.body.jobs.length, created: s.body.jobs.length, updated: 0 },
];

test("jobs are sent in batches with the local sign-in cookie and a same-origin header", async () => {
  const rc = await fakeRolecraft(ok);
  try {
    const jobs = Array.from({ length: 120 }, (_, i) => job(i));
    const result = await pushDiscovery(run, jobs, { baseUrl: rc.url, batchSize: 50 });
    assert.deepEqual(result, { received: 120, created: 120, updated: 0, batches: 3 });
    assert.deepEqual(rc.seen.map((s) => s.body.jobs.length), [50, 50, 20]);
    assert.equal(rc.seen[0]?.headers.cookie, "__sites_local_auth=1");
    assert.equal(rc.seen[0]?.headers.origin, rc.url);
    assert.deepEqual(rc.seen[2]?.body.run, run);
  } finally {
    rc.close();
  }
});

test("an empty run is still recorded once", async () => {
  const rc = await fakeRolecraft(ok);
  try {
    const result = await pushDiscovery(run, [], { baseUrl: rc.url });
    assert.equal(result.batches, 1);
    assert.deepEqual(rc.seen[0]?.body.jobs, []);
  } finally {
    rc.close();
  }
});

test("a rejected batch reports Rolecraft's reason and how much was already imported", async () => {
  const rc = await fakeRolecraft((s, n) =>
    n === 2 ? [400, { error: "Invalid request.", issues: ["jobs.0.sourceUrl: bad"] }] : ok(s),
  );
  try {
    await assert.rejects(
      pushDiscovery(run, Array.from({ length: 3 }, (_, i) => job(i)), { baseUrl: rc.url, batchSize: 2 }),
      (e: unknown) => {
        assert.ok(e instanceof RolecraftError);
        assert.equal(e.status, 400);
        assert.equal(e.imported, 2);
        assert.match(e.message, /batch 2.*Invalid request.*sourceUrl: bad/);
        return true;
      },
    );
  } finally {
    rc.close();
  }
});

test("invalid jobs fail before anything is sent", async () => {
  const rc = await fakeRolecraft(ok);
  try {
    const bad = { ...job(1), sourceUrl: "javascript:alert(1)" };
    await assert.rejects(pushDiscovery(run, [job(0), bad], { baseUrl: rc.url }), /not a valid CanonicalJob/);
    assert.equal(rc.seen.length, 0);
  } finally {
    rc.close();
  }
});

test("only a local Rolecraft is accepted, and an unreachable one is explained", async () => {
  assert.throws(() => resolveRolecraftUrl("https://rolecraft.example.com"), /local address/);
  assert.throws(() => resolveRolecraftUrl("file:///tmp/x"), /local address/);
  assert.equal(resolveRolecraftUrl("http://localhost:5173/some/path").href, "http://localhost:5173/");
  await assert.rejects(
    pushDiscovery(run, [job(0)], { baseUrl: "http://127.0.0.1:9" }),
    /cannot reach Rolecraft/,
  );
});
