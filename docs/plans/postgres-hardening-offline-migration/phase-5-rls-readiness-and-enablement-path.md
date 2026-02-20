# Phase 5 - RLS Readiness and Enablement Path

## Summary

Prepare the system for future Row Level Security enforcement with minimal future migration risk, while keeping immediate rollout stable.

## Goals

1. Define full RLS policy model for user-scoped data.
2. Prepare application DB session context needed by policies.
3. Ensure policy predicates are indexed and testable before enforcement.

## Work Plan

1. Define table classification:
   - user-scoped tables
   - system/shared tables
   - service-only tables
2. Add policy SQL artifacts for user-scoped tables using session context patterns (for example `current_setting('app.user_id', true)`).
3. Add helper/session conventions in DB access layer so request identity can be propagated once auth context is available end-to-end.
4. Add policy-supporting indexes where missing.
5. Add RLS readiness audit command and SQL checks:
   - missing policies
   - missing indexes
   - missing grants
6. Document staged enablement playbook:
   - dry run in staging
   - table-by-table enablement
   - rollback steps if policy mismatch appears

## Deliverables

1. Policy definitions committed and reviewed.
2. Session-context plumbing hooks in DB access layer.
3. RLS readiness audit report capability.
4. Enablement runbook with gate checks.

## Exit Criteria

1. Enabling RLS later requires no destructive schema migration.
2. Policy/index prerequisites are verified automatically.
3. Current behavior remains unchanged with RLS disabled.

## Risks and Mitigations

1. Risk: enabling RLS too early blocks production paths.  
   Mitigation: deferred enforcement plus audit-first rollout.
2. Risk: missing session context causes false denials.  
   Mitigation: explicit context contract and pre-enable checks.

## Dependencies

1. Stable migration framework from Phase 2.
2. Auth context propagation strategy in transport/application layers.

