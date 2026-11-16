// Adapter contract tests against a fake Career Ops checkout: tiny scripts
// that mimic each exposed script's documented interface, so every exit code
// and output shape can be exercised without the network.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  CareerOpsError,
  careerOpsHealth,
  initCareerOpsDataRoot,
  parseVerifyOutput,
  runCareerOps,
  fetchJobDescription,
  scanPortals,
  verifyCareerOpsPipeline,
  type ExposedScript,
} from "../src/index.ts";

// Real path: macOS tmpdir is a symlink (/var -> /private/var).
const base = realpathSync(mkdtempSync(join(tmpdir(), "applypilot-careerops-")));
const home = join(base, "career-ops");
const dataRoot = join(base, "data-root");
mkdirSync(join(home, "node_modules"), { recursive: true });
writeFileSync(join(home, "package.json"), "{}");

// Every fake reports what it saw, then behaves according to FAKE_MODE.
const prelude = `
const seen = { root: process.env.CAREER_OPS_ROOT, cwd: process.cwd(), argv: process.argv.slice(2),
  portals: process.env.CAREER_OPS_PORTALS ?? null, tracker: process.env.CAREER_OPS_TRACKER ?? null,
  noAsks: process.env.CAREER_OPS_NO_ASKS };
const mode = process.env.FAKE_MODE || "ok";
`;
writeFileSync(
  join(home, "doctor.mjs"),
  `${prelude}
if (mode === "shape") { console.log(JSON.stringify({ hello: 1 })); process.exit(0); }
console.log(JSON.stringify({ onboardingNeeded: mode !== "ready", missing: mode === "ready" ? [] : ["cv.md", "portals.yml"],
  unpersonalized: [{ path: "modes/_profile.md", reason: "template" }], warnings: ["w1\\nmore"],
  plugins: [{ id: "apify", enabled: false }, { id: "gmail", enabled: true }], seen }));`,
);
writeFileSync(
  join(home, "verify-pipeline.mjs"),
  `${prelude}
console.log("🔍 header line");
console.log("✅ All statuses are canonical");
console.log("⚠️  2 reports have no tracker row");
if (mode === "errors") { console.log("❌ Duplicate #4"); process.exit(1); }
if (mode === "crash") process.exit(3);
console.log(JSON.stringify(seen));`,
);
writeFileSync(
  join(home, "scan.mjs"),
  `${prelude}
if (mode === "noconfig") { console.error("Error: portals.yml not found. Run onboarding first."); process.exit(1); }
if (mode === "hang") setInterval(() => {}, 1000);
else {
  const errors = mode === "partial" ? [{ company: "Acme", error: "HTTP 404" }]
    : mode === "allfail" ? [{ company: "Acme", error: "HTTP 404" }, { company: "Beta", error: "timeout" }] : [];
  console.log("human line that is not the receipt");
  console.log(JSON.stringify({ version: mode === "shape" ? "other@1" : "careerops.scan.receipt@1", date: "2026-11-15",
    scanned: 2, skipped: 0, found: 10, filtered: 4, duplicates: 1, added: 5, added_urls: ["https://boards.greenhouse.io/acme/jobs/1"],
    errors, unverified_zero: [], partial: [], dry_run: seen.argv.includes("--dry-run"), seen }));
  process.exit(errors.length ? 2 : 0);
}`,
);

writeFileSync(
  join(home, "fetch-jd.mjs"),
  `${prelude}
if (mode === "closed") { console.log("CLOSED_POSTING This job is no longer accepting applications"); process.exit(3); }
if (mode === "miss") process.exit(1);
if (mode === "crash") process.exit(9);
console.log("About the role\\n\\nBuild agents. URL=" + seen.argv[0]);`,
);

const opts = (mode = "ok") => ({ home, dataRoot, env: { FAKE_MODE: mode } });

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (e: unknown) => {
    assert.ok(e instanceof CareerOpsError, String(e));
    assert.equal(e.code, code);
    return true;
  });
}

