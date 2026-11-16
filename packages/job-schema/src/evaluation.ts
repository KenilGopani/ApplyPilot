import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });

export const requirementImportances = [
  "critical",
  "high",
  "meaningful",
  "nice-to-have",
  "unknown",
] as const;

/** One requirement extracted from a job description. */
export const canonicalJobRequirementSchema = z.object({
  id: z.string().min(1).max(100),
  text: z.string().trim().min(1).max(1000),
  importance: z.enum(requirementImportances),
  category: z.string().max(100).optional(),
  /** Where in the JD the requirement was stated, e.g. "Requirements, item 2". */
  jdSignal: z.string().max(500).optional(),
});
export type CanonicalJobRequirement = z.infer<typeof canonicalJobRequirementSchema>;

/**
 * A verbatim excerpt from the candidate's resume or profile that supports a
 * requirement. The excerpt must be copied, never paraphrased or generated.
 */
export const canonicalResumeEvidenceSchema = z.object({
  requirementId: z.string().min(1).max(100).optional(),
  origin: z.enum(["resume", "profile", "portfolio"]),
  /** Resume family or document the excerpt came from, e.g. "applied-ai". */
  document: z.string().min(1).max(200),
  excerpt: z.string().trim().min(1).max(2000),
  section: z.string().max(200).optional(),
});
export type CanonicalResumeEvidence = z.infer<typeof canonicalResumeEvidenceSchema>;

export const fitDecisions = ["apply", "review", "skip"] as const;
export type FitDecision = (typeof fitDecisions)[number];

/** Never inferred: "unknown" when the posting does not say. */
export const authorizationSignals = [
  "compatible",
  "incompatible",
  "unknown",
  "manual-review",
] as const;
export type AuthorizationSignal = (typeof authorizationSignals)[number];

export const resumeFamilies = ["core-swe", "applied-ai", "hybrid"] as const;

const requirementMatchSchema = z.object({
  requirement: canonicalJobRequirementSchema,
  evidence: z.array(canonicalResumeEvidenceSchema),
});

export const canonicalJobEvaluationSchema = z
  .object({
    jobId: z.string().regex(/^job_[0-9a-f]{16}$/),
    evaluator: z.enum(["career-ops", "rolecraft-keywords", "manual"]),
    evaluatorVersion: z.string().max(100).optional(),
    evaluatedAt: isoDateTime,

    /** Career Ops scores on 1-5; keep its native scale instead of rescaling. */
    score: z.number().finite(),
    scoreScale: z.object({ min: z.number(), max: z.number() }),
    decision: z.enum(fitDecisions),
    confidence: z.number().min(0).max(1),

    matched: z.array(requirementMatchSchema),
    missing: z.array(canonicalJobRequirementSchema),

    workAuthorization: z.enum(authorizationSignals),
    roleClassification: z.string().max(200).optional(),
    recommendedResume: z.enum(resumeFamilies).optional(),
    explanation: z.string().max(20_000),

    /** Pointer to the native artifact, e.g. a Career Ops report path. */
    nativeReport: z.string().max(1000).optional(),
  })
  .superRefine((evaluation, ctx) => {
    const { score, scoreScale } = evaluation;
    if (scoreScale.min >= scoreScale.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scoreScale"],
        message: "scoreScale.min must be below scoreScale.max",
      });
    } else if (score < scoreScale.min || score > scoreScale.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["score"],
        message: "score is outside scoreScale",
      });
    }
    // No unsupported claims: a requirement counts as matched only with evidence.
    evaluation.matched.forEach((match, i) => {
      if (match.evidence.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["matched", i, "evidence"],
          message: `Matched requirement "${match.requirement.text}" has no resume evidence; list it under missing instead`,
        });
      }
    });
  });
export type CanonicalJobEvaluation = z.infer<typeof canonicalJobEvaluationSchema>;

/** A human or system decision about whether to pursue a job. */
export const canonicalApplicationDecisionSchema = z.object({
  jobId: z.string().regex(/^job_[0-9a-f]{16}$/),
  decision: z.enum(fitDecisions),
  decidedBy: z.enum(["human", "system"]),
  reason: z.string().max(5000),
  decidedAt: isoDateTime,
  evaluationRef: z.string().max(200).optional(),
});
export type CanonicalApplicationDecision = z.infer<
  typeof canonicalApplicationDecisionSchema
>;
