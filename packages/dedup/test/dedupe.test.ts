import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJobId, canonicalJobSchema, type CanonicalJob } from "@applypilot/job-schema";
import { mapJobSpyRecord } from "@applypilot/adapter-jobspy";
import { mapPortalScan, scanReceiptSchema } from "@applypilot/adapter-career-ops";
import {
  atsIdentity,
  dedupeJobs,
  jobKeys,
  keysConflict,
  normalizeCity,
  normalizeCompany,
  normalizeTitle,
} from "../src/index.ts";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures");
const at = "2026-11-15T12:00:00.000Z";

function job(over: Partial<CanonicalJob> & { source: CanonicalJob["source"]; sourceUrl: string }): CanonicalJob {
  const { source, sourceUrl } = over;
  return {
    id: canonicalJobId(source, sourceUrl),
    title: "Applied AI Engineer",
    company: "Example Labs",
    remoteType: "unknown",
    discoveredAt: at,
    provenance: [{ provider: source, site: source, url: sourceUrl, adapter: "jobspy", discoveredAt: at }],
    ...over,
  };
}

test("normalization ignores formatting, legal suffixes, abbreviations and work-mode qualifiers", () => {
  assert.equal(normalizeCompany("Example Labs, Inc."), "example labs");
  assert.equal(normalizeCompany("AT&T"), "at and t");
  assert.equal(normalizeCompany("Co"), "co", "a name that is only a suffix is kept");
  assert.equal(normalizeTitle("Sr. Software Eng (Remote, US)"), "senior software engineer");
  assert.equal(normalizeTitle("Software Engineer - Remote"), "software engineer");
  assert.equal(normalizeTitle("Software Engineer (Agents)"), "software engineer agents", "job qualifiers stay");
  assert.equal(normalizeCity("San Francisco, CA | New York City, NY"), "san francisco");
  assert.equal(normalizeCity("Remote - US"), undefined);
  assert.equal(normalizeCity("United States"), undefined);
});

test("ATS identities are read from board, embed and employer-page URLs", () => {
  assert.equal(atsIdentity("https://boards.greenhouse.io/acme/jobs/7001"), "greenhouse:7001");
  assert.equal(atsIdentity("https://job-boards.greenhouse.io/acme/jobs/7001?gh_src=x"), "greenhouse:7001");
  assert.equal(atsIdentity("https://boards.greenhouse.io/embed/job_app?for=acme&token=7001"), "greenhouse:7001");
  assert.equal(atsIdentity("https://acme.example/careers?gh_jid=7001234"), "greenhouse:7001234");
  assert.equal(
    atsIdentity("https://jobs.ashbyhq.com/acme/8B476294-6286-4292-8836-329DB2128F89?utm_source=x"),
    "ashby:8b476294-6286-4292-8836-329db2128f89",
  );
  assert.equal(atsIdentity("https://jobs.lever.co/acme/not-a-uuid"), undefined);
  assert.equal(atsIdentity("https://www.linkedin.com/jobs/view/1"), undefined);
});

test("a board listing whose apply link is the employer's ATS posting merges into the ATS record", () => {
  // Fixtures: JobSpy LinkedIn row li-4000000001 applies at boards.greenhouse.io/examplelabs/jobs/7001;
  // Career Ops found the same posting at job-boards.greenhouse.io/examplelabs/jobs/7001.
  const [linkedinRow] = JSON.parse(readFileSync(join(fixtures, "jobspy", "linkedin.json"), "utf8"));
  const linkedin = mapJobSpyRecord(linkedinRow, { runId: "run_js", discoveredAt: at }).job;
  const portal = mapPortalScan(
    scanReceiptSchema.parse(JSON.parse(readFileSync(join(fixtures, "career-ops", "receipt.json"), "utf8"))),
    readFileSync(join(fixtures, "career-ops", "scan-history.tsv"), "utf8"),
    { runId: "run_co", startedAt: at, finishedAt: "2026-11-15T13:00:00.000Z", durationMs: 1, upstreamVersion: null },
  ).jobs.find((j) => j.sourceUrl.endsWith("/7001"))!;

  const { jobs, merges } = dedupeJobs([linkedin, portal]);
  assert.equal(jobs.length, 1);
  const [merged] = jobs;
  canonicalJobSchema.parse(merged);
  assert.equal(merged!.source, "greenhouse", "the employer's posting is primary");
  assert.equal(merged!.id, portal.id);
  assert.equal(merged!.description, linkedin.description, "the board's description fills the gap");
  assert.equal(merged!.discoveredAt, at, "earliest sighting");
  assert.deepEqual(merged!.provenance.map((p) => p.adapter).sort(), ["career-ops", "jobspy"]);
  assert.ok(merged!.dedupKeys?.includes(`id:${linkedin.id}`), "the folded id stays findable");
  assert.ok(merged!.dedupKeys?.includes("ats:greenhouse:7001"));
  assert.deepEqual(merges, [{ into: portal.id, from: [linkedin.id], by: "ats" }]);
});

