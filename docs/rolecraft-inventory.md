# Rolecraft (KenilJobBoard) inventory

Commit `1fe8585`, package `rolecraft` 0.1.0. ~3k lines of TypeScript, most of it one component.

## Architecture

| Layer | Implementation |
|---|---|
| Framework | Vinext 1.0.0-beta.5 (Next-compatible App Router on Vite) building a Cloudflare Worker |
| UI | React 19, Tailwind 4, shadcn/Base UI, Lucide, Recharts. Almost all UI is `components/dashboard.tsx` (2,254 lines) |
| API | One route: `app/api/workspace/route.ts` — `GET` and `PUT` of the whole workspace |
| Auth | ChatGPT Sites (`app/chatgpt-auth.ts`): signed-in user id from the Sites runtime; local dev fakes it with the `__sites_local_auth` cookie |
| Persistence | Cloudflare D1 via Drizzle; **one table `workspaces(user_id, data, revision, updated_at)`** where `data` is the whole workspace as JSON |
| Concurrency | Optimistic: `PUT` carries `revision`; stale writes get 409 |
| Hosting | ChatGPT Sites (private, authenticated) on Cloudflare Workers |

## Domain model (`lib/workspace.ts`, Zod)

`Workspace = { jobs: Job[] (≤2000, unique ids), resume: { name, source (≤200 KB) }, weeklyGoal }`

`Job` fields: `id, company, title, track, location, workMode (Remote/Hybrid/On-site/Unknown), platform, url (http/https only), status, sponsorship, authorization, level, deadline, followUp, appliedAt (YYYY-MM-DD or ""), description, notes, recruiter, createdAt, reminderDone`.

| Enum | Values |
|---|---|
| `platforms` | LinkedIn, Indeed, ZipRecruiter, Jobright, Jack & Jill AI, a16z, Wellfound, YC, Other |
| `statuses` | Saved, Applied, Screening, Interview, Offer, Rejected, Withdrawn |
| `tracks` | Software Engineer, Applied AI Engineer, Backend Engineer, Other |
| `sponsorships` | Unknown, Available, Not available, Case by case |
| `authorizations` | Not specified, US authorized, OPT / STEM OPT, Citizen / permanent resident only, Other |
| `levels` | Unknown, New grad, Early career, Experienced |

There is no separate recruiter, follow-up, interview or resume-version entity: recruiter is a string, follow-up is a date on the job, and there is one resume.

## Features

- Opportunity list and board views, filters, stage tracking.
- Resume studio: deterministic keyword matcher over 8 topics (`analyze()`), reports matched topics with evidence and gaps; never rewrites the resume.
- Outreach templates (`outreach()`) that only cite matched topics and leave a placeholder for a verified result.
- `.ics` export (`calendarEvent()`), JSON backup/restore, isolated demo mode.

## Tests and build

- `npm test`: 5 unit tests (`tests/workspace.test.mjs`) — resume byte preservation, matcher scoring, outreach honesty, ICS escaping, URL/date validation.
- `npm run test:api`: one integration test against a running server (401, validation, origin check, round trip, 409).
- `npm run build` passes; `npm run typecheck` passes.

## Integration notes

- The workspace-as-one-JSON-document model will not hold thousands of discovered jobs well (schema caps `jobs` at 2,000 and every save rewrites the document). Discovered jobs need their own table, separate from application stages (Phase 7/16).
- Rolecraft is built for **hosted** ChatGPT Sites auth and D1, while ApplyPilot is local-first. Local dev already runs D1 through wrangler (`.wrangler/state`) with fake auth, which is the likely local path. See [RISKS.md](RISKS.md) R1.
- `platforms` lacks Glassdoor and the ATS sources; `CanonicalJob.source` → `platform` needs a mapping (or an enum extension) when discovered jobs are promoted to applications.
