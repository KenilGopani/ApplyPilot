// npm run push -- runtime/discovery/<run id>.json [--rolecraft-url http://127.0.0.1:5173]
// Imports a saved discovery run into Rolecraft without searching again.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { DEFAULT_ROLECRAFT_URL, RolecraftError, pushDiscovery } from "@applypilot/rolecraft-client";
import type { DiscoveryResult } from "@applypilot/adapter-jobspy";
import { runInfo } from "./cli.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "rolecraft-url": { type: "string", default: DEFAULT_ROLECRAFT_URL } },
});
if (positionals.length !== 1) {
  console.error("Usage: npm run push -- <runtime/discovery/run_….json> [--rolecraft-url <url>]");
  process.exit(1);
}
const result = JSON.parse(readFileSync(positionals[0] as string, "utf8")) as DiscoveryResult;
try {
  const pushed = await pushDiscovery(runInfo(result), result.jobs, { baseUrl: values["rolecraft-url"] });
  console.log(`Rolecraft: ${pushed.created} new, ${pushed.updated} already in the inbox (run ${result.runId})`);
} catch (error) {
  if (!(error instanceof RolecraftError)) throw error;
  console.error(`Rolecraft import failed: ${error.message}`);
  process.exit(3);
}
