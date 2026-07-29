# Konnect API Catalog tests

Automated tests for the Konnect API Catalog versioning workflow: create an API entity,
attach the Petstore OpenAPI spec as version 1.0, attach a second spec as version 1.1,
promote 1.1 to current, and assert the state after each step.

Written in TypeScript on the Playwright test runner. The API suite talks to the Konnect
REST API directly; a separate optional test drives the browser login.

See [JOURNAL.md](JOURNAL.md) for how the workflow actually behaves and why the tests are
shaped the way they are. A couple of the findings are not obvious from the docs.

## AI-Assisted Development Workflow

Kong builds AI connectivity infrastructure, so this project is also a small demonstration
of using AI as an engineering tool rather than a code generator. The workflow keeps a human
in the loop at every decision point:

- **Discovery, by hand.** I ran the whole flow in the Konnect console and captured a HAR per
  action. `.claude/skills/konnect-api-test/scripts/har-flow.mjs` turns those captures into the
  ordered list of API calls the UI actually makes — that's how the flows in
  `tests/api/console-flows.spec.ts` were derived.
- **Verification, before assertion.** Throwaway probes confirmed each behaviour against the
  live API. Nothing is asserted that wasn't first observed. The findings — and where the
  brief and the product disagree — are written up in `JOURNAL.md`.
- **Encoding knowledge for the agent.** `.claude/skills/konnect-api-test/SKILL.md` is a
  Cursor/Claude skill that captures the suite's conventions *and* Konnect's non-obvious
  behaviours (the version label lives inside the spec, "current" belongs to the API not the
  version, upsert has two branches). This is what stops an agent from writing a test that
  passes for the wrong reason. Ask an agent in this repo to add coverage and it picks the
  skill up automatically.
- **Guardrails, not autopilot.** `.claude/hooks/readme-drift.mjs` flags when code changes
  but the README doesn't — and it only reports, never edits, because generated docs produce
  churn rather than documentation. `scripts/scan-secrets.mjs` runs pre-commit and in CI to
  keep credentials out.

The division of labour: AI accelerated scaffolding tests in an established shape; I owned the
framework design, the interpretation of ambiguous requirements, the probing that established
ground truth, and verification of every run against a live organisation.

### How the skill is designed

Two deliberate choices in the skill are worth calling out, because they're what make it
reliable rather than just convenient:

- **Behaviours are encoded as a table, not prose.** `SKILL.md` lists each non-obvious Konnect
  behaviour next to its concrete consequence for a test ("the version label lives in the spec"
  -> "build specs with `petstoreSpec('1.1')`, never set the label independently"). A table
  forces every quirk to carry an actionable instruction, so the agent is steered toward the
  right call at the point of writing rather than left to rediscover the quirk by failing. This
  is the difference between a skill that generates plausible-looking tests and one that
  generates correct ones.
- **The drift hook reports, it never edits.** `.claude/hooks/readme-drift.mjs` flags when code
  changed but the README didn't, then stops — it does not regenerate documentation. Auto-generated
  docs produce churn that reads like documentation without being read by anyone; the point of
  the README is that a person wrote it and a person can trust it. The hook keeps the human in
  the loop instead of replacing them.

## Requirements

- Node 22.15 or newer (the test scripts use `--use-system-ca`, added in 22.15)
- A Konnect account and a personal access token

## Setup

With Node already installed (see Requirements), one command handles the rest — it checks the
Node version, installs dependencies, creates `.env` from the template, and asks whether to
install the Playwright browser the UI test needs:

```bash
npm run setup
```

Or do it by hand:

```bash
npm install
cp .env.example .env                # then fill in KONNECT_PAT
npx playwright install chromium     # only needed for the UI login test
```

The only required variable is `KONNECT_PAT`. Everything else has a sensible default:

| Variable | Purpose | Default |
| --- | --- | --- |
| `KONNECT_PAT` | Personal access token, used by the API suite | required |
| `KONNECT_BASE_URL` | Konnect region endpoint | `https://us.api.konghq.com` |
| `KONNECT_UI_URL` | Console URL, only for the UI test | `https://cloud.konghq.com` |
| `KONNECT_USERNAME` | Console login, only for the UI test | unset, test skips |
| `KONNECT_PASSWORD` | Console login, only for the UI test | unset, test skips |
| `KEEP_TEST_DATA` | Leave the created API in place instead of deleting it | `false` |
| `KONNECT_IGNORE_HTTPS_ERRORS` | Escape hatch for TLS interception | `false` |

Create a token in Konnect under your account menu, *Personal Access Tokens*. For a
non-US org set `KONNECT_BASE_URL` to `https://eu.api.konghq.com` or
`https://au.api.konghq.com`.

## Running

