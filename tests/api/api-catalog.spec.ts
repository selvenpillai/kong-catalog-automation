import { expect, test } from '../fixtures';
import { keepTestData } from '../../src/config';
import { operationCount, parseSpec, petstoreSpec, petstoreSpecWithHealthCheck } from '../../src/petstore';

const apiName = `petstore-e2e-${Date.now()}`;
let apiId: string;

test.describe.serial('API Catalog versioning workflow', () => {
  test.afterAll(async ({ konnect }) => {
    if (!apiId) return;

    if (keepTestData) {
      console.log(`KEEP_TEST_DATA is set, leaving "${apiName}" (${apiId}) in the org.`);
      return;
    }
    await konnect.deleteApi(apiId);
  });

  test('creates an API entity', async ({ konnect }) => {
    const created = await konnect.createApi(apiName, 'Created by the API Catalog test suite');
    apiId = created.id;

    expect(created.name).toBe(apiName);

    const fetched = await konnect.getApi(apiId);
    expect(fetched.id).toBe(apiId);
    expect(fetched.name).toBe(apiName);
    expect(await konnect.listVersions(apiId)).toEqual([]);
  });

  test('upserts the Petstore spec as version 1.0', async ({ konnect }) => {
    const spec = petstoreSpec('1.0');
    expect(await konnect.validateSpec(spec)).toEqual([]);

    const version = await konnect.upsertVersion(apiId, spec);
    expect(version.version).toBe('1.0');

    const versions = await konnect.listVersions(apiId);
    expect(versions.map((v) => v.version)).toEqual(['1.0']);

    // Konnect reformats the document it stores, so compare parsed values, not text.
    const stored = await konnect.getVersion(apiId, version.id);
    expect(stored.spec?.type).toBe('oas3');
    const storedSpec = parseSpec(stored.spec!.content!);
    expect(storedSpec.info.version).toBe('1.0');
    expect(operationCount(storedSpec)).toBe(operationCount(spec));

    expect((await konnect.currentVersion(apiId))?.version).toBe('1.0');
  });

  test('upserts a second spec as version 1.1 and sets it current', async ({ konnect }) => {
    const spec = petstoreSpecWithHealthCheck('1.1');
    const version = await konnect.upsertVersion(apiId, spec);
    expect(version.version).toBe('1.1');

    // Adding a version does not promote it. 1.0 stays current until we say otherwise.
    expect((await konnect.currentVersion(apiId))?.version).toBe('1.0');

    await konnect.setCurrentVersion(apiId, '1.1');

    const versions = await konnect.listVersions(apiId);
    expect(versions).toHaveLength(2);
    expect(versions.map((v) => v.version).sort()).toEqual(['1.0', '1.1']);
    expect((await konnect.currentVersion(apiId))?.version).toBe('1.1');

    const stored = await konnect.getVersion(apiId, version.id);
    expect(operationCount(parseSpec(stored.spec!.content!))).toBe(operationCount(spec));
  });

  test('re-upserting a version replaces its content instead of adding another', async ({ konnect }) => {
    const replacement = petstoreSpec('1.1');
    await konnect.upsertVersion(apiId, replacement);

    const versions = await konnect.listVersions(apiId);
    expect(versions.map((v) => v.version).sort()).toEqual(['1.0', '1.1']);

    const current = await konnect.currentVersion(apiId);
    expect(current?.version).toBe('1.1');

    const stored = await konnect.getVersion(apiId, current!.id);
    expect(operationCount(parseSpec(stored.spec!.content!))).toBe(operationCount(replacement));
  });
});
