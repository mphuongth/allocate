import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { renderToBuffer } from '@react-pdf/renderer'
import type { DocumentProps } from '@react-pdf/renderer'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { PortfolioReport } from '@/components/report/PortfolioReport'
import type { DashboardData } from '@/app/assets/DashboardClient'
import { readJsonBody } from '@/lib/apiBody'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Parsed before the render so a malformed body is a 400, not swallowed by
    // the catch below and reported as a PDF generation failure (#566).
    const parsed = await readJsonBody<{ data: DashboardData; locale: string }>(req)
    if (!parsed.ok) return parsed.response
    const { data, locale } = parsed.body
    const element = createElement(PortfolioReport, { data, locale }) as ReactElement<DocumentProps>

    const buffer = await renderToBuffer(element)

    const filename = `allocate-report-${new Date().toISOString().slice(0, 10)}.pdf`

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
