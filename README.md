# ApplyPilot

Local-first job search: discover jobs automatically, filter and evaluate them against your profile, prepare each application with your own resume, and track everything through to offers. ApplyPilot composes three projects instead of rewriting them:

- **[JobSpy](https://github.com/speedyapply/JobSpy)** finds jobs on LinkedIn, Indeed, Glassdoor, ZipRecruiter and regional boards.
- **[Career Ops](https://github.com/career-ops-hq/career-ops)** scans company ATS portals, fetches job descriptions and evaluates postings.
- **Rolecraft** ([KenilJobBoard](https://github.com/KenilGopani/KenilJobBoard)) is the dashboard and system of record.

Each engine runs unmodified behind an adapter; `npm run verify:sources` proves they stay untouched. Nothing is ever submitted to an employer: ApplyPilot prepares, you review and click Submit. The full roadmap is [docs/INTEGRATION_PLAN.md](docs/INTEGRATION_PLAN.md).

## Status

| Milestone | State |
|---|---|
| 1. Baseline: pins, inventories, capability matrix | done |
| 2. JobSpy → CanonicalJob → Rolecraft | done |
| 3. Multi-source discovery with cross-source dedup | done |
| 4. Hard filters → Career Ops evaluation → resume router | done |
| 5. Application workspace: tailoring, prep, drafts, follow-ups | done |
| 6. Analytics and scheduling | done |
| Verification, fixtures, logging, config, dev command, upstream guards | done |

## Setup

Requires Node ≥ 22.13, [uv](https://docs.astral.sh/uv/), and the three sources next to this repository:

```text
KenilOwnJobEngine/
├── ApplyPilot/      ├── JobSpy/      ├── career-ops/      └── KenilJobBoard/
```

```bash
npm install
npm run setup:jobspy                                             # Python 3.12 venv with the pinned JobSpy
cp config/candidate-profile.example.json runtime/candidate-profile.json   # then edit it
npm run profile -- sync                                          # writes Career Ops' profile.yml from it
npm run dev                                                      # health checks + starts Rolecraft
```

Rolecraft runs at http://127.0.0.1:5173 (apply its migrations `0000`–`0005` once; see its README). Settings: [docs/CONFIGURATION.md](docs/CONFIGURATION.md). Runtime layout: [docs/LOCAL_RUNTIME.md](docs/LOCAL_RUNTIME.md).

## Daily use

```bash
npm run discover -- "applied ai engineer" --sources jobspy,career-ops --push   # find, filter, import
npm run evaluate -- --limit 3                                                  # quick check, then full evaluation of the best
npm run prepare-application -- --job <job id> --drafts                         # resume version, priorities, gaps, drafts
npm run schedule -- start                                                      # or: run <name>, list, log
```

In Rolecraft's **Discovered** inbox: jobs that fail your hard filters wait in **Filtered out** with the reason; **Best match** sorts by evaluation; each job shows its sponsorship signal, Career Ops' score with CV-quoted matches and gaps, the resume to use and the application prep. **Save** or **Applied** moves a job into Opportunities, where stage changes build a timeline and schedule follow-ups. **Analytics** shows which roles, resumes and sources turn applications into interviews.

| Command | What it does |
|---|---|
| `discover` | JobSpy and/or Career Ops portal scan → canonical jobs → dedup → hard filters → Rolecraft |
| `push -- --all` | Re-send saved runs (re-deduplicated and re-screened) |
| `profile -- show / policy / sync` | The candidate profile, its filter policy, and the sync into Career Ops |
| `career-ops -- doctor / verify / scan / capabilities` | Career Ops through its adapter |
| `evaluate` | Career Ops triage + full evaluation via your `claude` login (no API key), capped per run |
| `prepare-application` | Application prep bundle; drafts only with `--drafts` |
| `schedule` | Scheduled discovery; quick checks only if a search asks for them |
| `dev` | Health check of every part, then start Rolecraft (and `--with-scheduler`) |
| `verify` / `verify:integration` | Fast checks / the plan's 18 integration checks (`--full` adds Career Ops' native suite) |
| `config:check`, `sources:check-updates` | Resolved settings / how far each source is behind upstream |

## Costs and limits

Discovery, filters, deduplication, description fetching, routing, tailoring and analytics are free. Only `evaluate` and `prepare-application --drafts` use Claude. A full evaluation is about 65K input and 13K output tokens, so a Claude Pro usage window covers a handful; quick checks are about 2K tokens per job. A usage limit stops a run cleanly and keeps finished work.

## Ground rules

- JobSpy and Career Ops are never edited in place; Rolecraft changes land on a branch with tests ([docs/UPSTREAM_PATCHES.md](docs/UPSTREAM_PATCHES.md), updates via [docs/UPSTREAM_UPDATES.md](docs/UPSTREAM_UPDATES.md)).
- Nothing is invented: matches must quote your CV, tailored resumes only reorder your own lines, gaps stay gaps, unverified numbers in drafts are flagged, sponsorship is never inferred.
- `runtime/` (profile, Career Ops data, runs, evaluations, resume versions, logs) is git-ignored; logs redact personal data.
- No automatic submission, ever.

## Layout

| Path | Purpose |
|---|---|
| `packages/job-schema` | Canonical job, provenance, screening, evaluation and decision schemas |
| `packages/dedup`, `packages/filters`, `packages/candidate-profile` | Cross-source dedup, hard filters, the candidate profile |
| `packages/resume-router`, `packages/tailoring` | Resume family choice; evidence-based, reorder-only tailoring |
| `packages/rolecraft-client`, `packages/logging`, `packages/config` | Rolecraft API client, redacted logs, settings |
| `workers/jobspy`, `adapters/jobspy` | JobSpy worker (Python) and its adapter |
| `adapters/career-ops`, `adapters/claude-code` | Career Ops runtime (health, scan, JD fetch, profile sync, evaluation prompts); headless Claude |
| `services/discovery`, `evaluation`, `preparation`, `scheduler` | The commands |
| `tests/fixtures`, `tests/integration`, `tests/guards` | Sanitized fixtures, end-to-end and Rolecraft tests, source guards |
| `docs/` | Inventories, contracts, risks, runtime, configuration, upstream policy |
