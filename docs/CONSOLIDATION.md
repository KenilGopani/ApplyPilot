# When to absorb upstream code

ApplyPilot composes JobSpy and Career Ops through adapters. Absorbing (copying or rewriting) any of their code is considered only when one of these holds:

- the upstream project is unmaintained, or its license or direction changes;
- the integration cost (process boundaries, format parsing) is measurably higher than owning the module;
- a needed capability cannot be extended safely through the public interface;
- a small, well-tested module can be replaced without losing behaviour.

Making the repository look cleaner is never a reason.

Before absorbing anything, all of these must exist: an inventory of the module's behaviour, its upstream tests running against the replacement, fixtures captured from the upstream implementation, a side-by-side behaviour comparison on real data, a migration plan for stored data, and a rollback plan (the old adapter kept working until the replacement has run in practice).

Current assessment (2026-11): none of the triggers hold. JobSpy is active and its public `scrape_jobs()` covers everything used; Career Ops is very active (hundreds of commits per release) and its file contract is stable and tested; the adapters are small. Stable composition stays preferable to a rewrite.