```bash
npm test         # API suite, this is the exercise workflow
npm run test:ui  # browser login, needs the chromium browser and credentials (skips without either)
npm run test:all # both
npm run load     # the same workflow as a k6 scenario, needs k6 installed
npm run report   # open the HTML report from the last run
npm run lint     # ESLint, including type-aware rules
npm run typecheck
npm run scan:secrets      # staged changes, same check the pre-commit hook runs
npm run scan:secrets:all  # every tracked file, same check CI runs
```

Each test creates its own API with a unique, prefixed name (for example
`petstore-e2e-<timestamp>` for the workflow, or `petstore-<test>-<uuid>` for the parallel
suites) and deletes it during teardown, so runs don't collide and nothing accumulates in
the org. Set `KEEP_TEST_DATA=true` to leave them behind for inspection.

## What the tests cover

`tests/api/api-catalog.spec.ts` is the exercise workflow, one test per step, in order:

1. **Creates an API entity** and reads it back by id, confirming it starts with no versions.
2. **Upserts the Petstore spec as version 1.0.** Validates the document first, then checks
   the stored version label, spec type and operation count, and that 1.0 is current.
3. **Upserts a second spec as version 1.1 and sets it current.** Asserts that adding a
   version does *not* promote it, then promotes it explicitly and asserts two versions
   exist, that they are 1.0 and 1.1, and that 1.1 is current. It also checks the stored 1.1
   document actually carries the added operation, not just that the count matches.
4. **Re-upserts an existing version** to cover the update half of "upsert": the content is
   replaced (the added operation is gone) and no third version appears.

`tests/api/console-flows.spec.ts` covers the remaining calls the console makes: creating
an API and its first version in a single request, deleting a version, and deleting the API.

`tests/api/version-rules.spec.ts` pins down the version constraints the workflow relies
on, so a change in Konnect fails here with a clear message rather than somewhere
confusing: a version label that disagrees with the spec is rejected, a duplicate label is
rejected, a document that isn't a specification (non-JSON, or an unsupported OpenAPI
version) is rejected while an empty-but-valid one is accepted, an upload past the request
body limit comes back as 413, deleting the current version leaves the API with none, and
promoting to a label no version carries is accepted but resolves to nothing. It also pins a
discrepancy: the single-call create path, unlike the two-step upload, doesn't enforce the
version/spec match.

`tests/api/contract.spec.ts` covers the entity-level guarantees a client hits first:
authentication is enforced (401), API names are unique (409) and required (400), an unknown
API reads as 404, and the wrong method reads as 405.

Both of these are independent checks, so each takes its own API from the `api` fixture
where it needs one and the files run in parallel.

The two workflow files above are ordered steps sharing one API, which is why they're
`describe.serial` and why only their first test can be run on its own. `JOURNAL.md`
explains the trade-off and when each shape applies.

`tests/ui/login.spec.ts` signs in with a username and password through Auth0, handles the
passkey and region prompts, and asserts the console loads.

## Load testing

`k6/api-catalog.js` runs the same happy path as a [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/)
scenario. It defaults to one virtual user and one iteration, which makes it a smoke run
rather than a load test:

```bash
npm run load                                    # 1 VU, 1 iteration
K6_VUS=5 K6_ITERATIONS=25 npm run load          # actual load
npm run load -- --out json=results.json         # extra k6 flags pass through
```

`npm run load` reads the same `.env` as the tests, so there's only one place to configure
credentials. Each iteration creates a uniquely named API and deletes it again. Thresholds
require every check to pass, no failed requests, and p(95) latency under three seconds.

## Corporate networks

If your network intercepts TLS you will see `unable to get local issuer certificate`. The
npm scripts already set `NODE_OPTIONS=--use-system-ca`, which makes Node trust the
operating system's certificate store and resolves it. Two notes:

- `npx playwright install chromium` does *not* go through those scripts, so run it as
  `NODE_OPTIONS=--use-system-ca npx playwright install chromium` if the download fails.
- `KONNECT_IGNORE_HTTPS_ERRORS=true` disables certificate verification entirely. It is a
  last resort, not a fix.

## Continuous integration

`.github/workflows/tests.yml` runs a `checks` job on every push and pull request:
`npm ci`, the secret scan, the linter and the typecheck. It needs no secrets and touches no
live org, so it's safe on forks and stays green without any setup.

The three jobs that talk to a live org run only via *Run workflow* in the Actions tab, so a
public repo never hits someone's org on a drive-by push and fork PRs (which don't receive
secrets) don't fail spuriously:

- **API suite** — needs a `KONNECT_PAT` repository secret, and optionally a
  `KONNECT_BASE_URL` repository variable for a non-US region.
- **UI login** — the least stable part of the suite; needs `KONNECT_USERNAME` and
  `KONNECT_PASSWORD` secrets.
