import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvaluationContext } from "@applypilot/adapter-career-ops";
import { ClaudeError, type ClaudeResult } from "@applypilot/adapter-claude-code";
import { evaluateInbox, rankCandidates } from "../src/evaluate.ts";

type Row = Record<string, unknown> & { id: string };

function row(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    status: "new",
    title: `Engineer ${id}`,
    company: `Co ${id}`,
    location: "Austin, TX",
    sourceUrl: `https://boards.greenhouse.io/co/jobs/${id.slice(4)}`,
    postedAt: "2026-11-10",
    sites: ["greenhouse-api"],
    screeningVerdict: "pass",
    authorization: "unknown",
    evaluationStage: null,
    evaluationScore: null,
    evaluationDecision: null,
    description: `Build agents and RAG in Python. (${id})`,
    provenance: [],
    ...over,
  };
}

/** A minimal in-memory Rolecraft speaking the discovered-jobs API. */
async function fakeRolecraft(rows: Row[]) {
  const puts: { id: string; body: Record<string, unknown> }[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://x");
      const send = (status: number, body: unknown) =>
        res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
      const m = /^\/api\/discovered-jobs\/([^/]+)(\/evaluation)?$/.exec(url.pathname);
      if (url.pathname === "/api/discovered-jobs") {
        const status = url.searchParams.get("status");
        return send(200, { jobs: rows.filter((r) => !status || r.status === status) });
      }
      const target = m && rows.find((r) => r.id === decodeURIComponent(m[1]!));
      if (!target) return send(404, { error: "not found" });
      if (m![2] && req.method === "PUT") {
        const body = JSON.parse(raw);
        puts.push({ id: target.id, body });
        if (body.stage === "triage") Object.assign(target, { evaluationStage: "triage", evaluationScore: body.score, evaluationDecision: body.verdict });
        else Object.assign(target, { evaluationStage: "full", evaluationScore: body.evaluation.score, evaluationDecision: body.evaluation.decision });
        return send(200, { ok: true, result: "stored" });
      }
      return send(200, { job: target });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, puts, close: () => server.close() };
}

const ctx: EvaluationContext = {
  shared: "S", oferta: "O", triage: "T", brief: "B", profileMd: "P", customMd: null, profileYml: "Y",
  cv: "Built FastAPI services in Python for payments.", articleDigest: null, version: "career-ops@1.40.0",
};
const usage = { inputTokens: 10, cacheCreationTokens: 100, cacheReadTokens: 50, outputTokens: 20 };
const reply = (text: string): ClaudeResult => ({ text, model: "claude-sonnet-5-5", usage, durationMs: 1 });

const REPORT = [
  "**Archetype:** Applied AI",
  "**Score:** 4.4/5",
  "**Decision:** Apply",
  "**Legitimacy:** High Confidence",
  "**Work Auth:** ⚠️ Unstated",
  "**Evidence confidence:** Medium — comp unstated",
  "",
  "**Apply.** Strong Python API overlap.",
  "",
  "## B) Match with CV",
  "| Requirement | Importance | Match | JD signal | Evidence / gap |",
  "|---|---|---|---|---|",
  '| Python APIs | critical (stated) | ✅ Strong | "Python" | "Built FastAPI services in Python" |',
  '| Kafka at scale | high (stated) | ✅ Strong | "Kafka" | "Ran Kafka for 10M events/s" |',
].join("\n");

test("ranking spends budget on jobs the filters passed, newest first, and never on decided or rejected ones", () => {
  const ranked = rankCandidates([
    row("job_0000000000000001", { screeningVerdict: "review", postedAt: "2026-11-15" }),
    row("job_0000000000000002", { postedAt: "2026-11-01" }),
    row("job_0000000000000003", { postedAt: "2026-11-12" }),
    row("job_0000000000000004", { screeningVerdict: "reject" }),
    row("job_0000000000000005", { status: "saved" }),
  ] as never);
  assert.deepEqual(ranked.map((r) => r.id.slice(-1)), ["3", "2", "1"]);
});

