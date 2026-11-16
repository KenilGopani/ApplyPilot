#!/usr/bin/env node
// npm run verify:integration [-- --full]
// The plan's integration verification (Phase 22): every layer in order,
// stopping at the first failure. --full also runs Career Ops' complete native
// suite (about 4 minutes).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = resolve(root, process.env.APPLYPILOT_SOURCES_DIR || "..");
const full = process.argv.includes("--full");
const python = process.env.APPLYPILOT_JOBSPY_PYTHON || join(root, "runtime", ".venv-jobspy", "bin", "python");
const node = process.execPath;
const TS = ["--experimental-strip-types", "--test"];

const run = (cmd, args, cwd = root, env = {}) =>
  spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", ...env } });

let n = 0;
function step(title, check) {
  n += 1;
  const started = Date.now();
  let result;
  try {
    result = check();
  } catch (error) {
    result = { ok: false, detail: error.message };
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${result.ok ? "✓" : "✗"} ${String(n).padStart(2)}. ${title}${result.detail ? ` — ${result.detail}` : ""} (${secs}s)`);
  if (!result.ok) {
    if (result.output) console.log(result.output.split("\n").slice(-25).map((l) => `      ${l}`).join("\n"));
    console.log(`\nStopped at step ${n}. Fix it and run npm run verify:integration again.`);
    process.exit(1);
  }
}
const proc = (r, okDetail) => ({
  ok: r.status === 0,
  detail: r.status === 0 ? okDetail : `exit ${r.status}`,
  output: `${r.stdout ?? ""}${r.stderr ?? ""}`,
});
const tests = (globs, label) => {
  const r = run(node, [...TS, ...globs]);
  const pass = /ℹ pass (\d+)/.exec(r.stdout)?.[1] ?? "?";
  return proc(r, `${pass} ${label} passed`);
};

const jobspy = join(sources, "JobSpy");
const careerOps = join(sources, "career-ops");
const rolecraft = join(sources, "KenilJobBoard");

step("Source checkouts match their pins", () => proc(run(node, ["scripts/verify-sources.mjs"]), "pinned and unmodified"));
step("JobSpy source exists", () => ({ ok: existsSync(join(jobspy, "pyproject.toml")), detail: jobspy }));
step("JobSpy imports", () => proc(run(python, ["-c", "from jobspy import scrape_jobs; import importlib.metadata as m; print(m.version('python-jobspy'))"]), "python-jobspy imports"));
step("JobSpy worker tests (JobSpy ships no unit tests; its contract is the worker's)", () =>
  proc(run(python, ["-m", "unittest", "discover", "-s", "workers/jobspy/tests"]), "worker contract passed"),
);
step("Career Ops source exists", () => ({ ok: existsSync(join(careerOps, "package.json")), detail: careerOps }));
step("Career Ops installation is valid", () => ({
  ok: existsSync(join(careerOps, "node_modules", "js-yaml")),
  detail: existsSync(join(careerOps, "node_modules")) ? "dependencies installed" : "run npm ci in career-ops",
}));
step(full ? "Career Ops native test suite (full)" : "Career Ops native checks (syntax; --full for the 4-minute suite)", () =>
  full ? proc(run(node, ["test-all.mjs"], careerOps), "native suite passed") : proc(run("npm", ["run", "lint", "--silent"], careerOps), "native syntax check passed"),
);
step("Career Ops doctor runs on an isolated data root", () => {
  const r = run(node, ["doctor.mjs", "--json"], careerOps, { CAREER_OPS_ROOT: mkdtempSync(join(tmpdir(), "applypilot-verify-")) });
  try {
    const state = JSON.parse(r.stdout.trim().split("\n").pop());
    return { ok: typeof state.onboardingNeeded === "boolean", detail: "doctor --json answered" };
  } catch {
    return { ok: false, detail: "doctor --json did not answer", output: r.stdout + r.stderr };
  }
});
step("Rolecraft unit tests and typecheck", () => {
  const t = run("npm", ["test", "--silent"], rolecraft);
  if (t.status !== 0) return proc(t);
  return proc(run("npx", ["tsc", "--noEmit"], rolecraft), `${/ℹ pass (\d+)/.exec(t.stdout)?.[1] ?? "?"} tests passed, types clean`);
});
step("Platform typecheck", () => proc(run("npx", ["tsc", "--noEmit"]), "types clean"));
step("Platform schema tests", () => tests(["packages/job-schema/test/*.test.ts"], "schema tests"));
step("JobSpy adapter tests", () => tests(["adapters/jobspy/test/*.test.ts"], "adapter tests"));
step("Career Ops adapter tests", () => tests(["adapters/career-ops/test/*.test.ts"], "adapter tests"));
step("Deduplication tests", () => tests(["packages/dedup/test/*.test.ts"], "dedup tests"));
step("Candidate profile mapping", () => tests(["packages/candidate-profile/test/*.test.ts"], "profile tests"));
step("Filters, routing, tailoring, logging, config and services", () =>
  tests(
    ["packages/filters/test/*.test.ts", "packages/resume-router/test/*.test.ts", "packages/tailoring/test/*.test.ts", "packages/logging/test/*.test.ts", "packages/config/test/*.test.ts", "packages/rolecraft-client/test/*.test.ts", "adapters/claude-code/test/*.test.ts", "services/*/test/*.test.ts"],
    "tests",
  ),
);
step("End-to-end fixture pipeline", () => tests(["tests/integration/fixture-pipeline.test.ts"], "end-to-end tests"));
step("Live Rolecraft round trip (when Rolecraft is running)", () => {
  const url = process.env.APPLYPILOT_ROLECRAFT_URL || "http://127.0.0.1:5173";
  const probe = run("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", `${url}/api/discovered-jobs`]);
  if (probe.stdout !== "401") return { ok: true, detail: `skipped: Rolecraft not running at ${url}` };
  const r = run(node, [...TS, "tests/integration/discovery-to-rolecraft.test.ts"], root, { ROLECRAFT_URL: url });
  return proc(r, "fixture jobs round-tripped through Rolecraft");
});
console.log(`\nAll ${n} checks passed.`);
