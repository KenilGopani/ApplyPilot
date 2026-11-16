#!/usr/bin/env node
// Run the JobSpy worker's Python (APPLYPILOT_JOBSPY_PYTHON, else
// runtime/.venv-jobspy) with the given arguments.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const python =
  process.env.APPLYPILOT_JOBSPY_PYTHON || join(root, "runtime", ".venv-jobspy", "bin", "python");
if (!process.env.APPLYPILOT_JOBSPY_PYTHON && !existsSync(python)) {
  console.error("JobSpy Python environment missing. Run: npm run setup:jobspy");
  process.exit(1);
}
const result = spawnSync(python, process.argv.slice(2), { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
