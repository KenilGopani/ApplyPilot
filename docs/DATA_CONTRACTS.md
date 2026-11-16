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

## Rolecraft native format

One workspace JSON per user: `{ jobs: Job[], resume: {name, source}, weeklyGoal }`, Zod-validated, revisioned. See [rolecraft-inventory.md](rolecraft-inventory.md).
