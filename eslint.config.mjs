import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Gitignored local git worktrees (stale repo copies checked out by other
    // Claude sessions) — don't lint their sources as if they were ours (#469).
    ".claude/**",
  ]),
  {
    rules: {
      // Downgrade two newer react-compiler rules (pulled in via eslint-config-next)
      // from error → warn. They fire on legitimate imperative code, not bugs:
      //  - set-state-in-effect: our client-only mount reads (navigator.onLine, the
      //    localStorage theme, matchMedia) and prop→state syncs genuinely need
      //    setState inside an effect — the value isn't knowable during SSR/first
      //    render.
      //  - immutability: writing document.cookie inside an onClick handler (locale
      //    toggle) is a normal side effect the rule flags as a global mutation.
      // Keep them as warnings so the signal survives without failing `npm run lint`.
      // The high-value react-hooks rules (rules-of-hooks, exhaustive-deps) stay at
      // error.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      // Honor the `_`-prefix convention for intentionally-unused bindings. Test
      // fetch mocks must declare `(url, init)` so `mock.calls[i]` is typed as the
      // full [url, init] tuple (the assertions read `calls[i][1]`), even when the
      // mock body ignores those args — prefixing with `_` marks that as deliberate.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // Business dates come from lib/dates, never from UTC or the runtime's local
  // zone (#591). Between 00:00 and 06:59 Vietnam time the UTC calendar date is
  // still yesterday, so `new Date().toISOString().slice(0, 10)` recorded the
  // wrong business day; `new Date().getMonth()` has the mirror problem of
  // depending on where the code runs. This keeps them from creeping back.
  // (`new Date().toISOString()` on its own is fine — that's a UTC *timestamp*,
  // which is exactly what `updated_at` and friends want.)
  {
    files: ["app/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    ignores: ["lib/dates.ts", "**/__tests__/**"],
    rules: {
      "no-restricted-syntax": ["error",
        {
          selector: "MemberExpression[object.callee.property.name='toISOString'][object.callee.object.type='NewExpression'][object.callee.object.callee.name='Date'][object.callee.object.arguments.length=0][property.name=/^(slice|split)$/]",
          message: "Don't derive a business date from the UTC date — use todayIso() from lib/dates.",
        },
        {
          selector: "CallExpression[callee.object.type='NewExpression'][callee.object.callee.name='Date'][callee.object.arguments.length=0][callee.property.name=/^(getMonth|getFullYear|getDate)$/]",
          message: "Don't derive a business date/month from the runtime's local zone — use todayIso()/businessYearMonth() from lib/dates.",
        },
        {
          // The two selectors above only see the direct form. Aliasing the clock
          // first (`const now = new Date(); now.getMonth()`) reads identically to
          // reading parts off a *parsed* date, which is legitimate — so the alias
          // itself is what gets rejected, and the author has to say which they
          // meant. A genuine timestamp is `new Date().toISOString()` inline, or
          // this rule disabled with a note (see mark-paid, which needs one instant
          // shared across updated_at and its audit line).
          selector: "VariableDeclarator[init.type='NewExpression'][init.callee.name='Date'][init.arguments.length=0]",
          message: "Don't alias the current clock — a business date/month comes from lib/dates (todayIso, businessYearMonth); a UTC timestamp is `new Date().toISOString()` inline.",
        },
      ],
    },
  },
]);

export default eslintConfig;
