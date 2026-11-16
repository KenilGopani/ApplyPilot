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

Not exposed yet (`npm run career-ops -- capabilities`): job evaluation, resume tailoring, application preparation, company and contact research. All of them need an AI CLI or model provider.

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
