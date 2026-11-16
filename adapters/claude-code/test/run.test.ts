// The "claude" binary is replaced by a fake Node script, so these tests cost
// no tokens and need no login.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeError, claudeArgs, runClaude } from "../src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "applypilot-fake-claude-"));
function fake(name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!${process.execPath}\n${body}`);
  chmodSync(path, 0o755);
  return path;
}

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (e: unknown) => {
    assert.ok(e instanceof ClaudeError, String(e));
    assert.equal(e.code, code);
    return true;
  });
}

test("runs with no tools, no MCP and no saved session; the prompt goes on stdin", async () => {
  assert.deepEqual(claudeArgs(), ["-p", "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--output-format", "json"]);
  const bin = fake(
    "echo",
    `let input = ""; process.stdin.on("data", (c) => (input += c)).on("end", () => {
      console.log(JSON.stringify({ type: "result", is_error: false, result: "GOT:" + input + "|ARGS:" + JSON.stringify(process.argv.slice(2)) + "|CWD:" + process.cwd(),
        usage: { input_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 7, output_tokens: 3 },
        modelUsage: { "claude-sonnet-5-5": {} } }));
    });`,
  );
  const r = await runClaude("hello", { bin, model: "sonnet" });
  assert.match(r.text, /^GOT:hello\|/);
  assert.match(r.text, /"--tools",""/);
  assert.match(r.text, /"--model","sonnet"/);
  assert.match(r.text, /CWD:.*applypilot-claude-/, "runs in an empty temporary directory");
  assert.deepEqual(r.usage, { inputTokens: 5, cacheCreationTokens: 100, cacheReadTokens: 7, outputTokens: 3 });
  assert.equal(r.model, "claude-sonnet-5-5");
});

test("usage limits, failures, garbage, hangs and a missing CLI are distinct errors", async () => {
  await rejectsWith(
    runClaude("x", { bin: fake("limit", `console.log(JSON.stringify({ is_error: true, result: "Claude AI usage limit reached|1760000000" })); process.exit(1);`) }),
    "CLAUDE_LIMIT",
  );
  await rejectsWith(
    runClaude("x", { bin: fake("fail", `console.log(JSON.stringify({ is_error: true, subtype: "error_during_execution", result: "boom" })); process.exit(1);`) }),
    "CLAUDE_FAILED",
  );
  await rejectsWith(runClaude("x", { bin: fake("garbage", `console.log("not json")`) }), "CLAUDE_PROTOCOL_ERROR");
  await rejectsWith(runClaude("x", { bin: fake("hang", `setInterval(() => {}, 1000)`), timeoutMs: 300 }), "CLAUDE_TIMEOUT");
  await rejectsWith(runClaude("x", { bin: join(dir, "missing-claude") }), "CLAUDE_UNAVAILABLE");
});
