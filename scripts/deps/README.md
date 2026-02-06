# Dependency Maintenance Scripts

- `pin-shared-deps.mjs`: normalizes shared dependency versions across workspace packages.
- `safe-upgrade.mjs`: upgrades allowlisted external SDKs/utilities, then reapplies shared pins.

Run via root scripts:

- `pnpm deps:pin`
- `pnpm deps:upgrade:safe`
