// npm run prepare-application -- --job <id> [--drafts] [--model sonnet]
import { parseArgs } from "node:util";
import { loadCandidateProfile, ProfileError } from "@applypilot/candidate-profile";
import { DEFAULT_ROLECRAFT_URL } from "@applypilot/rolecraft-client";
import { createLogger } from "@applypilot/logging";
import { prepareApplication } from "./prepare.ts";

const USAGE = `Usage: npm run prepare-application -- --job <discovered job id> [options]

Builds the application preparation bundle for one inbox job and shows it in
Rolecraft: the resume to use, a tailored version (your own lines, reordered),
tailoring priorities, gaps and a checklist. Nothing is ever submitted.

  --drafts             also draft a cover letter, recruiter note and "why this
                       company" with your Claude login (one call); numbers not in
                       your resume or the posting are flagged
  --model <name>       Claude model for drafts
  --rolecraft-url <u>  local Rolecraft (default ${DEFAULT_ROLECRAFT_URL})

The job id is shown in Rolecraft (job_…) and in runtime/discovery run files.`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      job: { type: "string" },
      drafts: { type: "boolean", default: false },
      model: { type: "string" },
      "rolecraft-url": { type: "string", default: DEFAULT_ROLECRAFT_URL },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help || !values.job) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }
  let profile;
  try {
    profile = loadCandidateProfile();
  } catch (error) {
    if (!(error instanceof ProfileError)) throw error;
    console.error(`${error.message} Using runtime/career-ops-data/cv.md.`);
  }
  const bundle = await prepareApplication({
    jobId: values.job,
    profile,
    withDrafts: values.drafts,
    claude: values.model ? { model: values.model } : {},
    rolecraft: { baseUrl: values["rolecraft-url"] },
  });
  createLogger("preparation").info("prepared", {
    job_id: values.job,
    family: bundle.resume.family,
    version_id: bundle.resume.versionId,
    priorities: bundle.priorities.length,
    gaps: bundle.gaps.length,
    with_drafts: Boolean(bundle.drafts),
    unverified_numbers: bundle.drafts?.unverifiedNumbers.length ?? 0,
  });
  console.log(`resume: ${bundle.resume.family} (${bundle.resume.reason})`);
  console.log(`tailored version: ${bundle.resume.file} (${bundle.resume.changedLines} lines reordered)`);
  console.log(`matched terms: ${bundle.resume.matchedTerms.join(", ") || "none"}`);
  for (const p of bundle.priorities) console.log(`  · ${p.detail}`);
  if (bundle.gaps.length) console.log(`gaps: ${bundle.gaps.join("; ")}`);
  if (bundle.drafts) {
    console.log(`drafts ready${bundle.drafts.unverifiedNumbers.length ? `; check numbers: ${bundle.drafts.unverifiedNumbers.join(", ")}` : ""}`);
  }
  console.log("Shown in Rolecraft under the job's Application prep. Review, then submit yourself.");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
