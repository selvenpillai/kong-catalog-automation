import { readFileSync } from 'fs';
import path from 'path';

export interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, unknown>;
  [key: string]: unknown;
}

const source = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'fixtures', 'petstore.json'), 'utf8'),
) as OpenApiSpec;

/**
 * Konnect reads the version label from `info.version` and rejects an upload whose
 * `version` field disagrees with it, so the label has to be written into the spec
 * rather than passed alongside it. The shipped Petstore file is 1.0.27.
 */
export function petstoreSpec(version: string): OpenApiSpec {
  return { ...source, info: { ...source.info, version } };
}

/** The same spec plus one extra operation, so 1.1 differs from 1.0 by more than its label. */
export function petstoreSpecWithHealthCheck(version: string): OpenApiSpec {
  const spec = petstoreSpec(version);
  return {
    ...spec,
    paths: {
      ...spec.paths,
      '/store/health': {
        get: {
          tags: ['store'],
          summary: 'Service health',
          operationId: 'getStoreHealth',
          responses: { '200': { description: 'The store is accepting orders' } },
        },
      },
    },
  };
}

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

/** Counts operations, not paths: a path with both a get and a post is two operations. */
export function operationCount(spec: OpenApiSpec): number {
  return Object.values(spec.paths).reduce<number>((total, item) => {
    if (!item || typeof item !== 'object') return total;
    return total + Object.keys(item).filter((key) => HTTP_METHODS.has(key.toLowerCase())).length;
  }, 0);
}

/** Konnect stores a reformatted copy of the document, so tests compare parsed values. */
export function parseSpec(content: string): OpenApiSpec {
  return JSON.parse(content) as OpenApiSpec;
}
