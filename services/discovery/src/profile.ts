// npm run profile -- <show|policy|sync>
import "@applypilot/config/env";
import { CareerOpsError, careerOpsHealth, initCareerOpsDataRoot, resolveCareerOpsDataRoot, syncCareerOpsProfile } from "@applypilot/adapter-career-ops";
import {
  ProfileError,
  loadCandidateProfile,
  resolveProfilePath,
  toCareerOpsAnswers,
  toFilterPolicy,
} from "@applypilot/candidate-profile";

const USAGE = `Usage: npm run profile -- <command>

  show     validate and summarise the candidate profile
  policy   print the hard-filter policy it implies
  sync     write Career Ops' config/profile.yml from it (Career Ops' own writer)

Profile: ${resolveProfilePath()} (APPLYPILOT_PROFILE)
Example: config/candidate-profile.example.json`;

async function main(): Promise<number> {
  const command = process.argv[2];
  if (!command || command === "-h" || command === "--help") {
    console.log(USAGE);
    return command ? 0 : 1;
  }
  const profile = loadCandidateProfile();
  switch (command) {
    case "show": {
      const { identity, career, workAuthorization: auth, compensation: comp, locations } = profile;
      console.log(`${identity.fullName} — ${career.level}, ${career.yearsOfExperience} yrs, ${identity.city}`);
      console.log(`  targets:   ${career.targetRoles.join(", ")}`);
      console.log(`  families:  ${career.roleFamilies.map((r) => `${r.name} (${r.fit})`).join(", ")}`);
      console.log(`  locations: ${locations.countries.join(", ")}${locations.remote ? ", remote ok" : ""}`);
      console.log(`  work auth: ${auth.status}${auth.needsSponsorship ? ", needs sponsorship" : ""}`);
      console.log(`  pay:       ${comp.currency} ${comp.targetMin}-${comp.targetMax} (min ${comp.minimum})`);
      return 0;
    }
    case "policy":
      console.log(JSON.stringify(toFilterPolicy(profile), null, 2));
      return 0;
    case "sync": {
      const dataRoot = resolveCareerOpsDataRoot();
      initCareerOpsDataRoot(dataRoot);
      const result = await syncCareerOpsProfile(toCareerOpsAnswers(profile), { dataRoot });
      console.log(`Career Ops: wrote ${result.written.join(", ") || "nothing"}`);
      const health = await careerOpsHealth({ dataRoot });
      console.log(health.ready ? "Career Ops setup: ready" : `Career Ops still needs: ${health.missing.join(", ")}`);
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
    if (error instanceof ProfileError) console.error(error.message);
    else if (error instanceof CareerOpsError) console.error(`${error.code}: ${error.message}`);
    else console.error(error);
    process.exit(1);
  },
);
