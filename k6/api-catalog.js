import http from 'k6/http';
import { check, fail } from 'k6';

// The same workflow the Playwright suite covers, expressed as a k6 scenario so the
// happy path can be run under load. Defaults to a single virtual user and a single
// iteration, which is a smoke run; override with K6_VUS and K6_ITERATIONS.

const BASE_URL = __ENV.KONNECT_BASE_URL || 'https://us.api.konghq.com';
const TOKEN = __ENV.KONNECT_PAT;

const petstore = JSON.parse(open('../fixtures/petstore.json'));

export const options = {
  vus: Number(__ENV.K6_VUS || 1),
  iterations: Number(__ENV.K6_ITERATIONS || 1),
  thresholds: {
    checks: ['rate==1.0'],
    http_req_failed: ['rate==0'],
    http_req_duration: ['p(95)<3000'],
  },
};

const params = {
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
};

// Konnect takes the version label from info.version and rejects a mismatch, so the
// label has to be written into the document. See JOURNAL.md.
function specAt(version) {
  return JSON.stringify(Object.assign({}, petstore, {
    info: Object.assign({}, petstore.info, { version }),
  }));
}

const post = (path, body) => http.post(BASE_URL + path, JSON.stringify(body), params);
const patch = (path, body) => http.patch(BASE_URL + path, JSON.stringify(body), params);
const get = (path) => http.get(BASE_URL + path, params);
const del = (path) => http.del(BASE_URL + path, null, params);

export function setup() {
  if (!TOKEN) {
    fail('KONNECT_PAT is not set. Copy .env.example to .env, or pass -e KONNECT_PAT=...');
  }
}

export default function () {
  const name = `petstore-k6-${__VU}-${__ITER}-${Date.now()}`;

  const created = post('/v3/apis', { name, description: 'Created by the k6 scenario' });
  if (!check(created, { 'API created': (r) => r.status === 201 })) {
    return;
  }
  const apiId = created.json('id');

  try {
    check(post(`/v3/apis/${apiId}/versions`, { version: '1.0', spec: { content: specAt('1.0') } }), {
      'version 1.0 added': (r) => r.status === 201,
    });

    check(post(`/v3/apis/${apiId}/versions`, { version: '1.1', spec: { content: specAt('1.1') } }), {
      'version 1.1 added': (r) => r.status === 201,
    });

    check(patch(`/v3/apis/${apiId}`, { version: '1.1' }), {
      '1.1 promoted to current': (r) => r.status === 200,
    });

    const versions = get(`/v3/apis/${apiId}/versions`);
    check(versions, {
      'both versions listed': (r) => r.json('data').length === 2,
    });

    // current_version_summary has no version label, so resolve its id against the list.
    const currentId = get(`/v3/apis/${apiId}`).json('current_version_summary.id');
    const current = versions.json('data').find((v) => v.id === currentId);
    check(current, { '1.1 is current': (v) => v !== undefined && v.version === '1.1' });
  } finally {
    check(del(`/v3/apis/${apiId}`), { 'API deleted': (r) => r.status === 204 });
  }
}
