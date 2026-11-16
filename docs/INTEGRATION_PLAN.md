# ApplyPilot — Integration Plan

## Product Identity

**Product name:** ApplyPilot

**GitHub repository:** `KenilGopani/ApplyPilot`

**One-line description:**  
ApplyPilot is a local-first AI-powered job discovery, evaluation, resume intelligence, application preparation, and tracking platform built by combining JobSpy, Career Ops, and the existing Rolecraft/KenilJobBoard workspace.

---

## Repository Name

**Recommended:** `ApplyPilot`

Why:
- Reuses the existing Rolecraft identity from KenilJobBoard.
- Clearly represents the new unified platform rather than only the dashboard.
- Leaves `KenilJobBoard`, `JobSpy`, and `career-ops` as distinct source projects.
- Works well if the project later grows beyond job scraping into resume intelligence, outreach, analytics, and automation.

Suggested GitHub repository:

```text
KenilGopani/ApplyPilot
```

Alternative names:
- `rolecraft-engine`
- `rolecraft-os`
- `career-intelligence-platform`
- `job-search-os`

`ApplyPilot` is preferred.

---

# 1. Goal

Build a local-first job-search platform that combines:

1. **JobSpy**
   - High-volume job discovery.
   - LinkedIn, Indeed, Glassdoor, ZipRecruiter, and other supported sources.
   - Preserve the upstream JobSpy implementation instead of rewriting its scrapers.

2. **Career Ops**
   - ATS/company portal discovery.
   - Candidate profile.
   - Job evaluation.
   - Resume/JD matching.
   - Apply/skip recommendations.
   - Resume tailoring workflows.
   - Company/contact research.
   - Application preparation.
   - Pipeline intelligence.
   - Preserve Career Ops behavior and data contracts before replacing anything.

3. **KenilJobBoard / Rolecraft**
   - Main UI.
   - Main application dashboard.
   - Resume workspace.
   - Application CRM.
   - Follow-ups.
   - Interviews.
   - Analytics.
   - Main user-facing product.

The new platform should use JobSpy and Career Ops as engines behind Rolecraft.

---

# 2. Core Integration Principle

Do **not** begin by copying source files from JobSpy or Career Ops into Rolecraft.

Initial architecture:

```text
                    APPLYPILOT

                  +-------------------+
                  |    Rolecraft UI   |
                  |  KenilJobBoard    |
                  +---------+---------+
                            |
                      Platform API
                            |
             +--------------+--------------+
             |                             |
      JobSpy Adapter               Career Ops Adapter
             |                             |
             v                             v
          JobSpy                      Career Ops
        upstream                       upstream
        preserved                      preserved
```

The first version should **compose** the systems rather than rewrite them.

Only absorb or replace internals after:
- the original behavior is documented,
- existing tests pass,
- adapter contract tests pass,
- end-to-end regression tests pass.

---

# 3. Local Workspace Structure

Create one parent directory locally:

```text
kenil-career-platform/
|
+-- sources/
|   +-- JobSpy/
|   +-- career-ops/
|   +-- KenilJobBoard/
|
+-- ApplyPilot/
|
+-- runtime/
|   +-- career-ops-data/
|   +-- jobspy-cache/
|   +-- logs/
|
+-- docs/
|   +-- INVENTORY.md
|   +-- CAPABILITY_MATRIX.md
|   +-- DEPENDENCY_MAP.md
|   +-- DATA_CONTRACTS.md
|   +-- INTEGRATION_MAP.md
|   +-- MIGRATION_PLAN.md
|   +-- TEST_MATRIX.md
|
+-- scripts/
    +-- verify-sources.sh
```

The three source repositories remain independent.

The new GitHub repository is:

```text
ApplyPilot/
```

---

# 4. Git Strategy

Use small modular commits.

Rules:

- One logical change per commit.
- Do not mix refactors and feature work.
- Do not modify upstream source repos unless absolutely necessary.
- Never commit secrets.
- Never commit personal resume/application data.
- Commit generated integration documentation separately.
- Every major phase should end in a working state.
- Every integration phase must have tests before moving forward.

Recommended commit prefixes:

```text
chore:
docs:
feat:
fix:
refactor:
test:
build:
ci:
```

Examples:

