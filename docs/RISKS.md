# Conflicts and risks found in the audit

| # | Risk | Impact | Proposed handling |
|---|---|---|---|
| R1 | **Rolecraft is a hosted ChatGPT Sites app** (Sites auth, Cloudflare D1, one JSON document per user) while ApplyPilot is local-first. | Decides how discovered jobs reach Rolecraft (Phase 7). | Run Rolecraft locally with wrangler's local D1 and the existing local-auth cookie; add a `discovered_jobs` table and API rather than growing the workspace document. Needs a decision before Phase 7. |
| R2 | Rolecraft's workspace document caps `jobs` at 2,000 and rewrites the whole document on every save. | Discovery volume would hit it in weeks. | Discovered jobs live in their own table; only promoted jobs enter `workspace.jobs`. |
| R3 | Career Ops evaluation needs an LLM (AI CLI, Gemini, OpenRouter, OpenAI-compatible or local Ollama). | Cost/privacy choice; blocks Phase 13. | Decide provider; Ollama keeps it fully local. |
| R4 | Career Ops has no library API and treats Markdown files as canonical. | Integration is process + file based. | Isolated `CAREER_OPS_ROOT`; read via its own parsers; never write its files except through its scripts. |
| R5 | JobSpy has no tests upstream. | Upstream changes can silently change output. | Fixtures generated from JobSpy's serializer + contract tests; regenerate on every pin update. |
| R6 | One Career Ops suite (`scan-verify-api`) flakes under parallel load. | Noise in integration verification. | Documented in BASELINE.md; rerun alone before treating as a failure. |
| R7 | Job boards rate-limit (LinkedIn 429, Glassdoor ~2 req/s). | Partial runs. | Per-site errors reported, never swallowed; small `results_wanted`; proxies optional (redacted in logs). |
| R8 | Rolecraft enums (`platforms`, `tracks`) don't cover all canonical sources (Glassdoor, ATS). | Lossy promotion. | Map at promotion time; extend Rolecraft enums in a Rolecraft-only commit. |
| R9 | Rolecraft runs on Vinext 1.0.0-beta. | Framework churn. | Don't upgrade during integration (plan rule 8). |
| R10 | Personal data paths: Career Ops user layer, Rolecraft resume, discovery output. | Accidental commit. | `runtime/` is git-ignored; Career Ops data root lives under it; fixtures are fictional. |
| R11 | Career Ops' `cv.md` at the repo root is an upstream example file, but the real one will hold the resume. | Accidental edit of upstream checkout. | Keep the real CV in the isolated data root only; `verify:sources` fails on any tracked-file change. |