test("triage runs in batches, then the best PASS job gets a full evaluation with verified evidence only", async () => {
  const rows = [
    row("job_0000000000000011"),
    row("job_0000000000000012"),
    row("job_0000000000000013", { description: null }),
    row("job_0000000000000014", { status: "skip" }),
  ];
  const rc = await fakeRolecraft(rows);
  const prompts: string[] = [];
  try {
    const summary = await evaluateInbox({
      context: ctx,
      batchSize: 2,
      limit: 1,
      reportsDir: mkdtempSync(join(tmpdir(), "applypilot-eval-")),
      rolecraft: { baseUrl: rc.url },
      fetchDescription: async () => ({ status: "unavailable" }),
      model: async (prompt) => {
        prompts.push(prompt);
        if (prompt.includes("triage worker")) {
          return reply("#1 TRIAGE: PASS | Co 11 | Engineer | 3.9/5 | fits\n#2 TRIAGE: PASS | Co 12 | Engineer | 4.2/5 | strong fit");
        }
        return reply(REPORT);
      },
    });
    assert.equal(prompts.filter((p) => p.includes("triage worker")).length, 1, "two jobs in one batch call");
    assert.deepEqual(summary.skipped.map((s) => [s.id.slice(-2), s.reason]), [["13", "no job description available"]]);
    const skip = rc.puts.find((p) => p.id === "job_0000000000000013")?.body;
    assert.equal(skip?.verdict, "SKIP", "an unreadable posting is marked so it is not retried");
    assert.equal(summary.triaged.length, 2);
    assert.equal(summary.evaluated.length, 1, "limit 1");
    assert.equal(summary.evaluated[0]!.id, "job_0000000000000012", "highest triage score first");
    assert.deepEqual(summary.evaluated[0]!.unverified, ["Kafka at scale"]);
    const full = rc.puts.find((p) => p.body.stage === "full")!.body.evaluation as {
      matched: { requirement: { text: string } }[];
      missing: { text: string; category?: string }[];
      evaluatorVersion: string;
      nativeReport: string;
    };
    assert.deepEqual(full.matched.map((m) => m.requirement.text), ["Python APIs"]);
    assert.deepEqual(full.missing, [{ id: "r2", text: "Kafka at scale", importance: "high", jdSignal: '"Kafka"', category: "unverified-match" }]);
    const body = rc.puts.find((p) => p.body.stage === "full")!.body as { resumeRouting: { recommended: string } };
    assert.ok(["core-swe", "applied-ai", "hybrid"].includes(body.resumeRouting.recommended));
    assert.equal(summary.evaluated[0]!.resume, body.resumeRouting.recommended);
    assert.match(full.evaluatorVersion, /career-ops@1\.40\.0 via claude-code \(claude-sonnet-5-5\)/);
    assert.match(readFileSync(full.nativeReport, "utf8"), /\*\*Score:\*\* 4\.4\/5/);
    assert.equal(summary.claudeCalls, 2);
    assert.deepEqual(summary.tokens, { input: 220, cached: 100, output: 40 });
  } finally {
    rc.close();
  }
});

test("a usage limit stops the run and keeps finished work", async () => {
  const rows = [row("job_0000000000000021"), row("job_0000000000000022")];
  const rc = await fakeRolecraft(rows);
  try {
    let calls = 0;
    const summary = await evaluateInbox({
      context: ctx,
      batchSize: 1,
      rolecraft: { baseUrl: rc.url },
      reportsDir: mkdtempSync(join(tmpdir(), "applypilot-eval-")),
      model: async () => {
        calls += 1;
        if (calls === 2) throw new ClaudeError("CLAUDE_LIMIT", "Claude AI usage limit reached");
        return reply("#1 TRIAGE: FAIL | Co | Engineer | 2.0/5 | DQ");
      },
    });
    assert.match(summary.stoppedByLimit ?? "", /usage limit/);
    assert.equal(summary.triaged.length, 1, "the first batch was stored before the limit hit");
    assert.equal(rc.puts.length, 1);
  } finally {
    rc.close();
  }
});

test("a dry run calls nothing", async () => {
  const rc = await fakeRolecraft([row("job_0000000000000031")]);
  try {
    const summary = await evaluateInbox({
      context: ctx,
      dryRun: true,
      rolecraft: { baseUrl: rc.url },
      model: async () => {
        throw new Error("must not be called");
      },
    });
    assert.equal(summary.claudeCalls, 0);
    assert.equal(rc.puts.length, 0);
  } finally {
    rc.close();
  }
});
