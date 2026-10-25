# Production configuration reconciliation (ESL-53)

## Meta

- Audience: maintainer performing an explicitly authorized production migration.
- Authority Level: bounded operator runbook.
- Owner: founder-maintainer.
- Status: `active`.

## Completion and authority

The repository implementation prepares this migration; it does not execute it. The maintainer must
review the release, exact path inventory, permissions, maintenance window and rollback before any
live command below. PR publication, merge and deployment retain their separate authorization.
Never paste secrets, rendered Compose config, env contents or archived configuration into chat/logs.

This reconciles trusted configuration/code/state ownership. It does not isolate production from
`ubuntu`: that account currently has passwordless unrestricted sudo and Docker-group access.
Sudo/Docker policy, SSH/firewall changes, credential rotation, provider changes, secret-management
platforms, schema/data changes, unknown-file cleanup and backup deletion are non-goals.

## Target layout

| Surface                                                | Target                                                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `/etc/esl-pipeline`                                    | root:root `0750`, protected ancestors, no symlink                                                                            |
| `/etc/esl-pipeline/production.env`                     | root:root `0600`, same existing values and signing identity                                                                  |
| `/opt/esl-pipeline` and tracked code/Git metadata      | root-owned ordinary clone; checkout `0750`, directories without group/other write; files `0644` or tracked executable `0755` |
| `.secrets/`                                            | root:1000 `0750`, only `google-service-account.json`                                                                         |
| Google key                                             | root:1000 `0640`, unchanged bytes; existing read-only container mount retained                                               |
| `uploads/`, `uploads/drafts/`                          | UID:GID 1000:1000 `0750`; existing contents retained                                                                         |
| Named `/var/lib/esl-pipeline/{deploy,ops}` directories | root:root `0750`; generated state root-owned without group/other write                                                       |
| Operator config snapshots                              | separate root:root `0700` directory, files `0600`, never container-mounted                                                   |

The existing Google key remains readable by runtime UID 1000 through its bind mount. Containers do
not need host checkout traversal permission. Restricting the checkout must not recursively change
uploads, named Docker volumes, TTS cache, unknown artifacts or backup contents.

## Prepare the exact inventory (read-only)

Use the deployed checkout and reviewed migration release as separate inputs. First inspect live
`git status`, HEAD, published immutable image identities, container mounts and active/enabled timers.
Recheck ownership with `stat` and every path's ancestors with `namei -l`. Stop for unexpected links,
mounts, hardlinks, unclean checkout or unidentified files. Do not run bootstrap `apply` to repair a
mixed-owner host: it deliberately refuses mismatched existing ownership.

Review these sets before writing an allowlist:

- Checkout root, directories containing tracked files, all tracked files and `.git` metadata. Confirm
  the clone and Git configuration/hooks are trusted; reconcile unexpected hooks/config explicitly
  before privileged Git operations. Preserve Git executable bits. Disable hooks during migration
  checkout updates (`git -c core.hooksPath=/dev/null ...`).
- Canonical env and Google key, plus `.secrets/.env.backup-20260627-132516` observed on October 13.
  Inspect names/metadata only; do not source the old backup or assume credentials are still valid.
- `/var/lib/esl-pipeline`, `deploy`, `deploy/backups/postgres`, `ops`, `ops/backups`,
  `ops/backups/postgres`, `ops/backups/postgres/remote-restore`, `ops/logs`, `ops/reports`, `ops/run`,
  `ops/state`, and the named generated deploy state files (image envs, pending SHA envs, migration
  inventories, compatibility records including their `.tmp` target, lock and deployment log).
  Include the latest integrity/restore reports and alert-state JSON files in named ownership repair. Inventory extra paths; change only reviewed
  targets. Protect existing secret snapshots through their ancestors and preserve their retention.
- All five operations timers/services listed by `deploy/systemd`. Record precisely which timers
  were active/enabled; identify and wait for in-flight operations before changing their inputs.

Known drift on October 13 included an ubuntu-owned checkout/state tree, root-owned landing assets,
and an old env backup readable by four containers. A partial Git update on October 12 is consistent
with mixed ownership. This does not establish which command or person created those assets.

## Authorized migration sequence

The following is an operator sequence, not a copy/paste unattended deployment. Run from the existing
trusted checkout as root through the maintainer's sudo workflow. Choose a unique root-only snapshot
directory outside runtime mounts (for example `/var/lib/esl-pipeline-config-backups/<UTC-stamp>`),
with protected root-owned ancestors. Never overwrite an existing snapshot or canonical config.

1. Pause only previously active operations timers after recording their states. Wait for the five
   associated services to finish; do not interrupt a backup/restore. Keep application services running
   during permission/config preparation. Prevent concurrent operators/deployments for this window.
2. Under `umask 0077`, save exact old metadata for every allowlisted path, the current units and
   enabled/active timer states. Archive tracked code plus Git metadata in restricted operator storage
   before updating the checkout. Exclude runtime uploads, volumes and unknown files. Save current,
   previous and known-good image state; record the live container image identities. Preserve the
   previous release reference and published images without rebuilding or retagging them.
3. Securely copy the current canonical `.env` to a root-only snapshot, retaining its bytes. Copy the
   Google key and old env backup to separate root-only snapshot files. Verify with `cmp -s`; do not
   print contents or hashes. Keep these snapshots for rollback. Apply root ownership and no
   group/other write permission to reviewed paths only, including Git metadata and tracked code.
   Reconcile the named state directories and generated state files; avoid recursive changes to
   existing backup archives or unknown operation evidence.
