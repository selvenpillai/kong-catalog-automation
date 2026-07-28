# Journal

Notes from working through the exercise: what the API actually does, where the brief and
the product disagree, and why the tests are written the way they are.

## How I worked

I did the whole flow by hand in the Konnect console first, capturing a HAR per action
(create API, add spec, update spec, make current, delete version, delete API). That gave
me the exact request the UI makes for each step, which turned out to matter, because
several behaviours are not obvious from the OpenAPI spec alone. I then confirmed each one
against the API directly with throwaway scripts, kept in a gitignored `probes/` directory
while working and not committed.

The HAR captures are **not** in the repo. The login capture contains the account password
in plaintext and the others contain session material, so `hars/` and `*.har` are
gitignored. Everything useful from them is written up below.

## Terminology: the UI and the API use different words

This is the root of most of the ambiguity in the brief.

| Console | API resource |
| --- | --- |
| API Specification tab | `/v3/apis/{id}/versions` |
| Gateway tab, "Link a gateway service" | `/v3/apis/{id}/implementations` |
| Portals tab, "Publish to a portal" | `/v3/apis/{id}/publications/{portalId}` |
| Documentation tab | `/v3/apis/{id}/documents` |

The brief says "implementation" where the console says "API Specification". Since
`implementations` and `versions` sit next to each other in the OpenAPI document, I think
the wording came from skimming the API reference.

## Finding: the version label lives inside the spec

This is the one that changes how the tests have to be written.

Konnect takes the version label from `info.version` in the uploaded document. If you send
a `version` field that disagrees with the spec, the request is rejected:

```
POST /v3/apis/{id}/versions   { "version": "1.0", "spec": { "content": <info.version 1.0.27> } }
-> 400  version: if spec.content and version is provided, the version must match the spec
```

Omitting `version` works and the label is derived from the document. Sending both works
as long as they agree.

The supplied Petstore file declares `info.version: "1.0.27"`. The brief asks for versions
`1.0` and `1.1`. **Those are mutually incompatible**: there is no way to produce a version
labelled `1.0` from that file as it stands. The test has to rewrite `info.version` in the
payload before uploading, which is exactly what `petstoreSpec(version)` in
`src/petstore.ts` does. This isn't a workaround I invented; it's the same thing the
console pushes you towards, since its upload dialog pre-fills the version box from
`info.version`.

Because the label and the document have to agree, `upsertVersion()` takes only the spec
and reads the label off it. There is no way for the two to drift apart.

I've asked the recruiter whether a separate 1.1 spec was meant to be supplied. Pending an
answer, version 1.1 is the same document with one extra operation added, so that the two
versions differ by more than a label.

## Finding: "current" belongs to the API, not the version

There is no writeable field for the current version. `current_version_summary` on the API
is read-only, and `current_version`, `current_version_id` and patching
`current_version_summary` are all rejected as unknown properties.

Promotion is an update to the **parent API**, matched by version string:

```
PATCH /v3/apis/{id}   { "version": "1.1" }
```

Two consequences for the tests:

**Adding a version does not promote it.** After posting 1.0 and then 1.1, 1.0 is still
current. The first version created does populate the API's `version` field, which makes it
look like promotion is automatic until you add a second one. The console behaves the same
way: uploading a new spec leaves the old version current, and "Make current version" is a
separate action that issues the PATCH above. This maps neatly onto the brief's own
phrasing, "update to version 1.1 **and set to current**", which is two steps in the
wording and two calls in the product.

**`current_version_summary` has no version label.** It returns only an id and the spec
type:

```json
"current_version_summary": { "id": "0f89c757-...", "spec": { "type": "oas3" } }
```

So "assert 1.1 is current" cannot read a version off that object. It has to resolve the id
against the version list, which is what `Konnect.currentVersion()` does. Asserting on the
summary directly would be a silent false pass.

## Finding: "implementation" cannot mean what the brief says

`implementations` is a real resource, distinct from versions. `POST
/v3/apis/{id}/implementations` binds an API to a Gateway Service:

```json
{ "service": { "control_plane_id": "...", "id": "..." } }
```

It works: the first call returns 201 and flips the API's `implementation_mode` to
`gateway_entity_binding`. A second one does not:

```
409  An implementation already exists for this API
```

An API can hold exactly one implementation, either a Gateway Service or a control plane.
That's documented behaviour, not an accident: the `create-api-implementation` description
says that an API implemented by multiple gateway services should be linked to the control
plane instead, and there's a defined `ApiImplementationConflict` response.