```text
chore: initialize ApplyPilot workspace
docs: add source repository inventory
feat: add canonical job schema
feat: add jobspy discovery adapter
test: add jobspy adapter contract tests
feat: add career ops evaluation adapter
feat: persist discovered jobs in rolecraft
fix: preserve source provenance during deduplication
```

---

# PHASE 0 — Freeze and Baseline All Three Repositories

## Objective

Establish a reproducible starting point before integration.

## Tasks

Clone:

```text
JobSpy
career-ops
KenilJobBoard
```

Record for each:

- repository URL,
- current branch,
- exact commit SHA,
- runtime version,
- package manager,
- lockfile,
- install command,
- test command,
- build command,
- environment variables,
- local database requirements,
- generated files,
- ignored files.

Create:

```text
docs/SOURCE_VERSIONS.md
```

Example:

```text
JobSpy
commit: <sha>

career-ops
commit: <sha>

KenilJobBoard
commit: <sha>
```

Run each project independently before integration.

All existing tests must pass or known failures must be documented.

## Commits

```text
chore: initialize ApplyPilot repository
docs: record upstream repository versions
docs: document local runtime requirements
test: record baseline source test results
```

---

# PHASE 1 — Full Source Code Inventory

## Objective

Understand all three codebases before integrating anything.

## JobSpy Audit

Document:

- public APIs,
- scraper entry points,
- supported sites,
- scraper classes/modules,
- models,
- enums,
- result schema,
- error behavior,
- retry behavior,
- proxy behavior,
- pagination,
- concurrency,
- rate-limit assumptions,
- job-description fetching,
- dependencies,
- test fixtures,
- environment variables,
- CLI/API interfaces if present.

Create:

```text
docs/jobspy-inventory.md
```

Do not modify JobSpy yet.

## Career Ops Audit

Document:

- entry points,
- CLI commands,
- modes,
- agents,
- job scanners,
- portal scanners,
- providers,
- evaluation logic,
- batch workflows,
- profile format,
- work-authorization logic,
- resume inputs,
- pipeline formats,
- job data formats,
- reports,
- PDF generation,
- application preparation,
- company research,
- contact research,
- outreach,
- interview preparation,
- deduplication,
- analytics,
- scripts,
- tests,
- external-data-directory support,
- environment variables,
- model-provider integrations,
- optional local-model support.

Create:

```text
docs/career-ops-inventory.md
```

Do not rewrite Career Ops.

## KenilJobBoard / Rolecraft Audit

Document:

- application architecture,
- React components,
- API routes,
- D1 schema,
- Drizzle schema,
- migrations,
- validation schemas,
- job model,
- resume model,
- application stages,
- recruiter model,
- follow-up model,
- backup/restore format,
- authentication,
- existing tests,
- API tests,
- build/deploy behavior.

Create:

```text
docs/rolecraft-inventory.md
```

## Commits

```text
docs: add jobspy codebase inventory
docs: add career ops codebase inventory
docs: add rolecraft codebase inventory
docs: add dependency and runtime map
```

---

# PHASE 2 — Capability Ownership Matrix

## Objective

Decide which system owns each capability.

Create:

```text
docs/CAPABILITY_MATRIX.md
```

Initial ownership:

| Capability | JobSpy | Career Ops | Rolecraft | Final Owner |
|---|---:|---:|---:|---|
| LinkedIn discovery | Yes | Maybe | No | JobSpy |
| Indeed discovery | Yes | No/limited | No | JobSpy |
| Glassdoor discovery | Yes | No/limited | No | JobSpy |
| ZipRecruiter discovery | Yes | No/limited | No | JobSpy |
| Greenhouse discovery | No | Yes | No | Career Ops |
| Lever discovery | No | Yes | No | Career Ops |
| Ashby discovery | No | Yes | No | Career Ops |
| Company portal discovery | No | Yes | No | Career Ops |
| Normalize jobs | No | Partial | Partial | Platform |
| Deduplicate jobs | Partial | Yes | Partial | Platform |
| Hard filtering | Partial | Yes | Partial | Platform |
| JD evaluation | No | Yes | Basic | Career Ops |
| Candidate profile | No | Yes | Partial | Platform |
| Resume evidence | No | Yes | Yes | Career Ops + Rolecraft |
| Resume routing | No | Partial | No | Platform |
| Resume tailoring | No | Yes | Partial | Career Ops |
| Application tracking | No | Yes | Yes | Rolecraft |
| Follow-ups | No | Yes | Yes | Rolecraft |
| Recruiter outreach | No | Yes | Yes | Rolecraft |
| Analytics | No | Yes | Yes | Rolecraft |
| Main UI | No | Optional | Yes | Rolecraft |

