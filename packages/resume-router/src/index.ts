/**
 * Resume family router (plan Phase 14). Deterministic and free: it reads the
 * job title, description and, when available, Career Ops' archetype, and
 * picks one of the candidate's resume families. It never rewrites a resume.
 */
export const resumeFamilies = ["core-swe", "applied-ai", "hybrid"] as const;
export type ResumeFamily = (typeof resumeFamilies)[number];

export interface RouteInput {
  title: string;
  description?: string;
  /** Career Ops' detected archetype, when the job was evaluated. */
  archetype?: string;
}

export interface ResumeRoute {
  recommended: ResumeFamily;
  /** The family the job itself points to, before checking which resumes exist. */
  ideal: ResumeFamily;
  confidence: number;
  reason: string;
  alternative: ResumeFamily | null;
  signals: { ai: string[]; backend: string[]; product: string[] };
}

const AI = /\b(llms?|genai|generative ai|large language|rag|retrieval|embeddings?|agents?|agentic|ml|machine learning|applied ai|ai engineer|nlp|prompt|evals?|fine-?tun\w*|langchain|langgraph|vector|inference|model serving)\b/gi;
const BACKEND = /\b(backend|back-end|apis?|microservices?|distributed|kafka|postgres\w*|sql|databases?|infrastructure|platform|scalab\w*|reliability|kubernetes|go(lang)?|java|python services?|systems)\b/gi;
const PRODUCT = /\b(full[- ]?stack|frontend|front-end|react|next\.?js|typescript|product engineer|ui|ux|customer[- ]facing|forward deployed|prototyp\w*)\b/gi;

function hits(re: RegExp, text: string): string[] {
  return [...new Set([...text.matchAll(re)].map((m) => m[0].toLowerCase()))];
}

/**
 * Route a job. Title words count three times as much as description words,
 * because a title states what the role is while descriptions mention
 * everything. An archetype from a full evaluation settles close calls.
 */
export function routeResume(input: RouteInput, available: ResumeFamily[] = [...resumeFamilies]): ResumeRoute {
  const title = input.title;
  const body = (input.description ?? "").slice(0, 20_000);
  const signals = {
    ai: [...new Set([...hits(AI, title), ...hits(AI, body)])],
    backend: [...new Set([...hits(BACKEND, title), ...hits(BACKEND, body)])],
    product: [...new Set([...hits(PRODUCT, title), ...hits(PRODUCT, body)])],
  };
  const score = (re: RegExp) => hits(re, title).length * 3 + Math.min(hits(re, body).length, 8);
  let ai = score(AI);
  let backend = score(BACKEND);
  const product = score(PRODUCT);
  const arch = input.archetype?.toLowerCase() ?? "";
  if (/\b(ai|llm|ml|agent)/.test(arch)) ai += 4;
  if (/\b(backend|platform|infrastructure|software engineer)\b/.test(arch) && !/\bai\b/.test(arch)) backend += 4;

  let ideal: ResumeFamily;
  let reason: string;
  if (ai >= 2 && (product >= 3 || (backend >= 3 && Math.abs(ai - backend) <= 2))) {
    ideal = "hybrid";
    reason = "AI work combined with product or backend breadth";
  } else if (ai > backend && ai >= 2) {
    ideal = "applied-ai";
    reason = "AI/LLM work is the core of the role";
  } else {
    ideal = "core-swe";
    reason = ai > 0 ? "Mostly software engineering; AI is secondary" : "Software engineering role without an AI focus";
  }
  const total = ai + backend + product || 1;
  const lead = { "applied-ai": ai, "core-swe": backend, hybrid: Math.min(ai, Math.max(backend, product)) * 2 }[ideal];
  let confidence = Math.max(0.35, Math.min(0.95, 0.4 + lead / total / 1.5));

  // Use the closest resume the candidate actually has.
  const fallback: Record<ResumeFamily, ResumeFamily[]> = {
    "applied-ai": ["applied-ai", "hybrid", "core-swe"],
    "core-swe": ["core-swe", "hybrid", "applied-ai"],
    hybrid: ["hybrid", "applied-ai", "core-swe"],
  };
  const order = fallback[ideal].filter((f) => available.includes(f));
  const recommended = order[0] ?? ideal;
  if (recommended !== ideal) {
    reason += `; no ${ideal} resume yet, so the closest one (${recommended}) is used`;
    confidence = Math.min(confidence, 0.5);
  }
  return {
    recommended,
    ideal,
    confidence: Math.round(confidence * 100) / 100,
    reason,
    alternative: order[1] ?? null,
    signals,
  };
}
