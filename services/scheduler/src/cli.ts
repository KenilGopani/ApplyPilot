// npm run schedule -- <list|run <name>|start|log>
import "@applypilot/config/env";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LOG_DIR, SCHEDULE_FILE, loadSchedule, runSearch, startScheduler, type ScheduledRunRecord } from "./scheduler.ts";

const USAGE = `Usage: npm run schedule -- <command>

  list          show the scheduled searches (${SCHEDULE_FILE})
  run <name>    run one search now
  start         keep running and run each search at its time (Ctrl+C to stop)
  log           the last scheduled runs (runtime/logs/schedule-runs.jsonl)

Each run discovers, applies your hard filters and imports into Rolecraft. It
never changes a job's status or an application. Quick checks run only when a
search sets triageLimit, and full evaluations are never automatic.`;

const show = (r: ScheduledRunRecord) =>
  `${r.started_at.slice(0, 16).replace("T", " ")}  ${r.search.padEnd(12)} found ${r.jobs_found}, new ${r.jobs_new}, ` +
  `duplicate ${r.jobs_duplicate}, filtered ${r.jobs_filtered}, quick-checked ${r.jobs_evaluated}` +
  (r.errors.length ? `, ${r.errors.length} error(s)` : "");

async function main(): Promise<number> {
  const [command, name] = process.argv.slice(2);
  switch (command) {
    case "list":
      for (const s of loadSchedule().searches) {
        console.log(`${s.at}  ${s.name.padEnd(12)} ${s.sources.join("+")}${s.query ? ` "${s.query}"` : ""}${s.triageLimit ? `, quick-check ${s.triageLimit}` : ""}`);
      }
      return 0;
    case "run": {
      const search = loadSchedule().searches.find((s) => s.name === name);
      if (!search) {
        console.error(`no search named ${name ?? "(missing)"}`);
        return 1;
      }
      const record = await runSearch(search);
      console.log(show(record));
      for (const e of record.errors) console.log(`  error: ${e}`);
      return record.errors.length && !record.jobs_found ? 2 : 0;
    }
    case "start": {
      loadSchedule();
      console.log("Scheduler running; Ctrl+C to stop.");
      await startScheduler({ onRun: (r) => console.log(show(r)) });
      return 0;
    }
    case "log": {
      const file = join(LOG_DIR, "schedule-runs.jsonl");
      const lines = existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean) : [];
      for (const line of lines.slice(-15)) console.log(show(JSON.parse(line)));
      if (!lines.length) console.log("No scheduled runs yet.");
      return 0;
    }
    default:
      console.log(USAGE);
      return command === "-h" || command === "--help" ? 0 : 1;
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
