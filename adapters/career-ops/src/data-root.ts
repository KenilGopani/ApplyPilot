import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Career Ops user-layer directories (its DATA_CONTRACT.md). */
export const DATA_ROOT_DIRS = ["config", "data", "reports", "jds", "output", "modes", "interview-prep"] as const;

const README = `# Career Ops data root (ApplyPilot)

ApplyPilot runs the pinned Career Ops checkout with CAREER_OPS_ROOT pointing
here, so Career Ops' user layer (CV, profile, portals.yml, tracker, reports)
lives in this folder and never inside the checkout.

Everything here is personal and git-ignored by ApplyPilot. Career Ops' own
files are the source of truth for this folder; ApplyPilot reads them through
Career Ops' scripts and does not edit them by hand.

Setup still needed before a scan or evaluation is useful:
  cv.md, config/profile.yml, modes/_profile.md, portals.yml
\`npm run career-ops -- doctor\` lists what is missing.
`;

export interface InitResult {
  dataRoot: string;
  created: string[];
}

/**
 * Create the isolated data root's directory skeleton. Idempotent and
 * additive: existing files are never touched, and no personal file (CV,
 * profile, portals) is created here; that belongs to the candidate profile
 * step (plan Phase 12) or Career Ops' own onboarding.
 */
export function initCareerOpsDataRoot(dataRoot: string): InitResult {
  const created: string[] = [];
  if (!existsSync(dataRoot)) {
    mkdirSync(dataRoot, { recursive: true });
    created.push(".");
  }
  for (const dir of DATA_ROOT_DIRS) {
    const path = join(dataRoot, dir);
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
      created.push(`${dir}/`);
    }
  }
  const readme = join(dataRoot, "README.md");
  if (!existsSync(readme)) {
    writeFileSync(readme, README);
    created.push("README.md");
  }
  return { dataRoot, created };
}
