# Agent validation routing verification — ESL-52

Date: 2026-10-12. Historical implementation evidence; current procedure is owned by
[AGENTS.md](../../../../AGENTS.md), the
[testing guide](../../../reference/TESTING_GUIDELINES.md#choose-the-evidence-route) and package recipes.
Execution: [ESL-52](https://linear.app/abocha/issue/ESL-52/streamline-agent-validation-discovery-and-instruction-ownership).

## Result and boundary

Consolidated validation decisions into the testing guide, kept invariants in the SSOT and replaced
parallel adapter/backend docs-check recipes with links. The guide now starts with task routes;
conditional CI implementation and timing notes follow routine execution guidance. The backend README
explains single-test lookup/setup/invocation and service prerequisites. The infrastructure skill routes
to mechanism owners and meaningful evidence; test-audit links to fixture/retention policy instead of
copying it. A local memory reconciliation note distinguishes retired runners from current routes.

Runtime code, test membership, safeguards, CI topology and hosted merge requirements were not changed.
No general runner, dependency or agent configuration was added to the repository. This demonstrates
usable routes and removed conflicts, not a measured reduction in agent task time or token use.

## Representative walkthroughs

| Task                                     | Previous friction                                                                                                                                       | Verified route and outcome                                                                                                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused backend regression               | README listed several suite commands without a single-test setup/invocation recipe.                                                                     | AGENTS → guide's ordinary-change row → backend Validation → project model. The documented read-only lookup resolves `config.pure-environment.test.ts` to `pure`; backend dependency setup and the exact focused invocation succeeded. No services or provider calls were needed. |
| Docs-only edit                           | Adapter, SSOT and backend README prescribed full docs checks; the guide already distinguished PR mode. The broad formatter also checked untouched code. | All entrypoints now use the guide's docs-only recipe: affected indexes, explicit Markdown/YAML formatting and PR-mode docs checks. PR mode's non-empty committed-diff requirement and working-tree document reads were checked against its implementation.                       |
| Backend validation-infrastructure change | Skill named broad owner categories without paths or evidence choices.                                                                                   | Guide → infrastructure skill's membership/environment row → project model and setup → existing project-contract/pure-environment cases. Six existing tests passed. This verifies the documented route; no membership change or service interaction was simulated.                |

The draft walkthrough exposed an incorrect example test path; the final recipe uses an existing test
and explicitly treats an empty lookup as missing evidence. The helper route identifies that adjacent
environment tests do not prove child-process behavior; it does not claim nonexistent helper coverage.
All 47 newly introduced relative link targets and heading anchors resolved in a focused local check.

## Executed evidence

- `pnpm --filter @esl-pipeline/batch-backend test:unit:setup`: passed; built the backend dependency graph.
- `pnpm --filter @esl-pipeline/batch-backend exec vitest run --config vitest.config.ts --project pure tests/config.pure-environment.test.ts`: one file, one test passed.
- `node --test scripts/check/backend-test-projects.test.mjs scripts/test/pure-test-env.test.mjs`: six tests passed.
- `uv run --no-project --with pyyaml python <installed-skill-creator>/scripts/quick_validate.py <skill-directory>`: both changed skills valid. The placeholders identify the installed system skill and each changed skill directory. The system Python lacked PyYAML; validation used an isolated tool environment without changing repo dependencies.
- `pnpm docs:generate:indexes`: succeeded; no substantive index changes. Restored its unrelated generated plans-index command-marker change.
- Explicit `pnpm exec prettier --ignore-path .prettierignore --check` on the eight changed Markdown files: passed. The default invocation silently skipped the tracked, Git-ignored test-audit skill; the explicit ignore file exposed its formatting findings, which were repaired.
- `pnpm docs:check:pr -- --from main --to HEAD`: passed (10 core, 10 operations, 14 non-core documents).
- `git diff --check`: passed.
- `pnpm format`: failed with 50 findings in untouched source/tooling files; no fixes applied. This supplied concrete evidence for using explicit docs-file formatting locally. It does not establish hosted formatting status.

## Remaining requirements

The unchanged classifier's `node scripts/check/run-ci-scope.mjs --from main --to HEAD` projection
selects build/unit and backend packaging because `packages/batch-backend/README.md` is treated as a
workspace input. Integration, DB/worker, media and Telegram are not selected. The release policy also
treats that package README as release-worthy, so this change requires `release:patch` despite its
documentation-only content. This residual routing cost is recorded; changing classification would
be a separate validation-system change, outside this consolidation.

Hosted CI remains the comprehensive merge gate. Service suites, media tests, live providers and
production operations were not run for this documentation/skill change. The walkthroughs are local
route evidence, not comprehensive application regression or a benchmark campaign.
