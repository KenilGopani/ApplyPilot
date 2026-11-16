import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SETTINGS, applyLocalEnv, checkConfig, parseEnv, repoRoot } from "../src/index.ts";

test(".env parsing handles comments, quotes and export", () => {
  assert.deepEqual(parseEnv('# c\nA=1\nexport B="two words"\nC=3 # trailing\nbad line\nD=\'x#y\''), {
    A: "1",
    B: "two words",
    C: "3",
    D: "x#y",
  });
});

test("the shell always wins over .env, and .env fills only what is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "applypilot-env-"));
  writeFileSync(join(root, ".env"), "APPLYPILOT_CLAUDE_BIN=/opt/claude\nAPPLYPILOT_LOG_DIR=/tmp/logs\n");
  const env: NodeJS.ProcessEnv = { APPLYPILOT_CLAUDE_BIN: "claude-from-shell" };
  assert.deepEqual(applyLocalEnv(env, root), ["APPLYPILOT_LOG_DIR"]);
  assert.equal(env.APPLYPILOT_CLAUDE_BIN, "claude-from-shell");
  assert.equal(env.APPLYPILOT_LOG_DIR, "/tmp/logs");
});

test("required settings are validated and problems explained", () => {
  const root = mkdtempSync(join(tmpdir(), "applypilot-cfg-"));
  const byName = Object.fromEntries(
    checkConfig({ APPLYPILOT_ROLECRAFT_URL: "https://rolecraft.example.com" }, root).map((s) => [s.name, s]),
  );
  assert.match(byName.APPLYPILOT_SOURCES_DIR!.problem!, /missing checkout/);
  assert.match(byName.APPLYPILOT_PROFILE!.problem!, /not found/);
  assert.match(byName.APPLYPILOT_ROLECRAFT_URL!.problem!, /local address/);
  assert.equal(byName.APPLYPILOT_ROLECRAFT_URL!.source, "environment");
});

test(".env.example lists every setting, and .env itself is git-ignored", () => {
  const example = readFileSync(join(repoRoot, ".env.example"), "utf8");
  for (const name of Object.keys(SETTINGS)) assert.match(example, new RegExp(`^${name}=`, "m"), name);
  assert.match(readFileSync(join(repoRoot, ".gitignore"), "utf8"), /^\.env$/m);
});
