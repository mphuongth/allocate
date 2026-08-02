import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { renderToBuffer } from '@react-pdf/renderer'
import type { DocumentProps } from '@react-pdf/renderer'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { PortfolioReport } from '@/components/report/PortfolioReport'
import { readJsonBody } from '@/lib/apiBody'
import { buildDashboardOverview } from '@/lib/dashboardOverview'
import { DEFAULT_LOCALE, isAppLocale } from '@/lib/locale'
import { todayIso } from '@/lib/dates'

// The whole body is one locale string, so a few dozen bytes is generous. The
// route used to take the entire dashboard payload from the client, which meant
// an authenticated user could both forge their own report's figures and hand
// the server an arbitrarily large or deeply nested object to render (#594).
const MAX_BODY_BYTES = 256

// Mirrors the window hardcoded in check_report_render_rate_limit; used only as
// the Retry-After fallback when the RPC can't tell us a precise one.
const RATE_LIMIT_WINDOW_SECONDS = 60

export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Parsed before the render so a malformed body is a 400, not swallowed by
    // the catch below and reported as a PDF generation failure (#566). The body
    // is optional: a client that only wants the default locale can send nothing.
    const parsed = await readJsonBody<{ locale?: unknown }>(req, {
      optional: true,
      maxBytes: MAX_BODY_BYTES,
    })
    if (!parsed.ok) return parsed.response

    // Allowlisted, not passed through: `locale` selects the label set and the
    // date format inside the PDF, and it is the only thing the client still gets
    // to influence about the document.
    const raw = parsed.body.locale
    if (raw !== undefined && !isAppLocale(raw)) {
      return NextResponse.json({ error: 'Unsupported locale' }, { status: 400 })
    }
    const locale = raw ?? DEFAULT_LOCALE

    // Durable per-user render budget (atomic fixed window in Postgres), checked
    // before the query + render so a refused call costs nothing. Rendering a PDF
    // is by far the most expensive thing an authenticated user can ask this app
    // to do, and nothing else bounds how often they can ask.
    const { data: rl, error: rlError } = await supabase.rpc('check_report_render_rate_limit')
    const verdict = Array.isArray(rl) ? rl[0] : rl
    if (rlError || !verdict) {
      // Fail CLOSED, like the gold-refresh limiter (#530): if the limit can't be
      // verified — RPC error, missing verdict, migration not yet applied — refuse
      // rather than let the render run uncapped exactly when the database is
      // unhealthy. Exporting a report is non-essential, so a retryable 503 is the
      // safe default.
      console.error('[report] rate-limit check unavailable:', rlError)
      return NextResponse.json(
        { error: 'Rate limit check unavailable. Please try again shortly.' },
        { status: 503, headers: { 'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS) } },
      )
    }
    if (verdict.allowed === false) {
      const retryAfter = verdict.retry_after_seconds ?? RATE_LIMIT_WINDOW_SECONDS
      return NextResponse.json(
        { error: 'Too many report exports. Please wait and try again.', retryAfter },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      )
    }

    // Derived here from the caller's own holdings — never taken from the request.
    // A forged body can no longer put figures into a PDF, and the render's size
    // is bounded by the user's real portfolio rather than by what they can POST.
    const overview = await buildDashboardOverview(supabase, user.id)
    if (!overview.ok) {
      return NextResponse.json({ error: 'Failed to load report data' }, { status: 500 })
    }

    const element = createElement(PortfolioReport, {
      data: overview.data,
      locale,
    }) as ReactElement<DocumentProps>

    const buffer = await renderToBuffer(element)

    const filename = `allocate-report-${todayIso()}.pdf`

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') return new Response(null, { status: 499 })
    console.error('[report] PDF generation failed:', err)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}
