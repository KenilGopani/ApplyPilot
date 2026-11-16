# Configuration

| What | Where | Committed? |
|---|---|---|
| Platform settings (paths, Claude binary, Rolecraft URL) | `.env` / `.env.local` (see `.env.example`) or your shell | `.env.example` only |
| Candidate profile: targets, work authorization, pay, filter rules, resumes | `runtime/candidate-profile.json` (example: `config/candidate-profile.example.json`) | example only |
| Search schedule | `runtime/schedule.json` (example: `config/schedule.example.json`) | example only |
| JobSpy search options | `npm run discover` flags or a schedule entry | — |
| Career Ops config (`config/profile.yml`, `portals.yml`, `cv.md`, `modes/_profile.md`, `modes/_brief.md`) | `runtime/career-ops-data/` | never |
| Model provider | your `claude` CLI login; `--model` per run | — |

`.env` and `.env.local` are loaded first by every command; a value already set in the shell always wins. `npm run config:check` shows every resolved setting and explains anything missing. No API key is required anywhere; never put one in a committed file. `runtime/` is git-ignored as a whole.
