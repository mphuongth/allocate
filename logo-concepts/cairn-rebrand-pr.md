## Summary

Rename **Allocate → Cairn** across the app. The old name described a single feature (monthly allocation); the new name describes the whole product — a **cairn** is a stack of stones that marks a trail, and every saving, fund, and monthly plan is a stone on the user's financial journey.

**Rename-only.** The `allocate` verb and derived identifiers (`unallocatedFunds`, `overAllocated`, `AllocationSummary`, `sectionUnallocated`, the i18n strings for "Allocated" / "Over-allocated" / "Unallocated Investments") still describe the underlying action and are intentionally unchanged.

### What changed

**Metadata & package**
- `package.json` / `package-lock.json`: `name` → `cairn`
- `app/layout.tsx`: `title`, `appleWebApp.title`, `description` (new tagline)
- `app/manifest.ts`: `name`, `short_name`, `description`, `theme_color`, `background_color`
- `.braingrid/project.json`: `project_name` (repo identity fields untouched — the GitHub repo stays `mphuongth/allocate`)
- `README.md`: heading + lead paragraph now use the cairn metaphor

**UI copy & branding**
- `app/page.tsx` — landing header and footer brand mark: the purple gradient "A" tile is replaced with the donut icon (served from `/cairn-icon.svg`). Wordmark text flips to "Cairn". Copyright line updated.
- `app/components/navigation/Header.tsx`, `Sidebar.tsx`, `MobileDrawer.tsx` — brand text updated. The collapsed sidebar monogram "A" is now "C".
- `scripts/generate-screenshots.mjs` — the inline SVG screenshots (shown in the Android PWA install prompt) now say "Cairn".

**Theme colors aligned with the new brand**
- `viewport.themeColor` and `manifest.theme_color`: `#7c3aed` (leftover violet) → navy palette matching the donut icon (`#0F2A4A` dark, `#f8fafc` light)
- `manifest.background_color`: now `#0F2A4A` so the PWA splash is cohesive with the icon background

**Brand assets**
- Renamed `public/allocate-icon.svg` → `public/cairn-icon.svg`
- Renamed `public/allocate-icon-transparent.svg` → `public/cairn-icon-transparent.svg`
- Added `public/cairn-wordmark.svg` (light) and `public/cairn-wordmark-dark.svg`
- `scripts/generate-icons.mjs` emits the new filenames

### Intentionally deferred

- **Landing page palette refresh.** `app/page.tsx` still has violet gradients on the hero and CTA (`from-violet-50 via-purple-50 to-pink-50`, `bg-violet-600` buttons, etc.). That's a design pass, not a rename, so it's saved for a follow-up PR — keeps this review focused on the name change.
- **Screenshot palette refresh.** `scripts/generate-screenshots.mjs` still uses the old `#7c3aed` accent in the mock UI. Same reasoning — rename first, redesign later.

### Test plan

- [ ] `npm run lint` — no new lint errors on touched files (pre-existing errors in `ThemeProvider.tsx` / `GoalDetailClient.tsx` unaffected)
- [ ] `npm run dev` — landing page header + footer show the donut icon and "Cairn" wordmark
- [ ] App nav (sidebar expanded, sidebar collapsed, mobile header, mobile drawer) all show "Cairn" / "C"
- [ ] Browser tab title is "Cairn"
- [ ] On the Vercel preview: install as PWA on iOS + Android — installed app name is "Cairn", splash screen and theme color use the navy palette
- [ ] `npm run generate-icons` regenerates all PNGs + emits `public/cairn-icon.svg` and `public/cairn-icon-transparent.svg`
- [ ] `npm run generate-screenshots` regenerates the Android install-prompt screenshots with the new name
