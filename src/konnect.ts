import type { APIRequestContext, APIResponse } from '@playwright/test';
import type { OpenApiSpec } from './petstore';

export interface Api {
  id: string;
  name: string;
  description: string | null;
  version: string | null;
  slug: string;
  current_version_summary: { id: string; spec?: { type: string } } | null;
}

export interface ApiVersion {
  id: string;
  version: string;
  spec?: { type: string; content?: string; validation_messages?: { message: string }[] };
}

/** The error body Konnect returns. `invalid_parameters` accompanies a 400, `detail` a 409. */
export interface ApiError {
  status: number;
  title: string;
  detail: string;
  invalid_parameters?: { field: string; reason: string; source: string; rule: string }[];
}

async function unwrap<T>(res: APIResponse, expected: number): Promise<T> {
  if (res.status() !== expected) {
    throw new Error(`Expected ${expected} from ${res.url()}, got ${res.status()}:\n${await res.text()}`);
  }
  return (await res.json()) as T;
}

export class Konnect {
  constructor(private readonly request: APIRequestContext) {}

  /** Escape hatch for tests that assert on error responses rather than happy paths. */
  get http(): APIRequestContext {
    return this.request;
  }

  async createApi(name: string, description?: string): Promise<Api> {
    const res = await this.request.post('/v3/apis', { data: { name, description } });
    return unwrap<Api>(res, 201);
  }

  /**
   * Creates the API and its first version in one call, which is what the console does
   * when you upload a spec from the "New API" dialog.
   */
  async createApiWithSpec(name: string, spec: OpenApiSpec, description?: string): Promise<Api> {
    const res = await this.request.post('/v3/apis', {
      data: { name, description, version: spec.info.version, spec_content: JSON.stringify(spec) },
    });
    return unwrap<Api>(res, 201);
  }

  async getApi(apiId: string): Promise<Api> {
    return unwrap<Api>(await this.request.get(`/v3/apis/${apiId}`), 200);
  }

  async deleteApi(apiId: string): Promise<void> {
    const res = await this.request.delete(`/v3/apis/${apiId}`);
    if (res.status() !== 204 && res.status() !== 404) {
      throw new Error(`Failed to delete API ${apiId}: ${res.status()} ${await res.text()}`);
    }
  }

  async listVersions(apiId: string): Promise<ApiVersion[]> {
    const res = await this.request.get(`/v3/apis/${apiId}/versions`);
    return (await unwrap<{ data: ApiVersion[] }>(res, 200)).data;
  }

  async getVersion(apiId: string, versionId: string): Promise<ApiVersion> {
    return unwrap<ApiVersion>(await this.request.get(`/v3/apis/${apiId}/versions/${versionId}`), 200);
  }

  async deleteVersion(apiId: string, versionId: string): Promise<void> {
    const res = await this.request.delete(`/v3/apis/${apiId}/versions/${versionId}`);
    if (res.status() !== 204) {
      throw new Error(`Failed to delete version ${versionId}: ${res.status()} ${await res.text()}`);
    }
  }

  /**
   * Adds the spec as a new version, or replaces the content of the existing version
   * carrying the same label. This mirrors what the "Add or update API spec" dialog
   * does: a new label POSTs, a familiar one PATCHes.
   */
  async upsertVersion(apiId: string, spec: OpenApiSpec): Promise<ApiVersion> {
    const version = spec.info.version;
    const data = { version, spec: { content: JSON.stringify(spec) } };

    const existing = (await this.listVersions(apiId)).find((v) => v.version === version);
    if (existing) {
      const res = await this.request.patch(`/v3/apis/${apiId}/versions/${existing.id}`, { data });
      return unwrap<ApiVersion>(res, 200);
    }

    const res = await this.request.post(`/v3/apis/${apiId}/versions`, { data });
    return unwrap<ApiVersion>(res, 201);
  }

  /** Promoting a version is an update to the parent API, not to the version itself. */
  async setCurrentVersion(apiId: string, version: string): Promise<Api> {
    const res = await this.request.patch(`/v3/apis/${apiId}`, { data: { version } });
    return unwrap<Api>(res, 200);
  }

  /**
   * `current_version_summary` carries an id but no version label, so the current
   * version has to be resolved against the version list.
   */
  async currentVersion(apiId: string): Promise<ApiVersion | undefined> {
    const api = await this.getApi(apiId);
    if (!api.current_version_summary) return undefined;
    const versions = await this.listVersions(apiId);
    return versions.find((v) => v.id === api.current_version_summary!.id);
  }

  async validateSpec(spec: OpenApiSpec): Promise<{ message: string }[]> {
    const res = await this.request.post('/v3/apis/validate-specification', {
      data: { content: JSON.stringify(spec) },
    });
    const body = await unwrap<{ validation_messages: { message: string }[] }>(res, 201);
    return body.validation_messages;
  }
}
