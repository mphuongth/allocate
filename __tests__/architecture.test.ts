import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

// Layer boundaries (#600). The audit found the dependency arrows pointing the
// wrong way: `lib/dashboardOverview.ts`, the PDF report component and the
// navigation badge all imported their data contract from `DashboardClient.tsx`
// — a 1,200-line `'use client'` dashboard component. That makes a UI edit able
// to break the server, the report and the nav, and leaves nobody able to say
// where a type belongs.
//
// The rules live in docs/architecture.md; this test is what makes them true.
// It reads imports as text — the questions here ("does anything under lib/
// import from app/") are structural, and the repo has no AST-parsing dependency
// on hand for a test.
const root = path.resolve(__dirname, '..')

const SOURCE_DIRS = ['app', 'lib', 'components', 'features', 'server', 'i18n']

/** Every .ts/.tsx file under `dir`, repo-relative, with `/` separators. */
function sourceFiles(dir: string): string[] {
  const abs = path.join(root, dir)
  let entries: import('fs').Dirent[]
  try {
    entries = readdirSync(abs, { withFileTypes: true })
  } catch {
    return [] // a layer that doesn't exist yet (features/, server/) has no files to check
  }
  return entries.flatMap((e) => {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sourceFiles(rel)
    return /\.tsx?$/.test(e.name) ? [rel] : []
  })
}

const ALL_FILES = SOURCE_DIRS.flatMap(sourceFiles)

/**
 * The module specifiers `file` imports, normalised to repo-relative paths so a
 * relative `../DashboardClient` and an aliased `@/app/assets/DashboardClient`
 * are the same edge. Bare package specifiers are dropped.
 */
function importsOf(file: string): string[] {
  const src = readFileSync(path.join(root, file), 'utf8')
  const specs = [...src.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
  return specs.flatMap((spec) => {
    if (spec.startsWith('@/')) return [spec.slice(2)]
    if (spec.startsWith('.')) return [path.posix.normalize(path.posix.join(path.posix.dirname(file), spec))]
    return []
  })
}

/** Files in `from` whose imports match `to`, as "file → import" lines. */
function edges(from: (f: string) => boolean, to: (spec: string) => boolean): string[] {
  return ALL_FILES.filter(from).flatMap((f) =>
    importsOf(f).filter(to).map((spec) => `${f} → ${spec}`),
  )
}

const isAppImport = (spec: string) => spec === 'app' || spec.startsWith('app/')
/**
 * UI that belongs to a screen: the `app/assets/` bucket and the route group.
 * `app/components/` is deliberately not here — it is the app's shared chrome
 * (navigation, layouts, primitives), which any screen may use.
 */
const isFeatureUi = (spec: string) => spec.startsWith('app/assets/') || spec.startsWith('app/(app)/')

describe('layer boundaries (#600)', () => {
  it('finds the source files it is meant to be checking', () => {
    // A broken walker would make every assertion below vacuously pass.
    expect(ALL_FILES.length).toBeGreaterThan(200)
    expect(ALL_FILES).toContain('lib/dashboardOverview.ts')
  })

  it('keeps lower layers free of app/ imports', () => {
    // `app/` is the top layer — routes, layouts and route handlers. Everything
    // below it (pure utilities, server services, shared components, feature
    // modules, i18n) has to be usable without it, so the arrow only ever points
    // upward. A type reached for from `lib/` is the symptom that a contract is
    // living in the wrong place.
    expect(edges((f) => !f.startsWith('app/'), isAppImport)).toEqual([])
  })

  it('keeps route handlers out of feature UI', () => {
    // Route handlers parse/auth/validate and call a service or RPC. Importing a
    // screen's module — even for a type — couples the HTTP contract to how the
    // dashboard happens to render today.
    expect(edges((f) => f.startsWith('app/api/'), isFeatureUi)).toEqual([])
  })

  it('keeps navigation out of feature UI', () => {
    // The sidebar/bottom-tab badge is chrome shared by every screen; it may read
    // a contract, never a screen's component module.
    expect(edges((f) => f.startsWith('app/components/navigation/'), isFeatureUi)).toEqual([])
  })

  it('exports no types from DashboardClient', () => {
    // The concrete instance of all of the above: the dashboard's DTOs live in a
    // layer-neutral contract module, not in the component that renders them.
    const src = readFileSync(path.join(root, 'app/assets/DashboardClient.tsx'), 'utf8')
    expect(src).not.toMatch(/^export (interface|type) /m)
  })
})
