# Security Scan Notes (2026-02-12)

## Scope

Two incremental security passes were run with Semgrep and CodeQL during active development. Goal was low-churn, high-ROI hardening without broad refactors.

## Fixes Applied

1. AES-GCM tag length made explicit in encryption service:
   - `packages/batch-backend/src/infrastructure/encryption-service.ts`
2. Markdown malicious-link checks hardened (case/whitespace normalization, broader protocol blocking):
   - `packages/batch-backend/src/infrastructure/file-validation-service.ts`
3. Video host matching hardened to exact domain/subdomain checks:
   - `packages/html-publisher/src/rendering.ts`
4. Auth routes wired through rate-limit prehandler:
   - `packages/batch-backend/src/transport/extended-routes.ts`
5. Rate-limit identifier hardened for unauthenticated traffic:
   - switched from trusting raw forwarded headers to Fastify-resolved `request.ip`
   - `packages/batch-backend/src/transport/rate-limit-middleware.ts`
6. Added regression tests for rate-limit identity behavior:
   - spoofed forwarded headers do not override `request.ip`
   - authenticated user id still takes precedence
   - `packages/batch-backend/tests/transport.rate-limit-middleware.test.ts`

## Validation Performed

### Tests

- `pnpm --filter @esl-pipeline/batch-backend test -- tests/infrastructure.encryption-service.test.ts tests/config.env.test.ts`
- `pnpm --filter @esl-pipeline/batch-backend test -- tests/transport.rate-limit-middleware.test.ts`
- `pnpm --filter @esl-pipeline/batch-backend test -- tests/transport.http-server.integration.test.ts`
- `pnpm --filter @esl-pipeline/html-publisher test -- src/rendering.test.ts`

### Semgrep

- Workspace scan (security-focused packs): crypto GCM finding cleared after explicit tag-length fix.
- Focused `batch-backend` scan result after second pass:
  - 23 findings
  - all under `javascript.express.security.audit.xss.direct-response-write.direct-response-write`
  - concentrated in `packages/batch-backend/src/transport/extended-routes.ts`

### CodeQL

- Full packages scan delta improved from 130 to 127 results after first pass.
- Focused `batch-backend` scan after second pass:
  - 15 results total
  - primary remaining findings:
    - `js/user-controlled-bypass` (auth flow condition patterns in route handlers)
    - `js/missing-rate-limiting` (route modeling still flags auth handlers)
    - `js/bad-tag-filter` / `js/incomplete-multi-character-sanitization`
    - `js/polynomial-redos` (email regex)
    - one type-quality warning

## Deferred Items (Intentional)

1. Regex-based HTML sanitization findings:
   - would require broader sanitization strategy shift, not a low-churn patch.
2. Remaining CodeQL auth-route flags:
   - likely static-analysis modeling mismatch after explicit prehandler rate limiting.
3. Broader temp-file and file-system race hardening in other packages:
   - useful, but better as a dedicated cross-package hardening pass.

## Suggested Next Security Pass (Smallest Useful)

1. Replace simplistic email regex with bounded/safer validator to address `js/polynomial-redos`.
2. Add a short scanner-triage policy doc for known false positives in route-handler response patterns.
3. Isolate and harden temp-file creation in runtime paths with `mkdtemp`-scoped directories.
