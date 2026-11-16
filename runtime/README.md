# runtime/

Local, uncommitted state. Everything in this directory except this file is ignored by git.

| Path | Written by | Contents |
|---|---|---|
| `.venv-jobspy/` | `npm run setup:jobspy` | Python 3.12 environment with the pinned JobSpy checkout installed in editable mode |
| `discovery/` | `npm run discover` | One JSON file per discovery run: canonical jobs, rejected records and run metrics |
| `career-ops-data/` | `npm run career-ops -- init` | Isolated Career Ops data root (`CAREER_OPS_ROOT`): its CV, profile, portals.yml, pipeline, scan history, tracker and reports |
| `logs/` | (Phase 24) | Structured pipeline logs |

Discovery output contains job postings only, but later phases put resume and application data here, so treat the whole directory as personal.
