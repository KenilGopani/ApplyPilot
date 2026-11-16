import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CareerOpsError } from "./errors.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** The pinned checkout: `<sources>/career-ops`, sources defaulting to the parent folder. */
export function resolveCareerOpsHome(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolve(repoRoot, env.APPLYPILOT_SOURCES_DIR || ".."), "career-ops");
}

/** Where ApplyPilot keeps Career Ops' user layer: never inside the checkout. */
export function resolveCareerOpsDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.APPLYPILOT_CAREER_OPS_DATA || join(repoRoot, "runtime", "career-ops-data"));
}

/**
 * Scripts the adapter may run, and why each is safe to expose. Anything else
 * (evaluation, tailoring, research, apply) needs an AI CLI or model provider
 * and stays unexposed until its output contract is mapped (plan Phase 8).
 */
export const exposedScripts = {
  "doctor.mjs": "read-only health and onboarding state (--json)",
  "verify-pipeline.mjs": "read-only pipeline integrity checks (creates data/ and reports/ if absent)",
  "scan.mjs": "zero-token portal scan with a JSON receipt (--json); --dry-run writes nothing",
  "fetch-jd.mjs": "read-only job description from the ATS's public API or the page's JSON-LD",
  "onboard-write.mjs": "Career Ops' own writer for config/profile.yml in the data root (used with --only profile)",
} as const;
export type ExposedScript = keyof typeof exposedScripts;

/**
 * Environment variables that redirect Career Ops to other files. They are
 * removed so a value set in the user's shell can never point an ApplyPilot run
 * at their personal Career Ops install.
 */
const REDIRECTING_ENV = [
  "CAREER_OPS_ROOT",
  "CAREER_OPS_DATA_DIR",
  "CAREER_OPS_PROFILE",
  "CAREER_OPS_PORTALS",
  "CAREER_OPS_PIPELINE",
  "CAREER_OPS_TRACKER",
  "CAREER_OPS_SCAN_HISTORY",
  "CAREER_OPS_REPORTS_DIR",
  "CAREER_OPS_FOLLOWUPS",
  "CAREER_OPS_ADDITIONS",
  "CAREER_OPS_TRACKER_DB",
  "CAREER_OPS_PDF_INDEX",
  "CAREER_OPS_BATCH_STATE",
  "CAREER_OPS_BLACKLIST",
];

/**
 * Real path, also for a path that does not exist yet: resolve the nearest
 * existing ancestor through symlinks and re-append the rest, so a data root
 * that is about to be created is still compared in the same spelling.
 */
function real(path: string): string {
  const absolute = resolve(path);
  let existing = absolute;
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  try {
    return join(realpathSync(existing), relative(existing, absolute));
  } catch {
    return absolute;
  }
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(real(parent), real(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export interface CareerOpsRunOptions {
  home?: string;
  dataRoot?: string;
  timeoutMs?: number;
  /** Extra environment, applied after isolation (cannot re-add a redirect). */
  env?: Record<string, string>;
}

export interface CareerOpsRunResult {
  script: ExposedScript;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export function isolatedEnv(dataRoot: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of REDIRECTING_ENV) delete env[name];
  for (const [k, v] of Object.entries(extra)) {
    if (!REDIRECTING_ENV.includes(k)) env[k] = v;
  }
  env.CAREER_OPS_ROOT = dataRoot;
  env.CAREER_OPS_NO_ASKS = "1"; // no community prompts in automated runs
  env.NO_COLOR = "1";
  return env;
}

/**
 * Run one exposed Career Ops script with the current Node, from the checkout,
 * against the isolated data root. Returns the raw result; callers decide what
 * an exit code means for that script.
 */
export async function runCareerOps(
  script: ExposedScript,
  args: string[],
  options: CareerOpsRunOptions = {},
): Promise<CareerOpsRunResult> {
  if (!Object.hasOwn(exposedScripts, script)) {
    throw new CareerOpsError("CAREER_OPS_NOT_EXPOSED", `${script} is not exposed by the Career Ops adapter`);
  }
  const home = options.home ?? resolveCareerOpsHome();
  const dataRoot = options.dataRoot ?? resolveCareerOpsDataRoot();
  if (!existsSync(join(home, script)) || !existsSync(join(home, "package.json"))) {
    throw new CareerOpsError("CAREER_OPS_UNAVAILABLE", `Career Ops checkout not found at ${home} (set APPLYPILOT_SOURCES_DIR)`);
  }
  if (!existsSync(join(home, "node_modules"))) {
    throw new CareerOpsError("CAREER_OPS_UNAVAILABLE", `Career Ops dependencies are not installed: run npm ci in ${home}`);
  }
  if (isInside(dataRoot, home)) {
    // The checkout is pinned and verified clean; user data must live elsewhere.
    throw new CareerOpsError(
      "CAREER_OPS_UNSAFE_DATA_ROOT",
      `Career Ops data root ${dataRoot} is inside the checkout ${home}; use runtime/career-ops-data`,
    );
  }

  const started = Date.now();
  const child = spawn(process.execPath, [join(home, script), ...args], {
    cwd: home,
    env: isolatedEnv(dataRoot, options.env),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (c: string) => (stdout += c));
  child.stderr.setEncoding("utf8").on("data", (c: string) => (stderr = (stderr + c).slice(-20_000)));

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, options.timeoutMs ?? 300_000);
  const exitCode = await new Promise<number | null>((done, fail) => {
    child.on("error", (error) => {
      clearTimeout(timer);
      fail(new CareerOpsError("CAREER_OPS_UNAVAILABLE", `cannot start ${script}: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done(code);
    });
  });
  if (timedOut) {
    throw new CareerOpsError("CAREER_OPS_TIMEOUT", `${script} timed out`, { stderrTail: stderr.slice(-2000) });
  }
  return { script, args, exitCode, stdout, stderr, durationMs: Date.now() - started };
}

/** The last non-empty stdout line, parsed as JSON. */
export function lastJsonLine(result: CareerOpsRunResult): unknown {
  const line = result.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  try {
    return JSON.parse(line);
  } catch {
    throw new CareerOpsError(
      "CAREER_OPS_PROTOCOL_ERROR",
      `${result.script} exited ${result.exitCode} without a JSON line on stdout`,
      { stdoutTail: result.stdout.slice(-1000), stderrTail: result.stderr.slice(-1000) },
    );
  }
}
