import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  careerOpsHealth,
  initCareerOpsDataRoot,
  resolveCareerOpsHome,
  syncCareerOpsProfile,
} from "@applypilot/adapter-career-ops";
import {
  ProfileError,
  candidateProfileSchema,
  loadCandidateProfile,
  toCareerOpsAnswers,
  toFilterPolicy,
} from "../src/index.ts";

const example = resolve(dirname(fileURLToPath(import.meta.url)), "../../../config/candidate-profile.example.json");
const raw = JSON.parse(readFileSync(example, "utf8"));

test("the committed example profile is valid and fictional", () => {
  const profile = loadCandidateProfile(example);
  assert.equal(profile.identity.email, "alex@example.com");
  assert.equal(profile.career.level, "early-career");
});

test("invalid or missing profiles fail with a readable reason", () => {
  const dir = mkdtempSync(join(tmpdir(), "applypilot-profile-test-"));
  assert.throws(() => loadCandidateProfile(join(dir, "none.json")), ProfileError);
  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify({ ...raw, compensation: { currency: "USD", minimum: 1, targetMin: 200, targetMax: 100 } }));
  assert.throws(() => loadCandidateProfile(bad), /Compensation range is inverted/);
  writeFileSync(bad, "{not json");
  assert.throws(() => loadCandidateProfile(bad), /not valid JSON/);
  assert.equal(candidateProfileSchema.safeParse({ ...raw, career: { ...raw.career, targetRoles: [] } }).success, false);
});

test("the filter policy comes straight from the profile", () => {
  const profile = loadCandidateProfile(example);
  const policy = toFilterPolicy(profile);
  assert.deepEqual(policy.countries, ["United States"]);
  assert.equal(policy.needsSponsorship, false);
  assert.equal(policy.salaryFloorYearly, 110000);
  assert.equal(policy.maxRequiredYears, 4);
  assert.deepEqual(policy.reviewTitleKeywords, ["Senior", "Sr", "Lead"]);
  const eur = toFilterPolicy({ ...profile, compensation: { ...profile.compensation, currency: "EUR" } });
  assert.equal(eur.salaryFloorYearly, undefined, "no USD floor applied to a non-USD target");
});

test("Career Ops answers carry the stated facts only", () => {
  const profile = candidateProfileSchema.parse({
    ...raw,
    workAuthorization: { status: "F-1 OPT", needsSponsorship: true, authorizedIn: [] },
  });
  const answers = toCareerOpsAnswers(profile);
  assert.equal(answers.candidate.full_name, "Alex Example");
  assert.equal(answers.candidate.location, "Austin, TX");
  assert.equal("phone" in answers.candidate, false, "absent facts stay absent");
  assert.deepEqual(answers.compensation, { target_range: "110000-150000", currency: "USD", minimum: "110000" });
  assert.equal(answers.location.visa_status, "F-1 OPT");
  assert.equal(answers.location.needs_sponsorship, true);
  assert.equal("authorized_in" in answers.location, false);
  assert.deepEqual(answers.archetypes[0], { name: "Applied AI / LLM Engineer", level: "Early career", fit: "primary" });
});

const skip = !existsSync(join(resolveCareerOpsHome(), "node_modules")) && "Career Ops checkout not found";

test("real Career Ops writes its profile.yml from the mapped answers, and only that", { skip, timeout: 60_000 }, async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "applypilot-profile-sync-"));
  initCareerOpsDataRoot(dataRoot);
  const result = await syncCareerOpsProfile(toCareerOpsAnswers(loadCandidateProfile(example)), { dataRoot });
  assert.deepEqual(result.written, ["config/profile.yml"]);
  assert.ok(!existsSync(join(dataRoot, "portals.yml")), "portals.yml is not written");
  const yml = readFileSync(join(dataRoot, "config", "profile.yml"), "utf8");
  assert.match(yml, /Alex Example/);
  assert.match(yml, /110000-150000/);
  const health = await careerOpsHealth({ dataRoot });
  assert.ok(!health.missing.includes("config/profile.yml"));
});
