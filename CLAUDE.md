## Development Methodology

**Always use Test-Driven Development (TDD).** For every feature or bug fix, write a
failing test first, then implement the minimum code to make it pass, then refactor with
the test green. TDD is non-negotiable — but *which layer* you write the test at is a
deliberate choice, not "all of them by default" (see below).

Red → green → refactor:
1. Write the test(s) that define the expected behavior **before** any implementation code
2. Run them to confirm they fail (red)
3. Implement the minimum to make them pass (green)
4. Refactor if needed, keeping tests green

### Pick the right layer — write the test as low as it can meaningfully live

Default downward. E2E is the scarce resource (~8 min serial, local-only, brittle against
DOM/i18n changes), so a new E2E must earn its place. Test each behavior at **one** layer —
the lowest one that can actually catch the bug — not at every layer.

1. **Pure logic** (money math, interest, %, fulfillments, double-count guards, date
   rollovers) → **unit test in `lib/`**. This is where the real bugs live; test it densely
   here. Almost every money bug we've shipped was a logic bug that a `lib/` test would have
   caught — not something that needed a browser.
2. **Component behavior** (renders the right outcome from given props/state, conditional UI,
   error vs. empty) → **component unit test (Vitest + React Testing Library)**. The
   "user-visible outcome" below is almost always assertable here, without a real browser.
3. **End-to-end integration** (auth/session, routing, the dashboard overview API, a real
   create→render round-trip, a migration's effect) → **E2E**. Add a *new* E2E only when the
   behavior genuinely spans layers and can't be pinned down at layer 1 or 2. Most bug fixes
   need **one** unit test, not a new E2E. Extend an existing spec before adding a new one.

Corollary — **do not add a desktop *and* a mobile E2E for the same logic.** Viewport-specific
rendering is a component-test concern; reserve the desktop/mobile E2E split for behavior that
truly differs across viewports.

**TDD lesson learned (assert the outcome, but at the right layer):** Tests must assert the
*user-visible outcome*, not just the data that enables it — e.g. testing that a flag is
stored in the DB is necessary but not sufficient; also assert the rendered result (the
progress-bar percentage is unchanged). A storage-only test misses bugs in a separate code
path that recomputes the same value. Close the loop: action → assert the rendered outcome.
But "rendered outcome" usually means a component test asserting the rendered DOM from props —
not a full E2E. Reach for E2E only when the loop itself crosses the network/DB boundary.

## Business dates — one timezone, one helper

The app has exactly **one business timezone: `Asia/Ho_Chi_Minh` (UTC+7)**. Every
"today", "current month", and plain-date comparison is derived in that zone, wherever
the code runs — a browser in any timezone, a Vercel function in UTC, a cron job.

Use `lib/dates`: `todayIso()`, `businessYearMonth()`, `businessTodayDate()`,
`daysUntilIso()`. Never derive a business date from UTC
(`new Date().toISOString().slice(0, 10)`) or from the runtime's local zone
(`new Date().getMonth()`) — between 00:00 and 06:59 Vietnam time the UTC date is still
*yesterday*, which recorded transactions on the wrong day and filed contributions under
the wrong month (#591). An eslint `no-restricted-syntax` rule blocks both idioms in
`app/`, `lib/`, and `components/`.

`new Date().toISOString()` on its own is fine and correct for *timestamps*
(`updated_at`, `created_at`) — those are instants, not business dates.

## What to run before opening a PR

E2E was removed from CI (PR #313) and runs **locally only** — so local checks are
the only automated gate before the Vercel preview. Scale the checks to the change:

- **Always:** `npm run typecheck`, `npm test -- --run` (Vitest unit tests), and
  `npm run lint`. Fast, every PR. Don't skip the typecheck because the tests are
  green — Vitest ignores extra arguments and unused types, so a test that calls a
  handler with a signature it no longer has passes locally and fails CI. CI runs
  `typecheck` inside the "Unit Tests" job, so a red X there is often `tsc`, not a
  failing assertion (#614).
- **Targeted E2E** — when the change touches a feature area, run that area's specs,
  e.g. `npx playwright test e2e/planning.spec.ts --project=chromium`. This is the
  common case.
- **Full E2E** (`npm run test:e2e`, ~8 min serial) — before merging anything broad or
  risky: auth, layout, the dashboard overview API, shared components, a DB migration,
  or env/config changes. Also run it after touching E2E selectors / DOM attributes /
  i18n strings (grep `e2e/` for the old value first).

Keep the local Supabase stack running for the session so spec runs are instant — see
[Running E2E locally](README.md#running-e2e-locally). A few specs key off the current
real date (e.g. planning's June-2026 fixtures), so they can fail as the calendar moves
— unrelated to your change.

## Git & PR Workflow

**Always act as the `mphuongth` GitHub account for this repo.** This is a personal
repo, but the machine may have other `gh` accounts logged in (e.g. an Agility work
account set as the global default). Before **any** `gh` command or GitHub API call —
commenting, closing, merging, pushing — verify the active account with
`gh api user -q .login` and make sure it is `mphuongth`. The clean way to do this
without changing the global default is to prefix gh commands with
`GH_CONFIG_DIR=~/.config/gh-allocate` (a passive config dir whose active account is
`mphuongth`; falls back to `gh auth switch --user mphuongth` if that dir is absent).
Never comment / close / merge / push as any other account.

**Never push code directly to `main`.** Every change — no matter how small — must go through a branch and PR.

Rules:
1. Create a feature/fix branch (e.g. `fix/some-bug`, `feat/some-feature`)
2. **Always branch off `main` and set `main` as the PR target.** Never base a branch on another feature branch or open PR.
3. Push to that branch and open a PR
4. Wait for explicit user approval ("merge it", "looks good") before merging
5. Only merge after the user has reviewed and tested on the Vercel preview deployment

**Always work in a dedicated git worktree — never on the shared main working directory.**
Multiple Claude sessions often run against this repo at once, so a shared working dir and
global stash race badly (files get clobbered, phantom `M` status, lost work). Isolate every
piece of work:

1. **Create a worktree off the latest `origin/main`** for each new branch, e.g.
   `git fetch origin && git worktree add ../allocate-<branch> -b fix/some-bug origin/main`.
   Do all editing, testing, committing, and pushing inside that folder.
2. **Never `git stash`** in this repo (it uses a global stash shared across worktrees/sessions).
3. **After the PR is merged, remove the worktree** — `git worktree remove ../allocate-<branch>`
   (and delete the local branch). Don't leave stale worktree folders lying around.

**PR isolation rule:** Each PR must be independent. If you are working on a new feature while another PR is open, start fresh from the latest `main` — do not stack branches or include commits that belong to an open PR. If a conflict arises because another PR hasn't merged yet, resolve it after that PR merges rather than combining them.

**Why:** The user reviews and tests every change on the preview deployment before it reaches main. Stacked or combined PRs make it impossible to review and deploy changes independently.
