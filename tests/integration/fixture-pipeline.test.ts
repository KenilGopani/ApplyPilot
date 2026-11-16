// End-to-end over sanitized fixtures, fully offline: JobSpy + Career Ops
// records -> canonical jobs -> dedup -> hard filters -> resume routing ->
// tailoring, plus the evaluation fixtures against the schema.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJobEvaluationSchema, canonicalJobSchema } from "@applypilot/job-schema";
import { mapJobSpyEnvelope, type JobSpyEnvelope } from "@applypilot/adapter-jobspy";
import { mapPortalScan, scanReceiptSchema } from "@applypilot/adapter-career-ops";
import { dedupeJobs } from "@applypilot/dedup";
import { screenJob } from "@applypilot/filters";
import { loadCandidateProfile, toFilterPolicy } from "@applypilot/candidate-profile";
import { routeResume } from "@applypilot/resume-router";
import { createResumeVersion, planTailoring, unsupportedLines } from "@applypilot/tailoring";

const fx = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const at = "2026-11-15T12:00:00.000Z";
const read = (p: string) => readFileSync(join(fx, p), "utf8");

function jobspy() {
  const sites = readdirSync(join(fx, "jobspy")).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
  const records = sites.flatMap((s) => JSON.parse(read(`jobspy/${s}.json`)));
  const env: JobSpyEnvelope = {
    version: "applypilot.jobspy.result@1", run_id: "run_e2e_js", started_at: at, finished_at: at, duration_ms: 1,
    upstream: { package: "python-jobspy", version: "1.4.1" }, request: {},
    metrics: { requested_per_site: 15, returned: records.length, by_site: {} }, records, error: null,
  };
  return mapJobSpyEnvelope(env);
}

test("fixture pipeline: discovery -> dedup -> filters -> routing -> tailoring keeps every invariant", () => {
  const portal = mapPortalScan(
    scanReceiptSchema.parse(JSON.parse(read("career-ops/receipt.json"))),
    read("career-ops/scan-history.tsv"),
    { runId: "run_e2e_co", startedAt: at, finishedAt: at, durationMs: 1, upstreamVersion: "career-ops@1.40.0" },
  );
  const boards = jobspy();
  const all = [...boards.jobs, ...portal.jobs];
  const { jobs, merges } = dedupeJobs(all);
  assert.equal(jobs.length, all.length - 1, "the LinkedIn listing of Greenhouse 7001 merges with the portal record");
  assert.equal(merges.length, 1);
  for (const job of jobs) {
    canonicalJobSchema.parse(job);
    assert.ok(job.provenance.length >= 1 && job.dedupKeys?.includes(`id:${job.id}`));
  }

  const policy = toFilterPolicy(loadCandidateProfile(resolve(fx, "../../config/candidate-profile.example.json")));
  const screened = jobs.map((j) => ({ ...j, screening: screenJob(j, policy, new Date("2026-11-16T00:00:00Z")) }));
  const verdicts = new Set(screened.map((j) => j.screening.verdict));
  assert.ok(verdicts.has("pass") && verdicts.has("reject"), "fixtures exercise both outcomes");
  const foreign = screened.find((j) => j.location?.includes("India"));
  assert.equal(foreign?.screening.verdict, "reject", "a role outside the allowed countries is filtered");
  for (const j of screened) {
    for (const c of j.screening.checks) if (c.status === "incompatible" && c.evidence) assert.ok(c.evidence.length <= 500);
  }

  const resumes = { "core-swe": read("resumes/core.md"), "applied-ai": read("resumes/applied-ai.md") };
  const families = Object.keys(resumes) as ("core-swe" | "applied-ai")[];
  const kept = screened.filter((j) => j.screening.verdict !== "reject" && j.description);
  assert.ok(kept.length > 0);
  for (const job of kept) {
    const route = routeResume({ title: job.title, description: job.description }, families);
    assert.ok(families.includes(route.recommended as "core-swe" | "applied-ai"));
    const base = resumes[route.recommended as "core-swe" | "applied-ai"];
    const plan = planTailoring({ resume: base, jobDescription: job.description!, missing: ["PyTorch"] });
    const { text } = createResumeVersion(base, plan, { jobId: job.id, family: route.recommended, baseFile: "fixture", createdAt: at });
    assert.deepEqual(unsupportedLines(base, text), [], `no new claims for ${job.title}`);
    assert.deepEqual(plan.gaps, ["PyTorch"]);
  }
});

test("evaluation fixtures are valid, and every match cites its resume fixture verbatim", () => {
  const applied = read("resumes/applied-ai.md");
  for (const file of readdirSync(join(fx, "evaluations"))) {
    const evaluation = canonicalJobEvaluationSchema.parse(JSON.parse(read(`evaluations/${file}`)));
    for (const m of evaluation.matched) for (const e of m.evidence) assert.ok(applied.includes(e.excerpt), `${file}: ${e.excerpt}`);
  }
  const reject = canonicalJobEvaluationSchema.parse(JSON.parse(read("evaluations/reject.json")));
  assert.equal(reject.workAuthorization, "incompatible");
});
