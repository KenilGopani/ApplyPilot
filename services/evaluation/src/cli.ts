// npm run evaluate -- [--limit 3] [--triage-limit 24] [--job <id>] [--model sonnet] [--dry-run]
import { parseArgs } from "node:util";
import { CareerOpsError } from "@applypilot/adapter-career-ops";
import { ClaudeError } from "@applypilot/adapter-claude-code";
import { DEFAULT_ROLECRAFT_URL, RolecraftError } from "@applypilot/rolecraft-client";
import { loadCandidateProfile } from "@applypilot/candidate-profile";
import { createLogger } from "@applypilot/logging";
import { evaluateInbox } from "./evaluate.ts";

const USAGE = `Usage: npm run evaluate -- [options]

Evaluates inbox jobs with Career Ops' own prompts through your Claude Code
login (e.g. a Claude Pro subscription; no API key). Nothing runs unless you
start it, and every run is capped.

  1. Quick check (triage) of jobs the hard filters kept, several per call.
  2. Full Career Ops evaluation of the best PASS jobs.

  --limit <n>          full evaluations this run (default 3)
  --triage-limit <n>   jobs to quick-check this run (default 24)
  --batch <n>          jobs per quick-check call (default 8, max 15)
  --job <id>           fully evaluate this inbox job now (repeatable)
  --model <name>       Claude model, e.g. sonnet or opus (default: Claude Code's)
  --dry-run            show what would run, call nothing
  --rolecraft-url <u>  local Rolecraft (default ${DEFAULT_ROLECRAFT_URL})

Reports are saved to runtime/evaluations/. If your Claude usage limit is
reached, the run stops and keeps everything it finished.`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      limit: { type: "string", default: "3" },
      "triage-limit": { type: "string", default: "24" },
      batch: { type: "string", default: "8" },
      job: { type: "string", multiple: true },
      model: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "rolecraft-url": { type: "string", default: DEFAULT_ROLECRAFT_URL },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const int = (v: string, name: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number`);
    return n;
  };
  let resumeFamilies: ("core-swe" | "applied-ai" | "hybrid")[] | undefined;
  try {
    const families = loadCandidateProfile().resumes.map((r) => r.family);
    if (families.length) resumeFamilies = families;
  } catch {
    resumeFamilies = undefined;
  }
  const summary = await evaluateInbox({
    resumeFamilies,
    limit: int(values.limit, "limit"),
    triageLimit: int(values["triage-limit"], "triage-limit"),
    batchSize: int(values.batch, "batch"),
    jobIds: values.job,
    dryRun: values["dry-run"],
    claude: values.model ? { model: values.model } : {},
    rolecraft: { baseUrl: values["rolecraft-url"] },
    log: (line) => console.log(line),
  });
  const t = summary.tokens;
  createLogger("evaluation").info("evaluate", {
    triaged: summary.triaged.length,
    evaluated: summary.evaluated.map((e) => ({ id: e.id, score: e.score, decision: e.decision })),
    skipped: summary.skipped.length,
    failed: summary.failed.map((f) => f.id),
    claude_calls: summary.claudeCalls,
    tokens: summary.tokens,
    stopped_by_limit: Boolean(summary.stoppedByLimit),
  });
  console.log(
    `\ndone: ${summary.triaged.length} quick-checked, ${summary.evaluated.length} fully evaluated, ` +
      `${summary.skipped.length} skipped, ${summary.failed.length} failed · ` +
      `${summary.claudeCalls} Claude call(s), ~${t.input.toLocaleString("en-US")} input (+${t.cached.toLocaleString("en-US")} cached) / ${t.output.toLocaleString("en-US")} output tokens`,
  );
  for (const s of summary.skipped) console.log(`  skipped ${s.id}: ${s.reason}`);
  for (const f of summary.failed) console.log(`  failed  ${f.id}: ${f.reason}`);
  if (summary.stoppedByLimit) {
    console.log(`\nStopped: Claude usage limit reached (${summary.stoppedByLimit}). Finished work is saved; run again later.`);
    return 2;
  }
  return summary.failed.length ? 3 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    if (error instanceof ClaudeError || error instanceof CareerOpsError) console.error(`${error.code}: ${error.message}`);
    else if (error instanceof RolecraftError) console.error(error.message);
    else console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
