// npm run config:check
import { applyLocalEnv, checkConfig, SETTINGS } from "./index.ts";

const applied = applyLocalEnv();
let problems = 0;
for (const s of checkConfig()) {
  if (s.problem) problems += 1;
  console.log(`${s.problem ? "✗" : "✓"} ${s.name.padEnd(28)} ${s.value}  (${s.source})${s.problem ? `  — ${s.problem}` : ""}`);
  if (s.problem) console.log(`    ${SETTINGS[s.name].about}`);
}
if (applied.length) console.log(`\nfrom .env: ${applied.join(", ")}`);
process.exit(problems ? 1 : 0);