## Commit

```text
docs: define capability ownership across integrated systems
```

---

# PHASE 3 — Define Platform Boundaries

## Objective

Prevent tight coupling.

Create four major boundaries:

```text
Discovery
Normalization
Evaluation
Product
```

Architecture:

```text
DISCOVERY
   |
   +-- JobSpy
   +-- Career Ops scanners
   |
   v
NORMALIZATION
   |
   v
CanonicalJob
   |
   v
FILTERING
   |
   v
EVALUATION
   |
   +-- Career Ops
   |
   v
ROLECRAFT
```

## Commit

```text
docs: define platform service boundaries
```

---

# PHASE 4 — Canonical Job Schema

## Objective

Do not force Rolecraft to understand every JobSpy/Career Ops internal format.

Create a platform-level job schema.

Example:

```ts
interface CanonicalJob {
  id: string;

  externalId?: string;

  title: string;
  company: string;

  location?: string;

  remoteType:
    | "remote"
    | "hybrid"
    | "onsite"
    | "unknown";

  description?: string;

  source:
    | "linkedin"
    | "indeed"
    | "glassdoor"
    | "ziprecruiter"
    | "google"
    | "greenhouse"
    | "lever"
    | "ashby"
    | "wellfound"
    | "company"
    | "manual"
    | "other";

  sourceUrl: string;

  postedAt?: string;

  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;

  employmentType?: string;

  discoveredAt: string;

  rawSource?: unknown;
}
```

Also define:

```text
CanonicalJobSource
CanonicalJobEvaluation
CanonicalJobRequirement
CanonicalResumeEvidence
CanonicalApplicationDecision
```

Store raw upstream data for traceability.

## Commits

```text
feat: add canonical job domain schema
feat: add canonical job source metadata model
test: add canonical job schema validation tests
```

---

# PHASE 5 — Build the New Integration Repository Structure

Recommended structure:

```text
ApplyPilot/
|
+-- apps/
|   +-- web/
|
+-- services/
|   +-- discovery/
|   +-- ingestion/
|   +-- evaluation/
|   +-- scheduler/
|
+-- workers/
|   +-- jobspy/
|
+-- adapters/
|   +-- jobspy/
|   +-- career-ops/
|
+-- packages/
|   +-- job-schema/
|   +-- candidate-profile/
|   +-- config/
|   +-- scoring/
|   +-- logging/
|
+-- runtime/
|
+-- tests/
|   +-- contracts/
|   +-- integration/
|   +-- e2e/
|
+-- docs/
```

Do not move KenilJobBoard code into the new repo until its build/tests are understood.

## Commits

```text
chore: scaffold ApplyPilot modules
build: add shared development configuration
test: add platform smoke test
```

---

# PHASE 6 — JobSpy Adapter

## Objective

Integrate JobSpy without rewriting it.

Preferred approach:

```text
Python worker
    |
    v
JobSpy scrape_jobs()
    |
    v
JobSpy Adapter
    |
    v
CanonicalJob[]
```

During development, use the source checkout as an editable/local dependency if appropriate.

The adapter must:

- call JobSpy's supported public interface,
- preserve site/source metadata,
- preserve raw output,
- translate JobSpy results into `CanonicalJob`,
- map errors into platform errors,
- avoid silently swallowing scraper failures,
- expose metrics:
  - jobs requested,
  - jobs returned,
  - source,
  - duration,
  - errors.

Do not edit scraper internals unless an integration blocker is proven.

## Tests

Create fixed fixtures for:

```text
LinkedIn
Indeed
Glassdoor
ZipRecruiter
Google
other supported JobSpy sources
```

Test:

```text
JobSpy result -> adapter -> CanonicalJob
```

## Commits

```text
feat: add python jobspy discovery worker
feat: add jobspy canonical job adapter
test: add jobspy adapter contract fixtures
test: add jobspy discovery integration tests
```

