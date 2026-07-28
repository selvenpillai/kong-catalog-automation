---
name: konnect-api-test
description: Scaffolds tests for the Konnect API Catalog in this repository's style, either a Playwright suite (a client method in src/konnect.ts plus a spec file in tests/api/) or a k6 load scenario. Use when adding coverage for a Konnect endpoint or flow, turning a recorded HAR capture into tests, extending the existing suite, or writing a load test against Konnect.
---

# Adding Konnect tests

This repository tests the Konnect API Catalog v3 on two surfaces. Correctness lives in the
Playwright suite; whether a flow holds up concurrently lives in the k6 scenario. Start with
Playwright unless the question is specifically about load, and see "Load coverage with k6"
below for that.

Playwright coverage goes in two places: a method on the client in `src/konnect.ts`, and a
spec file under `tests/api/`. Tests never call `fetch` or build URLs themselves, except
when asserting on an error response.

| File | Holds |
|------|-------|
| `src/konnect.ts` | One method per operation. Throws on an unexpected status. |
| `src/petstore.ts` | Builders that produce spec documents at a given version label. |
| `src/config.ts` | Environment variables and their defaults. Add new ones here. |
| `tests/fixtures.ts` | The worker-scoped `konnect` fixture. Rarely needs changing. |
| `tests/api/*.spec.ts` | One file per coherent flow, not one per endpoint. |

Read `JOURNAL.md` before starting. It records why the existing tests assert what they do,
and several of those reasons are non-obvious.

## Workflow for a Playwright suite

```
- [ ] 1. Establish what calls the flow actually makes
- [ ] 2. Add or extend the client method
- [ ] 3. Write the spec file
- [ ] 4. Run it against the live org
- [ ] 5. Diagnose a failing run, and heal it only if it's a test bug
- [ ] 6. Write a post-mortem if it can't be healed
- [ ] 7. Confirm nothing was left behind
```

### 1. Establish what calls the flow actually makes

**Why HAR for flow discovery.** A capture records exactly what the console drives — the
request shapes, payloads and ordering — which is what a behavioural suite needs and what the
published API reference alone does not give. It is also how the divergences in `JOURNAL.md`
were found: the docs and the observed behaviour differ more than once, and only a real
request reveals that. The trade-off is that a capture also carries console chrome (the
entitlement, `users/me` and onboarding calls to ignore) and credentials, so it is filtered
through `har-flow.mjs` and never committed. Where no capture exists — a new endpoint, or
confirming a behaviour — the published reference plus a throwaway probe is the second path,
and the one an external contributor can always fall back on.

**From a HAR capture** (a recorded console session, kept in `hars/`, untracked):

```bash
node .claude/skills/konnect-api-test/scripts/har-flow.mjs hars/capture.har --mutations
node .claude/skills/konnect-api-test/scripts/har-flow.mjs hars/capture.har --bodies
```

It prints the Konnect calls in order with templated ids, summarises spec payloads instead
of dumping 40 KB of JSON, and warns if the capture holds credentials. Ignore
`/v0/onboarding/users/hints`, `/v3/users/me`, `/v3/organizations/me` and the entitlement
calls: those are console chrome, not the flow.

**From documentation alone**, probe the endpoint before writing a test against it. The
published docs and the observed behaviour have diverged more than once. A throwaway script
in a gitignored `probes/` directory is the right place.

```bash
node --use-system-ca probes/scratch.mjs
```

Do not write a test that asserts behaviour nobody has observed.

### 2. Add or extend the client method

Methods are thin. They take the ids and data they need, call `unwrap` with the status the
API is expected to return, and return the parsed body. `unwrap` throws with the response
body included, so no test needs a try/catch to get a readable failure.

```ts
async deleteVersion(apiId: string, versionId: string): Promise<void> {
  const res = await this.request.delete(`/v3/apis/${apiId}/versions/${versionId}`);
  if (res.status() !== 204) {
    throw new Error(`Failed to delete version ${versionId}: ${res.status()} ${await res.text()}`);
  }
}
```

Do not add a method whose only job is to return an error. For those, tests use
`konnect.http`, which exposes the underlying request context.

### 3. Write the spec file

One file per flow. Steps that depend on each other go in a `test.describe.serial` block
sharing a module-level id; independent checks can be plain tests.

```ts
import { expect, test } from '../fixtures';
import { keepTestData } from '../../src/config';
import { petstoreSpec } from '../../src/petstore';

const apiName = `petstore-<flow>-${Date.now()}`;
let apiId = '';

test.describe.serial('<Flow name>', () => {
  test.afterAll(async ({ konnect }) => {
    if (!apiId || keepTestData) return;
    await konnect.deleteApi(apiId);
  });

  test('<what the behaviour is, as a sentence>', async ({ konnect }) => {
    // ...
  });
});
```

