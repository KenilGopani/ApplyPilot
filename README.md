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
| 2. JobSpy → CanonicalJob → Rolecraft | done: discovered jobs land in Rolecraft's Discovered inbox |
| 3. Multi-source discovery | done: JobSpy boards + Career Ops company portals land in Rolecraft, deduplicated across sources |
| 4–6. Hard filters, evaluation, workspace, analytics | not started (Phase 11 next) |

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

## Run Rolecraft locally

Discovered jobs are shown in Rolecraft (KenilJobBoard, branch `feat/discovered-jobs`). Once, in `../KenilJobBoard`: `npm ci`, `npm run build`, then apply both migrations as its README describes (`drizzle/0000_*.sql` and `drizzle/0001_discovered_jobs.sql`). Then start it:

```bash
cd ../KenilJobBoard && npm run dev -- --host 127.0.0.1
```

Open http://127.0.0.1:5173 and use the local sign-in.

## Discover jobs

```bash
npm run discover -- "applied ai engineer" --site indeed,linkedin --location "San Francisco, CA" -n 20 --push
```

Writes `runtime/discovery/<run id>.json` with canonical jobs, rejected records (with reasons) and per-board metrics, and with `--push` imports the jobs into Rolecraft's **Discovered** inbox. Board failures such as LinkedIn rate limits are reported per board; the run still returns the other boards' jobs. Importing is idempotent and never resets a decision you made in the inbox. A saved run can be imported later:

```bash
npm run push -- runtime/discovery/<run id>.json
```

Add Career Ops' company-portal scan (Greenhouse, Lever, Ashby, … from `runtime/career-ops-data/portals.yml`) with `--sources`:

```bash
npm run discover -- "applied ai engineer" --sources jobspy,career-ops --push   # both
npm run discover -- --sources career-ops --push                               # portals only
```

Each source is saved and imported as its own run. A portal scan returns only postings it has not seen before. The same posting found on several sources becomes one job in Rolecraft (see [docs/DATA_CONTRACTS.md](docs/DATA_CONTRACTS.md#deduplication-phase-10)); `npm run push -- --all` re-sends saved runs so older ones are deduplicated too.

In the inbox, **Save** or **Applied** adds a job to Opportunities (linked back to its discovered record); **Review**, **Skip** and **Restore** only change its inbox status. Nothing is ever submitted to an employer.

## Career Ops

ApplyPilot runs the pinned Career Ops checkout against its own data folder, `runtime/career-ops-data`, so your Career Ops files never live inside the checkout.

```bash
npm run career-ops -- init           # create the data folder
npm run career-ops -- doctor         # what Career Ops still needs (cv.md, profile, portals.yml, …)
npm run career-ops -- scan --dry-run # preview a scan of the boards in portals.yml
npm run career-ops -- capabilities   # which Career Ops operations ApplyPilot exposes
```

A scan needs `cv.md`, `config/profile.yml` and `portals.yml` in the data folder (Career Ops' format). `npm run discover -- --sources career-ops --push` brings its postings into Rolecraft.

## Layout

| Path | Purpose |
|---|---|
| `packages/job-schema` | `CanonicalJob`, provenance, evaluation and decision schemas (Zod) |
| `workers/jobspy` | Python worker: calls `jobspy.scrape_jobs()` and emits a JSON envelope |
| `adapters/jobspy` | Runs the worker and maps JobSpy rows to `CanonicalJob` |
| `adapters/career-ops` | Runs Career Ops scripts (health, verify, scan) against the isolated data folder |
| `packages/dedup` | Cross-source deduplication: identity keys, conflict rules, provenance-preserving merges |
| `packages/rolecraft-client` | Pushes canonical jobs to a local Rolecraft in batches (loopback only) |
| `services/discovery` | The `discover`, `push` and `career-ops` commands |
| `tests/integration` | Fixture jobs → Rolecraft round trip (`ROLECRAFT_URL=http://127.0.0.1:5173 npm run test:integration`) |
| `tests/fixtures/jobspy` | Fictional rows for every JobSpy board, generated with JobSpy's own serializer |
| `scripts/` | Setup, source-pin verification |
| `runtime/` | Local, git-ignored state (venv, discovery output, later Career Ops data) |
| `docs/` | Inventories, contracts, capability matrix, risks |

## Ground rules

JobSpy and Career Ops are never edited in place, and Rolecraft changes land on a branch with their own tests ([docs/UPSTREAM_PATCHES.md](docs/UPSTREAM_PATCHES.md)); `npm run verify:sources` checks every checkout against its pin. No secrets or personal job-search data are committed. Nothing is ever submitted to an employer automatically.
