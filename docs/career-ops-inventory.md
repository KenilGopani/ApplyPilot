# Career Ops inventory

Commit `9170fed`, release 1.40.0, MIT. Node ≥ 22.13. A very large, flat-root codebase: ~300 root scripts (`*.mjs`), 142 provider modules, ~1,180 test suites, and prompt files under `modes/`.

## What it is

An **agent-driven** job-search system. The core logic (evaluation, tailoring, outreach, interview prep) is written as Markdown prompts in `modes/` that an AI coding CLI (Claude Code, Codex, OpenCode, Gemini, …) executes; deterministic work (scanning, tracking, PDF rendering, liveness checks) is done by zero-token Node scripts. It is local-first and human-in-the-loop: it never submits applications.

## Architecture rules that constrain integration

1. **System vs user layer** (`DATA_CONTRACT.md`): scripts/modes/templates are system files the updater may overwrite; `cv.md`, `config/profile.yml`, `modes/_profile.md`, `data/`, `reports/`, `jds/`, `output/`, `portals.yml` are user files it never touches.
2. **Files are canonical, databases are derived** (issue #918): `data/applications.md`, `data/pipeline.md` and `reports/*.md` are the source of truth; `data/applications.db` (SQLite) is a rebuildable index. Upstream refuses a second canonical store.
3. **External data root**: `CAREER_OPS_ROOT` (or `CAREER_OPS_DATA_DIR`) points all user files at another directory. This is how ApplyPilot will isolate it (`runtime/career-ops-data/`).
4. **Flat root is deliberate**; script paths are a stable interface.

## Entry points

| Area | Scripts / modes | Output |
|---|---|---|
| Portal discovery | `scan.mjs` (+ `providers/*.mjs`), `scan-ats-full.mjs`, `scan-hn.mjs`, `scan-seek.mjs`, `scan-dayforce.mjs`, `scan-interamt.mjs`, `discover-ats.mjs`, `discover-new-companies.mjs` | appends to `data/pipeline.md`, `data/scan-history.tsv`, `data/scan-runs.tsv`, `data/portal-health.tsv` |
| Liveness | `check-liveness.mjs`, `liveness-{api,browser,core}.mjs` | per-URL verdicts |
| JD capture | `fetch-jd.mjs`, `jd-capture.mjs`, `browser-extract.mjs` | `jds/` |
| Evaluation | `modes/oferta.md` + `modes/_shared.md` via an AI CLI; standalone `gemini-eval.mjs`, `ollama-eval.mjs`, `openai-eval.mjs`, `openrouter-runner.mjs`, `batch/batch-runner.sh` | `reports/{NNN}-{company}-{date}.md`, tracker row |
| Triage / scoring helpers | `modes/triage.md`, `classify-tier.mjs`, `rank-pipeline.mjs`, `keyword-match.mjs`, `jd-skill-gap.mjs`, `jd-years.mjs`, `sponsor-check.mjs`, `role-matcher.mjs` | |
| Tailoring / generation | `modes/pdf.md`, `generate-pdf.mjs` (Playwright), `generate-latex.mjs`, `build-cv-*.mjs`, `generate-cover-letter.mjs`, `openai-tailor.mjs`, `batch-tailor.mjs`, `verify-cv-facts.mjs` | `output/*.pdf` |
| Application prep | `prepare-application.mjs`, `application-answers.mjs`, `application-artifacts.mjs`, `modes/apply.md` | |
| Company / contact research | `modes/deep.md`, `modes/contacto.md`, `contact-lookup.mjs`, `contacts.mjs`, `company-history.mjs`, `company-funded.mjs` | `data/contacts.tsv` |
| Tracking | `tracker.mjs`, `add-entry.mjs`, `set-status.mjs`, `merge-tracker.mjs`, `dedup-tracker.mjs`, `normalize-statuses.mjs`, `reconcile-pipeline.mjs`, `verify-pipeline.mjs` | `data/applications.md`, `status-log.tsv`, `applications.db` |
| Follow-ups / interviews | `followup-cadence.mjs`, `modes/followup.md`, `modes/interview-prep.md`, `ics-interview.mjs` | `data/follow-ups.md`, `interview-prep/` |
| Analytics | `stats.mjs`, `analyze-patterns.mjs`, `funnel-velocity.mjs`, `discard-analytics.mjs`, `weekly-digest.mjs`, `salary-gap.mjs` | |
| Health | `doctor.mjs`, `validate-profile.mjs`, `validate-portals.mjs` | |
| UIs | `web/` (Next.js app, `@career-ops/web` 0.18.0), `dashboard/` (Go TUI) | |
| Self-update | `update-system.mjs` | |

## Discovery details

- **Providers**: Greenhouse, Lever, Ashby, Workday, BambooHR, Teamtailor, Breezy, SmartRecruiters, Workable, Recruitee, iCIMS, Jobvite, Rippling, Avature, Eightfold, plus many regional/company-specific boards (142 modules). All are open, no-auth APIs; login-gated sources are left to plugins.
- **LinkedIn**: no search. `linkedin-watch.mjs` / `linkedin-import.mjs` import LinkedIn job-alert emails saved to a folder.
- **Config**: `portals.yml` (companies, title `positive`/`negative` keyword filters, `seniority_boost`, search queries).
- **Filters inside `scan.mjs`**: title, declared field, tier, location, posting age/date, salary, content, country eligibility, blacklist (`data/blacklist.md`), visa, cooldown, plus dedup against history/pipeline/tracker.
- **Machine interface**: `node scan.mjs --json [--dry-run]` prints one receipt `careerops.scan.receipt@1` (`scanned, skipped, found, filtered, duplicates, added, added_urls[], errors[], unverified_zero, partial[], dry_run`). Exit 0 ok, 1 config/fatal, 2 all targets failed (any failed with `--json`).
- **Postings themselves** are not in the receipt; they are in `data/pipeline.md` (Pending lines `- [ ] {url} | {company} | {title} | {location} | {comp}`) and `data/scan-history.tsv` (columns in `lib/scan-history-columns.mjs`: `url, first_seen, portal, title, company, status, location, fingerprint, posted_at, trust_score, trust_flags, normalized_company, requisition_id, language, listing_key, closes_at`).

## Evaluation details

- Report: Markdown with a header block (`Date, URL, Archetype, Score: x/5, Decision, Legitimacy, Work Auth, PDF`) and blocks A–H (role summary, CV match table with per-requirement evidence/gap, …). See `examples/sample-report.md`.
- Score: 1–5, archetype detection, posting-legitimacy signals, work-authorization line — all defined in `modes/_shared.md`.
- Evaluation needs an LLM. Interactive: an AI CLI. Headless: Gemini (`GEMINI_API_KEY`), OpenRouter (`OPENROUTER_API_KEY`), any OpenAI-compatible endpoint (`OPENAI_BASE_URL/OPENAI_API_KEY/OPENAI_MODEL`), or **fully local Ollama** (`ollama-eval.mjs`, `OLLAMA_*`).
- Report numbers are reserved atomically (`reserve-report-num.mjs`); tracker writes are locked.

## Profile format

`config/profile.yml` (`candidate, target_roles, narrative, compensation, location, language, spend_tier, cv, cover_letter`), `modes/_profile.md` (archetypes, narrative), `modes/_brief.md` (compact triage brief), `cv.md` (resume as Markdown), `config/cv-facts.json` (fact allowlist / forbidden phrases), `data/career-profile.yml` (source-backed master profile). Work-authorization rules live in the profile plus `templates/immigration-status-requirements.yml`.

## Tests and environment

- `node test-all.mjs` discovers `tests/**/*.test.mjs` (≈1,180 suites, 22.5k checks, ~4 min). Also `updater-migration-tests.mjs`, `upgrade-tests.mjs`, Playwright visual tests.
- Environment: see [SOURCE_VERSIONS.md](SOURCE_VERSIONS.md). `.env` is read from the data root.
- Dependencies: `@google/generative-ai`, `dotenv`, `js-yaml`, `playwright` (pinned 1.64.1), `undici`.

## Integration notes

- No importable library API: integrate through **CLI processes + files** under an isolated `CAREER_OPS_ROOT`.
- `scan.mjs --json` gives counts; read new postings from that data root's `scan-history.tsv` rows for the run (parse with upstream's `lib/scan-history-columns.mjs`), never by scraping stdout.
- Evaluation is the expensive, model-dependent part; expose it only after deciding on a provider (Phase 13 risk in [RISKS.md](RISKS.md)).
