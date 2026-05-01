import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { pdf } from '@react-pdf/renderer'
import type { DocumentProps } from '@react-pdf/renderer'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import { PortfolioReport } from '@/components/report/PortfolioReport'
import type { DashboardData } from '@/app/assets/DashboardClient'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const data: DashboardData = await req.json()
  const element = createElement(PortfolioReport, { data }) as ReactElement<DocumentProps>
  const buffer = await pdf(element).toBuffer()
  const filename = `allocate-report-${new Date().toISOString().slice(0, 10)}.pdf`

  return new Response(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