Rules that keep the suite re-runnable and readable:

- **Unique name per run.** `${prefix}-${Date.now()}`. Spec files run in parallel workers,
  so two files must never use the same name.
- **Always clean up, unless asked not to.** `afterAll` deletes the API and honours
  `KEEP_TEST_DATA`. Deleting the API deletes its versions.
- **Assert on version labels, not ids.** `expect(versions.map(v => v.version)).toEqual(['1.0', '1.1'])`
  fails legibly; an id comparison does not.
- **Name tests after the behaviour**, not the endpoint. "deleting the current version
  leaves the API without one", not "DELETE /versions/{id} returns 204".
- **Comment only what the code cannot say.** A surprising Konnect behaviour deserves a
  line and a pointer to `JOURNAL.md`. A restatement of the next line does not.

### 4. Run it against the live org

```bash
npm run typecheck
npm test                       # the API suite
npm test -- -g "<test name>"   # one test while iterating
```

The npm scripts set `NODE_OPTIONS=--use-system-ca` already, which is needed wherever TLS
is intercepted. Ad-hoc `node` commands need it passed explicitly.

Tests run against a real organisation. A failing run can leave an API behind.

### 5. Diagnose a failing run, and heal it only if it's a test bug

A red run is not a licence to make it green. First re-run just the failing test for a fast,
clean signal, then classify the failure **before** changing anything:

```bash
npm test -- -g "<test name>"
```

| Class | Signs | What to do |
|-------|-------|------------|
| **Test bug** | Wrong expected status, a missing `await` (`no-floating-promises` catches most), the version label not written into the document, a unique-name collision, comparing spec content as text, asserting a label off `current_version_summary`. | Fix it. The "Konnect behaviour to account for" table below lists the usual causes. |
| **Environment** | `unable to get local issuer certificate` (TLS), 401 (missing or expired `KONNECT_PAT`), 429 (rate limited), or leftover data from an earlier crashed run. | Fix the environment, not the test. Re-run with `NODE_OPTIONS=--use-system-ca`, re-export the PAT, back off, or clean up the org. |
| **Real product change** | The API now returns something `JOURNAL.md` records it did not. | This is a finding, not a bug. Do **not** weaken the assertion. Go to step 6. |

Rules for the heal loop, which is conservative on purpose:

- **At most three fix-and-rerun cycles.** If it is not green by then, stop and write the
  post-mortem. Looping past that hides the real cause.
- **Never make a test pass by weakening what it means.** No relaxing an assertion, no blanket
  retry, no `waitForTimeout` to paper over a race. If green needs any of those, the test is
  masked, not healed.
- **A test that correctly caught a product change has done its job.** Fixing the product is
  not this skill's task; recording the finding is.

### 6. Write a post-mortem if it can't be healed

Trigger this when the run is still red after the cap, or the moment a failure is classed as a
real product change. Write a report to `reports/postmortem-<timestamp>.md` (the `reports/`
directory is gitignored), then stop and surface it rather than leaving the suite green by
masking.

```markdown
# Post-mortem: <flow / test name>

- **When:** <timestamp>  **Command:** `npm test -- -g "<test name>"`
- **Symptom:** the exact failing assertion or error, verbatim.
- **Request/response:** method, path, status, and the distinctive fragment of the body.
- **Hypotheses tried:** each fix-and-rerun cycle and what it showed.
- **Classification:** test defect | environment | product finding.
- **Next step:** the fix, or — for a product finding — a note that it belongs in `JOURNAL.md`,
  which is where product findings live.
```

Keep it short and factual. A product finding also gets a paragraph in `JOURNAL.md`; the
report in `reports/` carries the run-level detail that is only useful for this one incident.

### 7. Confirm nothing was left behind

With `KONNECT_PAT` exported into the shell:

```bash
node --use-system-ca -e "fetch('https://us.api.konghq.com/v3/apis?page%5Bsize%5D=100',{headers:{Authorization:'Bearer '+process.env.KONNECT_PAT}}).then(r=>r.json()).then(j=>console.log(j.meta.page.total,j.data.map(a=>a.name)))"
```

The count should be what it was before the run. If a suite is flaky about teardown, that
is a bug in the test, not an acceptable cost.

## Konnect behaviour to account for

These were established by throwaway probes while working and are documented in `JOURNAL.md`. Getting
any of them wrong produces a test that fails for the wrong reason.

