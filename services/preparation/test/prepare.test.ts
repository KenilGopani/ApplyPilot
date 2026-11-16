import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unsupportedLines } from "@applypilot/tailoring";
import { prepareApplication, unverifiedNumbers } from "../src/prepare.ts";

const RESUME = `# CV -- Alex Example

## Professional Summary

Backend engineer building APIs with Python.

## Work Experience

### Acme -- Austin, TX

- Built billing dashboards for finance teams.
- Built a RAG pipeline with pgvector that improved Recall@5 from 70% to 88%.

## Technical Skills

- **Backend:** Python, PostgreSQL
- **AI:** RAG, pgvector
`;

async function fakeRolecraft(job: Record<string, unknown>) {
  const puts: unknown[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.method === "PUT") {
        puts.push(JSON.parse(raw));
        return res.end(JSON.stringify({ ok: true }));
      }
      res.end(JSON.stringify({ job }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, puts, close: () => server.close() };
}

const job = {
  id: "job_0123456789abcdef",
  company: "Example Labs",
  title: "Applied AI Engineer",
  sourceUrl: "https://boards.greenhouse.io/example/jobs/1",
  description: "Build RAG with pgvector and Python. Founded in 2019.",
  provenance: [],
  evaluation: { stage: "full", evaluation: { missing: [{ text: "PyTorch" }, { text: "On-site in SF", category: "unverified-match" }] }, resumeRouting: { recommended: "applied-ai" } },
};

test("numbers in drafts must come from the resume or the posting", () => {
  assert.deepEqual(unverifiedNumbers("Raised Recall@5 to 88% at a 2019 startup, 12 engineers", RESUME, job.description), ["12"]);
});

test("a bundle carries the routed resume, a reorder-only version, priorities, gaps and a checklist", async () => {
  const rc = await fakeRolecraft(job);
  const outDir = mkdtempSync(join(tmpdir(), "applypilot-prep-"));
  try {
    const bundle = await prepareApplication({
      jobId: job.id,
      resumeText: RESUME,
      outDir,
      rolecraft: { baseUrl: rc.url },
      now: () => new Date("2026-11-16T00:00:00Z"),
    });
    assert.equal(bundle.resume.family, "applied-ai");
    assert.deepEqual(bundle.gaps, ["PyTorch"]);
    assert.deepEqual(unsupportedLines(RESUME, readFileSync(bundle.resume.file, "utf8")), []);
    assert.ok(bundle.priorities.length > 0);
    assert.equal(bundle.drafts, null, "no model call without --drafts");
    assert.match(bundle.checklist.at(-1)!, /Submit the application yourself/);
    assert.equal(rc.puts.length, 1);
  } finally {
    rc.close();
  }
});

test("drafts come from one model call and flag numbers that are not in the sources", async () => {
  const rc = await fakeRolecraft(job);
  try {
    let calls = 0;
    const bundle = await prepareApplication({
      jobId: job.id,
      resumeText: RESUME,
      outDir: mkdtempSync(join(tmpdir(), "applypilot-prep-")),
      rolecraft: { baseUrl: rc.url },
      withDrafts: true,
      model: async (prompt) => {
        calls += 1;
        assert.match(prompt, /NO tools/);
        return {
          text: '```json\n{"coverLetter":"I improved Recall@5 from 70% to 88% and led 15 people.","outreach":"Hi! RAG + pgvector here.","whyCompany":"RAG focus."}\n```',
          model: "m",
          usage: { inputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 1 },
          durationMs: 1,
        };
      },
    });
    assert.equal(calls, 1);
    assert.deepEqual(bundle.drafts?.unverifiedNumbers, ["15"]);
    assert.ok(bundle.checklist.some((c) => c.includes("15")));
  } finally {
    rc.close();
  }
});
