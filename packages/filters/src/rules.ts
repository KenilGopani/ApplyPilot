import type { AuthorizationSignal, CanonicalJob, ScreeningCheck } from "@applypilot/job-schema";
import type { FilterPolicy } from "./policy.ts";

const US_STATES = new Set(
  ("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC").split(" "),
);
const US_NAMES = /\b(united states|usa|u\.s\.a?\.?|us)\b/i;
const FOREIGN = /\b(canada|toronto|vancouver|montreal|uk|united kingdom|england|london|ireland|dublin|germany|berlin|munich|france|paris|netherlands|amsterdam|spain|madrid|barcelona|italy|poland|warsaw|switzerland|zurich|sweden|stockholm|india|bangalore|bengaluru|hyderabad|pune|mumbai|delhi|singapore|japan|tokyo|korea|seoul|china|beijing|shanghai|hong kong|australia|sydney|melbourne|new zealand|brazil|sao paulo|mexico|argentina|israel|tel aviv|uae|dubai|emea|apac|latam|europe)\b/i;

const check = (rule: string, status: AuthorizationSignal, reason: string, evidence?: string): ScreeningCheck =>
  evidence ? { rule, status, reason, evidence: evidence.slice(0, 500) } : { rule, status, reason };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (words: string[]) =>
  words.length ? new RegExp(`\\b(${words.map(escape).join("|")})\\b`, "i") : null;

