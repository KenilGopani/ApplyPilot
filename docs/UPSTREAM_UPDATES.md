# Updating a source

Upstream code never flows into ApplyPilot by itself.

1. `npm run sources:check-updates` — fetches refs only and shows how far each pin is behind (or ahead).
2. In the source checkout, read the changes (`git log --stat <pin>..origin/main`), then check out the new commit.
3. Run its native tests: JobSpy's wheel build/import, `node test-all.mjs` in career-ops, `npm test` and `npm run test:api` in KenilJobBoard.
4. JobSpy only: regenerate fixtures (`node scripts/run-jobspy-python.mjs tests/fixtures/jobspy/generate.py`) and review the diff; a changed fixture means the adapter changes first.
5. `npm run verify:integration -- --full` (the adapter contract tests, including the Career Ops scan-history column check, catch format changes).
6. Update `sources.lock.json` and `docs/SOURCE_VERSIONS.md` in one `build:` commit.

If a step fails, stay on the old pin. Patches to JobSpy or Career Ops follow [UPSTREAM_PATCHES.md](UPSTREAM_PATCHES.md).
