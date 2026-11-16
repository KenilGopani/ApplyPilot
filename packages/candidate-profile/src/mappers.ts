import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FilterPolicy } from "@applypilot/filters";
import { candidateProfileSchema, type CandidateProfile } from "./profile.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** runtime/candidate-profile.json (personal, git-ignored) unless APPLYPILOT_PROFILE is set. */
export function resolveProfilePath(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.APPLYPILOT_PROFILE || join(repoRoot, "runtime", "candidate-profile.json"));
}

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileError";
  }
}

export function loadCandidateProfile(path = resolveProfilePath()): CandidateProfile {
  if (!existsSync(path)) {
    throw new ProfileError(`No candidate profile at ${path}. Copy config/candidate-profile.example.json there and edit it.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ProfileError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  const parsed = candidateProfileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProfileError(
      `${path} is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

/** The hard-filter policy (Phase 11) this profile implies. */
export function toFilterPolicy(profile: CandidateProfile): FilterPolicy {
  return {
    countries: profile.locations.countries,
    maxPostingAgeDays: profile.filters.maxPostingAgeDays,
    excludedTitleKeywords: profile.filters.excludedTitleKeywords,
    reviewTitleKeywords: profile.filters.reviewTitleKeywords,
    roleFamilyKeywords: profile.filters.roleFamilyKeywords,
    maxRequiredYears: profile.filters.maxRequiredYears,
    reviewRequiredYears: profile.filters.reviewRequiredYears,
    needsSponsorship: profile.workAuthorization.needsSponsorship,
    salaryFloorYearly: profile.compensation.currency === "USD" ? profile.compensation.minimum : undefined,
    excludedCompanies: profile.filters.excludedCompanies,
    excludedKeywords: profile.filters.excludedKeywords,
  };
}

const LEVEL_LABEL: Record<CandidateProfile["career"]["level"], string> = {
  intern: "Intern",
  "new-grad": "New grad",
  "early-career": "Early career",
  mid: "Mid-level",
  senior: "Senior",
};

/**
 * Answers for Career Ops' own writer (`onboard-write.mjs`), which owns the
 * format of its config/profile.yml. Only the profile is written; portals.yml
 * and the hand-tuned modes/_profile.md stay as they are.
 */
export function toCareerOpsAnswers(profile: CandidateProfile) {
  const { identity, career, compensation, workAuthorization } = profile;
  const money = (n: number) => String(Math.round(n));
  return {
    candidate: {
      full_name: identity.fullName,
      email: identity.email,
      location: [identity.city, identity.region].filter(Boolean).join(", "),
      ...(identity.phone ? { phone: identity.phone } : {}),
      ...(identity.linkedin ? { linkedin: identity.linkedin } : {}),
      ...(identity.github ? { github: identity.github } : {}),
      ...(identity.portfolio ? { portfolio_url: identity.portfolio } : {}),
      years_of_experience: career.yearsOfExperience,
    },
    target_roles: career.targetRoles,
    compensation: {
      target_range: `${money(compensation.targetMin)}-${money(compensation.targetMax)}`,
      currency: compensation.currency,
      minimum: money(compensation.minimum),
    },
    location: {
      country: identity.country,
      city: identity.city,
      timezone: identity.timezone,
      visa_status: workAuthorization.status,
      needs_sponsorship: workAuthorization.needsSponsorship,
      ...(workAuthorization.authorizedIn.length ? { authorized_in: workAuthorization.authorizedIn } : {}),
    },
    spend_tier: profile.spendTier,
    archetypes: career.roleFamilies.map((r) => ({ name: r.name, level: LEVEL_LABEL[career.level], fit: r.fit })),
    // onboard-write validates every section; with --only profile it does not write portals.yml.
    portals: {
      positive: career.targetRoles,
      negative: profile.filters.excludedTitleKeywords,
      countries: profile.locations.countries,
      cities: profile.locations.cities,
      max_posting_age_days: profile.filters.maxPostingAgeDays,
    },
  };
}
