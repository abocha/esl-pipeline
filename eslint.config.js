import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import nodePlugin from 'eslint-plugin-node';
import promisePlugin from 'eslint-plugin-promise';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

const ignores = ['**/dist/**', 'node_modules/**', 'out/**', 'coverage/**', '.pnpm-store/**'];
const tsconfigRootDir = new URL('.', import.meta.url).pathname;

const tsRules = {
  '@typescript-eslint/no-unused-vars': [
    'warn',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
    },
  ],
  '@typescript-eslint/explicit-module-boundary-types': 'off',
};

const baseRules = {
  ...js.configs.recommended.rules,
  ...promisePlugin.configs.recommended.rules,
  ...tsRules,
  'no-console': 'off',
  'no-unused-vars': 'off',
  'promise/param-names': 'off',
  'import/order': 'off',
  'import/no-unresolved': 'error',
  'no-useless-escape': 'off',
  'no-misleading-character-class': 'off',
  'no-empty': 'off',
  'node/no-unsupported-features/es-syntax': 'off',
  'node/no-missing-import': 'off',
};

const tsLanguageOptions = {
  parser: tsparser,
  parserOptions: {
    project: './tsconfig.base.json',
    tsconfigRootDir,
  },
  globals: {
    ...globals.node,
    TextEncoder: 'readonly',
    ReadableStream: 'readonly',
  },
};

export default [
  {
    ignores,
  },
  {
    files: ['packages/**/*.{ts,tsx}'],
    languageOptions: tsLanguageOptions,
    plugins: {
      '@typescript-eslint': tseslint,
      import: importPlugin,
      node: nodePlugin,
      promise: promisePlugin,
    },
    rules: baseRules,
    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.base.json',
        },
      },
    },
  },
  {
    files: ['packages/batch-frontend/**/*.{ts,tsx}'],
    languageOptions: {
      ...tsLanguageOptions,
      globals: {
        ...tsLanguageOptions.globals,
        ...globals.browser,
      },
    },
  },
  eslintConfigPrettier,
];
