# Fixture Inventory

This directory intentionally stays at the repo root.

## Purpose

- Historical Markdown samples retained for persistence/DTO tests and legacy-input rejection tests.
- Anytype preview examples that explicitly accept historical Markdown.

These files are not fresh assignment inputs. Fresh generation, submission and publication use
[AssignmentV1](../docs/reference/ASSIGNMENT_V1.md); use the typed fixture in the
[local product smoke recipe](../docs/operations/local-product-smoke.md) for a current smoke run.

## Canonical Fixtures

- `ok.md`: historical assignment sample/path used by backend tests, including legacy rejection.
- `job.md`: historical sample/path for generic job test literals.
- `actual_file.md`: retained manual Markdown sample for Anytype preview examples.

## Policy

- Keep fixtures small, deterministic, and intentionally referenced.
- Prefer canonical names (`ok`, `job`) for shared test fixtures.
- Do not commit generated artifacts here (audio, transcripts, or manifests).
- Archive/demo-only fixture data should live outside root `fixtures/`.
