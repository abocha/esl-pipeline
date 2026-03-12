# Wave 1 - Quick ROI

## Goal

Deliver low-risk, high-leverage cleanup in transport/application behavior while keeping runtime behavior explicit and well-tested.

Success is:

1. No dummy Redis inheritance needed for no-op rate limiting.
2. Metadata edit side effects are explicit and test-covered.
3. Job options fallback behavior is explicitly gated and observable.

## Included Items

1. `B5` - Decouple NoOp and Redis rate limiter implementations.
2. `B3` - Complete metadata edit side-effect contract.
3. `B4` - Remove static job-options fallback debt.

Out of scope:

1. Route module split (`B1`).
2. Remaining DB schema evolution unification work (`B2`).
3. Broad test typing cleanup (`B6`).

## Implementation Steps

1. Introduce a narrow rate-limiter interface used by middleware.
2. Split implementations into independent `RedisRateLimiter` and `NoOpRateLimiter` classes without inheritance coupling.
3. Update middleware wiring so no-op mode does not require mock/dummy Redis construction.
4. Define the metadata-edit side-effect contract in code comments and tests:
   expected manifest update behavior, expected event/notification behavior, and no-op behavior when inputs are unchanged.
5. Add integration coverage for metadata edit flow to assert the contract end-to-end.
6. Replace unconditional static job-options fallback with an explicit env-gated fallback.
7. Add structured warning/logging when fallback path is used.
8. Update callers/tests to prefer DB/config-driven options path and assert fallback gate behavior.
9. Update relevant docs where runtime flags or behavior semantics changed.

## Risks and Rollback

1. Risk: behavior drift in rate limiting under disabled mode.
   Rollback: restore previous middleware wiring behind a temporary compatibility toggle.
2. Risk: metadata edit side effects surprise existing workflows.
   Rollback: guard new side effects with a temporary feature flag while preserving old path.
3. Risk: disabling fallback breaks environments missing DB-backed options.
   Rollback: re-enable fallback via explicit env flag while fixing source-of-truth data.

## Acceptance Checklist

1. Unit tests for rate limiter implementations pass.
2. Middleware tests confirm disabled mode does not depend on Redis instance methods.
3. Metadata edit integration tests verify manifest/event side effects and unchanged-input no-op behavior.
4. Job options tests verify fallback is disabled by default and only enabled with explicit flag.
5. `pnpm --filter @esl-pipeline/batch-backend typecheck`, `pnpm --filter @esl-pipeline/batch-backend test`, and `pnpm --filter @esl-pipeline/batch-backend test:integration:http` pass.
6. `pnpm check:fast` passes before merge.
