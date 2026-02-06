# @esl-pipeline/shared-infrastructure

Shared infrastructure utilities reused across backend/orchestrator packages.

## Modules

- `env`
  - `.env` loading with optional memoization
  - typed env readers (`readBool`, `readInt`, `readString`)
- `storage`
  - storage provider config resolution (`s3` / `filesystem`)
  - manifest store config resolution helpers
- `job-options`
  - shared normalization for Notion DB option parsing
  - shared voice catalog normalization for UI/job-option payloads

## Why this package exists

It centralizes low-level infra logic that previously drifted across packages, so env/storage/metadata parsing stays consistent in one place.

