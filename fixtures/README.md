# Fixture Inventory

This directory intentionally stays at the repo root.

## Purpose

- Shared sample markdown used by multiple packages and integration tests.
- Manual playground inputs for local smoke runs.

## Canonical Fixtures

- `ok.md`: baseline valid assignment fixture used by backend/orchestrator tests.
- `job.md`: minimal valid fixture for generic job-path literals.
- `actual_file.md`: richer manual fixture used by Anytype preview examples.

## Policy

- Keep fixtures small, deterministic, and intentionally referenced.
- Prefer canonical names (`ok`, `job`) for shared test fixtures.
- Do not commit generated artifacts here (audio, transcripts, or manifests).
- Archive/demo-only fixture data should live outside root `fixtures/`.
