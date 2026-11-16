# Data contracts

## Platform: `CanonicalJob` (`packages/job-schema/src/job.ts`)

| Field | Type | Rule |
|---|---|---|
| `id` | `job_` + 16 hex | `sha256(site + externalId or canonical URL)`; stable across runs, per source |
| `externalId` | string? | Upstream id (`li-…`, `in-…`) |
| `title`, `company` | string | Required, trimmed; a record without them is rejected |
| `location` | string? | Display string as the source gave it |
| `remoteType` | remote/hybrid/onsite/unknown | Only from explicit signals; never inferred from "not remote" |
| `description` | string? | Markdown by default |
| `source` | enum | linkedin, indeed, glassdoor, ziprecruiter, google, greenhouse, lever, ashby, wellfound, company, manual, other |
| `sourceUrl` | http(s) URL | Must equal `provenance[0].url` |
| `postedAt` | YYYY-MM-DD? | Real calendar date |
| `salaryMin/Max/Currency/Interval` | number?/string?/enum? | Native interval kept (no silent annualising); inverted ranges dropped with a warning |
| `employmentType` | string? | |
| `discoveredAt` | ISO datetime | |
| `provenance` | `CanonicalJobSource[]` (≥1) | `{provider, site, url, applyUrl?, externalId?, adapter, upstreamVersion?, runId?, discoveredAt}` |
| `rawSource` | unknown | Untouched upstream record |

Also defined: `CanonicalJobRequirement`, `CanonicalResumeEvidence` (verbatim excerpt + document), `CanonicalJobEvaluation` (native score scale, decision, matched requirements **each with ≥1 evidence**, missing requirements, work-authorization signal, recommended resume family), `CanonicalApplicationDecision` (who decided and why), `DiscoveryStatus`.

## Worker protocol: `applypilot.jobspy.result@1`

Request: JSON object on stdin with `scrape_jobs()` keyword arguments (unknown keys rejected) plus optional `run_id`.

Response: exactly one JSON line on stdout.

```json
{
  "version": "applypilot.jobspy.result@1",
  "run_id": "run_…", "started_at": "…Z", "finished_at": "…Z", "duration_ms": 1635,
  "upstream": { "package": "python-jobspy", "version": "1.4.1" },
  "request": { "site_name": ["indeed"], "proxies": "<redacted>", "…": "…" },
  "metrics": { "requested_per_site": 15, "returned": 5,
               "by_site": { "indeed": { "returned": 5, "error": null, "warnings": [] } } },
  "records": [ { "id": "in-…", "site": "indeed", "job_url": "…", "…": "…" } ],
  "error": null
}
```

`error.code`: `INVALID_REQUEST` (exit 1), `WORKER_CRASHED` (exit 1), `ALL_SOURCES_FAILED` (exit 2). Records are JobSpy rows after JobSpy's serializer, empty cells removed, dates as `YYYY-MM-DD`. JobSpy's logs go to stderr.

The TypeScript side maps these to `PlatformError` codes `DISCOVERY_INVALID_REQUEST`, `DISCOVERY_WORKER_CRASHED`, `DISCOVERY_WORKER_UNAVAILABLE`, `DISCOVERY_WORKER_TIMEOUT`, `DISCOVERY_PROTOCOL_ERROR`, and returns `DiscoveryResult { status: ok|partial|failed, jobs, rejected, errors, metrics {returned, mapped, rejected, duplicates, bySite} }`. Invariant: `mapped + rejected + duplicates = returned`.

## JobSpy → CanonicalJob mapping

| JobSpy | Canonical |
|---|---|
| `site` | `source` (`zip_recruiter`→`ziprecruiter`; bayt/naukri/bdjobs/hellowork→`other`), `provenance.site` verbatim |
| `id` | `externalId` |
| `job_url` / `job_url_direct` | `sourceUrl` / `provenance.applyUrl` |
| `is_remote`, `work_from_home_type` | `remoteType` (hybrid > remote > onsite > unknown) |
| `date_posted` | `postedAt` |
| `min_amount`, `max_amount`, `currency`, `interval` | `salary*` |
| `job_type` | `employmentType` |
| everything | `rawSource` |

## Career Ops native formats (read-only for now)

| File | Format | Reader to reuse |
|---|---|---|
| `data/pipeline.md` | `- [ ] {url} \| {company} \| {title} \| {location} \| {comp}` under Pending/Processed | `lib/pipeline-sections.mjs`, `scan.mjs` exports |
| `data/scan-history.tsv` | Append-only TSV, columns in `lib/scan-history-columns.mjs` | `parseScanHistoryLine` |
| `scan.mjs --json` | `careerops.scan.receipt@1` counts + `added_urls` | — |
| `reports/{NNN}-{slug}-{date}.md` | Header block + A–H sections | (parser to write, Phase 13) |
| `data/applications.md` | Markdown tracker table | `tracker-parse.mjs` |

## Career Ops adapter (Phase 8)

