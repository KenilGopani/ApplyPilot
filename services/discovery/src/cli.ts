// npm run discover -- "applied ai engineer" --site indeed,linkedin --location "San Francisco, CA" -n 20 --push
// npm run discover -- --sources career-ops --push
// npm run discover -- "applied ai engineer" --sources jobspy,career-ops --push
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { DiscoveryResult } from "@applypilot/job-schema";
import { DEFAULT_ROLECRAFT_URL, RolecraftError, pushDiscovery } from "@applypilot/rolecraft-client";
import { discoverySources, runDiscovery, runInfo, saveRun, type DiscoverySource } from "./pipeline.ts";

export { runInfo };

const USAGE = `Usage: npm run discover -- [search term] [options]

  --sources <list>       jobspy, career-ops or both (default jobspy)

  JobSpy (needs a search term):
  --site <list>          comma-separated boards (default indeed,linkedin)
  --location <text>      e.g. "San Francisco, CA"
  -n, --results <n>      results wanted per board (default 15)
  --hours-old <n>        only postings newer than this
  --remote               remote postings only
  --country <name>       Indeed/Glassdoor country (default usa)
  --fetch-description    fetch each posting page for boards without descriptions (slower)

  Career Ops (scans the boards in runtime/career-ops-data/portals.yml):
  --company <name>       one company from portals.yml
  --since <days>         only postings from the last N days

  --push                 import the jobs into Rolecraft's Discovered inbox
  --rolecraft-url <url>  local Rolecraft (default ${DEFAULT_ROLECRAFT_URL})

Each source's run is saved to runtime/discovery/<run id>.json.
Exit status: 0 ok, 2 a source found nothing because every board failed,
1 a source could not run, 3 the jobs were saved but the Rolecraft import failed.`;

function printResult(result: DiscoveryResult, path: string) {
  const m = result.metrics;
  console.log(`${result.adapter} run ${result.runId}: ${result.status} in ${result.durationMs} ms`);
  console.log(`  returned ${m.returned}, mapped ${m.mapped}, rejected ${m.rejected}, duplicates ${m.duplicates}`);
  const sites = Object.entries(m.bySite).sort((a, b) => b[1].mapped - a[1].mapped);
  for (const [site, s] of sites.slice(0, 12)) {
    console.log(`  ${site.padEnd(20)} ${String(s.mapped).padStart(4)} jobs${s.error ? `  ERROR ${s.error}` : ""}`);
  }
  if (sites.length > 12) console.log(`  … and ${sites.length - 12} more boards`);
  for (const e of result.errors.filter((e) => !m.bySite[e.site]?.error)) console.log(`  ERROR ${e.site}: ${e.message}`);
  for (const r of result.rejected.slice(0, 10)) console.log(`  rejected #${r.index}: ${r.reason}`);
  console.log(`  saved ${path}`);
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      sources: { type: "string", default: "jobspy" },
      site: { type: "string", default: "indeed,linkedin" },
      location: { type: "string" },
      results: { type: "string", short: "n", default: "15" },
      "hours-old": { type: "string" },
      remote: { type: "boolean", default: false },
      country: { type: "string", default: "usa" },
      "fetch-description": { type: "boolean", default: false },
      company: { type: "string" },
      since: { type: "string" },
      push: { type: "boolean", default: false },
      "rolecraft-url": { type: "string", default: DEFAULT_ROLECRAFT_URL },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const sources = values.sources.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = sources.filter((s) => !(discoverySources as readonly string[]).includes(s));
  if (unknown.length || sources.length === 0) {
    console.error(`unknown source: ${unknown.join(", ") || "(none)"}\n\n${USAGE}`);
    return 1;
  }
  if (sources.includes("jobspy") && positionals.length === 0) {
    console.error(`JobSpy needs a search term.\n\n${USAGE}`);
    return 1;
  }
  const jobspy = sources.includes("jobspy")
    ? {
        site_name: values.site.split(",").map((s) => s.trim()).filter(Boolean),
        search_term: positionals.join(" "),
        location: values.location,
        results_wanted: Number(values.results),
        hours_old: values["hours-old"] ? Number(values["hours-old"]) : undefined,
        is_remote: values.remote,
        country_indeed: values.country,
        fetch_description: values["fetch-description"],
      }
    : undefined;

  const merged = await runDiscovery({
    sources: sources as DiscoverySource[],
    jobspy,
    careerOps: { company: values.company, sinceDays: values.since ? Number(values.since) : undefined },
    onLog: (source, line) => console.error(`  [${source}] ${line}`),
  });

  let exit = 0;
  const saved: { result: DiscoveryResult; path: string }[] = [];
  for (const outcome of merged.outcomes) {
    if (!outcome.result) {
      console.error(`${outcome.source}: could not run: ${outcome.error}`);
      exit = 1;
      continue;
    }
    const extra = outcome.source === "jobspy" ? { request: { ...jobspy, proxies: undefined } } : {};
    const path = saveRun(outcome.result, extra);
    printResult(outcome.result, path);
    saved.push({ result: outcome.result, path });
    if (outcome.result.status === "failed" && exit === 0) exit = 2;
  }
  for (const outcome of merged.outcomes) {
    for (const m of outcome.merges ?? []) {
      const job = outcome.result?.jobs.find((j) => j.id === m.into);
      console.log(`  same posting (${m.by}): ${job?.company} — ${job?.title} [${job?.provenance.map((p) => p.site).join(" + ")}]`);
    }
  }
  if (merged.outcomes.length > 1) {
    console.log(`merged: ${merged.jobs.length} distinct jobs across sources (${merged.crossSourceMerges.length} found by both)`);
  }
  if (merged.possibleDuplicates.length) {
    console.log(`${merged.possibleDuplicates.length} possible duplicates (same company and title, different or no city) were left separate`);
  }

  if (values.push) {
    for (const { result, path } of saved) {
      try {
        const pushed = await pushDiscovery(runInfo(result), result.jobs, { baseUrl: values["rolecraft-url"] });
        console.log(
          `Rolecraft (${result.adapter}): ${pushed.created} new, ${pushed.updated} already in the inbox, ${pushed.merged} merged into jobs found by another source`,
        );
      } catch (error) {
        if (!(error instanceof RolecraftError)) throw error;
        console.error(`Rolecraft import of ${result.adapter} failed: ${error.message}`);
        if (error.imported) console.error(`  ${error.imported} jobs were imported before the failure.`);
        console.error(`  Retry later with: npm run push -- ${path}`);
        exit = 3;
      }
    }
  }
  return exit;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