/** Sentences of a description, so evidence can be quoted verbatim. */
export function sentences(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .replace(/<[^>]+>/g, " ")
    // "U.S." would otherwise end a sentence: "Must be a U.S. citizen."
    .replace(/\bU\.\s?S\.(\s?A\.)?/g, "US")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/[*_#>`]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 3);
}

export function locationCheck(job: CanonicalJob, policy: FilterPolicy): ScreeningCheck {
  const loc = job.location?.trim();
  if (!loc) return check("location", "unknown", "No location listed");
  const parts = loc.split(/[|;]/).map((p) => p.trim());
  const wantsUs = policy.countries.some((c) => US_NAMES.test(c) || /united states/i.test(c));
  const named = (p: string) => policy.countries.some((c) => new RegExp(`\\b${escape(c)}\\b`, "i").test(p));
  const isUs = (p: string) =>
    US_NAMES.test(p) || p.split(",").slice(1).some((seg) => US_STATES.has(seg.trim().toUpperCase()));
  if (parts.some((p) => named(p) || (wantsUs && isUs(p)))) {
    return check("location", "compatible", `Located in ${policy.countries[0] ?? "an allowed country"}`, loc);
  }
  if (parts.every((p) => FOREIGN.test(p))) {
    return check("location", "incompatible", "Located outside the countries you can work in", loc);
  }
  return check("location", "unknown", "Location does not name a country", loc);
}

export function ageCheck(job: CanonicalJob, policy: FilterPolicy, now: Date): ScreeningCheck | null {
  if (policy.maxPostingAgeDays === undefined) return null;
  if (!job.postedAt) return check("posting-age", "unknown", "No posting date");
  const days = Math.floor((now.getTime() - Date.parse(`${job.postedAt}T00:00:00Z`)) / 86_400_000);
  return days > policy.maxPostingAgeDays
    ? check("posting-age", "incompatible", `Posted ${days} days ago (limit ${policy.maxPostingAgeDays})`)
    : check("posting-age", "compatible", `Posted ${days} days ago`);
}

export function titleChecks(job: CanonicalJob, policy: FilterPolicy): ScreeningCheck[] {
  const out: ScreeningCheck[] = [];
  const excluded = wordRe(policy.excludedTitleKeywords)?.exec(job.title);
  if (excluded) out.push(check("title-level", "incompatible", `Title level "${excluded[1]}" is excluded`, job.title));
  else {
    const review = wordRe(policy.reviewTitleKeywords)?.exec(job.title);
    out.push(
      review
        ? check("title-level", "manual-review", `Title level "${review[1]}" may be above your level`, job.title)
        : check("title-level", "compatible", "Title level fits"),
    );
  }
  const family = wordRe(policy.roleFamilyKeywords);
  if (family) {
    out.push(
      family.test(job.title)
        ? check("role-family", "compatible", "Title is in a target role family")
        : check("role-family", "incompatible", "Title is outside your target role families", job.title),
    );
  }
  return out;
}

const YEARS_RE =
  /(?:at least|minimum(?: of)?|min\.?)?\s*(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*)?\+?\s*(?:years?|yrs?)\b/i;
const PREFERRED = /\b(preferred|nice to have|bonus|plus if|a plus|ideally|desirable)\b/i;

/** The highest stated minimum years of experience among required sentences. */
export function requiredYears(description: string | undefined): { years: number; evidence: string } | null {
  let best: { years: number; evidence: string } | null = null;
  for (const s of sentences(description)) {
    // "expe" also catches common typos ("expeience"); "ago" is company history, not a requirement.
    if (!/\bexpe/i.test(s) || /\bago\b/i.test(s) || PREFERRED.test(s)) continue;
    const m = YEARS_RE.exec(s);
    if (!m) continue;
    const years = Number(m[1]);
    if (years > 0 && years <= 20 && (!best || years > best.years)) best = { years, evidence: s };
  }
  return best;
}

export function experienceCheck(job: CanonicalJob, policy: FilterPolicy): ScreeningCheck {
  if (!job.description) return check("experience", "unknown", "No description to read required experience from");
  const req = requiredYears(job.description);
  if (!req) return check("experience", "unknown", "No required years stated");
  if (req.years > policy.maxRequiredYears) {
    return check("experience", "incompatible", `Requires ${req.years}+ years`, req.evidence);
  }
  if (req.years > policy.reviewRequiredYears) {
    return check("experience", "manual-review", `Requires ${req.years}+ years`, req.evidence);
  }
  return check("experience", "compatible", `Requires ${req.years}+ years`, req.evidence);
}

const NO_SPONSOR = [
  /\b(not|un)\s*(able|willing)\s+to\s+sponsor\b/i,
  /\bunable\s+to\s+(provide|offer)\s+(visa\s+)?sponsorship\b/i,
  /\b(will|do|does|can)\s*not\s+(provide\s+|offer\s+)?sponsor/i,
  /\bno\s+(visa\s+|h-?1b\s+)?sponsorship\b/i,
  /\bwithout\s+(the\s+need\s+for\s+|requiring\s+)?(current\s+or\s+future\s+|future\s+)?(visa\s+|employer\s+)?sponsorship\b/i,
  /\bsponsorship\s+(is\s+)?not\s+(available|offered|provided)\b/i,
  /\b(must|required\s+to)\s+be\s+(a\s+)?u\.?s\.?\s+citizens?\b/i,
  /\bu\.?s\.?\s+citizenship\s+(is\s+)?required\b/i,
  /\b(active|current|ability to obtain)\s+(\w+\s+)?(security\s+)?clearance\b/i,
  /\b(secret|top secret|ts\/sci)\s+clearance\b/i,
  /\bgreen\s+card\s+holders?\s+only\b/i,
];
const SPONSORS = [
  /\b(visa\s+)?sponsorship\s+(is\s+)?(available|provided|offered)\b/i,
  /\bwe\s+(will\s+|can\s+)?sponsor\b/i,
  /\bwill\s+sponsor\b/i,
  /\bh-?1b\s+(sponsorship|transfers?)\s+(available|welcome|supported)\b/i,
];
const AUTHORIZED_ONLY = /\b(must|need to|required to)\s+be\s+(legally\s+)?authorized\s+to\s+work\b/i;

/**
 * Sponsorship / work authorization, from the posting's own words only. A
 * posting that says nothing is "unknown", never assumed either way.
 */
export function authorizationCheck(job: CanonicalJob, policy: FilterPolicy): ScreeningCheck {
  if (!policy.needsSponsorship) return check("work-authorization", "compatible", "You do not need sponsorship");
  if (!job.description) return check("work-authorization", "unknown", "No description to read sponsorship terms from");
  const lines = sentences(job.description);
  const refuse = lines.find((s) => NO_SPONSOR.some((re) => re.test(s)));
  if (refuse) return check("work-authorization", "incompatible", "The posting rules out sponsorship or requires citizenship/clearance", refuse);
  const offer = lines.find((s) => SPONSORS.some((re) => re.test(s)));
  if (offer) return check("work-authorization", "compatible", "The posting offers sponsorship", offer);
  const authorized = lines.find((s) => AUTHORIZED_ONLY.test(s));
  if (authorized) {
    return check("work-authorization", "manual-review", "Requires work authorization; future sponsorship not stated", authorized);
  }
  return check("work-authorization", "unknown", "Sponsorship not mentioned");
}

const YEARLY: Record<string, number> = { yearly: 1, monthly: 12, weekly: 52, daily: 260, hourly: 2080 };

export function salaryCheck(job: CanonicalJob, policy: FilterPolicy): ScreeningCheck | null {
  if (policy.salaryFloorYearly === undefined) return null;
  const top = job.salaryMax ?? job.salaryMin;
  if (top === undefined) return check("salary", "unknown", "No salary listed");
  const factor = YEARLY[job.salaryInterval ?? "yearly"] ?? 1;
  const yearlyTop = top * factor;
  if (job.salaryCurrency && job.salaryCurrency.toUpperCase() !== "USD") {
    return check("salary", "unknown", `Salary is in ${job.salaryCurrency}`);
  }
  return yearlyTop < policy.salaryFloorYearly
    ? check("salary", "incompatible", `Top of range ~$${Math.round(yearlyTop).toLocaleString("en-US")}/yr is below your floor`)
    : check("salary", "compatible", `Up to ~$${Math.round(yearlyTop).toLocaleString("en-US")}/yr`);
}

export function exclusionChecks(job: CanonicalJob, policy: FilterPolicy): ScreeningCheck[] {
  const out: ScreeningCheck[] = [];
  const company = job.company.toLowerCase();
  const blocked = policy.excludedCompanies.find((c) => company.includes(c.toLowerCase()));
  if (blocked) out.push(check("excluded-company", "incompatible", `${job.company} is on your excluded list`));
  const kw = wordRe(policy.excludedKeywords);
  const hit = kw ? sentences(job.description).find((s) => kw.test(s)) : undefined;
  if (hit) out.push(check("excluded-keyword", "incompatible", "Description contains an excluded keyword", hit));
  return out;
}
