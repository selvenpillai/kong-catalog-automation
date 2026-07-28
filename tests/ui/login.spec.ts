import { expect, test } from '@playwright/test';
import { uiCredentials } from '../../src/config';

const { username, password } = uiCredentials;

/**
 * Optional, and deliberately kept out of the `api` project.
 *
 * Konnect signs in through Auth0's hosted login rather than an API endpoint, so this
 * is a real browser flow: an identifier step, a password step, an optional passkey
 * enrolment prompt, then an OAuth redirect back to the console. It is the least stable
 * part of the exercise, which is why the API suite authenticates with a PAT instead.
 */
test.describe('Konnect UI login', () => {
  test.skip(!username || !password, 'Set KONNECT_USERNAME and KONNECT_PASSWORD to run this test');

  test('signs in with the provided credentials', async ({ page }) => {
    // Identifier step, password step, passkey prompt and two OAuth redirects take
    // well past the default 30s budget.
    test.setTimeout(120_000);

    // The identifier page also offers Google, GitHub, Microsoft and passkey buttons,
    // so target the primary action rather than any submit button.
    const primaryAction = page.locator('button[data-action-button-primary="true"]');

    await page.goto('/');

    await page.locator('input#username').fill(username!);
    await primaryAction.click();

    await page.locator('input#password').fill(password!);
    await primaryAction.click();

    // Auth0 offers passkey enrolment straight after a successful password login.
    if (await page.waitForURL(/passkey-enrollment/, { timeout: 10_000 }).then(() => true, () => false)) {
      await page.getByRole('button', { name: /not now|maybe later|skip|continue without/i }).click();
    }

    // The callback lands on /login?code=... before exchanging the code and redirecting
    // into the console proper, so wait for the URL to settle rather than for any
    // cloud.konghq.com URL.
    await page.waitForURL((url) => url.hostname === 'cloud.konghq.com' && !url.pathname.startsWith('/login'), {
      timeout: 90_000,
    });

    // A fresh browser profile is asked to pick a region before the console opens.
    const regionPrompt = page.getByRole('heading', { name: /select a konnect region/i });
    const regionPromptShown = await regionPrompt.waitFor({ state: 'visible', timeout: 15_000 }).then(
      () => true,
      () => false,
    );
    if (regionPromptShown) {
      await page.getByRole('button', { name: 'Continue' }).click();
    }

    await expect(page.getByRole('heading', { name: /welcome to konnect/i })).toBeVisible({ timeout: 30_000 });
  });
});
