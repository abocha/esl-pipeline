---
name: test-audit
description: Use when adding, changing, reviewing, or pruning tests in ESL Pipeline. For new tests, apply a value gate; for explicitly requested audits, identify redundant or implementation-coupled tests using read-only evidence first. Do not perform mass deletion automatically.
---

# Test Audit (ESL Pipeline)

Adapted for this repository from OpenClaw's `test-audit` skill:
https://github.com/openclaw/openclaw/tree/main/.agents/skills/test-audit
Upstream: © 2026 OpenClaw Foundation, MIT licensed.
The repository's `AGENTS.md`, `docs/reference/agents-ssot.md`, and
`docs/reference/TESTING_GUIDELINES.md` take precedence over this optional workflow.

## Scope and modes

- **Authoring / review (automatic trigger):** apply the gate below whenever creating, revising, or reviewing a test. Do not add a test simply because code was changed.
- **Audit (explicit request):** perform a read-only inventory and evidence-based assessment for a bounded owner or package. No deletions from classification alone.
- **Prune (explicitly authorized):** remove or consolidate a small, coherent, high-confidence batch only after checking the evidence for each candidate. Preserve independently useful contract coverage.
- **Campaign (separately authorized):** sweeping changes across a package or subsystem require an agreed scope, a regression-risk inventory, and staged PRs. A target percentage of removed lines is not proof of safety.

## The four-question test gate

Before writing or retaining a test, articulate:

1. Which externally observable behavior, invariant, or independent contract does it protect?
2. Which plausible defect would cause this test to fail for the *right reason*?
3. Where is the strongest existing owner-boundary check, and what distinct risk would another test cover?
4. Does testing require adding exports, toggles, wrappers, or injection points unused in production? If yes, prefer verifying through the actual owner boundary.

A bug-regression test should demonstrably fail on the buggy version and pass after the fix, when practical. If its expected result is generated from the very same implementation, or it survives an intentionally broken implementation, its independence is suspect. Prefer table-driven cases over near-duplicate files.

## Common low-value patterns to investigate

These are **signals for investigation**, never automatic deletion rules:

- Tests with no meaningful assertion, self-comparisons, or expectations computed by the code under test.
- String/source/import greps that break during behavior-preserving refactors.
- Repeated checks of one contract in multiple packages or layers without a distinct failure mode.
- White-box assertions about private call shapes when the public behavior is already independently checked.
- Full copies of manifests, fixtures, export inventories, or configuration constants with no external oracle.
- Mock implementations that manufacture the very outcome being asserted.
- Fake persistence or callback/order fixtures that bypass the real owner, so the claimed state was never produced.
- Pure capability-flag checks without validating the delivery, acceptance, or acknowledgement promised by the flag.
- Production-only-on-paper code: exports, wrappers, flags, or dead paths used solely by tests.
- Negative cases passing because the request is rejected by an unrelated earlier guard.
- Test titles claiming an invariant stronger than the scenario and assertions actually exercise.

## The retention bar

**Keep** tests that independently protect an observable protocol or user outcome, public contracts/DTOs, backwards compatibility, migrations, storage integrity, security/auth, durable state, release/config defaults, provider request compatibility, or cross-language formats. An implementation-facing or mocked test can be valuable when it enforces one of those contracts and there is no stronger equivalent.

Especially protect ESL Pipeline's:
- worker leases, retries, concurrency, duplicate suppression, acknowledgements, and idempotency;
- upload identity, deterministic keys, persisted publication truth, replay, and recovery;
- schema migrations, historical evidence, authorization and workspace isolation;
- provider compatibility, transcription speaker/channel provenance, and user-visible transcript/assignment output.

Do **not** use line coverage alone as a safety argument. It measures execution, not contract or defect detection. Slow, old, or mocked tests are not automatically waste.

## Audit protocol: gather evidence before edits

1. Read root and scoped `AGENTS.md`, current testing guidance, owning package README, and any pertinent hard invariant. Define a bounded ownership slice; don't start with all tests.
2. Inventory relevant tests, production entrypoints/callers, dependencies, sibling implementations, test configuration/CI routing, and overlapping tests. Use source and history to understand why each test exists.
3. For each candidate, record:
   - exact path and test name;
   - tested behavior and a credible regression;
   - what the assertion really proves, including mock and fixture limitations;
   - production caller or independent contract owner;
   - any stronger test that *actually* remains after removal;
   - why it was introduced or retained, including relevant history;
   - possible production/test-support simplification;
   - risk and precise focused validation command.
4. Classify as **retain**, **rewrite at stronger boundary**, **remove**, or **investigate further**. State uncertainty and false positives explicitly; do not force a removal quota.
5. Report the read-only findings and a small proposed batch. If pruning was authorized, only edit cases with complete evidence; move independent regression proof to its primary owner before retiring a duplicate.
6. Do not silently change contracts or reduce CI/test-project routing. Changes to the validation system itself additionally trigger `esl-pipeline-validation-evidence`.

## Validation and handoff

Use exact current owner commands from `docs/reference/TESTING_GUIDELINES.md` and package scripts, not OpenClaw-specific commands. Run the narrowest trustworthy test(s), targeted formatting, and `git diff --check`; broaden only for a concrete plausible risk. On a PR, hosted CI remains the full merge gate.

When editing, report separately:
- production/tooling lines removed or added;
- test/fixture lines removed or added;
- valuable test cases retained despite suspicious patterns;
- focused commands actually executed and their outcomes;
- hosted or service-backed checks not performed;
- remaining uncertainty and recommended follow-up.

Never present reduced test count, green mocks, or unchanged percentage coverage as proof that reliability is unchanged. Never merge, deploy, or change production data without the applicable authorization.
