import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { renderToStream } from '@react-pdf/renderer'
import type { DocumentProps } from '@react-pdf/renderer'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { PortfolioReport } from '@/components/report/PortfolioReport'
import type { DashboardData } from '@/app/assets/DashboardClient'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data, locale }: { data: DashboardData; locale: string } = await req.json()
    const element = createElement(PortfolioReport, { data, locale }) as ReactElement<DocumentProps>

    const stream = await renderToStream(element)

    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const buffer = Buffer.concat(chunks)

    const filename = `allocate-report-${new Date().toISOString().slice(0, 10)}.pdf`

    return new Response(buffer, {
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
