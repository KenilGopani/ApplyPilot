// Source preservation guard (plan Phase 28): verify-sources must catch an
// off-pin checkout and any edit to a source's tracked files.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd, encoding: "utf8" }).trim();

function fakeSources() {
  const dir = mkdtempSync(join(tmpdir(), "applypilot-guard-"));
  const lock: Record<string, { url: string; ref: string; commit: string; version: string }> = {};
  for (const name of ["JobSpy", "career-ops", "KenilJobBoard"]) {
    const repo = join(dir, name);
    mkdirSync(repo);
    git(repo, "init", "-q");
    writeFileSync(join(repo, "README.md"), name);
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "init");
    lock[name] = { url: "local", ref: "main", commit: git(repo, "rev-parse", "HEAD"), version: name };
  }
  const lockFile = join(dir, "lock.json");
  writeFileSync(lockFile, JSON.stringify({ sources: lock }));
  return { dir, lockFile };
}

const verify = (dir: string, lockFile: string) =>
  spawnSync(process.execPath, [join(root, "scripts", "verify-sources.mjs")], {
    encoding: "utf8",
    env: { ...process.env, APPLYPILOT_SOURCES_DIR: dir, APPLYPILOT_SOURCES_LOCK: lockFile },
  });

test("pinned, unmodified sources pass", () => {
  const { dir, lockFile } = fakeSources();
  assert.equal(verify(dir, lockFile).status, 0);
});

test("an edited tracked file in a source fails the guard", () => {
  const { dir, lockFile } = fakeSources();
  writeFileSync(join(dir, "career-ops", "README.md"), "patched in place");
  const r = verify(dir, lockFile);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /career-ops[\s\S]*tracked files modified/);
});

test("a source moved off its pin fails the guard", () => {
  const { dir, lockFile } = fakeSources();
  writeFileSync(join(dir, "JobSpy", "new.py"), "x");
  git(join(dir, "JobSpy"), "add", ".");
  git(join(dir, "JobSpy"), "commit", "-qm", "unrecorded change");
  const r = verify(dir, lockFile);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /HEAD [0-9a-f]+ != pinned/);
});
