#!/usr/bin/env node
// npm run sources:check-updates [-- --no-fetch]
// Shows how far each pinned source is behind its upstream branch. It fetches
// git refs only: no working tree is changed and nothing is merged. Updating a
// pin is the procedure in docs/UPSTREAM_UPDATES.md, never automatic.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcesDir = resolve(root, process.env.APPLYPILOT_SOURCES_DIR || "..");
const { sources } = JSON.parse(readFileSync(join(root, "sources.lock.json"), "utf8"));
const fetch = !process.argv.includes("--no-fetch");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

for (const [name, pin] of Object.entries(sources)) {
  const dir = join(sourcesDir, name);
  if (!existsSync(join(dir, ".git"))) {
    console.log(`✗ ${name}: no checkout at ${dir}`);
    continue;
  }
  try {
    if (fetch) git(dir, "fetch", "--quiet", "origin");
    let upstream;
    try {
      upstream = git(dir, "rev-parse", "--abbrev-ref", "origin/HEAD").replace(/^origin\//, "");
    } catch {
      upstream = ["main", "master"].find((b) => {
        try {
          git(dir, "rev-parse", "--verify", "--quiet", `origin/${b}`);
          return true;
        } catch {
          return false;
        }
      });
    }
    // A clone made at a release has no tracking branches: compare with the
    // remote's default branch fetched into FETCH_HEAD instead.
    let ref = upstream ? `origin/${upstream}` : null;
    if (!ref) {
      if (!fetch) throw new Error("no tracking branch; run without --no-fetch");
      git(dir, "fetch", "--quiet", "origin", "HEAD");
      ref = "FETCH_HEAD";
      upstream = "default branch";
    }
    const behind = Number(git(dir, "rev-list", "--count", `${pin.commit}..${ref}`));
    const ahead = Number(git(dir, "rev-list", "--count", `${ref}..${pin.commit}`));
    const latest = git(dir, "log", "-1", "--format=%h %cs %s", ref);
    if (behind) console.log(`↑ ${name}: ${behind} new commit(s) on ${ref === "FETCH_HEAD" ? "the upstream default branch" : ref} since the pin (latest ${latest})`);
    else if (ahead) console.log(`→ ${name}: pin is ${ahead} commit(s) ahead of ${ref === "FETCH_HEAD" ? "the upstream default branch" : ref} (branch work not merged or pushed there yet)`);
    else console.log(`✓ ${name}: pin is current with ${ref === "FETCH_HEAD" ? "the upstream default branch" : ref}`);
  } catch (error) {
    console.log(`? ${name}: could not compare (${String(error.stderr || error.message).trim().split("\n")[0]})`);
  }
}
console.log("\nTo take an update, follow docs/UPSTREAM_UPDATES.md. Nothing was changed.");
