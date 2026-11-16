// npm run discover -- "applied ai engineer" --site indeed,linkedin --location "San Francisco, CA" -n 20
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { JobSpyDiscoveryRequest } from "./envelope.ts";
import { PlatformError } from "./errors.ts";
import { runJobSpyDiscovery } from "./run.ts";

const USAGE = `Usage: npm run discover -- <search term> [options]

  --site <list>        comma-separated JobSpy boards (default indeed,linkedin)
  --location <text>    e.g. "San Francisco, CA"
  -n, --results <n>    results wanted per board (default 15)
  --hours-old <n>      only postings newer than this
  --remote             remote postings only
  --country <name>     Indeed/Glassdoor country (default usa)
  --fetch-description  fetch each posting page for boards without descriptions (slower)
  --out <path>         result file (default runtime/discovery/<run id>.json)

Exit status: 0 ok, 2 every board failed, 1 the run could not start or finish.`;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      site: { type: "string", default: "indeed,linkedin" },
      location: { type: "string" },
      results: { type: "string", short: "n", default: "15" },
      "hours-old": { type: "string" },
      remote: { type: "boolean", default: false },
      country: { type: "string", default: "usa" },
      "fetch-description": { type: "boolean", default: false },
      out: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }
  const request: JobSpyDiscoveryRequest = {
    site_name: values.site.split(",").map((s) => s.trim()).filter(Boolean),
    search_term: positionals.join(" "),
    location: values.location,
    results_wanted: Number(values.results),
    hours_old: values["hours-old"] ? Number(values["hours-old"]) : undefined,
    is_remote: values.remote,
    country_indeed: values.country,
    fetch_description: values["fetch-description"],
  };

  const result = await runJobSpyDiscovery(request, { onLog: (l) => console.error(`  [jobspy] ${l}`) });
  const out = resolve(values.out ?? join(repoRoot, "runtime", "discovery", `${result.runId}.json`));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ request: { ...request, proxies: undefined }, ...result }, null, 2)}\n`);

  const m = result.metrics;
  console.log(`run ${result.runId}: ${result.status} in ${result.durationMs} ms`);
  console.log(`  returned ${m.returned}, mapped ${m.mapped}, rejected ${m.rejected}, duplicates ${m.duplicates}`);
  for (const [site, s] of Object.entries(m.bySite)) {
    console.log(`  ${site.padEnd(14)} ${String(s.mapped).padStart(4)} jobs${s.error ? `  ERROR ${s.error}` : ""}`);
  }
  for (const r of result.rejected) console.log(`  rejected #${r.index}: ${r.reason}`);
  console.log(`saved ${out}`);
  return result.status === "failed" ? 2 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    if (error instanceof PlatformError) console.error(`${error.code}: ${error.message}`);
    else console.error(error);
    process.exit(1);
  },
);
