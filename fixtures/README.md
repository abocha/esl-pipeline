# Fixture Inventory

This directory intentionally stays at the repo root.

## Purpose

- Shared sample markdown/manifests used by multiple packages and integration tests.
- Manual playground inputs for local smoke runs.

## Guidelines

- Keep files small and deterministic when possible.
- Prefer `ok.md` / `bad.md` style names for test-oriented fixtures.
- Do not commit generated runtime artifacts here (for example recordings); keep those in ignored artifact directories.
