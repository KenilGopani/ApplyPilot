#!/usr/bin/env node
// Source preservation guard: each upstream checkout exists, sits at its pinned
// commit, and has no local modifications. Sources live next to this repo by
// default; set APPLYPILOT_SOURCES_DIR to point elsewhere.
//
//   node scripts/verify-sources.mjs          # fail on any drift
//   node scripts/verify-sources.mjs --warn   # report drift, exit 0
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcesDir = resolve(root, process.env.APPLYPILOT_SOURCES_DIR || "..");
const lockFile = resolve(root, process.env.APPLYPILOT_SOURCES_LOCK || "sources.lock.json");
const { sources } = JSON.parse(readFileSync(lockFile, "utf8"));
const warnOnly = process.argv.includes("--warn");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
let problems = 0;
for (const [name, pin] of Object.entries(sources)) {
  const dir = join(sourcesDir, name);
  const issues = [];
  if (!existsSync(join(dir, ".git"))) {
    issues.push(`missing checkout at ${dir}`);
  } else {
    const head = git(dir, "rev-parse", "HEAD");
    if (head !== pin.commit) issues.push(`HEAD ${head.slice(0, 12)} != pinned ${pin.commit.slice(0, 12)}`);
    const dirty = git(dir, "status", "--porcelain", "--untracked-files=no");
    if (dirty) issues.push(`tracked files modified:\n      ${dirty.split("\n").join("\n      ")}`);
  }
  problems += issues.length;
  console.log(`${issues.length ? "✗" : "✓"} ${name.padEnd(14)} ${pin.commit.slice(0, 12)}  ${pin.version}`);
  for (const issue of issues) console.log(`    ${issue}`);
}
if (problems) {
  console.log(`\n${problems} problem(s). Upstream changes follow docs/SOURCE_VERSIONS.md and docs/UPSTREAM_PATCHES.md.`);
  process.exit(warnOnly ? 0 : 1);
}