test("scripts run from the checkout against the isolated data root, with redirects stripped", async () => {
  const saved = { portals: process.env.CAREER_OPS_PORTALS, root: process.env.CAREER_OPS_ROOT };
  process.env.CAREER_OPS_PORTALS = "/someone/elses/portals.yml";
  process.env.CAREER_OPS_ROOT = "/someone/elses/root";
  try {
    const result = await runCareerOps("doctor.mjs", ["--json"], {
      ...opts(),
      env: { FAKE_MODE: "ok", CAREER_OPS_TRACKER: "/smuggled/tracker.md" },
    });
    const { seen } = JSON.parse(result.stdout);
    assert.equal(seen.root, dataRoot);
    assert.equal(seen.cwd, home);
    assert.equal(seen.portals, null, "shell redirect removed");
    assert.equal(seen.tracker, null, "redirect cannot be re-added through options.env");
    assert.equal(seen.noAsks, "1");
    assert.deepEqual(seen.argv, ["--json"]);
  } finally {
    if (saved.portals === undefined) delete process.env.CAREER_OPS_PORTALS;
    else process.env.CAREER_OPS_PORTALS = saved.portals;
    if (saved.root === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = saved.root;
  }
});

test("unsafe roots, unexposed scripts and missing checkouts are refused before anything runs", async () => {
  await rejectsWith(runCareerOps("doctor.mjs", [], { home, dataRoot: home }), "CAREER_OPS_UNSAFE_DATA_ROOT");
  await rejectsWith(runCareerOps("doctor.mjs", [], { home, dataRoot: join(home, "data") }), "CAREER_OPS_UNSAFE_DATA_ROOT");
  // A data root that does not exist yet, spelled through a symlink (/var vs /private/var).
  const symlinked = join(tmpdir(), relative(realpathSync(tmpdir()), home));
  await rejectsWith(
    runCareerOps("doctor.mjs", [], { home, dataRoot: join(symlinked, "not", "yet", "created") }),
    "CAREER_OPS_UNSAFE_DATA_ROOT",
  );
  await rejectsWith(runCareerOps("apply.mjs" as ExposedScript, [], opts()), "CAREER_OPS_NOT_EXPOSED");
  await rejectsWith(runCareerOps("doctor.mjs", [], { home: join(base, "nowhere"), dataRoot }), "CAREER_OPS_UNAVAILABLE");
  const bare = join(base, "no-deps");
  mkdirSync(bare, { recursive: true });
  writeFileSync(join(bare, "package.json"), "{}");
  writeFileSync(join(bare, "doctor.mjs"), "");
  await rejectsWith(runCareerOps("doctor.mjs", [], { home: bare, dataRoot }), "CAREER_OPS_UNAVAILABLE");
});

test("health maps doctor --json and rejects a changed shape", async () => {
  const health = await careerOpsHealth(opts());
  assert.equal(health.ready, false);
  assert.deepEqual(health.missing, ["cv.md", "portals.yml"]);
  assert.deepEqual(health.unpersonalized, ["modes/_profile.md"]);
  assert.deepEqual(health.enabledPlugins, ["gmail"]);
  assert.equal((await careerOpsHealth(opts("ready"))).ready, true);
  await rejectsWith(careerOpsHealth(opts("shape")), "CAREER_OPS_PROTOCOL_ERROR");
});

test("verify-pipeline lines become structured checks and the exit code decides ok", async () => {
  const ok = await verifyCareerOpsPipeline(opts());
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.checks, [
    { level: "pass", message: "All statuses are canonical" },
    { level: "warn", message: "2 reports have no tracker row" },
  ]);
  const bad = await verifyCareerOpsPipeline(opts("errors"));
  assert.equal(bad.ok, false);
  assert.equal(bad.errors, 1);
  await rejectsWith(verifyCareerOpsPipeline(opts("crash")), "CAREER_OPS_PROTOCOL_ERROR");
  assert.deepEqual(parseVerifyOutput("no marks here\n"), []);
});

test("scan passes its options, reads the receipt and grades failures", async () => {
  const ok = await scanPortals({ ...opts(), dryRun: true, company: "Acme", sinceDays: 7 });
  assert.equal(ok.status, "ok");
  assert.equal(ok.receipt.added, 5);
  assert.equal(ok.receipt.dry_run, true);
  assert.deepEqual((ok.receipt as unknown as { seen: { argv: string[] } }).seen.argv, [
    "--json", "--quiet", "--dry-run", "--company", "Acme", "--since", "7",
  ]);
  assert.equal((await scanPortals(opts("partial"))).status, "partial");
  assert.equal((await scanPortals(opts("allfail"))).status, "failed");
  await assert.rejects(scanPortals(opts("noconfig")), /portals\.yml not found/);
  await rejectsWith(scanPortals(opts("noconfig")), "CAREER_OPS_CONFIG_ERROR");
  await rejectsWith(scanPortals(opts("shape")), "CAREER_OPS_PROTOCOL_ERROR");
  await rejectsWith(scanPortals({ ...opts(), sinceDays: 0 }), "CAREER_OPS_CONFIG_ERROR");
  await rejectsWith(scanPortals({ ...opts("hang"), timeoutMs: 300 }), "CAREER_OPS_TIMEOUT");
});

test("init creates the user-layer skeleton once and never overwrites", () => {
  const root = join(base, "init-root");
  const first = initCareerOpsDataRoot(root);
  assert.ok(first.created.includes("data/") && first.created.includes("README.md"));
  assert.ok(existsSync(join(root, "reports")));
  writeFileSync(join(root, "README.md"), "mine");
  writeFileSync(join(root, "cv.md"), "my cv");
  const second = initCareerOpsDataRoot(root);
  assert.deepEqual(second.created, []);
  assert.equal(readFileSync(join(root, "README.md"), "utf8"), "mine");
  assert.equal(readFileSync(join(root, "cv.md"), "utf8"), "my cv");
  assert.ok(!existsSync(join(root, "portals.yml")), "no personal files are created");
});

test("job descriptions: found, closed with evidence, unavailable, and crashes are distinct", async () => {
  const url = "https://boards.greenhouse.io/acme/jobs/1";
  const found = await fetchJobDescription(url, opts());
  assert.equal(found.status, "found");
  assert.match(found.status === "found" ? found.text : "", /Build agents\. URL=https:\/\/boards\.greenhouse\.io\/acme\/jobs\/1/);
  assert.deepEqual(await fetchJobDescription(url, opts("closed")), {
    status: "closed",
    evidence: "This job is no longer accepting applications",
  });
  assert.deepEqual(await fetchJobDescription(url, opts("miss")), { status: "unavailable" });
  await rejectsWith(fetchJobDescription(url, opts("crash")), "CAREER_OPS_PROTOCOL_ERROR");
});
