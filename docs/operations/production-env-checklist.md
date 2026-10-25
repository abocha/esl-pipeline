# Production Environment Checklist

## Meta

- Audience: authorized operators and maintainers.
- Authority Level: deployment safety checklist.
- Owner: operations maintainers.
- Status: `active`.

## Purpose and source owners

This is a compact safety checklist. Exact deployment topology, commands, environment keys, and backup
procedures belong to their current owners:

- [Production deployment and rollback](../backend-frontend/DEPLOYMENT.md), including the
  [schema compatibility and recovery contract](../backend-frontend/DEPLOYMENT.md#schema-compatibility-and-recovery)
- [Environment names and validation](../reference/env.md) and the
  [generated exhaustive env index](../generated/env-surface-index.md)
- [Postgres backup and restore](postgres-backup-restore.md), [production S3 wrappers](postgres-backup-s3.md),
  and [ops health](postgres-ops-health.md)
- [Prompt gallery bootstrap](prompt-gallery-bootstrap.md)
- [Host/runtime readiness](host-runtime-health.md)

This checklist consolidates repeated mutable values and commands into those source owners. Treat
only the current linked owners and live operator evidence as current procedure/state.

## Before an authorized production change

- Identify the exact reviewed release SHA and deployment objective. Repository state alone does not
  prove what is installed on the host.
- Run the deployment script's plan and inspect its image, environment/configuration, edge and
  database-work effects before applying it. A plan is itself operational work; follow the current
  deployment contract.
- Preserve the prior immutable image identities and deployment metadata needed for rollback. Do not
  infer that an old image can safely run against a newer schema; check the recorded compatibility
  contract.
- Verify a usable backup with the production backup owner before a risky migration or recovery.
  Backup integrity and a completed restore drill are separate evidence.
- Validate environment configuration with the current env validator. Supply secrets through the
  approved host mechanism; never print, commit or copy real secrets or learner data into this file.
- Confirm the change's authorization includes any service recreation, data migration, backup/restore,
  DNS/edge mutation or provider call it requires.

## Host-level safety checks

For a fresh Ubuntu host, follow the deployment owner's bootstrap and verification path. Do not infer
host readiness from a successful local configuration check. Confirm separately, under the authorized
operation, that:

- SSH access and firewall policy have been reviewed before changing host firewall rules.
- Persistent data and backups are outside mutable container filesystems; do not delete unknown host
  files, volumes, images or packages as cleanup.
- Public traffic follows the documented edge route; databases, Redis and internal services are not
  exposed publicly unless a separately approved design says otherwise.
- Required workers, backup timers, container health and application endpoints match the intended
  release; use the owning readiness and backup runbooks.
- Lightsail CPU/burst capacity, memory, disk and container health are suitable for the operation.

## Recovery boundary

Application rollback and database rollback are separate decisions. Use the deployment compatibility
metadata and immutable prior images to determine whether an old application can run against the
current schema. An incompatible or unclassified boundary blocks that restart. PostgreSQL restore is
never automatic: select and verify the target backup using the backup/restore owner before any
separately authorized restore. A source-level or local check does not establish current production
state or successful recovery.

Never store production credentials, private S3 URLs, real learner data, invoices, transcripts or
other personal data in committed documentation.
