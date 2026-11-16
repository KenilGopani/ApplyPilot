import { createHash } from "node:crypto";

/**
 * Evidence-based tailoring (plan Phase 15). Rules:
 * - never fabricate experience, metrics or skills;
 * - never change a verified number;
 * - missing evidence stays missing (listed as a gap, never written in);
 * - the base resume is never modified; a tailored version is a separate file
 *   that only REORDERS the base resume's own lines and list items.
 */

export interface TailoringInput {
  /** Base resume in Markdown (Career Ops' cv.md format). */
  resume: string;
  jobDescription: string;
  /** Requirements the evaluation found unmet; listed as gaps only. */
  missing?: string[];
}

export type TailoringAction =
  | "surface-bullet"
  | "move-project-up"
  | "reorder-skills"
  | "emphasize-term"
  | "adjust-summary"
  | "deprioritize";

export interface TailoringItem {
  action: TailoringAction;
  detail: string;
  /** Verbatim text from the base resume this recommendation rests on. */
  evidence: string;
}

export interface TailoringPlan {
  /** Resume terms the job description also uses, most frequent in the JD first. */
  matchedTerms: string[];
  items: TailoringItem[];
  /** Gaps to prepare for, never to add to the resume. */
  gaps: string[];
}

const SKILL_LINE = /^\s*[-*]\s+\*\*[^*]+:\*\*\s*(.+)$/;

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termRe(term: string): RegExp {
  // Word-ish boundaries that also work for terms like "C++" or "CI/CD".
  return new RegExp(`(^|[^A-Za-z0-9+#])${escape(term)}(?=$|[^A-Za-z0-9+#])`, "gi");
}

const GENERIC = new Set(["systems", "system", "search", "outputs", "calling", "datasets", "services", "data", "with", "and"]);

/**
 * Occurrences of a skill in text. A multi-word skill ("REST APIs") also counts
 * through its distinctive words ("APIs"), so a JD's shorter wording still matches.
 */
function count(term: string, text: string): number {
  const full = [...text.matchAll(termRe(term))].length;
  if (full > 0 || !/\s/.test(term)) return full;
  return Math.max(
    0,
    ...term
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !GENERIC.has(w.toLowerCase()))
      .map((w) => [...text.matchAll(termRe(w))].length),
  );
}

/** Skills the resume lists (comma items of "**Group:** a, b, c" lines). */
export function resumeSkills(resume: string): string[] {
  const out: string[] = [];
  for (const line of resume.split("\n")) {
    const m = SKILL_LINE.exec(line);
    if (!m) continue;
    for (const item of m[1]!.split(",")) {
      const term = item.replace(/\(.*?\)/g, "").trim();
      if (term.length >= 2) out.push(term);
    }
  }
  return [...new Set(out)];
}

