import { randomUUID } from 'node:crypto';
import { expect, test } from '../fixtures';
import type { Api, ApiError } from '../../src/konnect';
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

  test('single-call create does not enforce the version/spec match the versions endpoint does', async ({ konnect }) => {
    // The two-step POST above rejects a mismatch. The single-call create path doesn't:
    // it takes `version` at face value, builds the version from the spec's info.version,
    // and reconciles nothing, so the API advertises a current version it doesn't have.
    const res = await konnect.http.post('/v3/apis', {
      data: {
        name: `petstore-mismatch-${randomUUID().slice(0, 8)}`,
        version: '9.9',
        spec_content: JSON.stringify(petstoreSpec('1.0.27')),
      },
    });

    expect(res.status()).toBe(201);
    const api = (await res.json()) as Api;
    try {
      expect(api.version).toBe('9.9');
      expect((await konnect.listVersions(api.id)).map((v) => v.version)).toEqual(['1.0.27']);
      expect((await konnect.getApi(api.id)).current_version_summary).toBeNull();
    } finally {
      await konnect.deleteApi(api.id);
    }
  });

  test('rejects a version label that already exists', async ({ konnect, api }) => {
    await konnect.upsertVersion(api.id, petstoreSpec('1.0'));

    const res = await konnect.http.post(`/v3/apis/${api.id}/versions`, {
      data: { version: '1.0', spec: { content: JSON.stringify(petstoreSpec('1.0')) } },
    });

    expect(res.status()).toBe(409);
    expect(((await res.json()) as ApiError).detail).toContain('already exists');
  });

  test('rejects a spec whose content exceeds the upload size limit', async ({ konnect, api }) => {
    // The console caps uploads at 8 MB, but the API doesn't: the only limit is a request
    // body cap at the edge, above 10 MiB. Pad a valid document past it. It's a 413, not a
    // validation error, and nothing is stored. See JOURNAL.md.
    const bloated = petstoreSpec('1.0');
    bloated.info.description = 'x'.repeat(12 * 1024 * 1024);

    const res = await konnect.http.post(`/v3/apis/${api.id}/versions`, {
      data: { spec: { content: JSON.stringify(bloated) } },
    });

    expect(res.status()).toBe(413);
    expect(await konnect.listVersions(api.id)).toEqual([]);
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

  test('rejects content that is not JSON or YAML', async ({ konnect }) => {
    const res = await konnect.http.post('/v3/apis/validate-specification', {
      data: { content: 'this is not a spec' },
    });

    expect(res.status()).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('JSON or YAML');
  });

  test('rejects a spec with an unsupported OpenAPI version', async ({ konnect }) => {
    // Valid JSON and shaped like a spec, but 4.0.0 isn't a version Konnect knows. This is
    // as deep as the validation goes: wrong field types (see JOURNAL.md) still pass.
    const res = await konnect.http.post('/v3/apis/validate-specification', {
      data: { content: JSON.stringify({ openapi: '4.0.0', info: { title: 't', version: '1.0' }, paths: {} }) },
    });

    expect(res.status()).toBe(400);
    expect(((await res.json()) as ApiError).detail).toContain('Unsupported OpenAPI version');
  });

  // A document with no paths is still a valid OpenAPI document, and Konnect treats it
  // as one: it validates clean rather than warning that there is nothing to serve.
  test('accepts a structurally valid spec with no operations', async ({ konnect }) => {
    const res = await konnect.http.post('/v3/apis/validate-specification', {
      data: { content: JSON.stringify({ openapi: '3.0.3' }) },
    });

    expect(res.status()).toBe(201);
    const body = (await res.json()) as { validation_messages: { message: string }[] };
    expect(body.validation_messages).toEqual([]);
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

  test('promoting to a label with no matching version is accepted but resolves to nothing', async ({ konnect, api }) => {
    await konnect.upsertVersion(api.id, petstoreSpec('1.0'));
    await konnect.setCurrentVersion(api.id, '1.0');

    // Konnect does not check that the label exists. It writes it to the free-form
    // `version` field and leaves current_version_summary unresolved, so the API can
    // advertise a current version that points at nothing. See JOURNAL.md.
    const promoted = await konnect.setCurrentVersion(api.id, '9.9');
    expect(promoted.version).toBe('9.9');

    const after = await konnect.getApi(api.id);
    expect(after.version).toBe('9.9');
    expect(after.current_version_summary).toBeNull();
    expect((await konnect.listVersions(api.id)).map((v) => v.version)).toEqual(['1.0']);
  });
});
