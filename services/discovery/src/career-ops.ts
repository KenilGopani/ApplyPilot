// npm run career-ops -- <init|doctor|verify|scan|capabilities> [options]
import { parseArgs } from "node:util";
import {
  CareerOpsError,
  careerOpsCapabilities,
  careerOpsHealth,
  initCareerOpsDataRoot,
  resolveCareerOpsDataRoot,
  resolveCareerOpsHome,
  scanPortals,
  verifyCareerOpsPipeline,
} from "@applypilot/adapter-career-ops";

const USAGE = `Usage: npm run career-ops -- <command> [options]

  init           create the isolated data root (runtime/career-ops-data)
  doctor         setup state: which onboarding files are missing
  verify         Career Ops pipeline integrity checks
  scan           scan portals.yml boards (Career Ops writes its pipeline and history)
    --dry-run      preview only, nothing written
    --company <n>  one company from portals.yml
    --since <days> only postings from the last N days
  capabilities   which Career Ops operations ApplyPilot exposes

Data root: ${resolveCareerOpsDataRoot()} (APPLYPILOT_CAREER_OPS_DATA)
Checkout:  ${resolveCareerOpsHome()} (APPLYPILOT_SOURCES_DIR)`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      company: { type: "string" },
      since: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }
  const dataRoot = resolveCareerOpsDataRoot();

  switch (command) {
    case "init": {
      const { created } = initCareerOpsDataRoot(dataRoot);
      console.log(created.length ? `created in ${dataRoot}: ${created.join(", ")}` : `${dataRoot} already set up`);
      return 0;
    }
    case "doctor": {
      initCareerOpsDataRoot(dataRoot);
      const health = await careerOpsHealth({ dataRoot });
      console.log(health.ready ? "Career Ops setup: ready" : "Career Ops setup: onboarding needed");
      if (health.missing.length) console.log(`  missing: ${health.missing.join(", ")}`);
      if (health.unpersonalized.length) console.log(`  still template content: ${health.unpersonalized.join(", ")}`);
      for (const w of health.warnings) console.log(`  warning: ${w.split("\n")[0]}`);
      return health.ready ? 0 : 2;
    }
    case "verify": {
      initCareerOpsDataRoot(dataRoot);
      const v = await verifyCareerOpsPipeline({ dataRoot });
      for (const c of v.checks) console.log(`  ${c.level.padEnd(5)} ${c.message}`);
      console.log(v.ok ? `ok (${v.warnings} warnings)` : `${v.errors} errors, ${v.warnings} warnings`);
      return v.ok ? 0 : 2;
    }
    case "scan": {
      initCareerOpsDataRoot(dataRoot);
      const r = await scanPortals({
        dataRoot,
        dryRun: values["dry-run"],
        company: values.company,
        sinceDays: values.since ? Number(values.since) : undefined,
      });
      const s = r.receipt;
      console.log(`scan ${r.status}${s.dry_run ? " (dry run)" : ""} in ${r.durationMs} ms`);
      console.log(`  boards ${s.scanned}, found ${s.found}, filtered ${s.filtered}, duplicates ${s.duplicates}, new ${s.added}`);
      for (const e of s.errors) console.log(`  ERROR ${e.company}: ${e.error}`);
      return r.status === "failed" ? 2 : 0;
    }
    case "capabilities": {
      for (const [name, c] of Object.entries(careerOpsCapabilities)) {
        console.log(`${c.state === "available" ? "✓" : "·"} ${name.padEnd(20)} ${c.via} — ${c.note}`);
      }
      return 0;
    }
    default:
      console.error(`unknown command: ${command}\n\n${USAGE}`);
      return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    if (error instanceof CareerOpsError) console.error(`${error.code}: ${error.message}`);
    else console.error(error);
    process.exit(1);
  },
);
