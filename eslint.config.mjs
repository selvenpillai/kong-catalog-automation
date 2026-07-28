import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import playwright from 'eslint-plugin-playwright';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'playwright-report/',
      'blob-report/',
      'test-results/',
      'fixtures/',
      'hars/',
    ],
  },

  js.configs.recommended,

  // Type-aware linting is the point of having a linter here: the mistake this suite is
  // most exposed to is a forgotten await on an API call or an expect, which reads fine
  // and passes silently.
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ['tests/**/*.ts'],
    ...playwright.configs['flat/recommended'],
  },

  // The browser login skips itself when no credentials are set, and branches around
  // interstitials that Auth0 shows only sometimes. Both are the design here, not an
  // oversight, so the two rules that object are off for that suite only.
  {
    files: ['tests/ui/**/*.ts'],
    rules: {
      'playwright/no-skipped-test': 'off',
      'playwright/no-conditional-in-test': 'off',
    },
  },

  // k6 runs its own runtime, so these globals are provided rather than imported.
  {
    files: ['k6/api-catalog.js'],
    languageOptions: {
      globals: {
        __ENV: 'readonly',
        __VU: 'readonly',
        __ITER: 'readonly',
        open: 'readonly',
      },
    },
  },

  {
    files: ['**/*.mjs', 'k6/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
);