---

# PHASE 7 — First Working MVP: JobSpy -> Rolecraft

## Objective

Get automated job discovery visible in Rolecraft before adding Career Ops.

Pipeline:

```text
JobSpy
  |
  v
CanonicalJob[]
  |
  v
Rolecraft persistence
  |
  v
Rolecraft Jobs Inbox
```

Add a "Discovered Jobs" inbox separate from application stages.

Possible statuses:

```text
new
review
saved
skip
applied
```

Do not automatically treat every discovered job as an application.

## Commits

```text
feat: persist discovered jobs in rolecraft
feat: add discovered jobs inbox
feat: add source provenance to job records
test: add discovery-to-rolecraft integration test
```

---

# PHASE 8 — Career Ops Adapter

## Objective

Integrate Career Ops as an engine, not by copying random internals.

Initially preserve Career Ops's own runtime/data directory.

Example:

```text
runtime/
+-- career-ops-data/
    +-- config/
    +-- data/
    +-- reports/
    +-- jds/
    +-- output/
```

Keep its source code in:

```text
sources/career-ops/
```

Create adapter operations such as:

```text
scan_portals()
evaluate_job()
prepare_application()
tailor_resume()
research_company()
research_contacts()
verify_pipeline()
```

Only expose a capability after its native behavior and output format are understood.

## Commits

```text
feat: add career ops runtime adapter
feat: add isolated career ops data directory
test: add career ops adapter smoke tests
```

---

# PHASE 9 — Career Ops Discovery Integration

## Objective

Combine JobSpy discovery with Career Ops portal scanning.

Pipeline:

```text
              Discovery Request

              +-------------+
              |             |
              v             v
           JobSpy      Career Ops
              |        Portal Scan
              |             |
              +------+------+
                     |
                     v
                 CanonicalJob
```

Career Ops scanner results must pass through their own adapter.

Never let raw Career Ops records directly enter Rolecraft.

## Commits

```text
feat: add career ops portal discovery adapter
feat: merge discovery streams into canonical ingestion pipeline
test: add multi-source discovery integration tests
```

---

# PHASE 10 — Deduplication Engine

## Objective

Avoid duplicates across:

```text
LinkedIn
Indeed
Glassdoor
ZipRecruiter
Greenhouse
Lever
Ashby
company sites
```

Use multiple signals.

Priority:

1. exact canonical URL,
2. ATS job ID,
3. external job ID,
4. normalized company + normalized title + location,
5. normalized company + normalized title,
6. description fingerprint/similarity.

Never discard provenance.

Example:

```json
{
  "canonicalJobId": "job_123",
  "sources": [
    {
      "provider": "linkedin",
      "url": "..."
    },
    {
      "provider": "greenhouse",
      "url": "..."
    }
  ]
}
```

## Commits

```text
feat: add canonical job deduplication engine
feat: preserve multi-source job provenance
test: add cross-source deduplication fixtures
```

---

# PHASE 11 — Hard Filters

## Objective

Filter cheaply before using AI/model-based evaluation.

Possible filters:

```text
country
location
remote/hybrid/onsite
career level
required years of experience
role family
employment type
sponsorship
work authorization
salary if available
excluded companies
excluded keywords
stale job age
```

Never infer sponsorship status when it is not present.

Use statuses such as:

```text
compatible
incompatible
unknown
manual-review
```

Pipeline:

```text
Discovered
   |
   v
Normalized
   |
   v
Deduplicated
   |
   v
Hard Filters
   |
   +--> rejected
   |
   v
Evaluation Queue
```

## Commits

```text
feat: add configurable hard-filter pipeline
feat: add work authorization review states
test: add hard-filter decision tests
```

---

# PHASE 12 — Candidate Profile

## Objective

Create one candidate profile used by the platform.

Store:

```text
target role families
career level
skills
resume families
locations
remote preferences
work authorization rules
sponsorship requirement
excluded roles
preferred companies
experience boundaries
```

Example role families:

```text
Applied AI Engineer
GenAI / LLM Engineer
Backend Software Engineer
Full-Stack AI Engineer
Software Engineer
```

Avoid duplicating candidate configuration independently in multiple systems.

Initially sync required values into Career Ops rather than deleting Career Ops's native profile format.

