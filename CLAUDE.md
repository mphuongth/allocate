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
