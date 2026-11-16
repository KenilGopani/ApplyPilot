import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { jobSpyEnvelopeSchema, type JobSpyDiscoveryRequest } from "./envelope.ts";
import { PlatformError } from "./errors.ts";
import { mapJobSpyEnvelope, type DiscoveryResult } from "./map.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const defaultWorkerPath = join(repoRoot, "workers", "jobspy", "worker.py");

/** APPLYPILOT_JOBSPY_PYTHON, else the venv `npm run setup:jobspy` creates. */
export function resolveJobSpyPython(env: NodeJS.ProcessEnv = process.env): string {
  return env.APPLYPILOT_JOBSPY_PYTHON || join(repoRoot, "runtime", ".venv-jobspy", "bin", "python");
}

export interface RunOptions {
  python?: string;
  workerPath?: string;
  /** Kill the worker after this long. Default 10 minutes. */
  timeoutMs?: number;
  /** Receives the worker's stderr (JobSpy's own log lines). */
  onLog?: (line: string) => void;
}

/**
 * Run one JobSpy discovery and return canonical jobs plus metrics.
 *
 * Throws {@link PlatformError} when the run as a whole fails (worker missing,
 * crashed, timed out, invalid request, unreadable output). A run in which
 * every board failed is returned with status "failed", not thrown, so the
 * per-board error messages reach the caller intact.
 */
export async function runJobSpyDiscovery(
  request: JobSpyDiscoveryRequest,
  options: RunOptions = {},
): Promise<DiscoveryResult> {
  const python = options.python ?? resolveJobSpyPython();
  const workerPath = options.workerPath ?? defaultWorkerPath;
  if (python.includes("/") && !existsSync(python)) {
    throw new PlatformError(
      "DISCOVERY_WORKER_UNAVAILABLE",
      `JobSpy Python not found at ${python}. Run: npm run setup:jobspy`,
    );
  }

  const child = spawn(python, [workerPath], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderrTail = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-4000);
    if (options.onLog) for (const line of chunk.split("\n")) if (line.trim()) options.onLog(line);
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, options.timeoutMs ?? 600_000);

  const exitCode = await new Promise<number | null>((resolvePromise, reject) => {
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        new PlatformError(
          "DISCOVERY_WORKER_UNAVAILABLE",
          `cannot start JobSpy worker with ${python}: ${error.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise(code);
    });
    child.stdin.end(JSON.stringify(request));
  });

  if (timedOut) {
    throw new PlatformError("DISCOVERY_WORKER_TIMEOUT", "JobSpy worker timed out", { stderrTail });
  }
  const line = stdout.trim().split("\n").pop() ?? "";
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    throw new PlatformError(
      "DISCOVERY_PROTOCOL_ERROR",
      `JobSpy worker exited ${exitCode} without a JSON result`,
      { stderrTail },
    );
  }
  const parsed = jobSpyEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new PlatformError("DISCOVERY_PROTOCOL_ERROR", "JobSpy worker result has the wrong shape", {
      issues: parsed.error.issues,
    });
  }
  const envelope = parsed.data;
  if (envelope.error?.code === "INVALID_REQUEST") {
    throw new PlatformError("DISCOVERY_INVALID_REQUEST", envelope.error.message);
  }
  if (envelope.error?.code === "WORKER_CRASHED") {
    throw new PlatformError("DISCOVERY_WORKER_CRASHED", envelope.error.message, { stderrTail });
  }
  return mapJobSpyEnvelope(envelope);
}
