import { z } from "zod";

/**
 * The one candidate profile the platform uses (plan Phase 12). It drives the
 * hard filters and is synced into Career Ops' native config/profile.yml, so
 * targeting is never maintained twice. Only facts the candidate states belong
 * here; nothing is inferred.
 */
export const candidateProfileSchema = z.object({
  version: z.literal(1),
  identity: z.object({
    fullName: z.string().min(1).max(200),
    email: z.string().email(),
    phone: z.string().max(50).optional(),
    linkedin: z.string().max(300).optional(),
    github: z.string().max(300).optional(),
    portfolio: z.string().max(300).optional(),
    city: z.string().min(1).max(100),
    region: z.string().max(100).optional(),
    country: z.string().min(1).max(100),
    timezone: z.string().min(1).max(100),
  }),
  career: z.object({
    level: z.enum(["intern", "new-grad", "early-career", "mid", "senior"]),
    yearsOfExperience: z.number().min(0).max(60),
    /** Titles to search for, e.g. "Applied AI Engineer". */
    targetRoles: z.array(z.string().min(1).max(100)).min(1),
    roleFamilies: z
      .array(
        z.object({
          name: z.string().min(1).max(100),
          fit: z.enum(["primary", "secondary", "adjacent"]),
        }),
      )
      .min(1),
    skills: z.array(z.string().min(1).max(100)).default([]),
  }),
  resumes: z
    .array(
      z.object({
        family: z.enum(["core-swe", "applied-ai", "hybrid"]),
        /** Path to the resume source, relative to the profile file. */
        file: z.string().min(1).max(500),
      }),
    )
    .default([]),
  workAuthorization: z.object({
    /** As the candidate states it, e.g. "F-1 OPT". */
    status: z.string().min(1).max(200),
    needsSponsorship: z.boolean(),
    /** Countries where no sponsorship is needed. */
    authorizedIn: z.array(z.string()).default([]),
  }),
  locations: z.object({
    countries: z.array(z.string().min(1)).min(1),
    cities: z.array(z.string()).default([]),
    remote: z.boolean().default(true),
    relocation: z.boolean().default(true),
  }),
  compensation: z
    .object({
      currency: z.string().min(3).max(3),
      minimum: z.number().positive(),
      targetMin: z.number().positive(),
      targetMax: z.number().positive(),
    })
    .refine((c) => c.minimum <= c.targetMax && c.targetMin <= c.targetMax, "Compensation range is inverted"),
  filters: z.object({
    maxPostingAgeDays: z.number().int().positive().default(45),
    excludedTitleKeywords: z.array(z.string()).default([]),
    reviewTitleKeywords: z.array(z.string()).default([]),
    roleFamilyKeywords: z.array(z.string()).default([]),
    /** A stated minimum above this rules a job out. */
    maxRequiredYears: z.number().min(0).max(30),
    /** A stated minimum above this needs review. */
    reviewRequiredYears: z.number().min(0).max(30),
    excludedCompanies: z.array(z.string()).default([]),
    excludedKeywords: z.array(z.string()).default([]),
  }),
  preferredCompanies: z.array(z.string()).default([]),
  /** Career Ops spend tier, used by its evaluation modes. */
  spendTier: z.enum(["economy", "standard", "premium"]).default("standard"),
});
export type CandidateProfile = z.infer<typeof candidateProfileSchema>;
export type CandidateProfileInput = z.input<typeof candidateProfileSchema>;