Career Ops runs as child processes of the current Node, from the pinned checkout, with `CAREER_OPS_ROOT=runtime/career-ops-data` (override: `APPLYPILOT_CAREER_OPS_DATA`). Every other `CAREER_OPS_*` path redirect inherited from the shell is removed, `CAREER_OPS_NO_ASKS=1` is set, and a data root inside the checkout is refused. Only these scripts are exposed:

| Operation | Native call | Machine format | Mapped to |
|---|---|---|---|
| `careerOpsHealth()` | `doctor.mjs --json` (read-only) | one JSON object: `onboardingNeeded, missing[], unpersonalized[], warnings[], plugins[]` | `CareerOpsHealth` |
| `verifyCareerOpsPipeline()` | `verify-pipeline.mjs --no-hints` | no JSON mode: one `✅`/`⚠️`/`❌` line per finding, exit 1 on errors | `PipelineVerification {ok, errors, warnings, checks[]}` |
| `scanPortals()` | `scan.mjs --json --quiet [--dry-run] [--company] [--since]` | last stdout line = `careerops.scan.receipt@1`; exit 1 = config error (e.g. no `portals.yml`), exit 2 = a target failed | `PortalScanResult {status: ok\|partial\|failed, receipt}` |

A non-dry-run scan makes Career Ops write, in the data root only: `data/pipeline.md` (Pending lines), `data/scan-history.tsv` (one row per posting: `url, first_seen, portal, title, company, status, location, fingerprint, posted_at, …, requisition_id, …`), `data/scan-runs.tsv`, `data/portal-health.tsv` and an HTTP cache. Phase 9 maps the scan-history rows of a run to `CanonicalJob`.

### Career Ops → CanonicalJob (Phase 9)

`discoverPortalJobs()` runs a real scan, then maps exactly the receipt's `added_urls`, each looked up in `scan-history.tsv` (latest `added` row). Cells are unescaped (`'=` → `=`); short legacy rows read missing trailing columns as absent. The column layout is copied in the adapter and checked against the pinned `lib/scan-history-columns.mjs` by the smoke test.

| scan-history | Canonical |
|---|---|
| `url` | `sourceUrl`, `id` = hash(source + canonical URL) |
| URL host | `source`: `greenhouse` / `lever` / `ashby` / `wellfound`, otherwise `company` |
| `portal` | `provenance.site` (e.g. `greenhouse-api`) |
| `title`, `company` | required; a row without them is rejected with a reason |
| `location` | `location`; `remoteType` only when every location part says Remote or Hybrid, else `unknown` |
| `posted_at` | `postedAt` (YYYY-MM-DD), dropped with a warning otherwise |
| `requisition_id` | `externalId` |
| whole row | `rawSource` |

A receipt URL missing from the history is rejected, not skipped. Scans return only postings new to Career Ops' history, so re-running a scan does not resend jobs already in Rolecraft. Descriptions and salary are not in the scan output; they arrive with JD fetching later.

## Merged discovery (Phase 9)

`services/discovery` runs the requested sources independently (one failing never stops the other), saves each run, and pushes each to Rolecraft as its own run (`adapter: jobspy | career-ops`). Jobs are merged by canonical id with provenance concatenated; cross-source matching of different ids is Phase 10.

Not exposed yet (`npm run career-ops -- capabilities`): job evaluation, resume tailoring, application preparation, company and contact research. All of them need an AI CLI or model provider.

## Deduplication (Phase 10)

`packages/dedup` gives every job identity keys (`kind:value`), strongest first:

| Kind | Value | Merges? |
|---|---|---|
| `id` | the job's canonical id (and the ids of copies merged into it) | yes |
| `url` | canonical posting or apply URL | yes |
| `ats` | ATS job identity parsed from any URL: `greenhouse:<id>` (board, embed, `?gh_jid=`), `lever:<uuid>`, `ashby:<uuid>` | yes |
| `req` | `<company>:<requisition id>` (Career Ops) | yes |
| `fp` | hash of the normalized description, only when it is 300+ characters | yes |
| `cctl` | normalized company + title + first city | yes |
| `ct` | normalized company + title | no: reported as a possible duplicate |

Conflict rule: two jobs with different `ats` ids (same ATS) or different `req` ids (same company) are different openings and are never merged, whatever else they share.

Merging keeps every sighting in `provenance`. The primary record is the employer's posting (ATS or company page) before job boards, then the earliest sighting; fields it lacks (description, location, posted date, employment type, remote type, salary as one unit) are filled from the others. The primary's raw record stays on the job; every other raw record stays in its saved run file (`runtime/discovery/<runId>.json`), which each provenance entry's `runId` names.

Each run is deduplicated before it is pushed and every job carries `dedupKeys`. Rolecraft stores the keys (`discovered_job_keys`) and merges an import into a stored job that shares a key (strongest kind wins, conflicts excluded). A job you acted on (status changed or promoted) always survives a merge; two acted-on jobs are never merged. Import responses include `merged`. `npm run push -- --all` re-sends every saved run with keys; it is idempotent.

## Screening, profile and evaluation (Phases 11–13)

- `CanonicalScreening` on each job: `verdict` pass | review | reject, `authorization`, and `checks[]` (`rule`, `status` compatible | incompatible | unknown | manual-review, `reason`, verbatim `evidence`). Unknown never rejects.
- `runtime/candidate-profile.json` (`packages/candidate-profile`): identity, career, work authorization, locations, compensation and filter rules. `toFilterPolicy()` feeds the filters; `toCareerOpsAnswers()` feeds Career Ops' `onboard-write.mjs --force --only profile`.
- Evaluation: `claude -p --tools "" --strict-mcp-config --no-session-persistence --output-format json`, run in an empty temp directory. Triage prompt = `modes/triage.md` + `modes/_brief.md` + fenced postings, answered as `#n TRIAGE: VERDICT | Company | Role | x/5 | reason`. Full prompt = `_shared.md` + `oferta.md` + `_profile.md` + `profile.yml` + `cv.md` + the fenced posting; the report's header (`Score`, `Decision`, `Work Auth`, `Evidence confidence`) and Block B table become a `CanonicalJobEvaluation`. Quotes not found in `cv.md` move a claimed match to `missing` with category `unverified-match`. Rolecraft stores it via `PUT /api/discovered-jobs/:id/evaluation`; a triage never overwrites a full evaluation. Unreadable postings get a SKIP triage without a model call.

