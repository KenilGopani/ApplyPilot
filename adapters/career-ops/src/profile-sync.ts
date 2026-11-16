import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CareerOpsError } from "./errors.ts";
import { lastJsonLine, runCareerOps, type CareerOpsRunOptions } from "./runtime.ts";

export interface ProfileSyncResult {
  written: string[];
  kept: string[];
}

/**
 * Write Career Ops' config/profile.yml from onboarding answers, through Career
 * Ops' own `onboard-write.mjs --force --only profile`. Career Ops keeps owning
 * the file's format; portals.yml and modes/ are never touched.
 */
export async function syncCareerOpsProfile(
  answers: object,
  options: CareerOpsRunOptions = {},
): Promise<ProfileSyncResult> {
  // The answers carry personal data: keep them out of the checkout and delete them after.
  const dir = mkdtempSync(join(tmpdir(), "applypilot-profile-"));
  const file = join(dir, "answers.json");
  try {
    writeFileSync(file, JSON.stringify(answers), { mode: 0o600 });
    const result = await runCareerOps("onboard-write.mjs", ["--answers", file, "--force", "--only", "profile"], options);
    if (result.exitCode !== 0) {
      const reason = (result.stderr || result.stdout).trim().split("\n")[0] ?? "";
      throw new CareerOpsError("CAREER_OPS_CONFIG_ERROR", `Career Ops refused the profile: ${reason}`);
    }
    const out = lastJsonLine(result) as Partial<ProfileSyncResult>;
    if (!Array.isArray(out.written) || !Array.isArray(out.kept)) {
      throw new CareerOpsError("CAREER_OPS_PROTOCOL_ERROR", "onboard-write output changed shape", out);
    }
    return { written: out.written, kept: out.kept };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
