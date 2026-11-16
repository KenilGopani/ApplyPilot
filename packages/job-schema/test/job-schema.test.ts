import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalApplicationDecisionSchema,
  canonicalJobEvaluationSchema,
  canonicalJobId,
  canonicalJobSchema,
  canonicalizeUrl,
  type CanonicalJob,
  type CanonicalJobEvaluation,
} from "../src/index.ts";

const discoveredAt = "2026-11-15T12:00:00.000Z";

function job(overrides: Partial<CanonicalJob> = {}): CanonicalJob {
  const sourceUrl = "https://www.linkedin.com/jobs/view/4000000001";
  return {
    id: canonicalJobId("linkedin", "li-4000000001"),
    externalId: "li-4000000001",
    title: "Software Engineer, Applied AI",
    company: "Example Labs",
    location: "San Francisco, CA, USA",
    remoteType: "hybrid",
    source: "linkedin",
    sourceUrl,
    postedAt: "2026-11-14",
    discoveredAt,
    provenance: [
      {
        provider: "linkedin",
        site: "linkedin",
        url: sourceUrl,
        externalId: "li-4000000001",
        adapter: "jobspy",
        discoveredAt,
      },
    ],
    ...overrides,
  };
}

test("a complete canonical job validates and survives a JSON round trip", () => {
  const value = job({ rawSource: { id: "li-4000000001", nested: [1, 2] } });
  const parsed = canonicalJobSchema.parse(JSON.parse(JSON.stringify(value)));
  assert.deepEqual(parsed, value);
});

test("canonical jobs reject unsafe urls, impossible dates and inverted salary ranges", () => {
  for (const sourceUrl of ["javascript:alert(1)", "file:///etc/passwd", "https://"]) {
    assert.equal(canonicalJobSchema.safeParse(job({ sourceUrl })).success, false, sourceUrl);
  }
  assert.equal(canonicalJobSchema.safeParse(job({ postedAt: "2026-02-30" })).success, false);
  assert.equal(
    canonicalJobSchema.safeParse(job({ salaryMin: 200_000, salaryMax: 150_000 })).success,
    false,
  );
  assert.equal(canonicalJobSchema.safeParse(job({ title: "   " })).success, false);
});

test("provenance is required and the primary entry must match the job source", () => {
  assert.equal(canonicalJobSchema.safeParse(job({ provenance: [] })).success, false);
  const mismatched = job({ source: "indeed" });
  const result = canonicalJobSchema.safeParse(mismatched);
  assert.equal(result.success, false);
  assert.match(JSON.stringify(result.error?.issues), /first provenance entry/);
});

test("job ids are deterministic per source and differ across sources", () => {
  const a = canonicalJobId("indeed", "in-abc");
  assert.equal(a, canonicalJobId("indeed", "in-abc"));
  assert.notEqual(a, canonicalJobId("linkedin", "in-abc"));
  assert.match(a, /^job_[0-9a-f]{16}$/);
});

test("url canonicalization drops tracking noise but keeps identifying parameters", () => {
  assert.equal(
    canonicalizeUrl("https://WWW.Indeed.com/viewjob?utm_source=x&jk=abc123&from=serp#top"),
    "https://www.indeed.com/viewjob?from=serp&jk=abc123",
  );
  assert.equal(
    canonicalizeUrl("https://boards.greenhouse.io/acme/jobs/123/?gh_src=li"),
    "https://boards.greenhouse.io/acme/jobs/123",
  );
});

function evaluation(overrides: Partial<CanonicalJobEvaluation> = {}): CanonicalJobEvaluation {
  return {
    jobId: job().id,
    evaluator: "career-ops",
    evaluatedAt: discoveredAt,
    score: 4.5,
    scoreScale: { min: 1, max: 5 },
    decision: "apply",
    confidence: 0.8,
    matched: [
      {
        requirement: { id: "r1", text: "Python APIs", importance: "critical" },
        evidence: [
          {
            requirementId: "r1",
            origin: "resume",
            document: "applied-ai",
            excerpt: "Built FastAPI services in Python",
          },
        ],
      },
    ],
    missing: [{ id: "r2", text: "PyTorch", importance: "meaningful" }],
    workAuthorization: "unknown",
    explanation: "Strong backend and LLM overlap.",
    ...overrides,
  };
}

test("evaluations validate and keep the native score scale", () => {
  assert.equal(canonicalJobEvaluationSchema.safeParse(evaluation()).success, true);
  assert.equal(canonicalJobEvaluationSchema.safeParse(evaluation({ score: 7 })).success, false);
});

test("a matched requirement without resume evidence is rejected as an unsupported claim", () => {
  const unsupported = evaluation({
    matched: [
      { requirement: { id: "r3", text: "Kubernetes", importance: "high" }, evidence: [] },
    ],
  });
  const result = canonicalJobEvaluationSchema.safeParse(unsupported);
  assert.equal(result.success, false);
  assert.match(JSON.stringify(result.error?.issues), /no resume evidence/);
});

test("application decisions record who decided", () => {
  assert.equal(
    canonicalApplicationDecisionSchema.safeParse({
      jobId: job().id,
      decision: "skip",
      decidedBy: "human",
      reason: "Requires 8+ years",
      decidedAt: discoveredAt,
    }).success,
    true,
  );
  assert.equal(
    canonicalApplicationDecisionSchema.safeParse({
      jobId: job().id,
      decision: "submit",
      decidedBy: "human",
      reason: "",
      decidedAt: discoveredAt,
    }).success,
    false,
  );
});
