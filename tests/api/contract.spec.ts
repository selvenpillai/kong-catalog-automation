import { randomUUID } from 'node:crypto';
import { expect, test } from '../fixtures';
import type { ApiError } from '../../src/konnect';

/**
 * Entity-level guarantees the suite leans on: authentication is enforced, names are
 * unique and required, missing things read as 404, and the wrong method reads as 405.
 * These are the errors a client would hit first, so it's worth knowing they stay put.
 *
 * Each test owns its API through the `api` fixture where it needs one, so the file has
 * no ordering and runs in parallel.
 */
test.describe.configure({ mode: 'parallel' });

test.describe('API contract', () => {
  test('rejects a request without a valid token', async ({ konnect }) => {
    // Override just the Authorization header on an otherwise normal request.
    const res = await konnect.http.get('/v3/apis', {
      headers: { Authorization: 'Bearer kpat_notarealtoken' },
    });

    expect(res.status()).toBe(401);
  });

  test('rejects a second API with a name already in use', async ({ konnect, api }) => {
    const res = await konnect.http.post('/v3/apis', { data: { name: api.name } });

    // The uniqueness is on name + null version, not name alone. The message is worth
    // pinning because it explains a 409 that would otherwise look like a plain conflict.
    expect(res.status()).toBe(409);
    expect(((await res.json()) as ApiError).detail).toContain('null version');
  });

  test('rejects an API with an empty name', async ({ konnect }) => {
    const res = await konnect.http.post('/v3/apis', { data: { name: '' } });

    expect(res.status()).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(JSON.stringify(body.invalid_parameters)).toContain('name');
  });

  test('returns 404 for an API that does not exist', async ({ konnect }) => {
    const res = await konnect.http.get(`/v3/apis/${randomUUID()}`);

    expect(res.status()).toBe(404);
  });

  test('returns 405 for a method the resource does not support', async ({ konnect, api }) => {
    // /implementations exists as a top-level collection but not under an API, so the
    // router answers "method not allowed" rather than 404.
    const res = await konnect.http.get(`/v3/apis/${api.id}/implementations`);

    expect(res.status()).toBe(405);
  });
});
