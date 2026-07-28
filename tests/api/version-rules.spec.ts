import { expect, test } from '../fixtures';
import type { ApiError } from '../../src/konnect';
import { petstoreSpec } from '../../src/petstore';

/**
 * The constraints the versions endpoint actually enforces. These are the rules the
 * workflow tests depend on, pinned down so a change in Konnect shows up here as a
 * specific failure rather than as a confusing one somewhere else.
 *
 * Each test owns its API through the `api` fixture, so nothing here is ordered and the
 * file runs in parallel. The workflow suites can't do this: their steps build on each
 * other and have to share one entity.
 */
test.describe.configure({ mode: 'parallel' });

test.describe('Version rules', () => {
  test('rejects a version label that disagrees with the spec', async ({ konnect, api }) => {
    const res = await konnect.http.post(`/v3/apis/${api.id}/versions`, {
      data: { version: '3.0', spec: { content: JSON.stringify(petstoreSpec('1.0.27')) } },
    });

    expect(res.status()).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(JSON.stringify(body.invalid_parameters)).toContain('must match the spec');
  });

  test('rejects a version label that already exists', async ({ konnect, api }) => {
    await konnect.upsertVersion(api.id, petstoreSpec('1.0'));

    const res = await konnect.http.post(`/v3/apis/${api.id}/versions`, {
      data: { version: '1.0', spec: { content: JSON.stringify(petstoreSpec('1.0')) } },
    });

    expect(res.status()).toBe(409);
    expect(((await res.json()) as ApiError).detail).toContain('already exists');
  });

  // No API needed: validation is a standalone endpoint, so this test never provisions one.
  test('rejects a document that is not a specification', async ({ konnect }) => {
    const res = await konnect.http.post('/v3/apis/validate-specification', {
      data: { content: JSON.stringify({ hello: 'world' }) },
    });

    expect(res.status()).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(JSON.stringify(body.invalid_parameters)).toContain('valid specification');
  });

  test('deleting the current version leaves the API without one', async ({ konnect, api }) => {
    await konnect.upsertVersion(api.id, petstoreSpec('1.0'));

    // The console hides "Delete version" on the current version. The API has no such
    // rule: it deletes it and promotes nothing in its place. See JOURNAL.md.
    await konnect.upsertVersion(api.id, petstoreSpec('1.1'));
    await konnect.setCurrentVersion(api.id, '1.1');

    const current = await konnect.currentVersion(api.id);
    expect(current?.version).toBe('1.1');

    await konnect.deleteVersion(api.id, current!.id);

    const after = await konnect.getApi(api.id);
    expect(after.current_version_summary).toBeNull();
    expect(after.version).toBeNull();

    const remaining = await konnect.listVersions(api.id);
    expect(remaining.map((v) => v.version)).toEqual(['1.0']);
  });
});
