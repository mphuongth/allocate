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
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