## Commits

```text
feat: add canonical candidate profile
feat: add career ops candidate profile mapper
test: add candidate profile mapping tests
```

---

# PHASE 13 — Career Ops Evaluation Engine

## Objective

Use Career Ops to evaluate jobs that survive hard filtering.

Pipeline:

```text
CanonicalJob
   |
   v
Career Ops Evaluation
   |
   v
CanonicalJobEvaluation
```

Evaluation should produce structured information such as:

```text
overall score
apply / review / skip
matched requirements
missing requirements
resume evidence
work authorization signal
role classification
confidence
recommended resume
evaluation explanation
```

Do not allow unsupported claims.

Each matched skill/requirement should point to resume/profile evidence where possible.

## Commits

```text
feat: add career ops job evaluation pipeline
feat: map career ops evaluations to canonical schema
test: add evaluation contract fixtures
```

---

# PHASE 14 — Resume Router

## Objective

Automatically select the best resume family.

Possible families:

```text
Core Software Engineer
Applied AI Engineer
Full-Stack AI / Hybrid
```

Initial decision logic:

```text
Role Classification
        |
        +-- Backend / SWE -> Core
        |
        +-- Applied AI / LLM -> Applied AI
        |
        +-- AI + product/full-stack -> Hybrid
```

The router should produce:

```text
recommended resume
confidence
reason
alternative resume
```

Do not automatically rewrite the resume yet.

## Commits

```text
feat: add resume family router
test: add resume routing decision fixtures
```

---

# PHASE 15 — Evidence-Based Tailoring

## Objective

Tailor safely without inventing experience.

Generate recommendations such as:

```text
move project higher
surface relevant experience
reorder skills
adjust summary
emphasize matching technologies
remove low-value content
```

Rules:

- Never fabricate experience.
- Never fabricate metrics.
- Never modify verified numbers automatically.
- Missing evidence should remain missing.
- Preserve canonical/base resumes.
- Tailored versions must be separate versions.

## Commits

```text
feat: add evidence-based tailoring recommendations
feat: add resume version tracking
test: prevent unsupported resume claims
```

---

# PHASE 16 — Rolecraft Becomes the Product System of Record

## Objective

Use Rolecraft as the primary user-facing database.

Possible entities:

```text
jobs
job_sources
job_requirements
job_evaluations
search_runs
applications
resumes
resume_versions
contacts
outreach
followups
interviews
activity_events
```

Important:

Do **not** remove Career Ops native files immediately.

For now:

```text
Career Ops files
       +
Rolecraft DB
```

Rolecraft is the product system of record.

Career Ops retains its own native runtime data until migration is proven safe.

## Commits

```text
feat: add platform persistence schema
feat: add evaluation persistence
feat: add search run history
test: add persistence round-trip tests
```

---

# PHASE 17 — Rolecraft UI Integration

Add UI sections such as:

```text
Dashboard
Discovered Jobs
Priority Queue
Applications
Resume Studio
Recruiters
Follow-Ups
Interviews
Analytics
Settings
Search Runs
```

Example job inbox:

```text
Anthropic
Software Engineer, Applied AI

Match: 94%
Track: Applied AI
Posted: 5h ago
Source: LinkedIn + company ATS
Resume: Applied AI
Authorization: Review

Strengths:
- Python
- FastAPI
- RAG
- agents

Gap:
- PyTorch

[Review] [Prepare] [Skip]
```

## Commits

```text
feat: add discovery dashboard
feat: add job evaluation detail view
feat: add priority application queue
feat: add search run history view
test: add rolecraft discovery ui tests
```

---

# PHASE 18 — Application Preparation

For strong-fit jobs, expose:

```text
tailoring priorities
resume choice
company research
recruiter research
application questions
cover letter if needed
outreach draft
```

Human review remains mandatory before submission.

No automatic submission in the initial platform.

## Commits

```text
feat: add application preparation workspace
feat: add recruiter outreach drafts
feat: add application answer workspace
test: add application preparation regression tests
```

---

# PHASE 19 — Follow-Ups and Pipeline Automation

Possible workflow:

```text
Applied
  |
  +-- follow-up due
  |
  +-- recruiter response
  |
  +-- screening
  |
  +-- interview
  |
  +-- offer/rejected
```

