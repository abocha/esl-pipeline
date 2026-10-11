# Canonical application and MCP domain migration

## Meta

- Audience: production operator and maintainer.
- Authority Level: operational procedure.
- Last Verified Against: 2026-10-11 repository contracts; live rollout remains unperformed.
- Owner: founder-maintainer.
- Review Cadence: after edge, OAuth, or deployment-contract changes.
- Status: `active`.

## Outcome and boundaries

Move the canonical application from `https://esl-pipeline.run.place` to
`https://app.eslpipeline.com`, including MCP issuer `/api/oauth` and resource `/api/mcp`.
The apex `eslpipeline.com` stays reserved for a future landing page. Preserve
`browser -> Caddy -> batch-frontend nginx -> batch-backend`, existing data/volumes, REST JWT
secret, MCP private JWKS and cookie signing keys. No database migration is introduced by this
domain change. Do not rotate credentials, reset grants, reinitialize storage, or restore the
database to change a hostname.

All commands below that edit production, deploy, back up, recreate services, update DNS or change
the ChatGPT integration belong to the separately authorized operator phase. Local implementation
and validation do not authorize them. Use the existing
[deployment flow](../backend-frontend/DEPLOYMENT.md#production-deployment-flow), complete released
SHA image bundle and schema-compatibility gates. Domain rollback uses the **same migration-capable
release**, so it does not cross a schema boundary by downgrading images.

### Operator privileges

SSH as the approved sudo-capable operator (normally `ubuntu`). Run the VPS filesystem and
deployment commands below in a root login shell:

```bash
sudo -i
cd /opt/esl-pipeline
```

The checkout's restricted `.env`, root-owned `/var/lib/esl-pipeline/deploy` state, Docker daemon,
and backup paths require these privileges. Keep their existing ownership and permissions; do not
grant `ubuntu` ownership or Docker-group membership to work around access failures. Confirm Docker,
Node, GHCR pull credentials and, when the deploy plan requires database work, the existing AWS
backup credentials are available in this root context. A sudo login shell does not inherit
`ubuntu`'s exports or credentials: set the non-secret deployment variables below **after** entering
it and use the host's existing root credential setup. Stop if that setup is unavailable; do not
copy, print or re-create secrets. Edit `.env` in this root shell while preserving its mode
and ownership. Run external DNS/browser checks from the indicated external computer. Exit the root
shell after the operator phase.

## Configuration stages

Edit these values in `/opt/esl-pipeline/.env`; change existing assignments instead of appending
duplicates. Preserve `CADDY_ACME_EMAIL`, `MCP_OAUTH_COOKIE_KEYS`, `MCP_OAUTH_JWKS` and all other
credentials. No frontend rebuild or CORS allowlist is needed.

If the enabled ops bot already sets `TELEGRAM_OPS_BOT_APP_BASE_URL`, keep it on the old origin in
Stage A and set it to `https://app.eslpipeline.com` in Stage B. Preserve its prior value/absence
for rollback, keep its profile enabled during deploy, and verify its application job links after
cutover. Leave `TELEGRAM_OPS_BOT_API_BASE_URL` (Telegram's API) and published S3 homework links
unchanged. Do not enable the bot merely for this migration.

| Setting                     | Stage A: verify new host                   | Stage B: canonical cutover              | Stage C: optional old-host redirect |
| --------------------------- | ------------------------------------------ | --------------------------------------- | ----------------------------------- |
| `CADDY_PUBLIC_HOSTNAME`     | `esl-pipeline.run.place`                   | `app.eslpipeline.com`                   | `app.eslpipeline.com`               |
| `CADDY_TRANSITION_HOSTNAME` | `app.eslpipeline.com`                      | `esl-pipeline.run.place`                | `esl-pipeline.run.place`            |
| `CADDY_TRANSITION_MODE`     | `serve`                                    | `serve`                                 | `redirect`                          |
| `MCP_OAUTH_ISSUER`          | `https://esl-pipeline.run.place/api/oauth` | `https://app.eslpipeline.com/api/oauth` | same as B                           |
| `MCP_OAUTH_RESOURCE`        | `https://esl-pipeline.run.place/api/mcp`   | `https://app.eslpipeline.com/api/mcp`   | same as B                           |

Throughout every stage:

```ini
MCP_OAUTH_ENABLED=true
BATCH_BACKEND_ENABLE_EXTENDED_API=true
REFRESH_COOKIE_SECURE=true
REFRESH_COOKIE_SAMESITE=lax
REFRESH_COOKIE_PATH=/
ENABLE_CORS=false
```

Leave `REFRESH_COOKIE_DOMAIN` **absent**, as in the inspected production environment.
Cookies, local storage, access tokens and unfinished uploads do not move between hosts. Finish
or cancel in-flight recordings before cutover; log in on the new host and select the workspace
again. Both hosts in `serve` reach the same application/database, but only the canonical host
serves OAuth, MCP and discovery. The transition host returns 410 for those paths. There is one
issuer/resource at a time and no old-issuer compatibility service.

## Prerequisites and rollback preparation

1. Confirm operator approval, a complete CI-published release bundle, and an up-to-date checkout
   containing this Caddyfile/deploy script. Record the deployed image refs and migration ledger.
   Confirm a recent verified production backup under the normal backup procedure. Preserve
   PostgreSQL, Redis, uploads, `.secrets`, `caddy_data` and `caddy_config`.
2. In Cloudflare authoritative DNS, the intended record is **A**, name **app**, IPv4
   **56.10.15.24**, **DNS only** (`proxied=false`), TTL **Auto**. Check for conflicting app CNAME,
   AAAA or HTTPS records. Do not add AAAA without working origin IPv6. Leave apex, MX, SPF, DKIM,
   Email Routing and DNSSEC/registrar DS records unchanged.
3. Cloudflare's API reports DNSSEC **`active` as of October 11, 2026**. This control-plane observation
   does not by itself verify signed delegation through validating resolvers. The operator must
   still check the registrar DS status and validating-resolver answers before cutover. Resolve
   any SERVFAIL or inconsistent delegation; do not disable DNSSEC as a migration shortcut.
4. Keep the old hostname's DNS and valid certificate in place. Both hosts must resolve to the
   Lightsail static IP. Public TCP 80/443 must reach Caddy through Lightsail and host firewalls.
   Review effective CAA records for compatibility with Caddy's ACME issuers if CAA exists.
   DNS-only uses **Caddy's publicly trusted certificate directly**; a Cloudflare Origin CA
   certificate is unsuitable for this browser path. Keep the ACME email and Caddy volumes.
5. Save restricted rollback evidence outside the checkout:

   ```bash
   cd /opt/esl-pipeline
   install -d -o root -g root -m 0700 /var/lib/esl-pipeline/deploy/domain-migration
   install -o root -g root -m 0600 .env /var/lib/esl-pipeline/deploy/domain-migration/before.env
   install -o root -g root -m 0600 /var/lib/esl-pipeline/deploy/current-images.env \
     /var/lib/esl-pipeline/deploy/domain-migration/before-images.env
   git rev-parse HEAD
   ```

   These commands require the root shell above; creating the directory as unprivileged `ubuntu`
   can fail. If evidence already exists, preserve it and choose a new run-specific directory
   instead of overwriting the original rollback snapshot, substituting that path throughout this
   runbook. Record the release SHA used for this
   migration and stage outcomes in that restricted directory.
   Never print or attach the saved `.env`. Image state is not an environment backup; later deploys
   overwrite `previous-images.env`.

DNS-only avoids Cloudflare Free's 100 MB proxied upload cap
([Cloudflare limit](https://developers.cloudflare.com/network/maximum-upload-size/)). Existing
frontend nginx `client_max_body_size 120m` still applies to the complete multipart body; backend
limits and disk reserve checks also remain. This migration does not increase recording limits.
Choose a supported recording below the effective limit, including multipart overhead, for smoke.

## Stage A: provision direct HTTPS and verify the new application

Set Stage A values. In the root SSH login shell above, clear stale shell overrides so Compose and the deploy
script use `.env`. Retain the existing ops-bot selection; set `DEPLOY_INCLUDE_OPS_BOT=true` below
only if that service is enabled in production.

```bash
cd /opt/esl-pipeline
unset CADDY_PUBLIC_HOSTNAME CADDY_ACME_EMAIL CADDY_TRANSITION_HOSTNAME CADDY_TRANSITION_MODE
export DEPLOY_INCLUDE_EDGE=true
# export DEPLOY_INCLUDE_OPS_BOT=true  # preserve the existing production profile
export MIGRATION_RELEASE_SHA=<40-character-complete-release-sha>
bash scripts/deploy/deploy-prod-images.sh "$MIGRATION_RELEASE_SHA" --plan
```

`--plan` can pull/alias images and write pending state, and runs disposable Caddy and production-env
validator, but does not stop/recreate services, back up or migrate. The validator must accept
the secure host-only cookie contract and **old** canonical OAuth URLs in Stage A. Read its plan
and schema compatibility result, then run the authorized deploy:

```bash
bash scripts/deploy/deploy-prod-images.sh "$MIGRATION_RELEASE_SHA"
```

The script validates Caddy configuration and the requested image's effective production environment
(`validate-env --runtime --profile production`) before any application mutation. It does not mount
or read the host's restricted `.env` inside the validator container.
It detects `.env`/Compose changes through `APPLICATION_CONFIG_DIGEST` and edge settings through
`CADDY_CONFIG_DIGEST`. With unchanged images an env change recreates backend/workers/frontend,
enabled bot and edge, without backups or migrations. Missing application digest in an older state
file causes one runtime refresh. Image changes still follow the normal backup/migration plan.

Run from an external computer as well as the VPS. Do not use `-k`:

```bash
dig +short app.eslpipeline.com A
dig +dnssec app.eslpipeline.com A @1.1.1.1
dig +dnssec app.eslpipeline.com A @8.8.8.8
dig eslpipeline.com DS @1.1.1.1
curl -sSI http://app.eslpipeline.com/
curl -fsS https://app.eslpipeline.com/ >/dev/null
curl -fsS https://app.eslpipeline.com/api/health
curl -fsS https://app.eslpipeline.com/api/meta/version
curl --resolve app.eslpipeline.com:443:56.10.15.24 -fsS \
  https://app.eslpipeline.com/api/health
curl -fsS https://esl-pipeline.run.place/api/health
```

Expect HTTP-to-HTTPS redirect, trusted certificate/SAN/chain on direct Caddy TLS, 2xx health with
database healthy, matching version contracts and old-host health. Wait for successful ACME issuance;
inspect bounded Caddy logs if it fails. Do not proceed on TLS failure or DNS SERVFAIL.
In Stage A, `https://app.eslpipeline.com/api/mcp` and its discovery routes must return 410.

In a browser on the **new** origin: log in with the existing account; confirm `esl_refresh` has
Secure, HttpOnly, SameSite=Lax, Path=/ and **no Domain attribute**. Reload to exercise refresh;
confirm authenticated student/workspace APIs succeed through `/api` with no CORS errors. Upload
one approved recording using the existing UI, verify acceptance and retained recording visibility.
Use a representative upload above 100 MB but below nginx's 120 MiB multipart limit if this size
is part of production use. Submission/transcription can mutate learner state and incur provider
cost, so the operator's smoke authorization must cover it. Keep tokens, cookies and learner
content out of evidence. Do not retire the old host before this smoke passes.

## Stage B: switch canonical origin and reconnect MCP

After Stage A passes, disconnect the maintainer's existing ChatGPT integration. Complete or cancel
pending OAuth interactions. Update **all five Stage B settings together** in `.env`, retain keys,
run the same `--plan` then deploy commands, and repeat both-host health and the new browser smoke.
The expected environment-only plan has `application_config_changed=true`, edge restart, and
`database_work=false` if the image digests match Stage A.

Check actual metadata, including the canonical path that bypasses the SPA:

```bash
curl -fsS https://app.eslpipeline.com/.well-known/oauth-protected-resource/api/mcp
curl -fsS https://app.eslpipeline.com/api/.well-known/oauth-protected-resource
curl -fsS https://app.eslpipeline.com/api/oauth/.well-known/oauth-authorization-server
curl -fsS https://app.eslpipeline.com/api/oauth/jwks
curl -sS -D - -o /dev/null -X POST https://app.eslpipeline.com/api/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_profile","arguments":{}}}'
```

Expect resource `https://app.eslpipeline.com/api/mcp`, authorization server and issuer
`https://app.eslpipeline.com/api/oauth`, authorization/token/JWKS endpoints on that new origin,
PKCE S256, read scope `teaching_context.read`, public-only JWKS and a 401 challenge naming
`https://app.eslpipeline.com/.well-known/oauth-protected-resource/api/mcp`. Old-host MCP/OAuth/
discovery requests must return 410 and must not redirect to the new token endpoint.

In the existing ChatGPT integration's management/settings UI, update its MCP server URL to
`https://app.eslpipeline.com/api/mcp`. If the installed integration cannot edit its endpoint,
update the maintainer-owned plugin configuration or replace the connection using the same
integration definition and this new URL. Rediscover metadata and explicitly reconnect through
OAuth; sign in on `app.eslpipeline.com`, select the intended workspace and consent. Keep the
existing client/redirect validation: use the exact CIMD/redirect pair displayed by ChatGPT;
do not substitute an application URL for ChatGPT's callback or widen the allowlist. See
[official OpenAI OAuth guidance](https://developers.openai.com/plugins/build/auth).

Verify `get_profile` succeeds and preserves the existing stable user/workspace profile identity;
perform one approved read-only learner lookup/context call, then repeat after access-token expiry
(15 minutes) to exercise refresh. A new connection is required: old resource-bound credentials
are rejected at the new resource even with the same signing keys and persisted artifacts.
Do not clean up OAuth tables or manually rewrite grants/tokens.

## Stage C: retire browser use of the old origin

Only after new browser/login/API/upload and MCP reconnection/refresh pass, optionally select Stage C
and run the same plan/deploy commands. Keep old DNS and Caddy certificates for the rollback window.
`redirect` returns uncached **302** only for query-free GET/HEAD paths outside `/api` and
`/.well-known`. API, MCP, OAuth, query-bearing requests (including `oauth_continue`) and writes
return uncached **410**. In-flight requests must finish before this switch. Do not use 301/308,
forward uploads, or replay credentials/state across origins.

Check old `/` returns 302 to the new HTTPS origin with `Cache-Control: no-store`; old `/api/health`,
`/api/oauth/token`, metadata, POST `/` and `/?oauth_continue=...` return 410 without Location.
Check new health remains 2xx. After the agreed rollback window, optionally remove the extra site
by setting `CADDY_TRANSITION_MODE=disabled` and removing `CADDY_TRANSITION_HOSTNAME`, then deploying
the same release. Retiring old DNS separately requires operator authorization. The apex stays out
of the application routing and no Cloudflare proxying is introduced.

## Rollback

For a failure before canonical cutover, restore old canonical values and disable/clear the temporary
site, then plan/deploy the **same release SHA**. The old integration was not migrated in Stage A;
if already disconnected, reconnect it to the old endpoint explicitly.

For a failure during Stage B or C, first disconnect the new-origin ChatGPT connection and pause
new submissions. Restore only these environment settings, preserving every secret and other
configuration change:

```ini
CADDY_PUBLIC_HOSTNAME=esl-pipeline.run.place
CADDY_TRANSITION_MODE=disabled
MCP_OAUTH_ISSUER=https://esl-pipeline.run.place/api/oauth
MCP_OAUTH_RESOURCE=https://esl-pipeline.run.place/api/mcp
```

Remove `CADDY_TRANSITION_HOSTNAME`; leave secure host-only cookies and `ENABLE_CORS=false` intact.
Restore `TELEGRAM_OPS_BOT_APP_BASE_URL` to its saved old-origin value if it was configured, or keep
it absent if absent before the migration; recreate the enabled bot through the same deploy plan.
Use the restricted `before.env` as reference, not a blind replacement if other settings changed.
Clear shell overrides and run the same migration release's `--plan` then deploy commands. This
updates config digests and recreates runtime; **do not use `previous-images.env` alone** because
it does not restore environment/issuer settings. Do not downgrade to pre-migration code or restore
the database as part of domain rollback. If a separate release/schema failure exists, follow its
compatibility-gated recovery procedure separately.

Verify old direct trusted HTTPS, health/version, browser login/refresh, authenticated APIs and
an approved recording upload. Restore the integration MCP URL to
`https://esl-pipeline.run.place/api/mcp`, rediscover old metadata and **disconnect/reconnect again**
through the old issuer. Tokens/clients connected to the new issuer do not automatically work
against the old issuer. Confirm read-only tools and refresh; do not assume a saved old connection
or token remains usable. Keep the new DNS-only A record for retry if desired; disabling its Caddy
site stops new-origin application service without altering email, DNSSEC or persistent data.

## Completion evidence

Record release SHA/image digests, stage env names/values (never secrets), DNS-only A and delegation
checks, direct certificate verification, both-host health, browser cookie/login/refresh/API/upload,
discovery/challenge fields, integration endpoint/reconnect/profile/read/refresh outcomes and the
tested rollback identity. Hosted CI/release, ACME issuance, live browser/recording/ChatGPT behavior
and production rollback remain operator-owned until actually performed. Close the rollout when
these acceptance checks pass; do not start adjacent infrastructure improvements.