test("company + title + city merges board copies; salary travels as one unit", () => {
  const a = job({ source: "linkedin", sourceUrl: "https://www.linkedin.com/jobs/view/1", location: "San Francisco, CA, USA" });
  const b = job({
    source: "indeed",
    sourceUrl: "https://www.indeed.com/viewjob?jk=abc",
    company: "Example Labs Inc",
    title: "Applied AI Engineer (Hybrid)",
    location: "San Francisco, CA",
    remoteType: "hybrid",
    salaryMin: 140000,
    salaryMax: 170000,
    salaryCurrency: "USD",
    salaryInterval: "yearly",
    discoveredAt: "2026-11-14T00:00:00.000Z",
  });
  const { jobs, merges } = dedupeJobs([a, b]);
  assert.equal(jobs.length, 1);
  assert.equal(merges[0]?.by, "cctl");
  assert.equal(jobs[0]!.remoteType, "hybrid");
  assert.deepEqual(
    [jobs[0]!.salaryMin, jobs[0]!.salaryMax, jobs[0]!.salaryCurrency, jobs[0]!.salaryInterval],
    [140000, 170000, "USD", "yearly"],
  );
});

test("two openings with the same title are never merged when their ATS ids differ", () => {
  const sf1 = job({ source: "greenhouse", sourceUrl: "https://boards.greenhouse.io/examplelabs/jobs/1", location: "San Francisco, CA" });
  const sf2 = job({ source: "greenhouse", sourceUrl: "https://boards.greenhouse.io/examplelabs/jobs/2", location: "San Francisco, CA" });
  const board = job({
    source: "linkedin",
    sourceUrl: "https://www.linkedin.com/jobs/view/9",
    location: "San Francisco, CA",
    provenance: [{ provider: "linkedin", site: "linkedin", url: "https://www.linkedin.com/jobs/view/9", applyUrl: "https://boards.greenhouse.io/examplelabs/jobs/2", adapter: "jobspy", discoveredAt: at }],
  });
  const { jobs, merges, possibleDuplicates } = dedupeJobs([sf1, sf2, board]);
  assert.equal(jobs.length, 2, "board copy joins opening 2 only");
  assert.deepEqual(merges.map((m) => m.from), [[board.id]]);
  assert.ok(possibleDuplicates.some((p) => p.key === "ct:example labs|applied ai engineer"));
  assert.ok(keysConflict(["ats:greenhouse:1"], ["ats:greenhouse:2"]));
  assert.ok(!keysConflict(["ats:greenhouse:1"], ["ats:lever:1"]), "different ATS scopes don't conflict");
});

test("different cities and missing locations only produce possible duplicates", () => {
  const sf = job({ source: "linkedin", sourceUrl: "https://www.linkedin.com/jobs/view/1", location: "San Francisco, CA" });
  const ny = job({ source: "indeed", sourceUrl: "https://www.indeed.com/viewjob?jk=1", location: "New York, NY" });
  const remote = job({ source: "glassdoor", sourceUrl: "https://www.glassdoor.com/job-listing/j?jl=1", location: "Remote" });
  const { jobs, possibleDuplicates } = dedupeJobs([sf, ny, remote]);
  assert.equal(jobs.length, 3);
  assert.equal(possibleDuplicates.length, 2);
});

test("a long identical description links copies; short ones never do", () => {
  const text = "Build retrieval pipelines and evaluation harnesses for production LLM features. ".repeat(8);
  const a = job({ source: "linkedin", sourceUrl: "https://www.linkedin.com/jobs/view/1", title: "AI Engineer", description: `## Role\n\n${text}` });
  const b = job({ source: "indeed", sourceUrl: "https://www.indeed.com/viewjob?jk=1", title: "Engineer, AI Products", description: `<p>Role</p><p>${text}</p>` });
  assert.equal(dedupeJobs([a, b]).merges[0]?.by, "fp");
  const shortA = { ...a, description: "Build things." };
  const shortB = { ...b, description: "Build things." };
  assert.equal(dedupeJobs([shortA, shortB]).jobs.length, 2);
  assert.ok(!jobKeys(shortA).strong.some((k) => k.startsWith("fp:")));
});

test("every job leaves with its keys, including singletons", () => {
  const solo = job({ source: "linkedin", sourceUrl: "https://www.linkedin.com/jobs/view/5" });
  const [out] = dedupeJobs([solo]).jobs;
  assert.ok(out!.dedupKeys?.includes(`id:${solo.id}`));
  assert.ok(out!.dedupKeys?.includes("url:https://www.linkedin.com/jobs/view/5"));
  assert.ok(!out!.dedupKeys?.some((k) => k.startsWith("ct:")), "weak keys are never sent");
});
