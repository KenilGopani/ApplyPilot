import test from "node:test";
import assert from "node:assert/strict";
import { createResumeVersion, matchedTerms, planTailoring, tailorResume, unsupportedLines } from "../src/index.ts";

// Fictional resume in Career Ops' cv.md shape.
const RESUME = `# CV -- Alex Example

## Professional Summary

Backend engineer building APIs with Python and PostgreSQL.

## Work Experience

### Acme -- Austin, TX

**Software Engineer**
2023-2025

- Built billing dashboards in React for finance teams.
- Ran Kafka consumers processing 2M events/day with idempotent retries.
- Built a RAG pipeline with pgvector that improved Recall@5 from 70% to 88%.

## Projects

- **Todo App** (React)
  - A small todo app.
- **Agent Lab** (Python, LangGraph)
  - Multi-agent research system with evals.

## Technical Skills

- **Backend:** Python, PostgreSQL, Kafka, React
- **AI:** RAG, pgvector, LangGraph
`;

const JD = "We build RAG and agent systems in Python. Experience with pgvector, LangGraph and Kafka. RAG evaluation matters.";

test("only skills the resume lists and the JD uses are matched, most mentioned first", () => {
  assert.deepEqual(matchedTerms(RESUME, JD), ["RAG", "Kafka", "LangGraph", "pgvector", "Python"]);
});

test("the tailored version only reorders existing lines; numbers and wording are untouched", () => {
  const tailored = tailorResume(RESUME, matchedTerms(RESUME, JD));
  assert.deepEqual(unsupportedLines(RESUME, tailored), []);
  assert.equal(tailored.split("\n").length, RESUME.split("\n").length);
  const exp = tailored.slice(tailored.indexOf("### Acme"), tailored.indexOf("## Projects"));
  assert.ok(exp.indexOf("RAG pipeline") < exp.indexOf("billing dashboards"), "the most relevant bullet leads");
  assert.ok(tailored.includes("70% to 88%"));
  const proj = tailored.slice(tailored.indexOf("## Projects"), tailored.indexOf("## Technical Skills"));
  assert.ok(proj.indexOf("Agent Lab") < proj.indexOf("Todo App"), "the relevant project moves up with its sub-bullet");
  assert.ok(proj.indexOf("Multi-agent research") === proj.indexOf("Agent Lab") + proj.slice(proj.indexOf("Agent Lab")).indexOf("Multi-agent research"));
  assert.match(tailored, /\*\*Backend:\*\* Kafka, Python, PostgreSQL, React/);
});

test("the guard catches any line that is not in the base resume", () => {
  const forged = RESUME.replace("70% to 88%", "70% to 99%");
  assert.equal(unsupportedLines(RESUME, forged).length, 1);
  assert.deepEqual(unsupportedLines(RESUME, `${RESUME}\n- Led a team of 40 engineers.`), ["- Led a team of 40 engineers."]);
});

test("recommendations cite verbatim resume text, and gaps stay gaps", () => {
  const plan = planTailoring({ resume: RESUME, jobDescription: JD, missing: ["PyTorch", "PyTorch"] });
  assert.deepEqual(plan.gaps, ["PyTorch"]);
  const surface = plan.items.find((i) => i.action === "surface-bullet");
  assert.ok(surface && RESUME.includes(surface.evidence), "evidence is copied from the resume");
  assert.ok(plan.items.some((i) => i.action === "move-project-up"));
  assert.ok(plan.items.some((i) => i.action === "reorder-skills"));
  const summary = plan.items.find((i) => i.action === "adjust-summary");
  assert.match(summary?.detail ?? "", /only if your experience below shows them/);
  for (const item of plan.items) assert.ok(!/PyTorch/.test(item.detail), "a gap is never suggested as content");
});

test("a resume version records its base and never changes it", () => {
  const plan = planTailoring({ resume: RESUME, jobDescription: JD });
  const before = RESUME;
  const { text, record } = createResumeVersion(RESUME, plan, {
    jobId: "job_0123456789abcdef",
    family: "applied-ai",
    baseFile: "cv.md",
    createdAt: "2026-11-16T00:00:00.000Z",
  });
  assert.equal(RESUME, before);
  assert.notEqual(text, RESUME);
  assert.match(record.versionId, /^rv_[0-9a-f]{12}$/);
  assert.equal(record.baseSha256.length, 64);
  assert.ok(record.changedLines > 0);
});

test("multi-word skills match the job's shorter wording through their distinctive words", () => {
  const resume = "## Skills\n\n- **Backend:** REST APIs, Hybrid Search\n";
  assert.deepEqual(matchedTerms(resume, "You build APIs."), ["REST APIs"]);
  assert.deepEqual(matchedTerms(resume, "Search the codebase."), [], "generic words alone do not match");
});
