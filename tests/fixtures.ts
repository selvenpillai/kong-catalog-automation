import { randomUUID } from 'node:crypto';
import { test as base, request } from '@playwright/test';
import { ignoreHttpsErrors, keepTestData, konnectBaseUrl, konnectToken } from '../src/config';
import { Konnect, type Api } from '../src/konnect';

type TestFixtures = { api: Api };
type WorkerFixtures = { konnect: Konnect };

/**
 * Names have to survive several workers provisioning at once, so a timestamp alone
 * isn't enough. The test title makes a leftover recognisable if a run dies mid-flight.
 */
function apiName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-|-$/g, '');
  return `petstore-${slug}-${randomUUID().slice(0, 8)}`;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Worker scoped so that afterAll hooks can still reach it for teardown.
  konnect: [
    async ({}, use) => {
      const context = await request.newContext({
        baseURL: konnectBaseUrl,
        extraHTTPHeaders: {
          Authorization: `Bearer ${konnectToken()}`,
          'Content-Type': 'application/json',
        },
        ignoreHTTPSErrors: ignoreHttpsErrors,
      });

      await use(new Konnect(context));
      await context.dispose();
    },
    { scope: 'worker' },
  ],

  /**
   * An empty API belonging to one test, so tests that need somewhere to work don't have
   * to share and can therefore run in parallel. Fixtures are lazy: a test that doesn't
   * ask for `api` doesn't create one.
   *
   * A suite whose steps build on each other can't use this, because the fixture is
   * disposed between tests. Those manage their own API and run serially.
   */
  api: async ({ konnect }, use, testInfo) => {
    const created = await konnect.createApi(
      apiName(testInfo.title),
      'Created by the API Catalog test suite',
    );

    await use(created);

    if (keepTestData) {
      console.log(`KEEP_TEST_DATA is set, leaving "${created.name}" (${created.id}) in the org.`);
      return;
    }
    await konnect.deleteApi(created.id);
  },
});

export { expect } from '@playwright/test';