## Resume routing, tailoring and application prep (Phases 14–18)

- Router (`packages/resume-router`): `core-swe` | `applied-ai` | `hybrid` from title words (×3), description words and the evaluation archetype; only families listed in the profile are recommended, with a lower confidence when falling back. Full evaluations carry `resumeRouting`.
- Tailoring (`packages/tailoring`): recommendations each cite verbatim resume text; a tailored version only reorders the base resume's own lines and skill items, `unsupportedLines()` rejects anything else, and each version is a separate file with the base file's SHA-256 (`runtime/resume-versions/rv_*.md|json`).
- Prep bundle (`npm run prepare-application`): resume, version, priorities, real gaps (unverified claims excluded), optional drafts with numbers not found in the resume or posting flagged, and a checklist ending in "submit it yourself". Stored via `PUT /api/discovered-jobs/:id/preparation`; display only.

## Pipeline, analytics, scheduler and logs (Phases 19–24)

- Rolecraft opportunities gain optional `activity[]` and `interviews[]`. `withStatusChange()` records stage changes and schedules follow-ups (Applied 7 days, Screening 5, Interview 3, Offer 2) unless a future one is set; Rejected/Withdrawn stop reminders.
- `GET /api/analytics`: response, screen, interview and offer rates by role family, resume, source, channel (employer site vs job board) and evaluation score, plus median days to response.
- Scheduler run record (`runtime/logs/schedule-runs.jsonl`): `search, started_at, completed_at, sources, queries, jobs_found, jobs_new, jobs_duplicate, jobs_filtered, jobs_evaluated, errors`.
- Logs (`runtime/logs/<service>.jsonl`): one JSON object per line; discovery runs log `run_id, source, query, start, end, jobs_found, jobs_normalized, duplicates, filtered, evaluated, failures, duration_ms`. Secrets, contact details and resume/posting/draft text are redacted.

## Rolecraft native format

One workspace JSON per user: `{ jobs: Job[], resume: {name, source}, weeklyGoal }`, Zod-validated, revisioned. See [rolecraft-inventory.md](rolecraft-inventory.md). Workspace jobs saved from the inbox carry `discoveredJobId`.

## Rolecraft discovered-jobs API (Phase 7)

Local only: ApplyPilot sends `Cookie: __sites_local_auth=1` and `Origin: <rolecraft origin>` to the loopback dev server.

| Call | Body / query | Result |
|---|---|---|
| `POST /api/discovered-jobs` | `{ run: {runId, adapter, status, startedAt, finishedAt, metrics}, jobs: CanonicalJob[] (≤200) }` | `{ received, created, updated }` |
| `GET /api/discovered-jobs` | `?status=new\|review\|saved\|skip\|applied`, `?limit=0..500` (0 = counts only) | `{ jobs: summary[], counts, runs }` |
| `GET /api/discovered-jobs/:id` | | `{ job }` with description, provenance, rawSource |
| `PATCH /api/discovered-jobs/:id` | `{ status, promotedJobId? }` | `{ ok }` |
| `DELETE /api/discovered-jobs/:id` | | `{ ok }` |
| `DELETE /api/discovered-jobs/runs/:runId` | | `{ ok }` (jobs stay) |

Import rules: content fields and `lastSeenAt` are refreshed; `status`, `promotedJobId` and `firstSeenAt` are never overwritten; provenance is merged by site + url + run, so re-importing a run adds nothing and a later run adds a sighting. Rolecraft restates the CanonicalJob contract in `lib/discovery.ts`; `tests/integration/discovery-to-rolecraft.test.ts` keeps the two in step.
