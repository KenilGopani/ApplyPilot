import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, redact } from "../src/index.ts";

test("sensitive fields are excluded from logs", () => {
  const out = redact({
    email: "alex@example.com",
    phone: "+1 (408) 555-0100",
    proxies: ["user:secret@host:1"],
    cv: "My whole resume",
    description: "Full job description",
    drafts: { coverLetter: "Dear…" },
    apiKey: "sk-ant-123456789",
    nested: { authorization: "Bearer abc", note: "contact alex@example.com or +1 408 555 0100 with token sk-proj-abcdefghij" },
    company: "Example Labs",
    jobs_found: 12,
  }) as Record<string, unknown>;
  for (const k of ["email", "phone", "proxies", "cv", "description", "drafts", "apiKey"]) assert.equal(out[k], "[redacted]", k);
  const nested = out.nested as Record<string, string>;
  assert.equal(nested.authorization, "[redacted]");
  assert.equal(nested.note, "contact [email] or [phone] with token [token]");
  assert.equal(out.company, "Example Labs");
  assert.equal(out.jobs_found, 12);
  assert.equal(redact("run_123456789012"), "run_123456789012", "ids stay readable");
  assert.equal(redact("2026-11-16T13:42:37.643Z"), "2026-11-16T13:42:37.643Z", "timestamps stay readable");
  assert.equal(redact("call 408-555-0100 now"), "call 408-555-0100 now", "bare dashed digits are ambiguous and left alone");
  assert.equal(redact("call (408) 555-0100"), "call [phone]");
});

test("runs are logged as JSON lines with the plan's metrics, and nothing personal leaks", () => {
  const dir = mkdtempSync(join(tmpdir(), "applypilot-log-"));
  const log = createLogger("discovery", dir);
  log.run({ run_id: "run_1", source: "jobspy", query: "ai engineer", start: "a", end: "b", jobs_found: 5, jobs_normalized: 5, duplicates: 1, filtered: 2, evaluated: 0, failures: [], duration_ms: 10 });
  log.info("profile-loaded", { fullName: "Alex Example", email: "alex@example.com" });
  const lines = readFileSync(join(dir, "discovery.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines[0].event, "run");
  assert.equal(lines[0].jobs_found, 5);
  assert.equal(lines[1].fullName, "[redacted]");
  assert.ok(!readFileSync(join(dir, "discovery.jsonl"), "utf8").includes("alex@example.com"));
});

test("a logging failure never breaks the caller", () => {
  const log = createLogger("x", "/dev/null/not-a-dir");
  assert.doesNotThrow(() => log.info("still fine"));
});
