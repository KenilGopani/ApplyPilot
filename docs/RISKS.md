# Conflicts and risks found in the audit

| # | Risk | Impact | Proposed handling |
|---|---|---|---|
| R1 | **Rolecraft is a hosted ChatGPT Sites app** (Sites auth, Cloudflare D1, one JSON document per user) while ApplyPilot is local-first. | Decides how discovered jobs reach Rolecraft (Phase 7). | **Resolved in Phase 7:** Rolecraft runs locally (`npm run dev`, local D1); ApplyPilot pushes over HTTP with the dev server's loopback sign-in cookie. The client refuses non-loopback URLs, so pushing to the hosted Site would need real auth (not built). |
| R2 | Rolecraft's workspace document caps `jobs` at 2,000 and rewrites the whole document on every save. | Discovery volume would hit it in weeks. | **Resolved in Phase 7:** `discovered_jobs` table; only jobs you Save/Apply enter `workspace.jobs`. |
| R3 | Career Ops evaluation needs an LLM (AI CLI, Gemini, OpenRouter, OpenAI-compatible or local Ollama). | Cost/privacy choice; blocks Phase 13. | Decide provider; Ollama keeps it fully local. |
| R4 | Career Ops has no library API and treats Markdown files as canonical. | Integration is process + file based. | Isolated `CAREER_OPS_ROOT`; read via its own parsers; never write its files except through its scripts. |
| R5 | JobSpy has no tests upstream. | Upstream changes can silently change output. | Fixtures generated from JobSpy's serializer + contract tests; regenerate on every pin update. |
| R6 | One Career Ops suite (`scan-verify-api`) flakes under parallel load. | Noise in integration verification. | Documented in BASELINE.md; rerun alone before treating as a failure. |
| R7 | Job boards rate-limit (LinkedIn 429, Glassdoor ~2 req/s). | Partial runs. | Per-site errors reported, never swallowed; small `results_wanted`; proxies optional (redacted in logs). |
| R8 | Rolecraft enums (`platforms`, `tracks`) don't cover all canonical sources (Glassdoor, ATS). | Lossy promotion. | Mapped at promotion (unknown sources → `Other`, track defaults to Software Engineer); full provenance stays on the discovered job. Extending the enums is still open. |
| R9 | Rolecraft runs on Vinext 1.0.0-beta. | Framework churn. | Don't upgrade during integration (plan rule 8). |
| R10 | Personal data paths: Career Ops user layer, Rolecraft resume, discovery output. | Accidental commit. | `runtime/` is git-ignored; Career Ops data root lives under it; fixtures are fictional. |
| R11 | Career Ops' `cv.md` at the repo root is an upstream example file, but the real one will hold the resume. | Accidental edit of upstream checkout. | Keep the real CV in the isolated data root only; `verify:sources` fails on any tracked-file change. |
| R12 | Promotion is two writes (workspace save, then inbox status). | If the second fails, the opportunity exists but the inbox still says New. | The inbox checks `discoveredJobId` before creating an opportunity, so retrying never duplicates it. |
