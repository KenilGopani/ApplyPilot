# Baseline test results

Run on 2026-11-15, macOS (arm64), Node 26.3.0, Python 3.12.13 (uv), against the commits in [SOURCE_VERSIONS.md](SOURCE_VERSIONS.md). No source repository was modified; `git status` was clean in all three afterwards.

## JobSpy

| Check | Command | Result |
|---|---|---|
| Import | `uv run --python 3.12 --with-editable . python -c "from jobspy import scrape_jobs"` | pass (JobPost has 34 fields) |
| CLI | `jobspy --version` | `1.4.1` |
| Unit tests | — | **none exist upstream**; CI only builds, imports and lints |
| Live smoke | `npm run discover` (Indeed ×5; LinkedIn+Indeed ×3) | pass: 11 jobs, 0 rejected |

Because JobSpy has no test suite, ApplyPilot's contract fixtures (generated with JobSpy's own `JobPost` serializer) are the only automated guard on its output shape.

## Career Ops

| Check | Command | Result |
|---|---|---|
| Full suite | `node test-all.mjs` (10 parallel jobs, 229 s) | **22,485 passed, 1 failed**, 15 warnings |
| The failure | `tests/scan-verify-api.test.mjs` | **passes 12/12 when run alone** (`node --test tests/scan-verify-api.test.mjs`) |

Known issue: `scan-verify-api` is timing-sensitive under the parallel runner on this machine. Treated as a flake, not a regression; re-check on each pin update. The suite is slow (≈4 min, ≈20 CPU-minutes), so `npm run verify` does not run it; Phase 22 adds it to the full integration verification.

## Rolecraft (KenilJobBoard)

| Check | Command | Result |
|---|---|---|
| Install | `npm ci` | pass. npm's allow-scripts held back `workerd`, `esbuild`, `unrs-resolver` postinstalls; build still succeeded |
| Unit tests | `npm test` | 5/5 pass |
| Typecheck | `npx tsc --noEmit` | pass |
| Build | `npm run build` | pass (`/` and `/api/workspace` routes) |
| API tests | `npm run test:api` | not run: needs `npm start` with the ChatGPT Sites local auth environment |

## ApplyPilot

| Check | Command | Result |
|---|---|---|
| Source pins | `npm run verify:sources` | 3/3 at pinned commits, clean |
| Typecheck | `npm run typecheck` | pass |
| TS tests | `npm test` | 28/28 at baseline; 40 pass + 1 skipped (Rolecraft integration, needs `ROLECRAFT_URL`) after Phase 8 |
| Python worker tests | `npm run test:python` | 5/5 |
