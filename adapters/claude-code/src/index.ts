import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Claude Code in print mode, as a text-in / text-out model call:
 *
 *   claude -p --tools "" --strict-mcp-config --no-session-persistence --output-format json
 *
 * - No tools at all: the model cannot read, write, run or fetch anything.
 *   Every input is in the prompt and ApplyPilot writes every file itself
 *   (Career Ops' rule for headless workers: never a blanket permission flag).
 * - Runs on the user's own `claude` login (e.g. a Claude Pro subscription);
 *   no API key is read or needed.
 * - Runs in an empty temporary directory so no project instructions load.
 */

export const claudeErrorCodes = [
  "CLAUDE_UNAVAILABLE",
  /** Subscription or rate limit reached: stop the run, try again later. */
  "CLAUDE_LIMIT",
  "CLAUDE_FAILED",
  "CLAUDE_TIMEOUT",
  "CLAUDE_PROTOCOL_ERROR",
] as const;
export type ClaudeErrorCode = (typeof claudeErrorCodes)[number];

export class ClaudeError extends Error {
  readonly code: ClaudeErrorCode;
  constructor(code: ClaudeErrorCode, message: string) {
    super(message);
    this.name = "ClaudeError";
    this.code = code;
  }
}

export interface ClaudeUsage {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

export interface ClaudeResult {
  text: string;
  model: string | null;
  usage: ClaudeUsage;
  durationMs: number;
}

export interface ClaudeOptions {
  /** The CLI to run; default "claude" on PATH (APPLYPILOT_CLAUDE_BIN overrides). */
  bin?: string;
  /** e.g. "sonnet" or "opus"; default is the CLI's own default. */
  model?: string;
  timeoutMs?: number;
}

const LIMIT = /usage limit|rate limit|limit reached|too many requests|\b429\b|overloaded/i;

export function claudeArgs(model?: string): string[] {
  return [
    "-p",
    "--tools",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--output-format",
    "json",
    ...(model ? ["--model", model] : []),
  ];
}

export async function runClaude(prompt: string, options: ClaudeOptions = {}): Promise<ClaudeResult> {
  const bin = options.bin ?? process.env.APPLYPILOT_CLAUDE_BIN ?? "claude";
  const cwd = mkdtempSync(join(tmpdir(), "applypilot-claude-"));
  const started = Date.now();
  try {
    const child = spawn(bin, claudeArgs(options.model), { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (c: string) => (stdout += c));
    child.stderr.setEncoding("utf8").on("data", (c: string) => (stderr = (stderr + c).slice(-4000)));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? 600_000);
    const exitCode = await new Promise<number | null>((done, fail) => {
      child.on("error", (error) => {
        clearTimeout(timer);
        fail(new ClaudeError("CLAUDE_UNAVAILABLE", `cannot start ${bin}: ${error.message}. Install Claude Code and log in.`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        done(code);
      });
      child.stdin.end(prompt);
    });
    if (timedOut) throw new ClaudeError("CLAUDE_TIMEOUT", "Claude did not answer in time");

    let body: {
      result?: unknown;
      is_error?: boolean;
      subtype?: string;
      api_error_status?: unknown;
      usage?: Record<string, number>;
      modelUsage?: Record<string, unknown>;
    };
    try {
      body = JSON.parse(stdout.trim().split("\n").filter(Boolean).pop() ?? "");
    } catch {
      const reason = `${stderr} ${stdout}`.trim().slice(-300);
      if (LIMIT.test(reason)) throw new ClaudeError("CLAUDE_LIMIT", reason);
      throw new ClaudeError("CLAUDE_PROTOCOL_ERROR", `claude exited ${exitCode} without a JSON result: ${reason}`);
    }
    const text = typeof body.result === "string" ? body.result : "";
    if (body.is_error || exitCode !== 0) {
      const reason = `${text} ${body.subtype ?? ""} ${String(body.api_error_status ?? "")} ${stderr}`.trim();
      if (LIMIT.test(reason)) throw new ClaudeError("CLAUDE_LIMIT", reason.slice(0, 300));
      throw new ClaudeError("CLAUDE_FAILED", reason.slice(0, 300) || `claude exited ${exitCode}`);
    }
    const u = body.usage ?? {};
    return {
      text,
      model: Object.keys(body.modelUsage ?? {})[0] ?? null,
      usage: {
        inputTokens: u.input_tokens ?? 0,
        cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
      },
      durationMs: Date.now() - started,
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
