import { expect, test } from '../fixtures';
import { keepTestData } from '../../src/config';
import { petstoreSpec } from '../../src/petstore';

/**
 * The remaining calls the console makes, which the main workflow doesn't reach:
 * the single-call create, version deletion and API deletion.
 */
const apiName = `petstore-console-${Date.now()}`;
let apiId = '';

test.describe.serial('Console flows', () => {
  test.afterAll(async ({ konnect }) => {
    if (!apiId || keepTestData) return;
    await konnect.deleteApi(apiId);
  });

  test('creates an API and its first version in a single call', async ({ konnect }) => {
    const spec = petstoreSpec('1.0.27');
    const api = await konnect.createApiWithSpec(apiName, spec, 'Created the way the console does it');
    apiId = api.id;

    expect(api.name).toBe(apiName);
    expect(api.version).toBe('1.0.27');

    const versions = await konnect.listVersions(apiId);
    expect(versions.map((v) => v.version)).toEqual(['1.0.27']);
    expect((await konnect.currentVersion(apiId))?.version).toBe('1.0.27');
  });

  test('deletes a version without touching the rest of the API', async ({ konnect }) => {
    const extra = await konnect.upsertVersion(apiId, petstoreSpec('2.0'));
    expect(await konnect.listVersions(apiId)).toHaveLength(2);

    await konnect.deleteVersion(apiId, extra.id);

    const remaining = await konnect.listVersions(apiId);
    expect(remaining.map((v) => v.version)).toEqual(['1.0.27']);
    expect((await konnect.currentVersion(apiId))?.version).toBe('1.0.27');
  });

  test('deletes the API and its versions', async ({ konnect }) => {
    const [version] = await konnect.listVersions(apiId);

    await konnect.deleteApi(apiId);

    expect((await konnect.http.get(`/v3/apis/${apiId}`)).status()).toBe(404);
    expect((await konnect.http.get(`/v3/apis/${apiId}/versions/${version.id}`)).status()).toBe(404);

    apiId = '';
  });
});
