import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEvaluationPrompt,
  buildTriagePrompt,
  fetchJobDescription,
  loadEvaluationContext,
  parseReport,
  parseTriage,
  toCanonicalEvaluation,
  type EvaluationContext,
  type JobForEvaluation,
  type JobDescriptionResult,
  type TriageResult,
} from "@applypilot/adapter-career-ops";
import { routeResume, type ResumeFamily } from "@applypilot/resume-router";
import { ClaudeError, runClaude, type ClaudeOptions, type ClaudeResult } from "@applypilot/adapter-claude-code";
import {
  getDiscoveredJob,
  listDiscoveredJobs,
  putEvaluation,
  type DiscoveredJobDetail,
  type DiscoveredJobSummary,
  type PushOptions,
} from "@applypilot/rolecraft-client";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface EvaluateOptions {
  /** Full evaluations at most (the expensive step). Default 3. */
  limit?: number;
  /** Jobs to quick-check at most in this run. Default 24. */
  triageLimit?: number;
  /** Postings per triage call. Default 8. */
  batchSize?: number;
  /** Evaluate exactly these inbox jobs (full evaluation, triage skipped). */
  jobIds?: string[];
  dryRun?: boolean;
  claude?: ClaudeOptions;
  rolecraft?: PushOptions;
  reportsDir?: string;
  /** Test seams. */
  context?: EvaluationContext;
  model?: (prompt: string) => Promise<ClaudeResult>;
  fetchDescription?: (url: string) => Promise<JobDescriptionResult>;
  now?: () => Date;
  log?: (line: string) => void;
  /** Resume families the candidate has (from the profile); all when unknown. */
  resumeFamilies?: ResumeFamily[];
}

export interface EvaluateSummary {
  triaged: { id: string; result: TriageResult }[];
  evaluated: { id: string; score: number; decision: string; report: string; unverified: string[]; resume: ResumeFamily }[];
  skipped: { id: string; reason: string }[];
  failed: { id: string; reason: string }[];
  stoppedByLimit: string | null;
  claudeCalls: number;
  tokens: { input: number; cached: number; output: number };
}

const decided = (j: DiscoveredJobSummary) => j.status !== "new" && j.status !== "review";

