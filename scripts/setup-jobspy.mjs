#!/usr/bin/env node
// Create runtime/.venv-jobspy (Python 3.12) and install the pinned JobSpy
// checkout into it in editable mode. JobSpy's source is never modified.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = resolve(root, process.env.APPLYPILOT_SOURCES_DIR || "..");
const jobspy = join(sources, "JobSpy");
const venv = join(root, "runtime", ".venv-jobspy");
const python = join(venv, "bin", "python");

if (!existsSync(join(jobspy, "pyproject.toml"))) {
  console.error(`JobSpy checkout not found at ${jobspy} (set APPLYPILOT_SOURCES_DIR)`);
  process.exit(1);
}
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });
try {
  if (!existsSync(python)) run("uv", ["venv", venv, "--python", "3.12"]);
  run("uv", ["pip", "install", "--python", python, "-e", jobspy]);
} catch (error) {
  console.error(`setup failed: ${error.message}\nInstall uv (https://docs.astral.sh/uv/) and retry.`);
  process.exit(1);
}
console.log(`JobSpy ready: ${python}`);
