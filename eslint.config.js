import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const NO_FLOAT_MESSAGE =
  'ledger-core never converts amounts to floating point. Use Decimal from ./decimal.js (or parseInt with a radix for date parts).';

export default defineConfig(
  {
    ignores: ['**/dist/**', '**/coverage/**', 'packages/transaction-schema/src/generated.ts'],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./packages/*/tsconfig.json', './tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['packages/*/test/**/*.ts'],
    rules: {
      // Asymmetric matchers such as expect.any() are typed as any.
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/ledger-core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', { name: 'parseFloat', message: NO_FLOAT_MESSAGE }],
      'no-restricted-properties': [
        'error',
        { object: 'Number', property: 'parseFloat', message: NO_FLOAT_MESSAGE },
        { object: 'Math', property: 'round', message: NO_FLOAT_MESSAGE },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.name='Number']", message: NO_FLOAT_MESSAGE },
        {
          selector: 'CallExpression[callee.property.name="toLocaleString"]',
          message: 'Output must not depend on the locale.',
        },
        {
          selector: 'CallExpression[callee.property.name="localeCompare"]',
          message: 'Use compareStrings: ordering must not depend on the locale.',
        },
        {
          selector: 'NewExpression[callee.name="Date"]',
          message: 'ledger-core does not read the clock or time zone.',
        },
        {
          selector: 'MemberExpression[object.name="Date"][property.name="now"]',
          message: 'ledger-core does not read the clock.',
        },
        {
          selector: 'MemberExpression[object.name="Math"][property.name="random"]',
          message: 'ledger-core must be deterministic.',
        },
      ],
    },
  },
  prettier,
);
