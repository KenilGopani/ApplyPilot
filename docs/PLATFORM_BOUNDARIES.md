# Platform boundaries

Four boundaries. Each one talks to the next only through a canonical type from `@applypilot/job-schema`, never through an upstream's native format.

```text
DISCOVERY            adapters/jobspy  ──┐            (later) adapters/career-ops scan
  upstream formats   JobSpy DataFrame    │            pipeline.md / scan-history.tsv
                                         ▼
NORMALIZATION        CanonicalJob[]  (+ provenance, rawSource)
                                         │
                                         ▼
FILTERING            dedup → hard filters → evaluation queue      (Phases 10–11)
                                         │
                                         ▼
EVALUATION           Career Ops adapter → CanonicalJobEvaluation  (Phase 13)
                                         │
                                         ▼
PRODUCT              Rolecraft: discovered-jobs inbox, applications, follow-ups
```

## Rules

1. **Adapters own translation.** Only `adapters/<engine>` reads an engine's native format. Everything downstream sees canonical types.
2. **Raw data travels with the job.** `rawSource` keeps the untouched upstream record; `provenance[]` keeps every sighting. Deduplication merges provenance, never drops it.
3. **Failures are values, not silence.** A board that fails is reported per site in the run result; a record that cannot be mapped is listed in `rejected` with a reason. Only whole-run failures throw (`PlatformError`).
4. **Engines run out of process.** JobSpy runs as a Python worker; Career Ops will run as CLI processes against an isolated `CAREER_OPS_ROOT`. No upstream module is imported into the platform at runtime.
5. **Discovered ≠ applied.** Discovery results land in an inbox with statuses `new / review / saved / skip / applied`; only a human promotes one to an application.
6. **Rolecraft is the product system of record; Career Ops keeps its own files** until a migration is proven (plan Phase 16).

## Code layout

| Path | Boundary | Status |
|---|---|---|
| `packages/job-schema` | Normalization types | done |
| `workers/jobspy` | Discovery (Python side) | done |
| `adapters/jobspy` | Discovery → Normalization | done |
| `adapters/career-ops` | Runtime (health, verify, scan) and portal postings → CanonicalJob | done (Phases 8–9); evaluation Phase 13 |
| `packages/dedup` | Cross-source dedup: identity keys, conflicts, merges | done (Phase 10) |
| `packages/filters`, `packages/candidate-profile` | Hard filters and the candidate profile | done (Phases 11–12) |
| `adapters/claude-code`, `services/evaluation` | Triage and Career Ops evaluation through the user's Claude login | done (Phase 13) |
| `packages/resume-router`, `packages/tailoring`, `services/preparation` | Resume choice, reorder-only tailoring, application prep | done (Phases 14–18) |
| `services/scheduler`, `packages/logging`, `packages/config` | Scheduled discovery, logs, configuration | done (Phases 21–25) |
| `packages/rolecraft-client` | Normalization → Product (push to Rolecraft) | done |
| `services/discovery` | Runs and merges sources, saves runs, pushes to Rolecraft (`discover --sources`, `push`, `career-ops`) | done |
| Rolecraft `discovered_jobs` + inbox | Product | done (KenilJobBoard `main`, merged in PR #1) |

Directories are created when their phase starts rather than scaffolded empty.
