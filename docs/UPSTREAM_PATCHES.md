# Upstream patches

Policy (plan Phase 28): before changing JobSpy, Career Ops or Rolecraft source to make an integration work,

1. document why the adapter cannot solve it,
2. add a failing regression test,
3. patch on a separate integration branch in that repository,
4. keep the patch minimal,
5. run that repository's tests and `npm run verify` here,
6. record it below and update `sources.lock.json`.

`npm run verify:sources` fails whenever a source checkout is off its pin or has modified tracked files, so an unrecorded patch cannot go unnoticed.

## Log

None. All three sources are unmodified.
