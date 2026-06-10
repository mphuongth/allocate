## Development Methodology

**Always use Test-Driven Development (TDD).** For every feature or bug fix, write tests first — then implement.

Rules:
1. Write unit tests and/or E2E tests that define the expected behavior **before** writing any implementation code
2. Run the tests to confirm they fail (red phase)
3. Implement the minimum code needed to make the tests pass (green phase)
4. Refactor if needed, keeping tests green

This applies to both new features and bug fixes. Never write implementation code without a failing test first.

**TDD lesson learned:** Tests must assert the *user-visible outcome*, not just the data that enables it. For example, testing that a flag is stored correctly in the DB is necessary but not sufficient — the E2E test must also assert the rendered result (e.g. the progress bar percentage is unchanged). A passing test that only checks storage can miss bugs in a separate code path that computes the same value locally. Always close the loop: UI action → assert the rendered outcome.

## What to run before opening a PR

E2E was removed from CI (PR #313) and runs **locally only** — so local checks are
the only automated gate before the Vercel preview. Scale the checks to the change:

- **Always:** `npm test -- --run` (Vitest unit tests) and `npm run lint`. Fast, every PR.
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

**Never push code directly to `main`.** Every change — no matter how small — must go through a branch and PR.

Rules:
1. Create a feature/fix branch (e.g. `fix/some-bug`, `feat/some-feature`)
2. **Always branch off `main` and set `main` as the PR target.** Never base a branch on another feature branch or open PR.
3. Push to that branch and open a PR
4. Wait for explicit user approval ("merge it", "looks good") before merging
5. Only merge after the user has reviewed and tested on the Vercel preview deployment

**PR isolation rule:** Each PR must be independent. If you are working on a new feature while another PR is open, start fresh from the latest `main` — do not stack branches or include commits that belong to an open PR. If a conflict arises because another PR hasn't merged yet, resolve it after that PR merges rather than combining them.

**Why:** The user reviews and tests every change on the preview deployment before it reaches main. Stacked or combined PRs make it impossible to review and deploy changes independently.
