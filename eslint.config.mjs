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
    },
  },
]);

export default eslintConfig;
