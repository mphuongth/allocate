<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/cairn-wordmark-dark.svg">
  <img src="public/cairn-wordmark.svg" alt="Cairn" width="280">
</picture>

### Personal finance, one stone at a time.

Plan, track, and visualize your financial journey — goals, investments, monthly budgets, insurance — all in one place. Bilingual (Vietnamese + English).

**[Try the live app →](https://allocate-kohl.vercel.app/)**

</div>

---

> A cairn is a stack of stones that marks a trail. Every saving, every fund, every monthly plan is a stone on your financial journey.

## What Cairn does

Cairn is a personal-finance webapp that turns the mental gymnastics of "where does my money go?" into a clear, visual trail. You set goals, log investments, and plan each month — Cairn shows you how every choice moves you forward.

## What you'll get

- **A single dashboard for your net worth** — see funds, bank deposits, gold, and stocks side by side with allocation breakdown and a sparkline of your portfolio history.
- **Goals you can actually track** — set targets (house, retirement, emergency), assign transactions to them, and watch progress bars fill as you save.
- **Monthly planning that doesn't break** — Cairn pulls your fixed expenses and insurance fees into each month's plan automatically. Override anything for a specific month without losing the defaults.
- **Investment tracking across every asset type** — fund NAV updates, bank deposits with interest projections, gold by chỉ at live prices, stocks. Buy and sell flows for each.
- **Insurance you don't dread** — family policies with annual-to-monthly fee calculations and per-member payment tracking.
- **A real desktop + mobile experience** — fully redesigned layouts for both, not just a stretched mobile view. Dark mode included.
- **Vietnamese & English** — every label, every plural, every currency format.

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/mphuongth/allocate.git
cd allocate
npm install

# 2. Configure Supabase
cp .env.example .env.local
# edit .env.local with your Supabase project URL + anon key

# 3. Run the dev server
npm run dev
```

Open <http://localhost:3000>.

> The first time you sign up, Cairn will create the schema for your account via Supabase migrations. Make sure your Supabase project has run the migrations in `supabase/migrations/`.

## Environment variables

| Variable | Purpose | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key | yes |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start dev server (Turbopack) on port 3000 |
| `npm run build` | Production build |
| `npm run start` | Start production server (after `build`) |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest, watch mode) |
| `npm test -- --run` | Unit tests once |
| `npm run test:coverage` | Coverage report |
| `npm run test:e2e` | End-to-end tests (Playwright) |
| `npm run test:e2e:ui` | Playwright UI mode |

## Running E2E locally

E2E tests (Playwright) run **locally**, not in CI — the dedicated test Supabase project is a small instance whose Disk IO budget can't sustain the suite's write load. Run them against a **local Supabase stack** (Docker) so there's no IO throttling and no risk of touching production:

```bash
supabase start            # boots local Postgres + replays all migrations
```

Then create **`.env.e2e`** (gitignored, loaded by `playwright.config.ts` for non-CI
runs) pointing both the app and the harness at the local stack, using the keys
`supabase start` (or `supabase status -o env`) prints:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from `supabase start`>
E2E_SUPABASE_URL=http://127.0.0.1:54321
E2E_SUPABASE_SERVICE_ROLE_KEY=<service_role key from `supabase start`>
```

```bash
npm run test:e2e          # or: npm run test:e2e:ui
```

The guard in `e2e/helpers/guard.ts` refuses to run against the production project, so a misconfigured env can't churn prod. The suite shares one auth user, so it runs serially (`workers: 1`).

### Windows / WSL2 (no Docker Desktop)

On Windows where Docker Desktop can't be installed (e.g. LTSC builds below 19045),
run the Docker engine **inside WSL2** instead — same containers, still fully local:

1. `wsl --install` (reboot), then complete Ubuntu's first-run user setup.
2. Inside WSL: install Docker Engine (`get.docker.com`) and the Supabase CLI, then
   run `supabase start` from this repo via `/mnt/...`. WSL2 forwards
   `127.0.0.1:54321` to Windows localhost, so the app + Playwright run on Windows.
3. If Playwright's bundled Chromium download stalls, add `PLAYWRIGHT_CHANNEL=msedge`
   to `.env.e2e` to run against system-installed Edge (see `playwright.config.ts`).

`supabase/config.toml` disables services the app doesn't use (studio, analytics,
realtime, storage, edge functions, inbucket) to keep the stack light.

## Tech stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript |
| Styling | Tailwind CSS 4, shadcn/ui |
| Database & Auth | Supabase (PostgreSQL + Auth) |
| Charts | Recharts |
| i18n | next-intl |
| Unit tests | Vitest + Testing Library |
| E2E | Playwright |
| Deployment | Vercel |

## Project structure

```
app/
├── page.tsx                  # Landing page (redirects to /dashboard if logged in)
├── (app)/                    # Protected routes (require auth)
│   ├── dashboard/            # Net-worth overview, goals, unallocated, insurance
│   ├── funds/                # Fund library with NAV refresh
│   ├── planning/             # Monthly planning with allocation summary
│   └── settings/             # Goals, transactions, expenses, insurance tabs
├── auth/                     # Login / signup / OAuth callback
├── api/v1/                   # Authenticated REST API
└── components/               # Layouts, navigation, theme

components/                   # App-wide shared components
lib/                          # Supabase clients, formatters, finance helpers
messages/                     # en.json + vi.json (next-intl)
supabase/migrations/          # Database schema migrations
e2e/                          # Playwright specs
```

## Contributing

Cairn follows a strict branch-and-PR workflow — never push directly to `main`. Every change goes through a feature branch, PR, and Vercel preview review. See `CLAUDE.md` for the full development methodology (TDD + PR isolation).
