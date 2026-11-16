"""ApplyPilot JobSpy discovery worker.

Reads one discovery request as JSON on stdin, calls JobSpy's public
``scrape_jobs()`` once, and writes one JSON envelope on stdout:

    {
      "version": "applypilot.jobspy.result@1",
      "run_id": ..., "started_at": ..., "finished_at": ..., "duration_ms": ...,
      "upstream": {"package": "python-jobspy", "version": "1.4.1"},
      "request": {... the request, proxies redacted ...},
      "metrics": {"requested_per_site": n, "returned": n,
                  "by_site": {site: {"returned": n, "error": str|None,
                                     "warnings": [...]}}},
      "records": [ JobSpy rows, NaN cells dropped, dates as YYYY-MM-DD ],
      "error": {"code": ..., "message": ...} | null
    }

Nothing else is ever written to stdout: JobSpy's own logging and any stray
prints are sent to stderr so the envelope stays parseable.

Exit status: 0 when at least one site answered, 2 when every requested site
failed, 1 for an invalid request or an unexpected crash (the envelope is still
written, with ``error`` set).

JobSpy internals are not touched. Only ``jobspy.scrape_jobs`` (its declared
public API, ``__all__``) is called.
"""

from __future__ import annotations

import contextlib
import json
import math
import sys
import time
import uuid
from datetime import date, datetime, timezone
from importlib import metadata
from typing import Any, Callable

VERSION = "applypilot.jobspy.result@1"

# Request keys forwarded to scrape_jobs(). Anything else is rejected so a typo
# can't silently become a no-op filter.
ALLOWED_KEYS = {
    "site_name",
    "search_term",
    "google_search_term",
    "location",
    "distance",
    "is_remote",
    "job_type",
    "easy_apply",
    "results_wanted",
    "country_indeed",
    "proxies",
    "description_format",
    "linkedin_company_ids",
    "offset",
    "hours_old",
    "enforce_annual_salary",
    "verbose",
    "fetch_description",
}
DEFAULT_SITES = ["indeed", "linkedin", "zip_recruiter", "glassdoor"]


class RequestError(ValueError):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def upstream_version() -> str | None:
    try:
        return metadata.version("python-jobspy")
    except metadata.PackageNotFoundError:
        return None


def validate_request(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise RequestError("request must be a JSON object")
    unknown = sorted(set(raw) - ALLOWED_KEYS - {"run_id"})
    if unknown:
        raise RequestError(f"unknown request keys: {', '.join(unknown)}")
    params = {k: v for k, v in raw.items() if k in ALLOWED_KEYS and v is not None}
    sites = params.get("site_name", DEFAULT_SITES)
    if isinstance(sites, str):
        sites = [sites]
    if not isinstance(sites, list) or not sites or not all(
        isinstance(s, str) and s for s in sites
    ):
        raise RequestError("site_name must be a non-empty list of site names")
    params["site_name"] = list(dict.fromkeys(sites))
    params.setdefault("results_wanted", 15)
    params.setdefault("verbose", 1)
    return params


def redacted(params: dict[str, Any]) -> dict[str, Any]:
    shown = dict(params)
    if "proxies" in shown:
        shown["proxies"] = "<redacted>"
    return shown


def clean_cell(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    try:
        import pandas as pd

        if value is pd.NaT:
            return None
        if isinstance(value, pd.Timestamp):
            return value.date().isoformat()
    except ImportError:  # pragma: no cover - pandas is a JobSpy dependency
        pass
    if isinstance(value, (datetime, date)):
        return value.isoformat()[:10]
    if hasattr(value, "item"):  # numpy scalar
        value = value.item()
        if isinstance(value, float) and math.isnan(value):
            return None
    return value


def dataframe_records(frame: Any) -> list[dict[str, Any]]:
    rows = frame.to_dict("records")
    out = []
    for row in rows:
        clean = {str(k): clean_cell(v) for k, v in row.items()}
        out.append({k: v for k, v in clean.items() if v is not None})
    return out


def run(
    raw_request: Any,
    scrape: Callable[..., Any] | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> tuple[dict[str, Any], int]:
    started_at = now_iso()
    start = clock()
    run_id = (
        raw_request.get("run_id") if isinstance(raw_request, dict) else None
    ) or f"run_{uuid.uuid4().hex[:12]}"
    envelope: dict[str, Any] = {
        "version": VERSION,
        "run_id": run_id,
        "started_at": started_at,
        "finished_at": None,
        "duration_ms": None,
        "upstream": {"package": "python-jobspy", "version": upstream_version()},
        "request": None,
        "metrics": {"requested_per_site": 0, "returned": 0, "by_site": {}},
        "records": [],
        "error": None,
    }
    code = 0
    try:
        params = validate_request(raw_request)
        envelope["request"] = redacted(params)
        envelope["metrics"]["requested_per_site"] = params["results_wanted"]
        if scrape is None:
            from jobspy import scrape_jobs as scrape
        with contextlib.redirect_stdout(sys.stderr):
            frame = scrape(**params)
        records = dataframe_records(frame)
        attrs = getattr(frame, "attrs", {}) or {}
        errors: dict[str, str] = attrs.get("errors", {}) or {}
        warnings: dict[str, list[str]] = attrs.get("warnings", {}) or {}
        by_site: dict[str, dict[str, Any]] = {}
        for site in params["site_name"]:
            by_site[site] = {
                "returned": sum(1 for r in records if r.get("site") == site),
                "error": errors.get(site),
                "warnings": list(warnings.get(site, [])),
            }
        envelope["records"] = records
        envelope["metrics"]["by_site"] = by_site
        envelope["metrics"]["returned"] = len(records)
        if by_site and all(s["error"] for s in by_site.values()):
            envelope["error"] = {
                "code": "ALL_SOURCES_FAILED",
                "message": "; ".join(f"{k}: {v['error']}" for k, v in by_site.items()),
            }
            code = 2
    except (RequestError, ValueError) as exc:
        # scrape_jobs raises ValueError for invalid arguments (documented).
        envelope["error"] = {"code": "INVALID_REQUEST", "message": str(exc)}
        code = 1
    except Exception as exc:  # noqa: BLE001 - reported, never swallowed
        envelope["error"] = {
            "code": "WORKER_CRASHED",
            "message": f"{type(exc).__name__}: {exc}",
        }
        code = 1
    envelope["finished_at"] = now_iso()
    envelope["duration_ms"] = round((clock() - start) * 1000)
    return envelope, code


def main() -> int:
    try:
        raw = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        envelope, _ = run(None)  # fails validation; never scrapes
        envelope["error"] = {"code": "INVALID_REQUEST", "message": f"stdin: {exc}"}
        code = 1
    else:
        envelope, code = run(raw)
    sys.stdout.write(json.dumps(envelope, ensure_ascii=False, default=str) + "\n")
    sys.stdout.flush()
    return code


if __name__ == "__main__":
    sys.exit(main())
