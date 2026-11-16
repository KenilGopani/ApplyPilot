# Source versions and runtime requirements

Recorded 2026-11-15; Rolecraft pin moved to its Phase 7 branch on 2026-11-15. The machine-readable pin is [`sources.lock.json`](../sources.lock.json); `npm run verify:sources` checks each checkout against it and fails on drift or local edits.

## Workspace layout

The plan's `sources/` folder is realized as sibling checkouts next to this repository (override with `APPLYPILOT_SOURCES_DIR`):

```text
KenilOwnJobEngine/
├── ApplyPilot/      this repository
├── JobSpy/          upstream, untouched
├── career-ops/      upstream, untouched
└── KenilJobBoard/   Rolecraft, untouched
```

## Pins

| Source | Remote | Ref | Commit | Version |
|---|---|---|---|---|
| JobSpy | `speedyapply/JobSpy` | `main` | `68b88d6909a2342ad75fbb945c4204a3a7ed6665` | python-jobspy 1.4.1 |
| career-ops | `career-ops-hq/career-ops` | detached at release | `9170fed51af6894753a9f520074529d15e38a004` | 1.40.0 |
| KenilJobBoard | `KenilGopani/KenilJobBoard` | `feat/discovered-jobs` (based on `main` `1fe8585`) | `3d2e87524e1eefc98bbdff843d6a89fb1bb972ea` | rolecraft 0.1.0 + Discovered inbox |

## Runtime requirements

| | JobSpy | Career Ops | Rolecraft | ApplyPilot |
|---|---|---|---|---|
| Runtime | Python ≥ 3.10 (system Python here is 3.9.6, so a uv-managed 3.12 is used) | Node `^22.13 \|\| >=23.4` | Node ≥ 22.13 | Node ≥ 22.13 + the JobSpy Python |
| Package manager | Poetry (lock: `poetry.lock`); pip/uv work | npm (`package-lock.json`) | npm (`package-lock.json`); repo also ships pnpm helpers | npm workspaces + uv |
| Install | `uv pip install -e .` | `npm ci` (postinstall fetches Playwright Chromium) | `npm ci` | `npm install && npm run setup:jobspy` |
| Test | none in repo; CI = wheel build + import + `ruff` + `mypy --strict` | `node test-all.mjs` | `npm test` (unit), `npm run test:api` (needs a running server) | `npm run verify` |
| Build | `python -m build --wheel` | n/a (scripts run directly) | `npm run build` (Vinext → Cloudflare Worker) | n/a |
| Env vars | none required; proxies passed as arguments | `CAREER_OPS_ROOT`/`CAREER_OPS_DATA_DIR` (data root), `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_*`, `OLLAMA_*`, `CAREER_OPS_PIPELINE`, ~40 more `CAREER_OPS_*` overrides | ChatGPT Sites auth + D1 binding (`.dev.vars`, `scripts/sites-env.mjs`) | `APPLYPILOT_SOURCES_DIR`, `APPLYPILOT_JOBSPY_PYTHON` |
| Local DB | none | SQLite index derived from markdown files (`data/applications.db`) | Cloudflare D1 (local: wrangler `.wrangler/state`; migrations `0000`, `0001_discovered_jobs`) | none (Rolecraft is the store) |
| Generated / ignored | `dist/`, caches | `data/`, `reports/`, `output/`, `jds/`, `cv.md` user layer (see its `DATA_CONTRACT.md`) | `dist/`, `.next/`, `.vinext/`, `.wrangler/`, `.env*` | `runtime/*`, `node_modules/` |

## Updating a pin

1. `git fetch` in the source checkout and read the changes.
2. Check out the new commit; run its native tests (see [BASELINE.md](BASELINE.md)).
3. For JobSpy: regenerate fixtures (`node scripts/run-jobspy-python.mjs tests/fixtures/jobspy/generate.py`), then `npm test`. A changed fixture or failing contract test means the adapter must change first.
4. `npm run verify` with the new checkout.
5. Update `sources.lock.json` and this table in one `build:` commit.

Never pull upstream changes straight into a running setup.