4. Create `/etc/esl-pipeline` as root:root `0750` after inspecting ancestors. If `production.env`
   already exists, stop and reconcile explicitly. Securely copy the current `.env` as root:root
   `0600`; verify byte equality before any path-only translation. Inspect host-only
   `PG_BACKUP_ENV_FILE`, `ESL_HOST_HEALTH_ENV_FILE` and `ESL_PRODUCTION_ENV_FILE` assignments locally:
   if present, reconcile them to the new canonical path with `sudoedit`; preserve all secret values
   and unrelated effective configuration. Container `PG_BACKUP_ENV_FILE=/dev/null` is a separate
   runtime override and must not be copied into host configuration. Provision existing `.secrets` as root:1000 `0750` and its Google key
   as root:1000 `0640`. Move the old env backup out of `.secrets` into the restricted snapshot
   directory only after its copy is verified. Preserve credential values and runtime UID/GID.
5. Advance the now protected checkout to the reviewed committed tooling release through privileged
   Git. Refuse dirty/partial updates; do not use reset/clean to erase unknown work. Reconcile newly
   introduced tracked directory modes as needed. The checkout may differ from the chosen published
   image SHA; the guard does not require their equality.
6. Run the metadata guard below. Install the reviewed systemd units with the existing installer,
   which reloads units without starting services/timers. Render production Compose with output
   suppressed, supplying canonical application env first and recorded image state second. Use the
   existing deployment script's `--plan` with the verified published image SHA. This plan can pull,
   alias images and write deployment state; it is not a read-only dry-run. Review it before apply.
7. Only with explicit deployment authorization, apply using the existing deployment script. It owns
   env preflight, schema compatibility, backup decisions, service recreation and smoke checks. A
   Compose/env configuration change can recreate services even when image digests are unchanged.
   Do not add a second deployment implementation or manually rebuild images.
8. Verify runtime access and the checks below. Resume exactly the timers active before migration;
   do not newly enable/start unrelated operations. Remove the checkout-local `.env` only after
   canonical loading, runtime and rollback evidence are accepted; retain its protected snapshot.

Illustrative commands for the reviewed preparation/verification phase:

```bash
# These commands are live operations and require maintainer authorization.
sudo install -d -o root -g root -m 0750 /etc/esl-pipeline
# Confirm the destination is absent before installing; never overwrite it blindly.
sudo test ! -e /etc/esl-pipeline/production.env
sudo test ! -L /etc/esl-pipeline/production.env
sudo install -o root -g root -m 0600 /opt/esl-pipeline/.env /etc/esl-pipeline/production.env
sudo cmp -s /opt/esl-pipeline/.env /etc/esl-pipeline/production.env

sudo node /opt/esl-pipeline/scripts/deploy/production-paths.mjs deploy \
  /opt/esl-pipeline /var/lib/esl-pipeline/deploy
sudo bash /opt/esl-pipeline/scripts/deploy/install-postgres-ops-systemd.sh
sudo docker compose -p esl-pipeline-prod -f /opt/esl-pipeline/docker-compose.prod.yml \
  --env-file /etc/esl-pipeline/production.env \
  --env-file /var/lib/esl-pipeline/deploy/current-images.env config --quiet
# Then invoke deploy-prod-images.sh <verified-published-SHA> --plan before authorized apply.
```

`ESL_PRODUCTION_ENV_FILE` exists for isolated local Compose fixtures; production guards reject a
different path. Production host operations reject `PG_BACKUP_ENV_FILE=/dev/null` or a checkout-local
file. Development behavior remains unchanged. Do not set a path override to bypass a migration error.

## Verification and rollback

Before removing the old path, establish:

- The guard accepts env, ancestors, tracked code/Git metadata, clean checkout, runtime secret contents
  and deploy state. An optional Google key may be absent only when provider configuration permits it.
- Published-image env preflight succeeds with the same runtime input; signing identity and all secret
  values are preserved. Compose output remains suppressed. Existing services, workers, edge and backup
  tooling follow the deployment owner's checks; no paid provider probe is required for permission proof.
- As runtime UID 1000, `test -r /app/secrets/google-service-account.json` succeeds, and no env backup
  exists in `/app/secrets`. This proves permission and mount scope, not Google IAM/key validity.
- New systemd units target `production.env`; restored timer states match the recorded inventory.
- Restricted snapshots and previous immutable images remain available for operator rollback.

Before service recreation, a failure leaves existing containers on their current configuration:
keep timers paused, repair the named failed invariant or restore previous reviewed tooling/units from
the restricted snapshot and resume the recorded timer set. Retain the root-only canonical env and
Google hardening where compatible; do not put env backups back into the mounted directory.

After service recreation, use the deployment owner's schema-compatibility-aware rollback. Image
rollback does not undo Compose or env-path changes: restore the previous reviewed tooling/units and
checkout-local env from the protected snapshot when the old tooling requires it, then render its
Compose using the recorded image state before an explicitly authorized recreation. Never infer that
an old image can run against a changed schema; database restoration is separate. Restore original
ownership metadata only for reviewed targets if required, and document any deliberately retained
hardening. Do not restore archived unknown paths, delete volumes or rotate keys as rollback cleanup.

If the checkout cannot pass its guard, do not add a bypass flag or source config from an unsafe
directory. The maintainer repairs the protected checkout from verified committed code or chooses a
reviewed older-tooling rescue with the restricted snapshot. Normal deployment remains fail-closed.

## Source owners

- [Deployment, bootstrap and rollback](../backend-frontend/DEPLOYMENT.md)
- [Environment policy](../reference/env.md)
- [Operational state and schedules](postgres-ops-health.md)
- [Production environment checklist](production-env-checklist.md)
- [ESL-53](https://linear.app/abocha/issue/ESL-53/harden-production-checkout-permissions-and-relocate-protected-env)
