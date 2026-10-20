# Public ESL Pipeline landing page

The public informational site is `https://eslpipeline.com/`. The authenticated application and
MCP OAuth issuer/resource remain exclusively on `https://app.eslpipeline.com`. The historical
`esl-pipeline.run.place` browser redirect remains unchanged.

## Implementation

Public English legal drafts are served at `/privacy/` and `/terms/` from directory index files,
with shared `legal.css`. They are linked from the landing footer and app. See
[legal/OAuth readiness](google-oauth-legal-readiness.md) for approval decisions and exact consent
URLs. The existing bind mount serves these files; draft copy is not production legal approval.

- The approved, dependency-free HTML/CSS/JavaScript lives in `deploy/landing/index.html`.
  It includes illustrative data rather than real learner records. The ChatGPT integration is
  labeled **Private preview** and is not represented as generally available.
- `deploy/landing/favicon.svg` is served as a static asset.
- `caddy-edge` mounts `deploy/landing` at `/srv/landing` **read-only**.
- The separate `eslpipeline.com` Caddy site uses automatic HTTPS and `file_server`. It does
  not import the application's proxy, and has no session/API/OAuth routing.
- Updating just the landing files is reflected by the live bind mount after the checked-out
  release files are updated. Caddyfile and Compose changes require the normal edge deployment.

## One-time DNS and rollout (operator-owned, not performed by this PR)

The sequence below records the one-time rollout plan, not current deployment evidence. This audit
did not check DNS, the host, Caddy, the live page, or rollout completion. Treat each step as
unverified until an operator records a dated check against the intended release; do not infer that
any step remains pending or has completed from this plan alone.

1. After the PR is reviewed/merged and a release is published, add a Cloudflare **A** record at
   the zone apex (`@`) pointing to the existing Lightsail IP `56.10.15.24`; use **DNS only**
   (grey cloud), not proxied, to stay consistent with the app's >100 MB recording transport.
   Do not modify MX, SPF/DKIM, DNSSEC, or the existing `app` record.
2. Verify that the apex resolves to the intended VPS before enabling the new Caddy site and
   certificate issuance. Optional `www` redirect is deferred until explicitly configured.
3. On the VPS, use the existing reviewed release-image deployment script and its `--plan`
   mode for the exact published SHA. Inspect edge and application-config changes and
   `database_work` before executing. Compose changes can recreate application containers;
   arrange a brief suitable window. **Do not change** `CADDY_PUBLIC_HOSTNAME`,
   `CADDY_TRANSITION_HOSTNAME`, `CADDY_TRANSITION_MODE`,
   `MCP_OAUTH_ISSUER`, or `MCP_OAUTH_RESOURCE`.
4. After deploying, verify:
   - `curl -fsSI https://eslpipeline.com/` → HTTPS 200 / HTML.
   - `curl -fsSI https://eslpipeline.com/favicon.svg` → HTTPS 200 / SVG.
   - HTML CTA opens an email to `hello@eslpipeline.com`, and “Open app” points to
     `https://app.eslpipeline.com`.
   - The three “From one lesson to the next” tab buttons work by pointer and arrow keys,
     including on narrow screens.
   - `https://app.eslpipeline.com/api/health` is healthy and ChatGPT MCP
     `get_profile` continues to work; existing `https://esl-pipeline.run.place/`
     still returns its temporary 302 redirect and old API endpoints return 410.

The landing is static, has no analytics, registration, credentials, forms, or additional
backend. Rollback is the normal reviewed release rollback for Caddy/Compose/files only;
it does not require a database restore. DNS removal is a separate operator decision.
