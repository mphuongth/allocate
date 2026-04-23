## Summary

Unify the whole app on the navy + emerald brand. The logo, favicons, and PWA metadata already speak navy/emerald after PRs #127/#129/#130; this PR closes the gap so the UI — landing, auth, every nav, every form, every modal, the PWA splash — speaks the same language.

### Color system

**Light mode** (`:root` in `globals.css`)

| Token | Hex | Role |
| --- | --- | --- |
| `--brand` | `#0F2A4A` | Navy — wordmark, primary brand text |
| `--brand-light` | `#ecfdf5` | Emerald-50 — accent surface, hover bg |
| `--brand-dark` | `#10B981` | Emerald — active state, strong accent |

**Dark mode** (`.dark`)

| Token | Hex | Role |
| --- | --- | --- |
| `--brand` | `#F8FAFC` | Cream — matches the icon peak stone |
| `--brand-light` | `#0F2A4A` | Navy — brand-tinted surface in dark mode |
| `--brand-dark` | `#34D399` | Mint — active state |

**Role split used everywhere**

- **Navy** is the *identity* color — wordmark, icon background, the portfolio-value "hero" card, PWA splash.
- **Emerald** is the *action* color — primary CTAs, active nav items, progress bars, links, focus rings, growth indicators.
- Gains/losses stay green — emerald ties the two together cleanly.

### What changed

**Brand tokens**: `app/globals.css` — both `:root` and `.dark`.

**Landing / auth / offline**
- `app/page.tsx` — bg gradient, signup CTA, hero gradient text, feature-card borders + icons, CTA card, link colors
- `app/auth/login/page.tsx`, `app/auth/signup/page.tsx` — gradient "A" tile → Cairn icon; CTAs emerald; bg matches landing
- `app/~offline/page.tsx` — "A" tile → Cairn icon; button emerald

**App chrome**
- `app/components/navigation/Sidebar.tsx` — wordmark uses `text-brand`; active nav item emerald; profile avatar emerald

**In-app components**
- `NetWorthCard` — chart line `#8b5cf6` → `#10b981`; gradient fill matches
- `InsuranceCard`, `GoalPickerModal`, `DashboardClient`, `UnallocatedSection` — selection highlights, CTAs, focus rings
- Settings tabs: `SavingsGoalsTab`, `FixedExpensesTab`, `InsuranceMembersTab`, `InvestmentTransactionsTab`
- Planning components: `InsuranceSection`, `FixedExpensesSection`, `OtherExpensesSection`, `DirectSavingsSection`, `FundInvestmentsSection`, `SalaryInput`
- `FundLibraryClient`

**Shared primitives**
- `components/ui/button.tsx` — focus ring + `link` variant color
- `components/ui/input.tsx`, `select.tsx`, `textarea.tsx` — focus border + ring

**Screenshot generator** (Android PWA install prompt previews)
- `scripts/generate-screenshots.mjs` — bg gradient, sidebar logo, active item, portfolio label, progress fills. Navy on the hero card to mirror the real app; progress fills emerald (growth).
- `public/screenshot-mobile.png`, `public/screenshot-desktop.png` — regenerated

### What I didn't touch (on purpose)

- **`ASSET_COLORS` / `TYPE_BADGE` maps** — `fund: purple`, `bank: blue`, `gold: amber`, `stock: green`. Categorical asset tags, not brand. Purple stays distinct from brand emerald. I did unify the one inconsistent entry in `UnallocatedSection` (it used violet; now purple to match the three other asset-color maps).
- **`RELATIONSHIP_COLORS.Self`** — swapped from violet to indigo so it's no longer the same hue as the old brand, but it's still a categorical tag.
- **Chart palette `#8b5cf6`** in `GoalCard` / `AssetAllocationPie` — categorical slice colors; swapping them to emerald would collide with the brand accent and reduce chart readability.

### Test plan

- [ ] **Landing**: gradient bg is slate → emerald (not violet/pink), CTAs emerald, feature-card hover borders emerald, hero gradient text reads navy → emerald
- [ ] **Auth** (login, signup, email-sent): Cairn icon replaces the purple "A" tile; CTAs emerald; bg matches landing
- [ ] **Dashboard sidebar**: collapsed shows "C" in brand (navy light / cream dark); expanded shows "Cairn"; active nav item emerald-tinted
- [ ] **Forms**: focus rings on input / select / textarea are emerald across every form
- [ ] **Modals**: all primary CTAs (`bg-emerald-600`) read consistent
- [ ] **Net-worth chart**: line is emerald; empty-state divider emerald
- [ ] **PWA install**: splash stays navy; install screenshots preview the new emerald+navy UI
- [ ] **Dark mode**: the wordmark reads cream; active nav items read emerald-tinted on navy; focus rings still visible