Rolecraft remains the main UI.

Career Ops can provide intelligence, but platform state belongs to Rolecraft.

## Commits

```text
feat: add application follow-up scheduling
feat: add pipeline activity timeline
feat: add interview stage tracking
test: add application lifecycle tests
```

---

# PHASE 20 — Analytics

Track:

```text
applications by role family
applications by source
response rate
recruiter-screen rate
interview rate
offer rate
resume-family conversion
source conversion
company-site vs easy-apply conversion
score vs outcome
time-to-response
```

Analytics should help answer:

```text
Which role family converts best?
Which resume performs best?
Which job source performs best?
Are 5/5 matches actually converting?
Should application volume be shifted?
```

## Commits

```text
feat: add application funnel analytics
feat: add source conversion analytics
feat: add resume performance analytics
test: add analytics aggregation tests
```

---

# PHASE 21 — Scheduler

Add local scheduled discovery.

Possible cadence:

```text
morning search
afternoon refresh
manual run
```

The scheduler should invoke discovery without changing application decisions automatically.

Store:

```text
started_at
completed_at
sources
queries
jobs_found
jobs_new
jobs_duplicate
jobs_filtered
jobs_evaluated
errors
```

## Commits

```text
feat: add local discovery scheduler
feat: persist scheduled search runs
test: add scheduler execution tests
```

---

# PHASE 22 — Platform Verification Command

Create one command:

```text
npm run verify:integration
```

It should verify:

1. JobSpy source exists.
2. JobSpy imports successfully.
3. JobSpy tests pass.
4. Career Ops source exists.
5. Career Ops installation is valid.
6. Career Ops native tests pass.
7. Career Ops health/doctor checks pass if available.
8. KenilJobBoard/Rolecraft tests pass.
9. Platform schema tests pass.
10. JobSpy adapter tests pass.
11. Career Ops adapter tests pass.
12. Deduplication tests pass.
13. Candidate profile mapping passes.
14. End-to-end fixture pipeline passes.

Fail fast if any layer breaks.

## Commits

```text
test: add full platform verification command
ci: run integration verification on pull requests
```

---

# PHASE 23 — Regression Fixtures

Create stable fixtures:

```text
tests/fixtures/
|
+-- jobs/
|   +-- linkedin.json
|   +-- indeed.json
|   +-- glassdoor.json
|   +-- ziprecruiter.json
|   +-- greenhouse.json
|   +-- lever.json
|   +-- ashby.json
|
+-- evaluations/
|   +-- strong-match.json
|   +-- medium-match.json
|   +-- reject.json
|
+-- resumes/
    +-- core.txt
    +-- applied-ai.txt
```

Use synthetic or sanitized data.

Never commit personal data.

## Commits

```text
test: add sanitized cross-source regression fixtures
test: add end-to-end discovery evaluation fixture
```

---

# PHASE 24 — Logging and Observability

Every pipeline run should log:

```text
run id
source
query
start time
end time
jobs found
jobs normalized
duplicates
filtered
evaluated
failures
duration
```

Each job should maintain provenance.

Do not log secrets, resume contents, API tokens, or sensitive personal data.

## Commits

```text
feat: add structured platform logging
feat: add discovery run metrics
test: verify sensitive fields are excluded from logs
```

---

# PHASE 25 — Configuration and Secrets

Provide:

```text
.env.example
```

Never commit `.env`.

Separate:

```text
platform config
JobSpy config
Career Ops config
model-provider config
candidate profile
search preferences
```

Support local overrides.

## Commits

```text
chore: add safe environment configuration
docs: document local configuration
test: validate required environment settings
```

---

# PHASE 26 — Local-First Runtime

The whole development stack should run locally.

Expected layout:

```text
Rolecraft Web
    |
    v
Platform Backend
    |
    +-------------------+
    |                   |
    v                   v
JobSpy Worker       Career Ops
Python              Node/Agent
    |                   |
    +---------+---------+
              |
              v
        Local Database
```

Internet access is needed for:
- job sites,
- ATS pages,
- external LLM APIs if used.

A local model may be used where Career Ops supports it.

## Commit

```text
docs: document local-first runtime architecture
```

---

# PHASE 27 — Local Developer Command

Target experience:

```bash
npm run dev
```

or:

```bash
./scripts/dev.sh
```

should start:

```text
Rolecraft UI
Platform API
JobSpy worker
Career Ops integration
local database
```

If one process fails, startup should report it clearly.

## Commits

```text
build: add unified local development command
build: add local service health checks
```

---

# PHASE 28 — Source Preservation Guardrails

Before modifying JobSpy or Career Ops source code:

1. Document why the adapter cannot solve the issue.
2. Add a failing regression test.
3. Create a separate integration branch.
4. Make the smallest possible patch.
5. Run upstream tests.
6. Run platform tests.
7. Record the change in:

```text
docs/UPSTREAM_PATCHES.md
```

Never silently fork upstream behavior.

## Commits

```text
docs: add upstream modification policy
test: add source preservation guard checks
```

---

# PHASE 29 — Upstream Update Strategy

Periodically update source repositories.

Process:

```text
fetch upstream
    |
    v
inspect changes
    |
    v
run native tests
    |
    v
run adapter contract tests
    |
    v
run platform verification
    |
    v
update pinned commit
```

Never automatically pull new upstream code directly into production behavior.

## Commits

```text
docs: add upstream update procedure
build: add source version verification script
```

---

# PHASE 30 — Only Then Consider Consolidation

Once the adapter-based platform is stable, evaluate whether any upstream functionality should be absorbed.

Candidate reasons:

- upstream project becomes unmaintained,
- integration overhead is too high,
- required capability cannot be extended safely,
- a small module can be replaced without losing behavior.

Before absorption:

```text
inventory
tests
fixtures
behavior comparison
migration plan
rollback plan
```

Never consolidate only to make the repository look cleaner.

Stable composition is preferable to a fragile rewrite.

## Commit

```text
docs: define future consolidation criteria
```

---

# Development Milestones

## Milestone 1 — Baseline

Success criteria:

- all three repos cloned,
- exact SHAs recorded,
- tests run,
- inventories complete.

## Milestone 2 — JobSpy Integration

Success criteria:

```text
JobSpy
 -> CanonicalJob
 -> Rolecraft
```

works locally.

## Milestone 3 — Multi-Source Discovery

Success criteria:

```text
JobSpy
+
Career Ops scanners
 -> canonical ingestion
 -> deduplication
 -> Rolecraft
```

works.

## Milestone 4 — Intelligent Evaluation

Success criteria:

```text
job
 -> hard filters
 -> Career Ops evaluation
 -> resume router
 -> Rolecraft
```

works.

## Milestone 5 — Application Workspace

Success criteria:

```text
discover
 -> evaluate
 -> prepare
 -> human review
 -> application tracking
```

works.

## Milestone 6 — Analytics and Scheduling

Success criteria:

```text
scheduled discovery
+
application outcomes
+
conversion analytics
```

work locally.

---

# Recommended Initial Commit Sequence

The first commits should be approximately:

```text
1.  chore: initialize ApplyPilot repository
2.  docs: add architecture and integration plan
3.  docs: record upstream source versions
4.  docs: add jobspy codebase inventory
5.  docs: add career ops codebase inventory
6.  docs: add rolecraft codebase inventory
7.  docs: define capability ownership matrix
8.  feat: add canonical job domain schema
9.  test: add canonical job validation tests
10. chore: scaffold discovery and adapter modules
11. feat: add python jobspy discovery worker
12. feat: add jobspy canonical adapter
13. test: add jobspy adapter contract fixtures
14. feat: persist discovered jobs in rolecraft
15. feat: add discovered jobs inbox
16. test: add discovery-to-rolecraft integration test
17. feat: add career ops runtime adapter
18. test: add career ops adapter smoke tests
19. feat: add career ops portal discovery adapter
20. feat: merge discovery sources
21. feat: add canonical deduplication engine
22. test: add cross-source deduplication tests
23. feat: add hard-filter pipeline
24. feat: add canonical candidate profile
25. feat: add career ops evaluation pipeline
26. test: add evaluation contract tests
27. feat: add resume family router
28. feat: add evidence-based tailoring recommendations
29. feat: add priority job queue
30. feat: add application preparation workspace
31. feat: add application funnel analytics
32. feat: add local discovery scheduler
33. test: add full platform verification command
34. ci: run integration verification on pull requests
35. docs: document complete local workflow
```