/** Inbox order for spending model budget: filters' pass before review, then newest. */
export function rankCandidates(jobs: DiscoveredJobSummary[]): DiscoveredJobSummary[] {
  const verdictRank = (j: DiscoveredJobSummary) => (j.screeningVerdict === "review" ? 1 : 0);
  return [...jobs]
    .filter((j) => !decided(j) && j.screeningVerdict !== "reject")
    .sort((a, b) => verdictRank(a) - verdictRank(b) || (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "job";
}

/**
 * Two-step evaluation of inbox jobs with Career Ops' own prompts:
 *
 * 1. Triage (modes/triage.md): a cheap, batched quick check of jobs the hard
 *    filters kept and nobody has checked yet.
 * 2. Full evaluation (modes/oferta.md) for triage PASS jobs, best first, up
 *    to `limit` per run.
 *
 * Results go to Rolecraft as they arrive, so a run stopped by a usage limit
 * keeps everything it finished. Reports are saved under runtime/evaluations.
 */
export async function evaluateInbox(options: EvaluateOptions = {}): Promise<EvaluateSummary> {
  const log = options.log ?? (() => undefined);
  const now = options.now ?? (() => new Date());
  const ctx = options.context ?? loadEvaluationContext();
  const model = options.model ?? ((prompt: string) => runClaude(prompt, options.claude));
  const fetchDescription = options.fetchDescription ?? ((url: string) => fetchJobDescription(url));
  const reportsDir = options.reportsDir ?? join(repoRoot, "runtime", "evaluations");
  const limit = options.limit ?? 3;
  const triageLimit = options.triageLimit ?? 24;
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 8, 15));

  const summary: EvaluateSummary = {
    triaged: [],
    evaluated: [],
    skipped: [],
    failed: [],
    stoppedByLimit: null,
    claudeCalls: 0,
    tokens: { input: 0, cached: 0, output: 0 },
  };
  const call = async (prompt: string) => {
    const result = await model(prompt);
    summary.claudeCalls += 1;
    summary.tokens.input += result.usage.inputTokens + result.usage.cacheCreationTokens;
    summary.tokens.cached += result.usage.cacheReadTokens;
    summary.tokens.output += result.usage.outputTokens;
    return result;
  };

  /** The job with a description, fetched through Career Ops when Rolecraft has none. */
  const withDescription = async (summaryRow: DiscoveredJobSummary): Promise<{ detail: DiscoveredJobDetail; job: JobForEvaluation } | null> => {
    const detail = await getDiscoveredJob(summaryRow.id, options.rolecraft);
    let description = detail.description ?? "";
    if (!description) {
      const url = detail.provenance.find((p) => p.applyUrl)?.applyUrl ?? detail.sourceUrl;
      const jd = await fetchDescription(url).catch(() => ({ status: "unavailable" }) as const);
      if (jd.status === "found") description = jd.text;
      else {
        summary.skipped.push({ id: detail.id, reason: jd.status === "closed" ? "posting closed" : "no job description available" });
        return null;
      }
    }
    return {
      detail,
      job: {
        company: detail.company,
        title: detail.title,
        location: detail.location ?? undefined,
        url: detail.sourceUrl,
        description,
      },
    };
  };

  try {
    let fullQueue: DiscoveredJobSummary[];
    if (options.jobIds?.length) {
      fullQueue = await Promise.all(options.jobIds.map((id) => getDiscoveredJob(id, options.rolecraft)));
    } else {
      const inbox = rankCandidates([
        ...(await listDiscoveredJobs({ status: "new", screening: "kept" }, options.rolecraft)),
        ...(await listDiscoveredJobs({ status: "review" }, options.rolecraft)),
      ]);
      const toTriage = inbox.filter((j) => j.evaluationStage === null).slice(0, triageLimit);
      log(`inbox: ${inbox.length} candidates; quick-checking ${toTriage.length}`);
      if (options.dryRun) {
        const passed = inbox.filter((j) => j.evaluationStage === "triage" && j.evaluationDecision === "PASS");
        log(`dry run: would triage ${toTriage.length} in ${Math.ceil(toTriage.length / batchSize)} call(s), then fully evaluate up to ${limit} PASS job(s) (${passed.length} already waiting)`);
        return summary;
      }

      // Step 1: triage in batches.
      for (let i = 0; i < toTriage.length; i += batchSize) {
        const ready: { detail: DiscoveredJobDetail; job: JobForEvaluation }[] = [];
        for (const row of toTriage.slice(i, i + batchSize)) {
          const item = await withDescription(row);
          if (item) {
            ready.push(item);
            continue;
          }
          // Record why, as Career Ops' own SKIP verdict, so later runs do not
          // pick the same unreadable posting again. No model call is made.
          await putEvaluation(
            row.id,
            {
              stage: "triage",
              evaluator: "applypilot (no model call)",
              evaluatedAt: now().toISOString(),
              verdict: "SKIP",
              score: 0,
              reason: summary.skipped[summary.skipped.length - 1]?.reason ?? "posting not readable",
            },
            options.rolecraft,
          );
        }
        if (ready.length === 0) continue;
        log(`triage: ${ready.length} job(s)…`);
        const result = await call(buildTriagePrompt(ctx, ready.map((r) => r.job)));
        const lines = parseTriage(result.text, ready.length);
        for (const [index, item] of ready.entries()) {
          const triage = lines.get(index + 1);
          if (!triage) {
            summary.failed.push({ id: item.detail.id, reason: "no triage line returned" });
            continue;
          }
          await putEvaluation(
            item.detail.id,
            {
              stage: "triage",
              evaluator: `career-ops triage${ctx.version ? ` (${ctx.version})` : ""} via claude-code${result.model ? ` (${result.model})` : ""}`,
              evaluatedAt: now().toISOString(),
              verdict: triage.verdict,
              score: triage.score,
              reason: triage.reason,
            },
            options.rolecraft,
          );
          summary.triaged.push({ id: item.detail.id, result: triage });
          log(`  ${triage.verdict.padEnd(8)} ${triage.score.toFixed(1)}  ${item.detail.company} — ${item.detail.title}`);
        }
      }

      // Step 2: the best PASS jobs (from this run and earlier ones) get a full evaluation.
      const refreshed = rankCandidates([
        ...(await listDiscoveredJobs({ status: "new", screening: "kept" }, options.rolecraft)),
        ...(await listDiscoveredJobs({ status: "review" }, options.rolecraft)),
      ]);
      fullQueue = refreshed
        .filter((j) => j.evaluationStage === "triage" && j.evaluationDecision === "PASS")
        .sort((a, b) => (b.evaluationScore ?? 0) - (a.evaluationScore ?? 0));
    }

    for (const row of fullQueue.slice(0, options.jobIds?.length ? undefined : limit)) {
      if (options.dryRun) break;
      const item = await withDescription(row);
      if (!item) continue;
      log(`evaluate: ${item.detail.company} — ${item.detail.title}…`);
      const result = await call(buildEvaluationPrompt(ctx, item.job, now().toISOString().slice(0, 10)));
      const file = join(reportsDir, `${now().toISOString().slice(0, 10)}-${slug(item.detail.company)}-${item.detail.id}.md`);
      mkdirSync(reportsDir, { recursive: true });
      writeFileSync(
        file,
        `<!-- ApplyPilot: ${item.detail.id} · ${item.job.url} · ${result.model ?? "claude"} -->\n\n${result.text}\n`,
      );
      try {
        const parsed = parseReport(result.text, ctx.cv);
        const { evaluation, unverifiedMatches } = toCanonicalEvaluation(item.detail.id, parsed, {
          evaluatedAt: now().toISOString(),
          evaluatorVersion: `${ctx.version ?? "career-ops"} via claude-code${result.model ? ` (${result.model})` : ""}`,
          nativeReport: file,
        });
        const route = routeResume(
          { title: item.job.title, description: item.job.description, archetype: parsed.archetype ?? undefined },
          options.resumeFamilies,
        );
        const { jobId: _jobId, ...stored } = evaluation;
        void _jobId;
        await putEvaluation(
          item.detail.id,
          {
            stage: "full",
            evaluation: { ...stored, recommendedResume: route.recommended },
            resumeRouting: {
              recommended: route.recommended,
              confidence: route.confidence,
              reason: route.reason,
              alternative: route.alternative,
            },
          },
          options.rolecraft,
        );
        summary.evaluated.push({
          id: item.detail.id,
          score: evaluation.score,
          decision: parsed.decision,
          report: file,
          unverified: unverifiedMatches,
          resume: route.recommended,
        });
        log(`  ${evaluation.score.toFixed(1)}/5 ${parsed.decision}${unverifiedMatches.length ? ` (${unverifiedMatches.length} unverified claim(s) moved to gaps)` : ""}`);
      } catch (error) {
        summary.failed.push({ id: item.detail.id, reason: `report not usable (${(error as Error).message}); saved at ${file}` });
      }
    }
  } catch (error) {
    if (error instanceof ClaudeError && error.code === "CLAUDE_LIMIT") {
      summary.stoppedByLimit = error.message;
      return summary;
    }
    throw error;
  }
  return summary;
}
