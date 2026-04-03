import eslintReactPlugin from '@eslint-react/eslint-plugin';
import vitestPlugin from '@vitest/eslint-plugin';
import { defineConfig } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      'node_modules/**',
      'out/**',
      'coverage/**',
      '.pnpm-store/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  // TypeScript parsing for the specialized ESLint lane
  {
    files: ['packages/batch-frontend/**/*.{ts,tsx}', 'packages/**/*.{test,spec}.{ts,tsx}'],
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
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
  // React rules (batch-frontend)
  {
    files: ['packages/batch-frontend/**/*.{ts,tsx}'],
    extends: [eslintReactPlugin.configs['recommended-typescript']],
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
      '@eslint-react/component-hook-factories': 'off',
      '@eslint-react/no-array-index-key': 'off',
      '@eslint-react/no-context-provider': 'off',
      '@eslint-react/no-direct-mutation-state': 'off',
      '@eslint-react/no-use-context': 'off',
      '@eslint-react/purity': 'off',
      '@eslint-react/set-state-in-effect': 'off',
      '@eslint-react/use-state': 'off',
      '@eslint-react/naming-convention-ref-name': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  // Vitest rules
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    plugins: {
      vitest: vitestPlugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      ...vitestPlugin.configs.recommended.rules,
      'vitest/expect-expect': 'off', // Common in some test patterns
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
