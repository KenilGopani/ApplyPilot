/**
 * What the hard filters check, derived from the candidate profile (Phase 12).
 * Every rule is explicit configuration; nothing is inferred about the candidate.
 */
export interface FilterPolicy {
  /** Countries the candidate can work in. Matched against location text. */
  countries: string[];
  /** Postings older than this are stale. */
  maxPostingAgeDays?: number;
  /** Title words that rule a job out (e.g. Staff, Principal, Manager). */
  excludedTitleKeywords: string[];
  /** Title words that need a human look (e.g. Senior). */
  reviewTitleKeywords: string[];
  /** The title must contain at least one of these (role family); empty disables the check. */
  roleFamilyKeywords: string[];
  /** A stated minimum above this many years rules the job out. */
  maxRequiredYears: number;
  /** A stated minimum above this many years needs review. */
  reviewRequiredYears: number;
  /** True when the candidate needs visa sponsorship now or later. */
  needsSponsorship: boolean;
  /** Yearly pay floor; a posted maximum below it rules the job out. */
  salaryFloorYearly?: number;
  excludedCompanies: string[];
  /** Words in the description that rule a job out. */
  excludedKeywords: string[];
}

export const POLICY_VERSION = "filters@1";
