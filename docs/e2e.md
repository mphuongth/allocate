# E2E lanes

Playwright runs in two lanes (#595). Pick the lane by what you're guarding, not
by habit — and remember that most behaviors belong in a `lib/` or component unit
test, not here (see CLAUDE.md).

| Lane      | What runs                        | Size | Budget            | Where                                        |
| --------- | -------------------------------- | ---- | ----------------- | -------------------------------------------- |
| **smoke** | tests tagged `@smoke`            | ~19  | **3 min**         | every PR (CI) + `npm run test:e2e:smoke`      |
| **full**  | every spec                       | ~258 | ~7.6 min (serial) | nightly + on demand + `npm run test:e2e`      |

The lanes are mutually exclusive Playwright projects selected by `E2E_LANE`, so
a bare `npx playwright test` runs the full suite and never double-runs a smoke
test.

## The smoke lane

It is a regression *gate*, not coverage. It keeps one or a few tests per area
that would be catastrophic to break and that no lower layer can catch:

- **auth / session** — login, wrong password, unauthenticated redirect, stale cookie
- **cross-user ownership** — 403 on a foreign FK, 2xx on your own
- **API validation** — non-finite amount, malformed UUID, malformed date, invalid JSON
- **core transaction flow** — dashboard renders, net worth card, sell an unallocated fund
- **add-transaction entry point** — the sheet opens
- **maturity / merge money path** — merge a sibling deposit, no double-count
- **report download** — the PDF actually downloads
- **navigation** — sidebar routing

Those areas are listed in `e2e/helpers/lanes.ts` (`SMOKE_COVERAGE_AREAS`) and a
Vitest unit test (`lib/__tests__/e2eSmokeLane.test.ts`) fails if the lane drifts
outside 15–30 tests or if an area loses its tags. Adding a test to the lane is
one edit:

```ts
test('something critical', { tag: '@smoke' }, async ({ page }) => { … })
```

### The budget

`SMOKE_BUDGET_MS` (3 minutes, in `e2e/helpers/lanes.ts`) covers the whole run —
setup project included. The lane reporter prints the run's wall-clock time and
warns when it overruns. An overrun means trim the lane or move the test down a
layer; it doesn't fail the run.

## Infra failures vs. product failures

`e2e/reporters/laneReporter.ts` classifies every failure with
`e2e/helpers/failureClass.ts`:

- **infra** — socket errors, `fetch failed`, Postgres connection exhaustion or
  statement timeouts, Disk IO throttling, 429/5xx from the API gateway, a
  webServer that never came up, a dead browser.
- **product** — everything else, including a plain locator timeout (that is an
  element that never appeared, i.e. a real regression).

A run whose failures are *all* infra prints an explicit note. Re-run it against
a healthy stack before chasing the app.

## Running locally

Both lanes need a Supabase stack and the app. Keep a local stack running for the
session so spec runs are instant:

```bash
supabase start                     # local stack on :54321 / :54322
supabase status -o env             # copy API_URL / ANON_KEY / SERVICE_ROLE_KEY
```

Put those in `.env.e2e` (gitignored):

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key>
E2E_SUPABASE_URL=http://127.0.0.1:54321
E2E_SUPABASE_SERVICE_ROLE_KEY=<local service role key>
```

Then:

```bash
npm run test:e2e:smoke                                   # the PR gate, ~3 min
npm run test:e2e                                         # everything, ~7.6 min
npx playwright test e2e/planning.spec.ts --project=chromium   # one area
```

`e2e/helpers/guard.ts` aborts the run if the target Supabase URL is the
production project, in CI and locally alike.

## In CI

- **Every PR** — `.github/workflows/ci.yml` runs the smoke lane after the unit
  tests, via the reusable `.github/workflows/e2e.yml`.
- **Nightly (01:00 Vietnam) and on demand** — the same reusable workflow runs
  the full suite; `workflow_dispatch` lets you pick the lane.
- Both start a **local Supabase stack inside the runner**. The shared NANO test
  project throttles under the suite's write load — that is what made CI E2E
  unusable in #313 — so nothing points at it.
- The Playwright HTML report and `test-results/` are uploaded as artifacts on
  failure.

Sharding is deliberately not enabled: the suite shares a single authenticated
user (one `storageState`), so parallel workers race on per-user rows. Isolated
users/storage state per worker come first.
