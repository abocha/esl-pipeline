# ESLint 9 -> 10 Migration Playbook

This playbook outlines the steps for an AI agent to migrate a repository from ESLint v9 to v10, specifically tailored for a **pnpm monorepo**.

## Prerequisites

-   **Node.js**: Ensure the environment is running Node.js `^20.19.0`, `^22.13.0`, or `>=24.0.0`.
    -   *Action*: run `node -v` to verify.

## Migration Steps

### 1. Update Dependencies

Update ESLint and related packages.
-   **Action**:
    -   Run `pnpm add -D eslint@latest` in the relevant package or workspace root.
    -   Use `pnpm add -D eslint@latest -w` if ESLint is a root dependency.
    -   For all packages in the workspace: `pnpm -r add -D eslint@latest` (use with caution, verify if all packages need the update).
-   **Check**: If `jiti` is present in `package.json`, ensure it is updated to at least `v2.2.0`.

### 2. Verify Configuration Format

ESLint v10 **drops support** for the old configuration system (`.eslintrc*`, `package.json` `eslintConfig` field).
This playbook assumes the user is already on Flat Config (v9).

-   **Check**: Does `eslint.config.js` (or `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`) exist?
-   **Action**:
    -   If `eslint.config.js` exists: Ensure no legacy config files (`.eslintrc.*`) remain. Delete them if found.
    -   If ONLY legacy config exists: **STOP**. A full "Flat Config" migration is required first (using `@eslint/migrate`).
    -   **Remove Options**: In `eslint.config.js`, remove any "configType: 'eslintrc'" options if present in `Linter` options.

### 3. Clean Up CLI Flags

ESLint v10 makes the "config lookup from file" behavior default and removes the feature flag.

-   **Search**: Look for `v10_config_lookup_from_file` in `package.json` scripts, `Makefiles`, or CI configurations.
-   **Action**: Remove `--flag v10_config_lookup_from_file` and remove `v10_config_lookup_from_file` from `ESLINT_FLAGS` environment variable.

### 4. Codebase Cleanup

#### Remove `eslint-env` Comments
`/* eslint-env node */` style comments are now **errors**.

-   **Search**: `grep -r "eslint-env" .`
-   **Action**: Remove these comments. Define environments (e.g., `globals: { node: true }`) in `eslint.config.js` instead.

#### Fix JSX Variable Tracking
ESLint v10 now correctly tracks JSX identifiers (e.g., `<Card />` is a reference to `Card`).

-   **Action**:
    -   Remove workarounds like `@eslint-react/jsx-uses-vars` or `react/jsx-uses-vars` from `eslint.config.js` that might have been used to suppress false positives.
    -   Run the linter (`pnpm eslint .`).
    -   Expect **new errors**:
        -   `no-unused-vars`: Check if you have definitions that were previously ignored.
        -   `no-undef`: Check that all JSX components are properly imported/defined.

### 5. Address `eslint:recommended` Updates

Three new rules are enabled by default in `eslint:recommended`:
-   `no-unassigned-vars`
-   `no-useless-assignment`
-   `preserve-caught-error`

-   **Action**: Run the linter. If these report errors, fix the code or disable the rule in `eslint.config.js`.

### 6. Verify Support for Glob Patterns

ESLint v10 uses `minimatch` with POSIX character class support.

-   **Check**: Review `eslint.config.js` `files` and `ignores` patterns.
-   **Action**: Ensure no patterns accidentally look like POSIX classes (e.g., `[[:upper:]]`) unless intended.

## Validation

1.  Run `pnpm eslint .` (or `pnpm exec eslint .`) and ensure no fatal errors occur regarding configuration loading.
2.  Fix any new linting errors that appear.
3.  Run project tests to ensure no regressions (`pnpm test`).
