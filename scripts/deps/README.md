# Dependency Maintenance Scripts

- `pin-shared-deps.mjs`: normalizes shared dependency versions across workspace packages.
- `safe-upgrade.mjs`: upgrades allowlisted external SDKs/utilities, then reapplies shared pins.

Run via root scripts:

- `pnpm deps:pin`
- `pnpm deps:upgrade:safe`
- `pnpm deps:audit` (report only)
- `pnpm deps:audit:strict` (non-zero exit on issues)

Reference:

- Orchestrator runtime dependency evidence: `docs/reference/ORCHESTRATOR_DEPENDENCY_AUDIT.md`