So "assert API entity has 2 implementations" is unachievable under the literal reading, no
matter how the org is set up. I've read the one- and two-implementation assertions as the
spec versions 1.0 and 1.1, which is the only interpretation where every assertion in the
brief holds.

The one detail that cuts against this: the brief says "assert API entity has 2
implementations, **the versions**, and that 1.1 is current", and listing "the versions"
separately would be redundant if the two were the same thing. I've noted it, but it
doesn't change the conclusion.

Also worth knowing: listing implementations is `GET /v3/api-implementations` with a
`filter[api_id][eq]` parameter. The nested `GET /v3/apis/{id}/implementations` returns 405,
correctly, because that path only defines `POST`.

## Finding: upsert has two distinct branches

The console's "Add or update API spec" dialog states the rule itself: *"Uploading a new
spec with the same version will replace the current specification."* The HARs confirm it
resolves to two different calls:

| Case | Call |
| --- | --- |
| New version label | `POST /v3/apis/{id}/versions` |
| Existing version label | `PATCH /v3/apis/{id}/versions/{versionId}` |

`upsertVersion()` implements exactly that. It matters for more than fidelity: a naive
add-only implementation fails on a second run against the same API with

```
409  A version with this version string already exists for this API
```

**A trap in the brief's wording.** "Upsert a second OAS spec... update to version 1.1"
reads like it could be a PATCH on the existing version, and PATCH will happily rename 1.0
to 1.1. Doing that leaves you with a single version and the "2 versions" assertion fails.
Step three has to add a version, not rename one.

`PATCH` enforces the same `version`/`info.version` matching rule as `POST`, so both
branches have to rewrite the label into the document.

## Finding: stored spec content is normalised

The document that comes back is not the document you sent. The pretty-printed 40,218
character fixture is stored as 17,106 characters. The console minifies client-side before
upload; the API normalises regardless.

Tests must not compare spec content as text. The suite parses it and compares
`info.version` and the operation count instead.

## Observation: spec validation is looser than it looks

The console calls `POST /v3/apis/validate-specification` before every upload, and so does
the suite. It's worth knowing how little it checks:

| Document | Result |
| --- | --- |
| The Petstore fixture | 201, `validation_messages: []` |
| `{"openapi":"3.0.3"}` with no `info` and no `paths` | 201, `validation_messages: []` |
| `{"hello":"world"}` | 400, "content must be a valid specification" |
| Not JSON or YAML at all | 400, "content must be a JSON or YAML object" |

So it establishes that the payload is a specification, not that it is a good one. A spec
with no operations sails through. Useful as a cheap guard, not as a quality gate.

## Observation: the UI guards deleting the current version, the API doesn't

In the console, "Delete version" only appears on versions that aren't current. The API has
no such rule:

```
DELETE /v3/apis/{id}/versions/{currentVersionId}   -> 204
```

It succeeds, and it does not promote anything to replace it. The API is left holding a
perfectly good version while `current_version_summary` is null and the entity's `version`
field has been cleared. That state is reachable through the API but not through the
console.

I'd report this rather than work around it. Whether it's a missing server-side check or a
deliberate API/UI split is Kong's call, but a client-enforced invariant that the server
doesn't hold is worth surfacing. Nothing in the suite deletes versions individually;
teardown deletes the whole API, which takes the versions with it.

## Authentication: why the API suite uses a PAT

The brief asks for a test that runs from a username and password, lists a PAT as a
prerequisite, and marks the interactive login optional. Konnect's sign-in is a
browser-based Auth0 OIDC authorization code flow with PKCE, not an API endpoint. The HAR
shows `GET /authorize` with `code_challenge`, `code_challenge_method` and `nonce`, an
identifier step, a password step, and a final `POST /oauth/token` exchanging a
`code_verifier`. Credentials cannot be traded for a token in a plain HTTP call.

So the API suite authenticates with the PAT, and the username and password drive a
separate browser test that is skipped unless both are set. Keeping them in different
Playwright projects means a flaky hosted login can't take the workflow suite down with it.

The login turned out to be automatable, at about 13 seconds. Three things needed handling
that aren't obvious:

- The identifier page has five submit buttons (passkey, Google, GitHub, Microsoft, email),
  so `button[type="submit"]` is ambiguous. `button[data-action-button-primary="true"]` is
  the primary action on both Auth0 steps.
