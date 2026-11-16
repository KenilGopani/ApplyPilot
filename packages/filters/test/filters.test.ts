import test from "node:test";
import assert from "node:assert/strict";
import { canonicalJobId, canonicalScreeningSchema, type CanonicalJob } from "@applypilot/job-schema";
import {
  authorizationCheck,
  locationCheck,
  requiredYears,
  screenJob,
  type FilterPolicy,
} from "../src/index.ts";

const now = new Date("2026-11-16T12:00:00Z");
const policy: FilterPolicy = {
  countries: ["United States"],
  maxPostingAgeDays: 45,
  excludedTitleKeywords: ["Staff", "Principal", "Manager"],
  reviewTitleKeywords: ["Senior", "Sr"],
  roleFamilyKeywords: ["Engineer", "Developer", "Scientist"],
  maxRequiredYears: 4,
  reviewRequiredYears: 2,
  needsSponsorship: true,
  salaryFloorYearly: 120000,
  excludedCompanies: ["Fictional Staffing"],
  excludedKeywords: ["commission only"],
};

function job(over: Partial<CanonicalJob> = {}): CanonicalJob {
  const url = `https://boards.greenhouse.io/example/jobs/${Math.floor(Math.random() * 1e9)}`;
  return {
    id: canonicalJobId("greenhouse", url),
    title: "Applied AI Engineer",
    company: "Example Labs",
    location: "San Francisco, CA",
    remoteType: "unknown",
    source: "greenhouse",
    sourceUrl: url,
    postedAt: "2026-11-10",
    discoveredAt: now.toISOString(),
    provenance: [{ provider: "greenhouse", site: "greenhouse", url, adapter: "career-ops", discoveredAt: now.toISOString() }],
    ...over,
  };
}

const byRule = (j: CanonicalJob, rule: string) => screenJob(j, policy, now).checks.find((c) => c.rule === rule);

test("a clean fit passes, and unknowns never reject", () => {
  const s = screenJob(job(), policy, now);
  canonicalScreeningSchema.parse(s);
  assert.equal(s.verdict, "pass");
  assert.equal(s.authorization, "unknown", "no description means sponsorship is unknown, not assumed");
});

test("location: US cities and states pass, foreign-only fails, bare Remote is unknown", () => {
  assert.equal(locationCheck(job({ location: "Austin, TX" }), policy).status, "compatible");
  assert.equal(locationCheck(job({ location: "London, UK | New York, NY" }), policy).status, "compatible");
  assert.equal(locationCheck(job({ location: "Remote - US" }), policy).status, "compatible");
  assert.equal(locationCheck(job({ location: "London, UK" }), policy).status, "incompatible");
  assert.equal(locationCheck(job({ location: "Bengaluru, India" }), policy).status, "incompatible");
  assert.equal(locationCheck(job({ location: "Remote" }), policy).status, "unknown");
  assert.equal(locationCheck(job({ location: undefined }), policy).status, "unknown");
});

test("stale postings, excluded levels and other role families are rejected; Senior is reviewed", () => {
  assert.equal(byRule(job({ postedAt: "2026-09-01" }), "posting-age")?.status, "incompatible");
  assert.equal(byRule(job({ title: "Staff Software Engineer" }), "title-level")?.status, "incompatible");
  assert.equal(screenJob(job({ title: "Senior AI Engineer" }), policy, now).verdict, "review");
  assert.equal(byRule(job({ title: "Account Executive" }), "role-family")?.status, "incompatible");
  assert.equal(byRule(job({ title: "Engineering Manager" }), "title-level")?.status, "incompatible");
});

test("required years come from required sentences only, with the sentence as evidence", () => {
  assert.deepEqual(requiredYears("You have 5+ years of professional software engineering experience."), {
    years: 5,
    evidence: "You have 5+ years of professional software engineering experience.",
  });
  assert.equal(requiredYears("3-5 years of industry experience. 8+ years of experience preferred.")?.years, 3);
  assert.equal(requiredYears("Founded 10 years ago, we build software."), null);
  const five = screenJob(job({ description: "Requirements: 5+ years of software engineering experience." }), policy, now);
  assert.equal(five.verdict, "reject");
  const three = screenJob(job({ description: "3+ years of professional experience building APIs." }), policy, now);
  assert.equal(three.verdict, "review");
});

test("sponsorship is read from the posting's own words, quoted, never inferred", () => {
  const no = authorizationCheck(job({ description: "Great team.\nWe are not able to sponsor visas for this role." }), policy);
  assert.equal(no.status, "incompatible");
  assert.equal(no.evidence, "We are not able to sponsor visas for this role.");
  for (const text of [
    "Candidates must be authorized to work without current or future sponsorship.",
    "Must be a U.S. citizen.",
    "Active Secret clearance required.",
  ]) {
    assert.equal(authorizationCheck(job({ description: text }), policy).status, "incompatible", text);
  }
  assert.equal(authorizationCheck(job({ description: "Visa sponsorship is available." }), policy).status, "compatible");
  assert.equal(
    authorizationCheck(job({ description: "You must be authorized to work in the US." }), policy).status,
    "manual-review",
  );
  assert.equal(authorizationCheck(job({ description: "We build agents." }), policy).status, "unknown");
  assert.equal(
    authorizationCheck(job({ description: "We are not able to sponsor visas." }), { ...policy, needsSponsorship: false }).status,
    "compatible",
  );
});

test("salary: hourly pay is annualised against the floor; other currencies are unknown", () => {
  assert.equal(byRule(job({ salaryMin: 40, salaryMax: 50, salaryInterval: "hourly", salaryCurrency: "USD" }), "salary")?.status, "incompatible");
  assert.equal(byRule(job({ salaryMin: 70, salaryMax: 85, salaryInterval: "hourly" }), "salary")?.status, "compatible");
  assert.equal(byRule(job({ salaryMax: 90000, salaryCurrency: "EUR" }), "salary")?.status, "unknown");
  assert.equal(byRule(job(), "salary")?.status, "unknown");
});

test("excluded companies and keywords reject", () => {
  assert.equal(screenJob(job({ company: "Fictional Staffing LLC" }), policy, now).verdict, "reject");
  assert.equal(screenJob(job({ description: "This role is commission only." }), policy, now).verdict, "reject");
});
