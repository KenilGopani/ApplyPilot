# JobSpy inventory

Commit `68b88d6`, python-jobspy 1.4.1, MIT. ~4.7k lines of Python.

## Public interfaces

| Interface | Entry point | Notes |
|---|---|---|
| Library | `jobspy.scrape_jobs(...)` → `pandas.DataFrame` | The only name in `__all__`. **The adapter uses only this.** |
| CLI | `jobspy` (`jobspy/cli.py`) | Options mirror `scrape_jobs`; writes `.csv/.json/.jsonl` |
| MCP server | `mcp-jobspy` (`jobspy/mcp.py`, separate `mcp/` package) | Optional extra `mcp` |

## `scrape_jobs()` parameters

`site_name`, `search_term`, `google_search_term`, `location`, `distance` (default 50), `is_remote`, `job_type`, `easy_apply`, `results_wanted` (default 15, **per site**), `country_indeed` (default usa), `proxies`, `ca_cert`, `description_format` (markdown/html/plain), `linkedin_fetch_description` (deprecated), `linkedin_company_ids`, `offset`, `hours_old`, `enforce_annual_salary`, `verbose` (0–2), `user_agent`, `fetch_description`.

Validated by pydantic `ScraperInput`; invalid input raises `ValueError` with all messages joined.

## Supported sites (`Site` enum)

| Site value | Module | Id prefix | Default? | Notes |
|---|---|---|---|---|
| `linkedin` | `linkedin/` | `li-` | yes | 429s on bursts; description needs `fetch_description` |
| `indeed` | `indeed/` | `in-` | yes | GraphQL API, least rate-limited; searches descriptions too |
| `zip_recruiter` | `ziprecruiter/` | `zr-` | yes | US/Canada only |
| `glassdoor` | `glassdoor/` | `gd-` | yes | ~2 req/s limit |
| `google` | `google/` | `go-` | **no** | README: "currently unavailable"; excluded from default site list |
| `bayt` | `bayt/` | `bayt-` | no | Middle East |
| `naukri` | `naukri/` | `nk-` | no | India; sets `work_from_home_type` |
| `bdjobs` | `bdjobs/` | `bd-` | no | Bangladesh |
| `hellowork` | `hellowork/` | `hw-` | no | France |

## Result schema

One row per `JobPost` (`jobspy/model.py`, `extra="forbid"`): `id, site, job_url, job_url_direct, title, company, location, date_posted, job_type, salary_source, interval, min_amount, max_amount, currency, is_remote, job_level, job_function, listing_type, emails, description, company_industry, company_url, company_logo, company_url_direct, company_addresses, company_num_employees, company_revenue, company_description, skills, experience_range, company_rating, company_reviews_count, vacancy_count, work_from_home_type`.

The model's custom serializer flattens values: `location` becomes a display string ("Austin, TX, USA"), list fields (`job_type`, `emails`, `skills`) become comma-joined strings, enums become their values, and `salary_source` is forced to `direct_data` when pay exists. Rows are sorted by site, then newest first. Empty cells are NaN/None.

## Behaviour that matters for integration

| Topic | Behaviour |
|---|---|
| Errors | Scrapers **never raise** (the `*Exception` classes are deprecated and unused). A failing board logs and sets `scraper.error`; results surface in `df.attrs["errors"]` (`{site: message}`) and `df.attrs["warnings"]` (`{site: [msg]}`). An all-failed run returns an empty frame. |
| Concurrency | One `ThreadPoolExecutor` thread per site; each scraper paginates sequentially. No per-site timing is exposed. |
| Retry / rate limits | Per-scraper; LinkedIn 429 clears in ~1 min; Glassdoor ~2 req/s; most boards cap ~1000 results per search. |
| Proxies | `RotatingProxySession` round-robins the list per board; socks needs `requests[socks]`. |
| Pagination | `offset` + `results_wanted` per board. |
| Description fetching | `fetch_description=True` adds one request per job on boards whose search results lack it (LinkedIn, …). |
| Logging | `jobspy` logger with its own handler; `verbose` sets the level. |
| Salary | Native interval kept unless `enforce_annual_salary` (hourly×2080, etc.). Some boards parse pay out of the description (`salary_source=description`). |
| Remote | `is_remote` is a heuristic per board (title/location keyword on LinkedIn, attributes on Indeed). `False` means "not flagged", not "on-site". |

## Dependencies

`requests`, `beautifulsoup4`, `pandas`, `pydantic>=2.3`, `curl_cffi>=0.16.2`, `markdownify`. Dev: `ruff`, `mypy`, `pandas-stubs`. Python ≥ 3.10.

## Tests, fixtures, env

No unit tests or fixtures upstream. No environment variables. CI builds wheels on 3.10–3.14 and runs ruff + mypy strict.

## How ApplyPilot uses it

`workers/jobspy/worker.py` calls `scrape_jobs()` once per discovery request in an isolated Python 3.12 venv with JobSpy installed **editable from the pinned checkout**, then emits the `applypilot.jobspy.result@1` envelope ([DATA_CONTRACTS.md](DATA_CONTRACTS.md)). Scraper internals are never imported at runtime; only the fixture generator imports `jobspy.model` to build realistic rows.
