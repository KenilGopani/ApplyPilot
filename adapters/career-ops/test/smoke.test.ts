// Smoke tests against the real, pinned Career Ops checkout. Offline: the
// scan has no enabled boards, so no network request is made. Skipped when the
// checkout or its node_modules is missing.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  careerOpsHealth,
  initCareerOpsDataRoot,
  resolveCareerOpsHome,
  scanPortals,
  verifyCareerOpsPipeline,
} from "../src/index.ts";

const home = resolveCareerOpsHome();
const skip = !existsSync(join(home, "node_modules")) && "Career Ops checkout with node_modules not found";

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .sort();
}

test("real Career Ops: health, verify and an offline dry-run scan on a fresh data root", { skip, timeout: 120_000 }, async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "applypilot-careerops-smoke-"));
  initCareerOpsDataRoot(dataRoot);

  const health = await careerOpsHealth({ dataRoot });
  assert.equal(health.ready, false);
  assert.deepEqual(
    [...health.missing].sort(),
    ["config/profile.yml", "cv.md", "modes/_profile.md", "portals.yml"],
  );

  const verified = await verifyCareerOpsPipeline({ dataRoot });
  assert.equal(verified.ok, true);
  assert.equal(verified.errors, 0);
  assert.ok(verified.checks.length > 0, "verify printed its checks");

  await assert.rejects(scanPortals({ dataRoot, dryRun: true }), /portals\.yml not found/);

  writeFileSync(
    join(dataRoot, "portals.yml"),
    "title_filter:\n  positive: [\"Engineer\"]\n  negative: []\ntracked_companies: []\n",
  );
  const before = files(dataRoot);
  const scan = await scanPortals({ dataRoot, dryRun: true });
  assert.equal(scan.status, "ok");
  assert.equal(scan.receipt.scanned, 0);
  assert.equal(scan.receipt.dry_run, true);
  assert.deepEqual(files(dataRoot), before, "a dry run writes nothing");

  // The pinned checkout stays untouched.
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: home, encoding: "utf8" });
  assert.equal(dirty.trim(), "");
});
