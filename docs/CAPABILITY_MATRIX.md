# Capability ownership

Built from the three inventories. "Final owner" is who ApplyPilot calls for that capability; "Platform" means ApplyPilot's own packages.

| Capability | JobSpy | Career Ops | Rolecraft | Final owner | Notes |
|---|---|---|---|---|---|
| LinkedIn discovery | Yes | Partial (imports saved LinkedIn alert emails, `linkedin-watch.mjs`; no search) | No | JobSpy | Alert import can feed the same pipeline later |
| Indeed discovery | Yes | No | No | JobSpy | |
| Glassdoor discovery | Yes | No | No | JobSpy | |
| ZipRecruiter discovery | Yes | No | No | JobSpy | |
| Google Jobs | Broken upstream | No | No | — | Disabled until JobSpy fixes it |
| Regional boards (Naukri, Bayt, BDJobs, HelloWork) | Yes | Some regional providers | No | JobSpy | Mapped to source `other` |
| Greenhouse / Lever / Ashby / Workday / … | No | Yes (142 providers) | No | Career Ops | |
| Company portal discovery | No | Yes (`portals.yml`, `discover-ats.mjs`) | No | Career Ops | |
| Liveness checking | No | Yes | No | Career Ops | Before spending evaluation budget |
| Normalize jobs | Partial (JobPost) | Partial (pipeline/scan-history rows) | Partial (Job) | Platform | `CanonicalJob` |
| Deduplicate jobs | No | Yes (within its own files) | No | Platform | Cross-source, keeps provenance |
| Hard filtering | Partial (query params) | Yes (title/location/age/salary/visa/blacklist) | No | Platform | Reuse Career Ops' rules as reference |
| JD evaluation | No | Yes (LLM, 1–5, A–H report) | Basic (keyword topics) | Career Ops | Rolecraft matcher stays as the cheap pre-check |
| Candidate profile | No | Yes (rich) | Partial (one resume) | Platform | Synced into Career Ops' native files |
| Resume evidence | No | Yes (per-requirement in reports) | Yes (topic evidence) | Career Ops + Rolecraft | Evidence must be verbatim |
| Resume routing | No | Partial (archetypes) | No | Platform | |
| Resume tailoring | No | Yes | Priorities only | Career Ops | Never invents experience |
| Application preparation | No | Yes | No | Career Ops | Exposed through Rolecraft UI |
| Company / contact research | No | Yes | No | Career Ops | |
| Application tracking | No | Yes (markdown tracker) | Yes | Rolecraft | Rolecraft is the system of record |
| Follow-ups | No | Yes | Yes (dates + ICS) | Rolecraft | |
| Recruiter outreach | No | Yes | Yes (templates) | Rolecraft | Career Ops can draft; never sent automatically |
| Interviews | No | Yes (prep, debrief) | Stage only | Rolecraft (state), Career Ops (prep) | |
| Analytics | No | Yes | Basic | Rolecraft | |
| Scheduling | No | Yes (web UI scheduler) | No | Platform | Phase 21 |
| Main UI | No | Optional (web, TUI) | Yes | Rolecraft | |
