import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Every setting ApplyPilot reads, with its default. Kept in step with .env.example. */
export const SETTINGS = {
  APPLYPILOT_SOURCES_DIR: { default: "..", about: "folder holding the JobSpy, career-ops and KenilJobBoard checkouts" },
  APPLYPILOT_JOBSPY_PYTHON: { default: "runtime/.venv-jobspy/bin/python", about: "Python with the pinned JobSpy installed" },
  APPLYPILOT_CAREER_OPS_DATA: { default: "runtime/career-ops-data", about: "Career Ops data root (CAREER_OPS_ROOT)" },
  APPLYPILOT_PROFILE: { default: "runtime/candidate-profile.json", about: "candidate profile" },
  APPLYPILOT_LOG_DIR: { default: "runtime/logs", about: "structured logs" },
  APPLYPILOT_CLAUDE_BIN: { default: "claude", about: "Claude Code CLI used for evaluation and drafts" },
  APPLYPILOT_ROLECRAFT_URL: { default: "http://127.0.0.1:5173", about: "local Rolecraft (loopback only)" },
} as const;
export type SettingName = keyof typeof SETTINGS;

/** Parse KEY=value lines; # comments, blank lines and surrounding quotes handled. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2]!.trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    out[m[1]!] = value;
  }
  return out;
}

/**
 * Apply the repository's git-ignored .env (and .env.local) to process.env.
 * Values already set in the shell always win; nothing is overwritten.
 */
export function applyLocalEnv(env: NodeJS.ProcessEnv = process.env, root = repoRoot): string[] {
  const applied: string[] = [];
  for (const file of [".env.local", ".env"]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    for (const [k, v] of Object.entries(parseEnv(readFileSync(path, "utf8")))) {
      if (env[k] === undefined) {
        env[k] = v;
        applied.push(k);
      }
    }
  }
  return applied;
}

export interface ResolvedSetting {
  name: SettingName;
  value: string;
  source: "environment" | "default";
  problem?: string;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Resolve and check every setting. Problems are reported, never thrown. */
export function checkConfig(env: NodeJS.ProcessEnv = process.env, root = repoRoot): ResolvedSetting[] {
  return (Object.keys(SETTINGS) as SettingName[]).map((name) => {
    const fromEnv = env[name]?.trim();
    const value = fromEnv || SETTINGS[name].default;
    const setting: ResolvedSetting = { name, value, source: fromEnv ? "environment" : "default" };
    const path = resolve(root, value);
    if (name === "APPLYPILOT_SOURCES_DIR") {
      const missing = ["JobSpy", "career-ops", "KenilJobBoard"].filter((r) => !existsSync(join(path, r)));
      if (missing.length) setting.problem = `missing checkout(s): ${missing.join(", ")}`;
    } else if (name === "APPLYPILOT_JOBSPY_PYTHON") {
      if (!existsSync(path)) setting.problem = "not found; run npm run setup:jobspy";
    } else if (name === "APPLYPILOT_PROFILE") {
      if (!existsSync(path)) setting.problem = "not found; copy config/candidate-profile.example.json there";
    } else if (name === "APPLYPILOT_ROLECRAFT_URL") {
      try {
        const url = new URL(value);
        if (!LOOPBACK.has(url.hostname)) setting.problem = "must be a local address";
      } catch {
        setting.problem = "not a URL";
      }
    }
    return setting;
  });
}
