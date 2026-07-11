# GPT-5.6 Model Family Migration Design

## Goal

Consolidate every active OpenAI generation workload onto the GPT-5.6 family while preserving the
existing Responses API, provider fallback, structured-output, audit, and operator-activation
contracts.

## Model and Reasoning Policy

Active OpenAI workloads use exactly two configured model IDs:

| Workload                | Model          | Reasoning effort | Text verbosity |
| ----------------------- | -------------- | ---------------- | -------------- |
| Assignment draft        | `gpt-5.6-sol`  | `medium`         | `medium`       |
| Profile revision        | `gpt-5.6-luna` | `medium`         | `low`          |
| Student-memory snapshot | `gpt-5.6-luna` | `medium`         | `low`          |
| Lesson memory           | `gpt-5.6-luna` | `low`            | `low`          |
| Homework memory         | `gpt-5.6-luna` | `low`            | `low`          |
| Profile candidate patch | `gpt-5.6-luna` | `low`            | `low`          |

All OpenAI primary, fallback, tertiary, and allowlist defaults collapse to these two models. The
assignment/default generation role resolves to Sol; every student-memory and profile role resolves
to Luna. Explicit environment overrides remain supported, but no built-in active default retains a
GPT-5.5, GPT-5.4, GPT-5.4-mini, or GPT-5.4-nano model.

`GEN_OPENAI_TARGET_MODELS_ENABLED` remains as an operator-visible compatibility gate because
removing an environment contract is outside this migration. Both gate states resolve to the new
family defaults, so disabling the gate cannot silently restore a legacy model. The gate's revised
meaning and follow-up deprecation status must be documented.

## Request and Prompt Architecture

The integration remains on the Responses API. It does not adopt Pro mode, persisted reasoning,
Programmatic Tool Calling, multi-agent execution, explicit prompt caching, tools, or a new request
schema. These workloads are single-turn generation and structured extraction tasks, so those
features do not solve a demonstrated problem.

The versioned generation envelope remains the shared boundary:

- trusted task policy stays in `instructions`;
- transcript, teacher, memory, and profile content stays in labelled source-data blocks in `input`;
- the source-data injection boundary remains explicit;
- workload-specific reasoning effort and text verbosity remain explicit;
- structured workloads retain strict JSON schemas, required evidence fields, and parser validation.

Prompt review follows the current GPT-5.6 guidance: prompts should be lean, outcome-first, explicit
about constraints, success criteria, evidence, output shape, and stopping behavior, without
prescribing unnecessary intermediate reasoning. Existing working prompts are not rewritten during
the baseline model migration. A prompt changes only when inspection finds concrete duplication or
contradiction, or the offline representative eval exposes a specific missing success criterion,
evidence rule, output requirement, or stop condition. Each prompt edit must be surgical and tied to
that observed failure.

## Configuration and Compatibility

Configuration remains environment-overridable and audit-friendly. Model responses continue to
record requested and returned model identifiers. Provider ordering, quota handling, budgets,
timeouts, retries, structured-output parsing, batch replay gates, and non-OpenAI providers remain
unchanged.

Active documentation, examples, package guidance, offline eval fixtures, and tests must agree with
the new policy. Historical plans, archived evaluation reports, prior returned-model snapshots, and
documents whose purpose is to describe older model behavior remain unchanged unless they are
incorrectly presented as active defaults.

## Validation

Implementation follows test-driven development:

1. Change focused config, routing, envelope, and fixture tests first and verify they fail against the
   legacy defaults.
2. Apply the minimum production changes needed to pass those tests.
3. Run the focused backend tests for environment policy, workload routing, request envelopes, and
   structured Responses requests.
4. Run the versioned offline fixture evaluation with
   `pnpm --filter @esl-pipeline/batch-backend generation:eval`.
5. Run `pnpm docs:generate:indexes`, `pnpm docs:check`, and
   `pnpm --silent run check:fast:agent`.
6. Run `pnpm check:pre-pr` because the migration crosses runtime configuration, prompts, fixtures,
   tests, and canonical docs.

No credentialed live evaluation, target activation, deployment, commit of implementation changes,
push, or pull request is included unless separately requested. If a live evaluation is later run,
compare representative workload quality, schema validity, evidence coverage, latency, total and
reasoning tokens, and provider errors before further lowering or raising effort.

## Success Criteria

- Every active built-in OpenAI model default is either `gpt-5.6-sol` or `gpt-5.6-luna`.
- Assignment generation uses Sol at medium effort.
- Profile revision and student-memory snapshot use Luna at medium effort.
- Lesson memory, homework memory, and candidate patch use Luna at low effort.
- Strict schemas, evidence requirements, and provider/audit behavior remain intact.
- Active docs and offline fixtures match runtime policy.
- Prompt changes, if any, are minimal and justified by a concrete GPT-5.6 guidance mismatch or eval
  failure.
- Required focused, offline-eval, documentation, affected, and pre-PR checks pass, or any remaining
  failure is reported with exact evidence.
