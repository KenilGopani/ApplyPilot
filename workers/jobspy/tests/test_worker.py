"""Worker tests. They never touch the network: scrape_jobs is replaced by a
fake that returns a DataFrame shaped like JobSpy's real output."""

from __future__ import annotations

import io
import json
import sys
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import worker  # noqa: E402


def fake_frame(rows: list[dict], errors=None, warnings=None) -> pd.DataFrame:
    frame = pd.DataFrame(rows)
    frame.attrs = {"errors": errors or {}, "warnings": warnings or {}}
    return frame


ROWS = [
    {
        "id": "in-abc123",
        "site": "indeed",
        "job_url": "https://www.indeed.com/viewjob?jk=abc123",
        "title": "Backend Engineer",
        "company": "Example Co",
        "date_posted": date(2026, 11, 14),
        "min_amount": float("nan"),
        "is_remote": True,
    },
    {
        "id": "li-1",
        "site": "linkedin",
        "job_url": "https://www.linkedin.com/jobs/view/1",
        "title": "AI Engineer",
        "company": "Example Labs",
        "date_posted": None,
        "min_amount": 150000.0,
        "is_remote": False,
    },
]


class WorkerTests(unittest.TestCase):
    def test_envelope_carries_records_metrics_and_upstream_version(self) -> None:
        calls = []

        def scrape(**kwargs):
            calls.append(kwargs)
            print("noise that must not reach stdout")
            return fake_frame(ROWS, warnings={"indeed": ["easy_apply ignored"]})

        stdout = io.StringIO()
        with mock.patch("sys.stdout", stdout):
            env, code = worker.run(
                {"site_name": ["indeed", "linkedin"], "search_term": "ai", "run_id": "run_t"},
                scrape=scrape,
            )
        self.assertEqual(code, 0)
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(calls[0]["site_name"], ["indeed", "linkedin"])
        self.assertEqual(calls[0]["results_wanted"], 15)
        self.assertEqual(env["version"], worker.VERSION)
        self.assertEqual(env["run_id"], "run_t")
        self.assertEqual(env["metrics"]["returned"], 2)
        self.assertEqual(env["metrics"]["by_site"]["indeed"]["warnings"], ["easy_apply ignored"])
        indeed = env["records"][0]
        self.assertEqual(indeed["date_posted"], "2026-11-14")
        self.assertNotIn("min_amount", indeed)  # NaN dropped, not serialized as NaN
        self.assertNotIn("date_posted", env["records"][1])
        json.dumps(env, allow_nan=False)  # strict JSON

    def test_site_failures_are_reported_not_swallowed(self) -> None:
        env, code = worker.run(
            {"site_name": ["linkedin", "indeed"]},
            scrape=lambda **_: fake_frame(ROWS[:1], errors={"linkedin": "status 429"}),
        )
        self.assertEqual(code, 0)
        self.assertEqual(env["metrics"]["by_site"]["linkedin"]["error"], "status 429")
        self.assertIsNone(env["error"])

        env, code = worker.run(
            {"site_name": ["linkedin"]},
            scrape=lambda **_: fake_frame([], errors={"linkedin": "status 429"}),
        )
        self.assertEqual(code, 2)
        self.assertEqual(env["error"]["code"], "ALL_SOURCES_FAILED")

    def test_invalid_requests_never_scrape(self) -> None:
        def scrape(**_):
            raise AssertionError("scrape must not run")

        for bad in (None, [], {"site_name": []}, {"serch_term": "typo"}):
            env, code = worker.run(bad, scrape=scrape)
            self.assertEqual(code, 1, bad)
            self.assertEqual(env["error"]["code"], "INVALID_REQUEST")

    def test_jobspy_value_errors_and_crashes_are_mapped(self) -> None:
        def invalid(**_):
            raise ValueError("Invalid site_name: 'monster'")

        env, code = worker.run({"site_name": ["monster"]}, scrape=invalid)
        self.assertEqual((code, env["error"]["code"]), (1, "INVALID_REQUEST"))

        def crash(**_):
            raise RuntimeError("boom")

        env, code = worker.run({"site_name": ["indeed"]}, scrape=crash)
        self.assertEqual((code, env["error"]["code"]), (1, "WORKER_CRASHED"))

    def test_proxies_are_redacted_from_the_echoed_request(self) -> None:
        env, _ = worker.run(
            {"site_name": "indeed", "proxies": ["user:secret@host:1"]},
            scrape=lambda **_: fake_frame([]),
        )
        self.assertEqual(env["request"]["proxies"], "<redacted>")
        self.assertNotIn("secret", json.dumps(env))


if __name__ == "__main__":
    unittest.main()
