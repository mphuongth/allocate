# Project structure and layer boundaries

One rule for where a file goes, and one direction the dependency arrows point.

This exists because the audit in #600 found neither. `app/assets/` had become a
bucket holding dashboard, transaction, goal, insurance and maturity UI;
`DashboardClient.tsx` declared the dashboard's data contract, so the server
(`lib/dashboardOverview.ts`), the PDF report and the navigation badge each
imported a type out of a 1,200-line `'use client'` component. A UI edit could
break all three, and a new contributor had no way to decide where a component,
type, hook or business rule belonged.

## The layers

| Layer | Owns | May import from |
| --- | --- | --- |
| `app/` | Routes, layouts, route handlers, and (for now) the screens themselves | anything |
| `features/<domain>/` | One domain's contracts, models, actions, and eventually its UI | `components/`, `lib/`, `server/`, other `features/` contracts |
| `components/ui/`, `components/layout/`, `components/navigation/`, `components/report/` | Reusable primitives, hooks and app chrome with no domain knowledge | `lib/` |
| `server/` | Server services and RPC orchestration | `lib/`, `features/*/contracts` |
| `lib/` | Pure utilities and small infrastructure (money math, dates, Supabase clients) | `lib/`, `features/*/contracts` |
| `supabase/` | Migrations and the SQL test suite | — |

**The arrow only points up.** `app/` is the top: everything below it must be
usable without it. Nothing under `lib/`, `components/`, `features/`, `server/`
or `i18n/` may import from `app/`. If a lower layer reaches into `app/` for a
type, that type is in the wrong place — extract it to a contract module.

## Where does it go?

- **A data shape crossing a boundary** (an API response, something the server
  builds and the UI renders) → `features/<domain>/contracts.ts`. Layer-neutral
  by construction: no React, no `'use client'`, no imports. See
  [`features/dashboard/contracts.ts`](../features/dashboard/contracts.ts).
- **A hook or component with no domain knowledge** (focus trap, mount/unmount
  animation, amount input) → `components/ui/`. If two features import it, it
  isn't a feature's — it's shared. Never leave it owned by whichever feature
  happened to need it first.
- **A domain rule** (interest accrual, withdrawal progress, merge eligibility)
  → `lib/`, as a pure function with a unit test. Not in a component, not
  inlined in a route handler.
- **A screen** → `app/` for now, `features/<domain>/` as files are touched.
- **HTTP handling** → `app/api/**`. Route handlers stay thin: parse → auth →
  validate → call a server service or an atomic RPC. A handler must not import
  a screen's module, not even for a type.

## Enforcement

[`__tests__/architecture.test.ts`](../__tests__/architecture.test.ts) fails the
build on: an import from `app/` in any lower layer, a route handler or the
navigation chrome importing feature UI, and a type exported from
`DashboardClient.tsx` or `PlanningClient.tsx`. Add a rule there when you
establish one here.

## Migration status (#600)

Done:

- Dashboard DTOs extracted to `features/dashboard/contracts.ts`; `lib/`, the
  report and the nav badge no longer import from `DashboardClient`.
- `useDialogA11y` / `useDialogMount` moved out of Planning into `components/ui/`.
- Dashboard decomposed (#602): the derived view model (`dashboardModel.ts`), the
  data lifecycle (`useOverviewData`), the fund-detail history
  (`useFundPurchaseHistory`) and the overview cache all live in
  `features/dashboard/`, tested directly instead of through a full-page render.
  `DashboardClient` is orchestration + layout: 1,210 → ~805 lines.
- Maturity resolve decomposed (#602): the merge rules and picker state
  (`features/dashboard/maturity/`) and the sheet's 121-line copy block are out
  of `MaturityResolveBody`, 1,021 → ~818 lines.
- Fund Library desktop/mobile drift (#603): one filter+sort rule and one
  fund-type palette in `features/funds/`, replacing a byte-identical copy in
  each view. The table and the card list stay separate — they genuinely differ.
- Planning desktop/mobile drift (#603): the plan's DTOs are out of
  `PlanningClient.tsx` and into `features/planning/contracts.ts`, and the
  per-row derivations (month labels, goal progress, an allocation's sublabel,
  the skipped/overridden/amount rules for a fixed expense and an insurance
  member) into `features/planning/planModel.ts`. Three of those copies had
  already drifted. The table and the card stack stay separate.
- Settings desktop/mobile drift (#603): the theme, language and price-source
  tables in `features/settings/settingsOptions.ts` — each had been declared
  twice, with a third hand-written chain on mobile to summarise the current
  choice in the row — and the profile editor's draft + save-flash sequence in
  `useProfileEditor`, replacing a copy in each view that carried its own
  `SAVE_FLASH_MS`. `useManagedTimeout` moved to `components/ui/`; it knows
  nothing about settings.
- One component root: `app/components/` folded into `components/{ui,layout,navigation}`
  and `features/landing/`. The app shell no longer imports a screen — the
  add-transaction sheet reaches it as an opaque `overlays` node from the route
  group, with its open flag in `NavigationContext`.

All three drift areas in #603 are done: Fund Library, Planning, Settings.

Still open — incremental, as files are touched, not as a repo-wide rename:

- `app/assets/` split into `features/dashboard`, `features/investments`,
  `features/goals`, `features/insurance`. This is the standing rule for new
  work, not a migration anyone should schedule: move a file the first time you
  have a reason to open it.