/** Resume skills the JD mentions, ordered by how often the JD mentions them. */
export function matchedTerms(resume: string, jd: string): string[] {
  return resumeSkills(resume)
    .map((t) => ({ t, n: count(t, jd) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.t.localeCompare(b.t))
    .map((x) => x.t);
}

function relevance(line: string, terms: string[]): number {
  return terms.reduce((n, t) => n + (count(t, line) > 0 ? 1 : 0), 0);
}

interface Block {
  heading: string | null;
  lines: string[];
}

/** Split into blocks at "##"/"###" headings, keeping every line. */
function blocks(md: string): Block[] {
  const out: Block[] = [{ heading: null, lines: [] }];
  for (const line of md.split("\n")) {
    if (/^#{2,3}\s/.test(line)) out.push({ heading: line, lines: [] });
    else out[out.length - 1]!.lines.push(line);
  }
  return out;
}

const isBullet = (l: string) => /^\s*[-*]\s+/.test(l) && !SKILL_LINE.test(l);

/** Stable sort of the bullet runs in a block by relevance; other lines stay put. */
function reorderBullets(lines: string[], terms: string[]): string[] {
  const out = [...lines];
  let i = 0;
  while (i < out.length) {
    if (!isBullet(out[i]!) || /^\s{2,}/.test(out[i]!)) {
      i += 1;
      continue;
    }
    // A run of top-level bullets, each with its indented children.
    const items: string[][] = [];
    let j = i;
    while (j < out.length && isBullet(out[j]!) && !/^\s{2,}/.test(out[j]!)) {
      const item = [out[j]!];
      j += 1;
      while (j < out.length && /^\s{2,}\S/.test(out[j]!)) item.push(out[j++]!);
      items.push(item);
    }
    const sorted = items
      .map((item, k) => ({ item, k, r: relevance(item.join(" "), terms) }))
      .sort((a, b) => b.r - a.r || a.k - b.k)
      .map((x) => x.item);
    out.splice(i, j - i, ...sorted.flat());
    i = j;
  }
  return out;
}

function reorderSkillLine(line: string, terms: string[]): string {
  const m = /^(\s*[-*]\s+\*\*[^*]+:\*\*\s*)(.+)$/.exec(line);
  if (!m) return line;
  const items = m[2]!.split(",").map((s) => s.trim());
  const rank = (s: string) => {
    const k = terms.findIndex((t) => count(t, s) > 0);
    return k === -1 ? Infinity : k;
  };
  const sorted = items.map((s, k) => ({ s, k })).sort((a, b) => rank(a.s) - rank(b.s) || a.k - b.k).map((x) => x.s);
  return `${m[1]}${sorted.join(", ")}`;
}

/** A tailored version: the same lines and list items, reordered for this job. */
export function tailorResume(resume: string, terms: string[]): string {
  return blocks(resume)
    .map((b) => {
      const lines = reorderBullets(b.lines, terms).map((l) => (SKILL_LINE.test(l) ? reorderSkillLine(l, terms) : l));
      return [...(b.heading !== null ? [b.heading] : []), ...lines].join("\n");
    })
    .join("\n");
}

/**
 * Guard: the tailored version may only contain the base resume's own lines
 * (skill lines may reorder their comma items). Returns the offending lines.
 */
export function unsupportedLines(base: string, tailored: string): string[] {
  const key = (l: string) => {
    const m = /^(\s*[-*]\s+\*\*[^*]+:\*\*\s*)(.+)$/.exec(l);
    return m ? `${m[1]}${m[2]!.split(",").map((s) => s.trim()).sort().join(", ")}` : l;
  };
  const pool = new Map<string, number>();
  for (const l of base.split("\n")) pool.set(key(l), (pool.get(key(l)) ?? 0) + 1);
  const bad: string[] = [];
  for (const l of tailored.split("\n")) {
    const k = key(l);
    const n = pool.get(k) ?? 0;
    if (n === 0) bad.push(l);
    else pool.set(k, n - 1);
  }
  return bad;
}

/** Recommendations for this job, each resting on verbatim resume text. */
export function planTailoring(input: TailoringInput): TailoringPlan {
  const terms = matchedTerms(input.resume, input.jobDescription);
  const items: TailoringItem[] = [];
  for (const b of blocks(input.resume)) {
    const bullets = b.lines.filter((l) => isBullet(l) && !/^\s{2,}/.test(l));
    if (bullets.length < 2) continue;
    const ranked = bullets.map((l, k) => ({ l, k, r: relevance(l, terms) }));
    const best = [...ranked].sort((a, c) => c.r - a.r || a.k - c.k)[0]!;
    const isProjects = /project/i.test(b.heading ?? "");
    if (best.k > 0 && best.r > ranked[0]!.r) {
      items.push({
        action: isProjects ? "move-project-up" : "surface-bullet",
        detail: `${isProjects ? "Lead the projects with" : `Under ${b.heading?.replace(/^#+\s*/, "") ?? "this section"}, lead with`} the item that matches ${best.r} job term(s)`,
        evidence: best.l.replace(/^\s*[-*]\s+/, "").slice(0, 400),
      });
    }
    const weak = ranked.filter((x) => x.r === 0);
    if (weak.length && weak.length < ranked.length && !isProjects) {
      items.push({
        action: "deprioritize",
        detail: "Move lower (keep it; it matches none of the job's terms)",
        evidence: weak[0]!.l.replace(/^\s*[-*]\s+/, "").slice(0, 400),
      });
    }
  }
  if (terms.length) {
    items.push({
      action: "reorder-skills",
      detail: `List these first in your skills: ${terms.slice(0, 8).join(", ")}`,
      evidence: terms.slice(0, 8).join(", "),
    });
    items.push({
      action: "emphasize-term",
      detail: `Use the job's own wording for skills you already list: ${terms.slice(0, 5).join(", ")}`,
      evidence: terms.slice(0, 5).join(", "),
    });
  }
  const summary = /^##\s*(professional\s+)?summary[^\n]*\n+([^\n#]+)/im.exec(input.resume)?.[2]?.trim();
  if (summary) {
    const inSummary = terms.filter((t) => count(t, summary) > 0);
    const notInSummary = terms.filter((t) => count(t, summary) === 0).slice(0, 4);
    if (notInSummary.length) {
      items.push({
        action: "adjust-summary",
        detail: `Your summary could name ${notInSummary.join(", ")} — only if your experience below shows them${inSummary.length ? `; it already names ${inSummary.slice(0, 4).join(", ")}` : ""}`,
        evidence: summary.slice(0, 400),
      });
    }
  }
  return { matchedTerms: terms, items, gaps: [...new Set(input.missing ?? [])] };
}

export interface ResumeVersion {
  versionId: string;
  jobId: string;
  family: string;
  baseFile: string;
  baseSha256: string;
  createdAt: string;
  matchedTerms: string[];
  changedLines: number;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Build a tailored version and its record. Throws if the guard finds a new line. */
export function createResumeVersion(
  base: string,
  plan: TailoringPlan,
  meta: { jobId: string; family: string; baseFile: string; createdAt: string },
): { text: string; record: ResumeVersion } {
  const text = tailorResume(base, plan.matchedTerms);
  const bad = unsupportedLines(base, text);
  if (bad.length) throw new Error(`tailored version adds lines not in the base resume: ${bad.slice(0, 3).join(" | ")}`);
  const baseLines = base.split("\n");
  const changedLines = text.split("\n").filter((l, i) => l !== baseLines[i]).length;
  const baseSha256 = sha256(base);
  return {
    text,
    record: {
      versionId: `rv_${sha256(`${meta.jobId}:${baseSha256}:${plan.matchedTerms.join(",")}`).slice(0, 12)}`,
      ...meta,
      baseSha256,
      matchedTerms: plan.matchedTerms,
      changedLines,
    },
  };
}