- Auth0 offers passkey enrolment after a successful password login.
- A fresh browser profile gets a "Select a Konnect region" dialog before the console loads.
- The OAuth callback lands on `/login?code=...` before redirecting into the console, so
  waiting for any `cloud.konghq.com` URL matches too early.

No MFA prompt appeared on the test account.

## Environment: TLS interception

Node's `fetch` and Playwright's request context both failed with `unable to get local
issuer certificate` on my corporate network, while `curl` worked, because curl uses the
Windows certificate store and Node ships its own CA bundle. `NODE_OPTIONS=--use-system-ca`
fixes it and is wired into the npm scripts. The Playwright browser download needs the same
flag, and it doesn't go through those scripts.

Unrelated but it cost me time: PowerShell 5.1's `ConvertTo-Json` hangs for minutes on a
40 KB string, which is why the throwaway probing scripts were Node rather than PowerShell.

## How the tests are shaped, and what that costs

Two shapes are in use here, and the difference is deliberate.

`api-catalog.spec.ts` and `console-flows.spec.ts` are `describe.serial` blocks whose tests
are ordered steps sharing one API. The brief enumerates numbered steps with an assertion at
each, and this keeps the report readable as that same list, so the submission can be
checked against the exercise line by line. It also means a failure names the step that
broke, and Playwright skips the remaining steps instead of running them against a
half-built API. The assertions are only meaningful in sequence anyway: "1.1 is current" is
a claim about the 1.0 that preceded it.

The cost is real and worth stating. Separate `test()` blocks normally imply independence,
and these are not independent — they share a module-level `apiId`, so no step past the
first can be run on its own. Running step two alone fails with a request to
`/v3/apis/undefined/versions`. The alternative is a single test using `test.step()`, which
would keep step names in the report while removing the shared state; that would be the
better default in a codebase where people run individual tests all day, and the reason it
isn't used here is the traceability above.

`version-rules.spec.ts` is the opposite case and is shaped accordingly. Those are four
independent contract checks, so each takes its own API from the `api` fixture and the file
declares `mode: 'parallel'`. The validation check needs no API at all, and because Playwright
fixtures are lazy, it never creates one. Nothing is ordered, and the file runs on four
workers rather than one.

The general rule the suite follows: the unit of parallelism is the unit of isolation. A
test can run concurrently exactly when it owns its data, so provisioning belongs in a
fixture rather than in shared state, and `describe.serial` is reserved for cases where the
steps genuinely build on each other.

Two consequences of running this in parallel against a live organisation. Names now carry a
UUID suffix rather than a timestamp, because several workers provisioning inside the same
millisecond would otherwise collide. And `workers` is capped, because every worker points at
the same org and a rate-limited response would surface as a puzzling assertion failure
rather than as "you went too fast". For the same reason, no test asserts on a list of the
org's APIs — a test like that could never run alongside anything else.

## Why there is a k6 scenario as well

The Playwright suite answers "is the workflow correct". `k6/api-catalog.js` answers "does
it hold up when more than one person does it at once", which is a different question and
needs a different tool. It duplicates the happy path deliberately rather than sharing code,
because k6 runs its own JavaScript runtime and importing the TypeScript client into it
would cost more than the duplication saves.

It defaults to one virtual user and one iteration, so out of the box it's a smoke run that
proves the scenario works. Raising `K6_VUS` turns it into an actual load test. Each
iteration creates a uniquely named API and deletes it, so concurrent users don't collide.

One thing to be careful of before pointing it at a real org: this creates and deletes
catalog entities, and the thresholds treat any failed request as a failure. Konnect will
have its own rate limits, and hitting them would show up here as a threshold breach rather
than as anything more informative.

## Scope

Out of scope, because none of them appear in the brief's steps: Gateway Service linking,
Dev Portal publication, and API documents. The first is discussed above; the other two are
adjacent features the console suggests on the API overview page, not things the exercise
asks for.

## Known gaps

- The 1.1 contract change is my own invention pending an answer from the recruiter. If a
  1.1 spec was meant to be supplied, swapping it in is a fixture change and nothing else.
- The suite asserts on the API's own responses. It doesn't verify the console renders the
  result, though the manual walkthrough and the HARs confirm both paths converge on the
  same state.
- The browser test asserts the console loads. It doesn't go on to check the API appears in
  the catalog UI, which would be the natural next step if UI coverage mattered here.
