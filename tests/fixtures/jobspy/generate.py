"""Regenerate the JobSpy contract fixtures.

    node scripts/run-jobspy-python.mjs tests/fixtures/jobspy/generate.py

Every posting is fictional. Rows are built as real JobSpy ``JobPost`` objects
and serialized with JobSpy's own serializer, then passed through the worker's
cell cleaning, so each fixture has exactly the shape the worker emits for the
pinned JobSpy version. Re-run after a JobSpy upgrade: a contract test that
breaks on the new fixtures is an adapter change to make before pinning it.
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import pandas as pd
from jobspy.model import (
    CompensationInterval,
    Country,
    JobPost,
    JobType,
    Location,
)

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "workers" / "jobspy"))
import worker  # noqa: E402

DESC = (
    "## About the role\n\nBuild production LLM features: RAG pipelines, "
    "tool-calling agents and evaluation harnesses. Python, FastAPI, Postgres.\n\n"
    "**Requirements**\n\n* 2+ years building backend services\n* Experience with LLM APIs"
)

POSTS: dict[str, list[JobPost]] = {
    "linkedin": [
        JobPost(
            id="li-4000000001",
            job_url="https://www.linkedin.com/jobs/view/4000000001",
            job_url_direct="https://boards.greenhouse.io/examplelabs/jobs/7001",
            title="Software Engineer, Applied AI",
            company="Example Labs",
            location=Location(city="San Francisco", state="CA", country=Country.USA),
            date_posted=date(2026, 11, 14),
            job_type=[JobType.FULL_TIME],
            is_remote=False,
            job_level="Entry level",
            company_industry="Software Development",
            description=DESC,
            company_url="https://www.linkedin.com/company/example-labs",
        ),
        JobPost(
            id="li-4000000002",
            job_url="https://www.linkedin.com/jobs/view/4000000002",
            title="Backend Engineer (Remote)",
            company="Northwind Data",
            location=Location(country=Country.USA),
            date_posted=date(2026, 11, 13),
            is_remote=True,
        ),
    ],
    "indeed": [
        JobPost(
            id="in-5e409e577046abcd",
            job_url="https://www.indeed.com/viewjob?jk=5e409e577046abcd",
            job_url_direct="https://careers.contoso.example/jobs/123",
            title="GenAI Engineer",
            company="Contoso Analytics",
            location=Location(city="Austin", state="TX", country=Country.USA),
            date_posted=date(2026, 11, 12),
            job_type=[JobType.FULL_TIME, JobType.CONTRACT],
            interval=CompensationInterval.YEARLY,
            min_amount=140000,
            max_amount=180000,
            currency="USD",
            is_remote=False,
            description=DESC,
            emails=["jobs@contoso.example"],
            company_num_employees="201 to 500",
        ),
    ],
    "glassdoor": [
        JobPost(
            id="gd-1009000000001",
            job_url="https://www.glassdoor.com/job-listing/j?jl=1009000000001",
            title="Full-Stack AI Engineer",
            company="Fabrikam",
            location=Location(city="Seattle", state="WA", country=Country.USA),
            date_posted=date(2026, 11, 10),
            interval=CompensationInterval.HOURLY,
            min_amount=70,
            max_amount=85,
            currency="USD",
            is_remote=True,
            company_rating=4.1,
            company_reviews_count=212,
            description=DESC,
        ),
    ],
    "zip_recruiter": [
        JobPost(
            id="zr-zr0000000001",
            job_url="https://www.ziprecruiter.com/jobs//j?lvk=zr0000000001",
            title="Software Engineer - New Grad",
            company="Tailspin Toys",
            location=Location(city="Santa Monica", state="CA", country=Country.USA),
            date_posted=date(2026, 11, 11),
            job_type=[JobType.FULL_TIME],
            interval=CompensationInterval.YEARLY,
            min_amount=130000,
            max_amount=150000,
            currency="USD",
            description="We offer a hybrid work environment.",
        ),
    ],
    "google": [
        JobPost(
            id="go-AbCdEf0123",
            job_url="https://www.google.com/search?q=ai+engineer&udm=8#vhid=AbCdEf0123",
            title="Machine Learning Engineer",
            company="Wide World Importers",
            location=Location(city="New York", state="NY", country="USA"),
            date_posted=date(2026, 11, 9),
            is_remote=False,
            description="Work on retrieval and ranking.",
        ),
    ],
    "naukri": [
        JobPost(
            id="nk-151125000001",
            job_url="https://www.naukri.com/job-listings-151125000001",
            title="Python Developer - LLM",
            company="Proseware",
            location=Location(city="Pune", country=Country.INDIA),
            date_posted=date(2026, 11, 14),
            is_remote=False,
            work_from_home_type="Hybrid",
            skills=["python", "fastapi", "llm"],
            experience_range="2-5 Yrs",
            vacancy_count=3,
        ),
    ],
    "bayt": [
        JobPost(
            id="bayt-5000001",
            job_url="https://www.bayt.com/en/uae/jobs/ai-engineer-5000001/",
            title="AI Engineer",
            company="Litware",
            location=Location(city="Dubai", country=Country.UNITEDARABEMIRATES),
            is_remote=False,
        ),
    ],
    "bdjobs": [
        JobPost(
            id="bd-1300001",
            job_url="https://jobs.bdjobs.com/jobdetails.asp?id=1300001",
            title="Software Engineer",
            company="Adatum",
            location=Location(city="Dhaka", country="bangladesh"),
            date_posted=date(2026, 11, 8),
        ),
    ],
    "hellowork": [
        JobPost(
            id="hw-60000001",
            job_url="https://www.hellowork.com/fr-fr/emplois/60000001.html",
            title="Ingénieur IA générative",
            company="Woodgrove",
            location=Location(city="Lyon", country=Country.FRANCE),
            date_posted=date(2026, 11, 13),
            is_remote=False,
            description="Concevoir des agents LLM.",
        ),
    ],
}


def records(site: str, posts: list[JobPost]) -> list[dict]:
    rows = [p.model_copy(update={"site": site}).model_dump() for p in posts]
    frame = pd.DataFrame(rows, columns=list(JobPost.model_fields))
    return worker.dataframe_records(frame)


def main() -> None:
    for site, posts in POSTS.items():
        path = HERE / f"{site}.json"
        path.write_text(
            json.dumps(records(site, posts), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"wrote {path.relative_to(HERE.parents[2])}")


if __name__ == "__main__":
    main()
