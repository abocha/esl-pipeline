import js from '@eslint/js';
import queryPlugin from '@tanstack/eslint-plugin-query';
import vitestPlugin from '@vitest/eslint-plugin';
import eslintConfigPrettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import-x';
import nodePlugin from 'eslint-plugin-n';
import promisePlugin from 'eslint-plugin-promise';
import reactPlugin from 'eslint-plugin-react';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import unicornPlugin from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', 'node_modules/**', 'out/**', 'coverage/**', '.pnpm-store/**'],
  },
  // Base JS rules
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    extends: [js.configs.recommended, promisePlugin.configs['flat/recommended']],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      n: nodePlugin,
      'import-x': importPlugin,
      unicorn: unicornPlugin,
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': 'off', // Handled by TS
      'no-useless-escape': 'off',
      'no-misleading-character-class': 'off',
      'no-empty': 'off',

      // Node rules
      'n/no-unsupported-features/es-syntax': 'off',
      'n/no-missing-import': 'off', // Handled by TS/Import

      // Import rules
      'import-x/no-unresolved': 'off', // Handled by TS
      'import-x/order': 'off', // Handled by Prettier/other tools

      // Unicorn rules - selective enablement
      ...unicornPlugin.configs['recommended'].rules,
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/filename-case': 'off',
      'unicorn/no-null': 'off',
      'unicorn/prefer-top-level-await': 'off',
      'unicorn/no-process-exit': 'off',
      'unicorn/import-style': 'off',
      'unicorn/no-array-sort': 'off',
      'unicorn/consistent-function-scoping': 'off',
    },
  },
  // TypeScript rules
  {
    files: ['packages/**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommended, ...tseslint.configs.stylistic],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
  // React rules (batch-frontend)
  {
    files: ['packages/batch-frontend/**/*.{ts,tsx}'],
    extends: [
      reactPlugin.configs.flat.recommended,
      reactPlugin.configs.flat['jsx-runtime'],
      queryPlugin.configs['flat/recommended'],
    ],
    plugins: {
      'react-refresh': reactRefreshPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  // Vitest rules
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    plugins: {
      vitest: vitestPlugin,
    },
    rules: {
      ...vitestPlugin.configs.recommended.rules,
      'vitest/expect-expect': 'off', // Common in some test patterns
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  // Batch frontend context files are allowed to export helpers alongside components
  {
    files: ['packages/batch-frontend/src/context/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // Prettier must be last
  eslintConfigPrettier,
);