Each commit should pass the relevant tests before the next commit is created.

---

# Branch Strategy

Recommended:

```text
main
|
+-- feat/source-audit
+-- feat/jobspy-adapter
+-- feat/rolecraft-ingestion
+-- feat/career-ops-adapter
+-- feat/deduplication
+-- feat/evaluation
+-- feat/resume-router
+-- feat/application-workspace
+-- feat/analytics
```

Keep branches small.

Merge only after:

```text
native tests pass
platform tests pass
integration verification passes
```

---

# Pull Request Template

Each PR should include:

```text
## What changed

## Why

## Source systems affected
- [ ] JobSpy
- [ ] Career Ops
- [ ] Rolecraft
- [ ] Platform only

## Upstream source modified?
- [ ] No
- [ ] Yes — documented in UPSTREAM_PATCHES.md

## Tests
- [ ] Native source tests
- [ ] Unit tests
- [ ] Contract tests
- [ ] Integration tests
- [ ] End-to-end test

## Data migration required?
- [ ] No
- [ ] Yes

## Rollback plan

## Screenshots / logs if relevant
```

---

# Definition of Done for Every Phase

A phase is complete only when:

```text
code works locally
tests pass
existing behavior is preserved
documentation is updated
no secrets are committed
no personal data is committed
commit is modular
commit message describes one logical change
rollback is possible
```

---

# Final Target Architecture

```text
                      APPLYPILOT
                              |
                  +-----------+-----------+
                  |                       |
                  v                       v
             Rolecraft UI            Platform API
                                          |
                      +-------------------+-------------------+
                      |                                       |
                      v                                       v
               Discovery Service                       Evaluation Service
                      |                                       |
             +--------+--------+                              |
             |                 |                              |
             v                 v                              v
          JobSpy         Career Ops Scanner              Career Ops
             |                 |                         Evaluation
             +--------+--------+                              |
                      |                                       |
                      v                                       |
                 Canonical Jobs                               |
                      |                                       |
                      v                                       |
                 Deduplication                                |
                      |                                       |
                      v                                       |
                  Hard Filters                                |
                      |                                       |
                      +----------------+----------------------+
                                       |
                                       v
                                  Resume Router
                                       |
                                       v
                              Application Preparation
                                       |
                                       v
                                Rolecraft Database
                                       |
                    +------------------+------------------+
                    |                  |                  |
                    v                  v                  v
                Pipeline           Follow-Ups          Analytics
```

---

# Non-Negotiable Safety Rules

1. Do not rewrite JobSpy scrapers during initial integration.
2. Do not delete Career Ops data structures before mapping them.
3. Do not merge databases before contract tests exist.
4. Do not let an LLM invent resume evidence.
5. Do not automatically submit applications.
6. Do not commit API keys.
7. Do not commit personal job-search data.
8. Do not upgrade upstream dependencies casually during integration.
9. Do not modify multiple source systems in the same commit unless unavoidable.
10. Always preserve raw source/provenance data.
11. Always keep rollback possible.
12. Every integration step must be testable independently.

---

# First Execution Task

When development begins, the coding agent should **not immediately implement features**.

Its first task should be:

```text
1. Recursively inspect all three source repositories.
2. Record their exact commit SHAs.
3. Identify all runtime and dependency requirements.
4. Run all native tests/builds.
5. Produce the three repository inventories.
6. Produce the capability matrix.
7. Produce the dependency/data-contract map.
8. Report any conflicts or risks.
9. Do not modify upstream source code.
10. Commit only documentation and scaffolding.
```

Only after that audit passes should implementation begin.

---

# Expected End Result

From one local environment:

```text
Discover jobs automatically
        |
        v
Combine JobSpy + Career Ops sources
        |
        v
Normalize
        |
        v
Deduplicate
        |
        v
Filter
        |
        v
Evaluate against candidate profile
        |
        v
Choose resume
        |
        v
Generate evidence-based tailoring priorities
        |
        v
Show jobs in Rolecraft
        |
        v
Prepare application
        |
        v
Human review + submit
        |
        v
Track application
        |
        v
Follow up
        |
        v
Analyze outcomes
```

All major components run locally, while internet access is used only where required for job sites, ATS sources, and optional external model APIs.
