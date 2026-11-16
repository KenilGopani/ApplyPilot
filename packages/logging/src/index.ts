import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const DEFAULT_LOG_DIR = join(repoRoot, "runtime", "logs");

/**
 * Field names whose values never reach a log: secrets, contact details and
 * any resume, posting or draft text (plan Phase 24).
 */
const SENSITIVE_KEY =
  /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|proxies|proxy|email|phone|full[-_]?name|resume|cv|description|answers?|cover[-_]?letter|outreach|why[-_]?company|drafts?|raw[-_]?source|prompt|text)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /\+?\(?\d[\d\s().-]{8,}\d/g;

/** Mask only what looks like a phone number: 10-15 digits written with +, ( ) or spaces; never dates or ids. */
function maskPhones(text: string): string {
  return text.replace(PHONE, (m) => {
    const digits = m.replace(/\D/g, "").length;
    const phoneLike = /^\+|[()\s]/.test(m) && !/^\d{4}-\d{2}-\d{2}/.test(m);
    return digits >= 10 && digits <= 15 && phoneLike ? "[phone]" : m;
  });
}
const BEARER = /\b(bearer|sk-[a-z]*|ghp_|xox[bp]-)[A-Za-z0-9._-]{8,}/gi;
const MAX_STRING = 300;

/** Deep copy with sensitive fields replaced and stray contact details or tokens masked. */
export function redact(value: unknown, key = "", depth = 0): unknown {
  if (key && SENSITIVE_KEY.test(key)) return "[redacted]";
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") {
    const masked = maskPhones(value.replace(EMAIL, "[email]").replace(BEARER, "[token]"));
    return masked.length > MAX_STRING ? `${masked.slice(0, MAX_STRING)}…` : masked;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, "", depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k, depth + 1)]));
  }
  return value;
}

/** The per-run record the plan asks every pipeline run to log. */
export interface RunMetrics {
  run_id: string;
  source: string;
  query?: string;
  start: string;
  end: string;
  jobs_found: number;
  jobs_normalized: number;
  duplicates: number;
  filtered: number;
  evaluated: number;
  failures: string[];
  duration_ms: number;
}

export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  run(metrics: RunMetrics): void;
}

/** A logger writing one JSON object per line to <dir>/<service>.jsonl. Never throws. */
export function createLogger(service: string, dir = process.env.APPLYPILOT_LOG_DIR || DEFAULT_LOG_DIR): Logger {
  const file = join(dir, `${service}.jsonl`);
  const write = (level: string, event: string, fields: Record<string, unknown> = {}) => {
    try {
      mkdirSync(dir, { recursive: true });
      const line = { ts: new Date().toISOString(), level, service, event, ...(redact(fields) as object) };
      appendFileSync(file, `${JSON.stringify(line)}\n`);
    } catch {
      // Logging must never break a run.
    }
  };
  return {
    info: (e, f) => write("info", e, f),
    warn: (e, f) => write("warn", e, f),
    error: (e, f) => write("error", e, f),
    run: (m) => write("info", "run", m as unknown as Record<string, unknown>),
  };
}
