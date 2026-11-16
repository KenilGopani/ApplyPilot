// npm run push -- runtime/discovery/<run id>.json [--rolecraft-url http://127.0.0.1:5173]
// npm run push -- --all
// Imports saved discovery runs into Rolecraft without searching again. Runs
// are re-deduplicated first, so re-sending older runs lets Rolecraft merge
// them with the same postings found by other sources (jobs you have acted on
// are never folded away). Re-sending a run is idempotent.
import "@applypilot/config/env";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_ROLECRAFT_URL, RolecraftError, pushDiscovery } from "@applypilot/rolecraft-client";
import type { DiscoveryResult } from "@applypilot/job-schema";
import { ProfileError, loadCandidateProfile, toFilterPolicy } from "@applypilot/candidate-profile";
import { runInfo, screenJobs, withDedup } from "./pipeline.ts";

const runsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../runtime/discovery");

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    all: { type: "boolean", default: false },
    "no-screen": { type: "boolean", default: false },
    "rolecraft-url": { type: "string", default: DEFAULT_ROLECRAFT_URL },
  },
});
if (values.all === positionals.length > 0 || positionals.length > 1) {
  console.error("Usage: npm run push -- <runtime/discovery/run_….json> | --all [--rolecraft-url <url>]");
  process.exit(1);
}

function load(path: string): DiscoveryResult {
  const saved = JSON.parse(readFileSync(path, "utf8")) as DiscoveryResult;
  // Runs saved before the adapter field existed all came from JobSpy, and
  // runs saved before dedup keys existed get them now.
  return withDedup({ ...saved, adapter: saved.adapter ?? "jobspy" }).result;
}

const files = values.all
  ? readdirSync(runsDir).filter((f) => f.endsWith(".json")).map((f) => join(runsDir, f))
  : [positionals[0] as string];
// Oldest first, so the earliest stored copy of a posting stays its record.
const runs = files.map(load).sort((a, b) => a.startedAt.localeCompare(b.startedAt));

// Saved runs are screened with the current profile, so older jobs get the
// same hard filters as new ones.
let policy: ReturnType<typeof toFilterPolicy> | undefined;
if (!values["no-screen"]) {
  try {
    policy = toFilterPolicy(loadCandidateProfile());
  } catch (error) {
    if (!(error instanceof ProfileError)) throw error;
    console.error(`Hard filters off: ${error.message}`);
  }
}

let failed = false;
for (const loaded of runs) {
  let result = loaded;
  if (policy) {
    const screened = await screenJobs(loaded.jobs, { policy });
    result = { ...loaded, jobs: screened.jobs };
    const v = screened.summary.verdicts;
    console.log(`${loaded.runId}: screened ${v.pass} pass, ${v.review} review, ${v.reject} filtered out`);
  }
  try {
    const p = await pushDiscovery(runInfo(result), result.jobs, { baseUrl: values["rolecraft-url"] });
    console.log(
      `${result.runId} (${result.adapter}): ${p.created} new, ${p.updated} updated, ${p.merged} merged into existing jobs`,
    );
  } catch (error) {
    if (!(error instanceof RolecraftError)) throw error;
    console.error(`${result.runId}: Rolecraft import failed: ${error.message}`);
    failed = true;
  }
}
process.exit(failed ? 3 : 0);
