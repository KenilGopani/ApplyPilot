# ApplyPilot

Local-first job discovery, evaluation and application tracking. ApplyPilot composes three existing projects instead of rewriting them:

- **[JobSpy](https://github.com/speedyapply/JobSpy)** finds jobs on LinkedIn, Indeed, Glassdoor, ZipRecruiter and regional boards.
- **[Career Ops](https://github.com/career-ops-hq/career-ops)** scans company ATS portals and evaluates postings against a candidate profile.
- **Rolecraft** ([KenilJobBoard](https://github.com/KenilGopani/KenilJobBoard)) is the dashboard and system of record for applications.

Each engine runs unmodified behind an adapter that translates its output into one canonical job schema. See [docs/INTEGRATION_PLAN.md](docs/INTEGRATION_PLAN.md) for the full roadmap.

## Status

| Milestone | State |
|---|---|
| 1. Baseline: pins, inventories, capability matrix | done |
| 2. JobSpy → CanonicalJob | adapter, worker and contract tests done; Rolecraft ingestion next |
| 3–6. Career Ops discovery, dedup, evaluation, workspace, analytics | not started |

## Setup

Requires Node ≥ 22.13 and [uv](https://docs.astral.sh/uv/). The three source repositories are expected next to this one:

```text
KenilOwnJobEngine/
├── ApplyPilot/
├── JobSpy/
├── career-ops/
└── KenilJobBoard/
```

```bash
npm install
npm run setup:jobspy      # Python 3.12 venv in runtime/ with the pinned JobSpy installed editable
npm run verify            # source pins, typecheck, TS tests, Python worker tests
```

## Discover jobs

```bash
npm run discover -- "applied ai engineer" --site indeed,linkedin --location "San Francisco, CA" -n 20
```

Writes `runtime/discovery/<run id>.json` with canonical jobs, rejected records (with reasons) and per-board metrics. Board failures such as LinkedIn rate limits are reported per board; the run still returns the other boards' jobs.

## Layout

| Path | Purpose |
|---|---|
| `packages/job-schema` | `CanonicalJob`, provenance, evaluation and decision schemas (Zod) |
| `workers/jobspy` | Python worker: calls `jobspy.scrape_jobs()` and emits a JSON envelope |
| `adapters/jobspy` | Runs the worker and maps JobSpy rows to `CanonicalJob` |
| `tests/fixtures/jobspy` | Fictional rows for every JobSpy board, generated with JobSpy's own serializer |
| `scripts/` | Setup, source-pin verification |
| `runtime/` | Local, git-ignored state (venv, discovery output, later Career Ops data) |
| `docs/` | Inventories, contracts, capability matrix, risks |

## Ground rules

Upstream sources are never edited in place ([docs/UPSTREAM_PATCHES.md](docs/UPSTREAM_PATCHES.md)); `npm run verify:sources` enforces it. No secrets or personal job-search data are committed. Nothing is ever submitted to an employer automatically.
