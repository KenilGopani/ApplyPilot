#!/usr/bin/env node
// npm run dev [-- --with-scheduler]
// Checks every part of the local stack, starts Rolecraft (unless it is already
// running) and, if asked, the discovery scheduler. Ctrl+C stops what it started.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = resolve(root, process.env.APPLYPILOT_SOURCES_DIR || "..");
const rolecraftDir = join(sources, "KenilJobBoard");
const url = process.env.APPLYPILOT_ROLECRAFT_URL || "http://127.0.0.1:5173";
const python = process.env.APPLYPILOT_JOBSPY_PYTHON || join(root, "runtime", ".venv-jobspy", "bin", "python");
const quiet = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });

const checks = [
  ["JobSpy worker", () => quiet(python, ["-c", "import jobspy"]).status === 0 || "run npm run setup:jobspy"],
  [
    "Career Ops",
    () => {
      const r = quiet(process.execPath, ["doctor.mjs", "--json"], {
        cwd: join(sources, "career-ops"),
        env: { ...process.env, CAREER_OPS_ROOT: mkdtempSync(join(tmpdir(), "applypilot-dev-")) },
      });
      return r.status === 0 || "doctor.mjs failed; run npm ci in career-ops";
    },
  ],
  ["Candidate profile", () => existsSync(join(root, "runtime", "candidate-profile.json")) || "copy config/candidate-profile.example.json to runtime/"],
  ["Claude CLI (evaluation)", () => quiet(process.env.APPLYPILOT_CLAUDE_BIN || "claude", ["--version"]).status === 0 || "install Claude Code and log in (only needed for evaluate and drafts)"],
  ["Rolecraft database", () => existsSync(join(rolecraftDir, ".wrangler", "state")) || "apply drizzle/0000-0005 migrations (KenilJobBoard README)"],
];

let failed = 0;
for (const [name, check] of checks) {
  let result;
  try {
    result = check();
  } catch (error) {
    result = error.message;
  }
  const ok = result === true;
  if (!ok) failed += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${result}`}`);
}

const up = quiet("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", `${url}/api/discovered-jobs`]).stdout === "401";
const children = [];
const start = (label, cmd, args, cwd) => {
  const child = spawn(cmd, args, { cwd, env: process.env });
  const tag = (chunk) => chunk.toString().split("\n").filter(Boolean).forEach((l) => console.log(`[${label}] ${l}`));
  child.stdout.on("data", tag);
  child.stderr.on("data", tag);
  child.on("exit", (code) => {
    console.log(`[${label}] stopped${code ? ` with exit ${code}` : ""}`);
    if (code) process.exitCode = 1;
  });
  children.push(child);
};

if (up) console.log(`✓ Rolecraft already running at ${url}`);
else if (!existsSync(join(rolecraftDir, "node_modules"))) console.log(`✗ Rolecraft — run npm ci in ${rolecraftDir}`);
else start("rolecraft", "npm", ["run", "dev", "--", "--host", "127.0.0.1"], rolecraftDir);
if (process.argv.includes("--with-scheduler")) {
  if (existsSync(join(root, "runtime", "schedule.json"))) start("scheduler", "npm", ["run", "schedule", "--silent", "--", "start"], root);
  else console.log("✗ Scheduler — copy config/schedule.example.json to runtime/schedule.json");
}
console.log(`\n${failed ? `${failed} part(s) need attention (above). ` : "All parts healthy. "}Rolecraft: ${url}`);
if (!children.length) process.exit(failed ? 1 : 0);
const stop = () => {
  for (const c of children) c.kill("SIGTERM");
  process.exit();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
