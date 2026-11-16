# Dependency and runtime map

```text
ApplyPilot (Node ≥22.13, npm workspaces)
├── @applypilot/job-schema ─ zod 3.25.76 (same version as Rolecraft)
├── @applypilot/adapter-jobspy ─ job-schema, zod
│     └─ spawns ─► runtime/.venv-jobspy/bin/python workers/jobspy/worker.py   (Python 3.12, uv)
│                    └─ python-jobspy 1.4.1, editable from ../JobSpy
│                         requests, beautifulsoup4, pandas, pydantic 2, curl_cffi, markdownify
├── (Phase 8) adapter-career-ops ─ spawns ─► node ../career-ops/*.mjs   (CAREER_OPS_ROOT=runtime/career-ops-data)
│                                            js-yaml, dotenv, undici, playwright 1.64.1 (+ Chromium), @google/generative-ai
│                                            optional LLM: Ollama (local) | Gemini | OpenRouter | OpenAI-compatible
└── (Phase 7) Rolecraft ─ ../KenilJobBoard: React 19, Vinext beta, Drizzle, D1 via wrangler 4.92
```

## Shared or conflicting dependencies

| Dependency | ApplyPilot | Rolecraft | Career Ops | Note |
|---|---|---|---|---|
| Node | ≥22.13 | ≥22.13 | ^22.13 \|\| ≥23.4 | Compatible; tested on 26.3 |
| zod | 3.25.76 | ^3.25.76 | — | Kept identical so schemas can be shared |
| TypeScript | 5.9.3 | 5.9.3 | — (plain JS) | |
| Python | 3.12 via uv | — | — | System Python 3.9 is too old for JobSpy |
| Playwright | — | — | 1.64.1 | Downloads Chromium on install; only needed for PDFs/liveness |

## Network access

Job boards (JobSpy), ATS APIs (Career Ops providers), optional LLM APIs (Career Ops evaluation). Nothing else.