- **k6 smoke** — there's no value in load testing an org on every commit.

The HTML report is uploaded as an artifact from the API and UI jobs.

### Running the live jobs on demand

The live jobs read their credentials from repository secrets, which is GitHub's encrypted,
log-masked store — never commit a token or paste it into the workflow. Add them once under
*Settings → Secrets and variables → Actions*:

| Kind | Name | For |
| --- | --- | --- |
| Secret | `KONNECT_PAT` | API suite and k6 smoke |
| Secret | `KONNECT_USERNAME`, `KONNECT_PASSWORD` | UI login |
| Variable | `KONNECT_BASE_URL` | non-US org (optional) |

For a public repo, prefer a **fine-grained, least-privilege, short-expiry** Konnect token so
a leaked secret has a small blast radius. Then trigger a job from *Actions → tests → Run
workflow*, picking the branch. Only the manual (`workflow_dispatch`) jobs run; the `checks`
job already covers pushes and pull requests.

## Layout

```
fixtures/petstore.json   the provided Petstore OpenAPI document, unmodified
src/config.ts            environment variables and their defaults
src/konnect.ts           thin client over the Catalog API
src/petstore.ts          builds spec variants from the fixture
tests/api/               the exercise workflow, console flows, version rules and contract checks
tests/ui/                optional browser login
k6/                      the workflow as a k6 scenario
probes/                  throwaway scripts used to work out the API's behaviour (gitignored)
scripts/                 the secret scanner used by the pre-commit hook and CI
.githooks/               the pre-commit hook itself
.claude/skills/          an agent skill for adding tests in this style
.claude/hooks/           a Stop hook that flags README drift
```

## Keeping credentials out

The HAR captures in `hars/` contain the account password and a personal access token in
plaintext. They're gitignored, but `git add -f` ignores that and so does an edit to
`.gitignore`, so there's a second guard: `scripts/scan-secrets.mjs` refuses paths that
should never be committed (`hars/`, any `.har`, `.env`) and looks for token, JWT, bearer,
password and private-key patterns in the content of everything else.

It runs as a pre-commit hook and again in CI over every tracked file. The hook installs
itself on `npm install` — the `prepare` script points `core.hooksPath` at `.githooks/`,
which needs no extra dependency and no manual step. `git commit --no-verify` bypasses it,
which is the right escape hatch for a false positive and the wrong one for anything else.

## Linting

`npm run lint` runs ESLint with `typescript-eslint`'s type-aware rules and
`eslint-plugin-playwright`. Type-aware linting is the reason the config is set up the way
it is: the mistake this kind of suite is most exposed to is a forgotten `await` on an API
call or an assertion, which reads correctly and passes silently. `no-floating-promises`
catches it; a syntax-only linter would not.

Two Playwright rules are switched off for `tests/ui/` only, with the reason in
`eslint.config.mjs`. That suite skips itself when no credentials are set and branches
around interstitials Auth0 shows only sometimes, both of which are the design.

TypeScript is pinned to 5.x. TypeScript 7 is the native port and `typescript-eslint` does
not support it yet, and type-aware linting is worth more here than the newer compiler.

## Adding tests

`.claude/skills/konnect-api-test/` is an agent skill that captures how this suite is put
together: where a client method goes, what a spec file looks like, how the k6 scenario
differs from the Playwright one, and the Konnect behaviours that will otherwise produce a
test that fails for the wrong reason. Ask an agent in this repo to add coverage for an
endpoint, a recorded session or a load scenario and it will pick the skill up. Claude Code
and Cursor both read project skills from this path; other tools can be pointed at
`SKILL.md` directly, since it's plain markdown.

The skill also carries a workflow for after the tests are written: run them against the live
org, then diagnose a failure conservatively — fix genuine test bugs, but never weaken an
assertion to force a pass, and treat a caught product change as a finding rather than a bug.
When a run can't be healed within a few cycles, it writes a structured post-mortem to a
gitignored `reports/` directory and surfaces it instead of leaving the suite green by masking.

It ships with `scripts/har-flow.mjs`, which turns a HAR capture of a console session into
the ordered list of API calls it made:

```bash
node .claude/skills/konnect-api-test/scripts/har-flow.mjs hars/capture.har --mutations
```

That's how the console flows in `tests/api/console-flows.spec.ts` were identified.

`.claude/hooks/readme-drift.mjs` is a Claude Code `Stop` hook, registered in
`.claude/settings.json`. Once per session, if the working tree has changes under `src/`,
`tests/`, `k6/`, the workflows or `package.json` while `README.md` is untouched, it tells
the agent to check whether this file is still accurate. It reports and never edits:
generating documentation automatically produces churn rather than documentation, and the
point of the README is that a person reads it.
