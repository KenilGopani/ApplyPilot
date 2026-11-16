# Local-first runtime

Everything runs on your machine. Network access is used only for job boards (JobSpy), company ATS APIs (Career Ops' scanners and `fetch-jd.mjs`) and, when you run evaluation or drafts, Claude through your own `claude` CLI login.

```text
Rolecraft web (KenilJobBoard, npm run dev, http://127.0.0.1:5173, local D1)
        ▲  HTTP, loopback only, local sign-in cookie
        │
ApplyPilot commands (Node ≥ 22.13)
  discover / push ──► JobSpy worker (Python 3.12 venv, runtime/.venv-jobspy)
                 └──► Career Ops scripts (node, CAREER_OPS_ROOT=runtime/career-ops-data)
  evaluate / prepare-application ──► claude -p (no tools, your login)
  schedule start ──► the above on a timetable
        │
runtime/  (git-ignored: profile, Career Ops data, run files, evaluations, resume versions, logs)
```

| Piece | Start | Health |
|---|---|---|
| Whole stack | `npm run dev` (add `-- --with-scheduler`) | `npm run dev` prints a ✓/✗ per part |
| Rolecraft | `cd ../KenilJobBoard && npm run dev -- --host 127.0.0.1` | `GET /api/discovered-jobs` answers 401 without the cookie |
| JobSpy worker | `npm run setup:jobspy` once | `npm run verify:integration` step 3 |
| Career Ops | `npm ci` in `../career-ops` once | `npm run career-ops -- doctor` |
| Claude | install Claude Code and log in | `claude --version` |
| Everything | | `npm run verify:integration` |

Rolecraft's local database needs its migrations `0000`–`0005` applied once (KenilJobBoard README). The hosted Rolecraft Site is not used by ApplyPilot; pushing to it would need real authentication, which the client refuses.
