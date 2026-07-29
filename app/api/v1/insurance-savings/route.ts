import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateUUID } from '@/lib/validation'
import { ownershipError } from '@/lib/assertOwned'
import { readJsonBody } from '@/lib/apiBody'

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  const { insurance_member_id, amount_saved_vnd, saved_date } = body

  let cleanMemberId: string
  let cleanAmount: number
  let cleanSavedDate: string | undefined
  try {
    if (!insurance_member_id) throw new ValidationError('insurance_member_id is required')
    cleanMemberId = validateUUID(insurance_member_id, 'insurance_member_id')
    cleanAmount = validateAmount(amount_saved_vnd, 'amount_saved_vnd')
    if (cleanAmount <= 0) throw new ValidationError('Amount must be greater than 0')
    if (saved_date !== undefined && saved_date !== null) {
      if (typeof saved_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(saved_date) || Number.isNaN(Date.parse(saved_date))) {
        throw new ValidationError('saved_date must be a valid YYYY-MM-DD date')
      }
      cleanSavedDate = saved_date
    }
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  // A valid UUID isn't proof of ownership: without this, a caller who knew a
  // foreign member_id could log savings against someone else's policy. The DB
  // trigger (#525) is the backstop; this makes it a clear 403 rather than a 500
  // from mid-write.
  const ownErr = await ownershipError(supabase, 'insurance_members', 'member_id', cleanMemberId, user.id, 'insurance member')
  if (ownErr) return ownErr

  const { data, error } = await supabase
    .from('insurance_savings')
    .insert({
      user_id: user.id,
      insurance_member_id: cleanMemberId,
      amount_saved_vnd: cleanAmount,
      ...(cleanSavedDate ? { saved_date: cleanSavedDate } : {}),
    })
    .select('id, amount_saved_vnd, saved_date, created_at')
    .single()

  if (error) return NextResponse.json({ error: 'Failed to record savings' }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
