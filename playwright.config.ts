import { defineConfig, devices } from '@playwright/test';
import { ignoreHttpsErrors, konnectBaseUrl, konnectUiUrl } from './src/config';

export default defineConfig({
  testDir: './tests',
  // Files run in parallel; tests within a file only where the file opts in with
  // test.describe.configure({ mode: 'parallel' }). The workflow suites share one API
  // between ordered steps and would break under a global switch.
  fullyParallel: false,
  // Every worker hits the same Konnect organisation, and a rate-limited request surfaces
  // as a puzzling assertion failure rather than as "you went too fast".
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    ignoreHTTPSErrors: ignoreHttpsErrors,
  },
  projects: [
    {
      name: 'api',
      testDir: './tests/api',
      use: { baseURL: konnectBaseUrl },
    },
    {
      name: 'ui',
      testDir: './tests/ui',
      use: { ...devices['Desktop Chrome'], baseURL: konnectUiUrl },
    },
  ],
});
