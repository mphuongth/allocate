# Cairn

Personal finance, one stone at a time. A plan-and-track app for goals, investments, and monthly budgets — built with Next.js, Supabase, and Tailwind CSS. Supports Vietnamese and English.

> A cairn is a stack of stones that marks a trail. Every saving, every fund, every monthly plan is a stone on your financial journey.

Production: https://allocate-kohl.vercel.app/

## Features

- **Asset Overview** — visualize your portfolio with interactive charts (funds, bank deposits, gold, insurance)
- **Savings Goals** — track financial goals with progress monitoring and transaction assignment
- **Investment Tracking** — record and monitor fund investments, bank savings, stocks, and gold
- **Monthly Planning** — allocate monthly income across goals, fixed expenses, insurance, and one-off costs
- **Auto-Populate** — fixed expenses and insurance fees automatically flow into each month's plan
- **Insurance Tracking** — manage family insurance policies with annual-to-monthly fee calculations
- **AI Chat** — ask questions about your portfolio via an AI assistant (multi-provider)
- **i18n** — full English and Vietnamese support via next-intl

## Tech Stack

| Concern | Library |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript |
| Styling | Tailwind CSS 4, shadcn/ui |
| Database & Auth | Supabase (PostgreSQL + Supabase Auth) |
| AI | Vercel AI SDK (`ai`, `@ai-sdk/react`) |
| Charts | Recharts |
| i18n | next-intl |
| Deployment | Vercel |

## Getting Started

Copy the environment template and fill in your Supabase credentials:

```bash
cp .env.example .env.local
```

Install dependencies and run the dev server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |

AI chat requires additional provider keys (see `lib/chat-providers.ts`).

## Project Structure

```
app/
├── page.tsx                  # Landing page (redirects to /dashboard if logged in)
├── layout.tsx                # Root layout (fonts, theme, i18n, toast)
├── globals.css               # Tailwind + CSS variables (light/dark tokens)
│
├── (app)/                    # Protected routes (require auth)
│   ├── layout.tsx            # App shell with sidebar + header
│   ├── dashboard/            # Asset overview with charts and goal cards
│   ├── funds/                # Fund library (add/edit/NAV refresh)
│   ├── planning/             # Monthly planning with allocation summary
│   └── settings/             # Goals, transactions, expenses, insurance tabs
│
├── savings-goals/[goalId]/   # Goal detail page with transaction history
│
├── auth/
│   ├── login/
│   ├── signup/
│   └── callback/             # Supabase OAuth callback
│
├── api/
│   ├── funds/                # Legacy fund routes
│   └── v1/                   # REST API (all authenticated)
│       ├── chat/             # AI chat endpoint
│       ├── dashboard/        # Overview + history data
│       ├── savings-goals/
│       ├── investment-transactions/
│       ├── fund-investments/
│       ├── direct-savings/
│       ├── fixed-expenses/
│       ├── insurance-members/
│       ├── insurance-savings/
│       ├── monthly-plans/    # Plans with overrides, fund investments, other expenses
│       ├── funds/refresh-nav/
│       └── gold-price/
│
└── components/               # Page-level shared components
    ├── ThemeProvider.tsx
    ├── ThemeToggleButton.tsx
    ├── LanguageSwitcher.tsx
    ├── layouts/AuthenticatedLayout.tsx
    └── navigation/           # Sidebar, Header, MobileDrawer, Breadcrumb, UserMenu

components/                   # App-wide shared components
├── AuthProvider.tsx
├── ChatWidget.tsx
└── ui/                       # shadcn/ui primitives

lib/
├── supabase.ts               # Browser Supabase client
├── supabase-server.ts        # Server Supabase client (RSC/API routes)
├── chat-providers.ts         # AI provider configuration
└── utils.ts                  # cn() utility

messages/
├── en.json                   # English translations
└── vi.json                   # Vietnamese translations

supabase/
└── migrations/               # Database schema migrations
```

## Scripts

```bash
npm run dev      # Start dev server (Turbopack)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # ESLint
```
