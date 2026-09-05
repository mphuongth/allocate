import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    // `.claude/worktrees` holds gitignored local git worktrees (stale copies of
    // the repo other Claude sessions check out). They contain their own *.test
    // files, which vitest would otherwise discover and run — reporting failures
    // from a stale checkout, not this one (#469).
    exclude: ['**/node_modules/**', '**/e2e/**', '**/.claude/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // Count every application/server source file, not just the ones a test
      // happens to import — an untested route must show up as 0%, not vanish
      // from the report and leave the global number overstating the repo (#596).
      // Vitest 4 reports every file matching `include` regardless of imports, so
      // the explicit patterns below are what makes that true (the old `all` flag
      // is gone).
      include: [
        'app/**/*.{ts,tsx}',
        'lib/**/*.{ts,tsx}',
        'components/**/*.{ts,tsx}',
        // The feature layer (#600): domain contracts, models and actions moved
        // out of the UI. Counted like any other source so a module that lands
        // here untested shows as 0% instead of vanishing from the report.
        'features/**/*.{ts,tsx}',
        'server/**/*.{ts,tsx}',
        'i18n/**/*.{ts,tsx}',
        // The Next.js middleware — auth redirects, session refresh, CSP. It's
        // the only application source at the repo root, and it runs on every
        // page navigation, so it belongs in the report like any route.
        'proxy.ts',
        // Deliberately NOT here: public/sw.js. lib/__tests__/serviceWorker.test.ts
        // does exercise the real worker, but it loads the file as text and runs
        // it through `new Function(...)`, which v8 cannot attribute back to the
        // source. Adding it reports a flat 0% across 140 statements — measured —
        // so it would drag the global floor down while labelling a well-tested
        // file untested. Attributing it properly means reworking that harness to
        // load the worker through the module pipeline.
      ],
      exclude: [
        '**/__tests__/**',
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        // Framework manifests and metadata: declarative config with no branches
        // worth gating on.
        'app/layout.tsx',
        'app/manifest.ts',
        'app/robots.ts',
        'app/sitemap.ts',
        'app/**/layout.tsx',
        'app/**/loading.tsx',
        'app/**/not-found.tsx',
      ],
      // Ratchet, not aspiration: the globals sit just under today's numbers so a
      // regression fails CI while nothing fails on day one. The per-file entries
      // guard the money paths the audit called out — raise them as tests land,
      // never lower them to make a red build green.
      thresholds: {
        // Repo-wide floor, measured 2026-08-03 at 63.07 / 59.17 / 62.48 / 66.30
        // (#602 lifted the dashboard's view model, its data loading and the
        // maturity merge rules out of components only a full-page render could
        // reach, and tested them directly).
        statements: 63,
        branches: 59,
        functions: 62,
        lines: 66,

        // The money math. These modules are the ones that have actually shipped
        // bugs, and they are fully covered today — hold them there.
        'lib/{accumulating,bankWithdrawal,dates,depositValuation,effectiveRange,finance,fundWithdrawal,goldWithdrawal,heldForMerge,inflation,maturity,mergeCluster,mergeEligibility,planning,recurringLink,snapshots,validation,withdrawalProgress}.ts':
          { lines: 100, functions: 100, branches: 80 },

        // The server routes the audit flagged as thin. Floors sit just under
        // today's numbers: they fail on a regression, and they are meant to be
        // raised as tests land — never lowered to turn a red build green.
        'app/api/v1/investment-transactions/route.ts': { lines: 65, branches: 57, functions: 50 },
        'app/api/v1/investment-transactions/[id]/route.ts': { lines: 78, branches: 72, functions: 65 },
        'app/api/v1/dashboard/overview/route.ts': { lines: 95, branches: 72, functions: 90 },
        'lib/dashboardOverview.ts': { lines: 35, branches: 15, functions: 20 },
      },
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
