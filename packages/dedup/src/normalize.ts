/** Text normalization for identity matching. Lossy on purpose: only for keys, never for display. */

const COMPANY_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company",
  "plc", "gmbh", "ag", "sa", "pvt", "pte", "bv", "lp", "llp",
]);

function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** "Example Labs, Inc." -> "example labs" */
export function normalizeCompany(company: string): string {
  const w = words(company);
  while (w.length > 1 && COMPANY_SUFFIXES.has(w[w.length - 1]!)) w.pop();
  return w.join(" ");
}

const TITLE_ABBREVIATIONS: Record<string, string[]> = {
  sr: ["senior"],
  jr: ["junior"],
  eng: ["engineer"],
  engr: ["engineer"],
  swe: ["software", "engineer"],
  sde: ["software", "development", "engineer"],
  mle: ["machine", "learning", "engineer"],
  ml: ["machine", "learning"],
  dev: ["developer"],
};

/** Parenthesised or dashed qualifiers that describe where/how, not what the job is. */
const WORK_MODE = /\b(remote|hybrid|on ?site|in office|us|usa|united states|u s)\b/i;

/**
 * "Sr. Software Eng (Remote, US)" -> "senior software engineer".
 * Qualifiers about the job itself ("Software Engineer (Agents)") are kept.
 */
export function normalizeTitle(title: string): string {
  let t = title.replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (whole, a?: string, b?: string) =>
    WORK_MODE.test(a ?? b ?? "") ? " " : whole,
  );
  t = t.replace(/\s[-–—|]\s*(remote|hybrid|on-?site)\b.*$/i, " ");
  return words(t)
    .flatMap((w) => TITLE_ABBREVIATIONS[w] ?? [w])
    .join(" ");
}

/**
 * The first city named: "San Francisco, CA | New York City, NY" -> "san francisco".
 * Undefined when the location names no city ("Remote - US", "United States").
 */
export function normalizeCity(location: string | undefined): string | undefined {
  if (!location) return undefined;
  const first = location.split(/[|;/]| or /i)[0] ?? "";
  const city = words(first.split(",")[0] ?? "").join(" ");
  if (!city || /^(remote|hybrid|anywhere|usa?|united states|worldwide|multiple locations?)\b/.test(city)) {
    return undefined;
  }
  return city;
}

/** Description text reduced to words, so formatting differences between boards don't matter. */
export function normalizeDescription(description: string | undefined): string {
  if (!description) return "";
  // HTML tags and Markdown markup (headings, emphasis, quotes, code) differ between boards.
  return words(description.replace(/<[^>]+>/g, " ").replace(/[#*_`>~|]+/g, " ")).join(" ");
}