| Behaviour | Consequence for a test |
|-----------|------------------------|
| The version label is taken from `info.version` in the document. A `version` field that disagrees is rejected with 400. | Build specs with `petstoreSpec('1.1')`, which writes the label into the document. Never set the label independently. |
| `POST /v3/apis/{id}/versions` with a label that already exists returns 409. | "Upsert" means POST when the label is new, `PATCH /versions/{id}` when it is not. Use `konnect.upsertVersion`. |
| Adding a version does not make it current. | Promote explicitly with `PATCH /v3/apis/{id}` and `{ version: label }`. Assert the non-promotion too if the flow depends on it. |
| `current_version_summary` is read-only and carries no version label. | Resolve its `id` against the versions list. `konnect.currentVersion` does this. |
| `POST /v3/apis` accepts `version` and `spec_content`, creating the API and its first version at once. | This is what the console does. `createApiWithSpec` covers it; the two-step path is also valid. |
| An *implementation* is a separate resource needing a Gateway service, capped at one per API. It is not a spec version. | Do not use "implementation" to mean "version" in test names or assertions. |
| `validate-specification` rejects documents that are not specifications, but passes a spec with no `info` and no `paths`. | Useful as a pre-flight guard. Not evidence that a spec is usable. |
| The API allows deleting the current version and promotes nothing in its place; the console hides the action. | Test API behaviour, and note the divergence rather than asserting the console's rule. |

## Asserting on errors

Negative tests use `konnect.http` and assert the status and the message shape. Konnect
returns `invalid_parameters` for 400s and `detail` for 409s.

```ts
const res = await konnect.http.post(`/v3/apis/${apiId}/versions`, {
  data: { version: '3.0', spec: { content: JSON.stringify(petstoreSpec('1.0.27')) } },
});

expect(res.status()).toBe(400);
expect(JSON.stringify((await res.json()).invalid_parameters)).toContain('must match the spec');
```

Match on a distinctive fragment of the message, not the whole string. Whole-string matches
break on wording changes that do not represent a behaviour change.

## Load coverage with k6

`k6/api-catalog.js` runs the happy path under load. Extend it only when a flow is worth
running concurrently — correctness belongs in the Playwright suite, and duplicating a
negative test here buys nothing.

k6 runs its own JavaScript runtime, so most of the Playwright habits do not transfer:

| Constraint | What it means here |
|------------|--------------------|
| No TypeScript, and `src/` cannot be imported. | The flow is duplicated on purpose. Do not try to bridge the two; it costs more than the duplication. |
| Files are read with `open()` at init, not `import`. | `const petstore = JSON.parse(open('../fixtures/petstore.json'))` at module scope. Calling `open()` inside the default function fails. |
| `check()` returns a boolean; it does not throw. | A failed check does not stop the iteration. Guard explicitly on the ones that make the rest meaningless, and put teardown in a `finally`. |
| Thresholds decide the exit code, not checks. | Failing checks alone still exit 0. `checks: ['rate==1.0']` is what turns the scenario into a test. |
| Every virtual user runs the same code. | Names must include `__VU` and `__ITER` or concurrent iterations collide on the unique-name constraint. |

The shape to follow:

```js
export const options = {
  vus: Number(__ENV.K6_VUS || 1),
  iterations: Number(__ENV.K6_ITERATIONS || 1),
  thresholds: {
    checks: ['rate==1.0'],
    http_req_failed: ['rate==0'],
    http_req_duration: ['p(95)<3000'],
  },
};

export default function () {
  const name = `petstore-k6-${__VU}-${__ITER}-${Date.now()}`;

  const created = post('/v3/apis', { name });
  if (!check(created, { 'API created': (r) => r.status === 201 })) return;
  const apiId = created.json('id');

  try {
    // one check per step, named as the behaviour
  } finally {
    check(del(`/v3/apis/${apiId}`), { 'API deleted': (r) => r.status === 204 });
  }
}
```

Keep the defaults at one virtual user and one iteration, so `npm run load` is a smoke run
that proves the scenario works. Raising the committed default would make a routine command
hit a real organisation harder than whoever runs it expects.

```bash
npm run load                              # 1 VU, 1 iteration
K6_VUS=5 K6_ITERATIONS=25 npm run load    # actual load
npm run load -- --out json=results.json   # extra k6 flags pass through
```

`npm run load` goes through `k6/run.mjs`, which loads `.env` and shells out to k6, so
credentials come from the same place as the Playwright suite. k6 does not read `.env`
itself: invoking `k6 run` directly needs `-e KONNECT_PAT=...`.

Everything in the Konnect behaviour table above still applies. The version label in
particular still has to be written into the document, which is why the scenario carries
its own `specAt()` helper rather than sending a bare `version` field.
