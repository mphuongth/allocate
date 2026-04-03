'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, Edit, Trash2 } from 'lucide-react'
import ConfirmModal from '@/app/components/ConfirmModal'

interface InsuranceMember {
  member_id: string
  member_name: string
  relationship: string
  annual_payment_vnd: number
  monthly_premium_vnd: number
  payment_date: string | null
  created_at: string
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

const emptyForm = { member_name: '', relationship: '', annual_payment_vnd: '', payment_date: '' }

const INS_CACHE_KEY = 'insuranceMembersCache'
const CACHE_TTL = 2 * 60 * 1000
function getInsCache(): InsuranceMember[] | null {
  try {
    const raw = localStorage.getItem(INS_CACHE_KEY)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL) return null
    return data
  } catch { return null }
}
function setInsCache(data: InsuranceMember[]) {
  try { localStorage.setItem(INS_CACHE_KEY, JSON.stringify({ data, ts: Date.now() })) } catch {}
}
function bustInsCache() {
  try { localStorage.removeItem(INS_CACHE_KEY) } catch {}
}

export default function InsuranceMembersTab() {
  const t = useTranslations('insurance')
  const tCommon = useTranslations('common')
  const [members, setMembers] = useState<InsuranceMember[]>(() => getInsCache() ?? [])
  const [loading, setLoading] = useState(() => !getInsCache())
  const [showForm, setShowForm] = useState(false)
  const [editMember, setEditMember] = useState<InsuranceMember | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmMember, setConfirmMember] = useState<InsuranceMember | null>(null)
  const [successMsg, setSuccessMsg] = useState('')

  const fetchMembers = useCallback(async (opts?: { force?: boolean }) => {
    if (opts?.force) bustInsCache()
    const res = await fetch('/api/v1/insurance-members')
    const { members } = await res.json()
    const list: InsuranceMember[] = members ?? []
    setInsCache(list)
    setMembers(list)
    setLoading(false)
  }, [])

  useEffect(() => { fetchMembers() }, [fetchMembers])

  function openCreate() {
    setEditMember(null)
    setForm(emptyForm)
    setFormError('')
    setShowForm(true)
  }

  function openEdit(member: InsuranceMember) {
    setEditMember(member)
    setForm({
      member_name: member.member_name,
      relationship: member.relationship,
      annual_payment_vnd: String(member.annual_payment_vnd),
      payment_date: member.payment_date ?? '',
    })
    setFormError('')
    setShowForm(true)
  }

  async function handleSave() {
    setFormError('')
    if (!form.member_name.trim()) { setFormError(t('nameRequired')); return }
    if (!form.relationship.trim()) { setFormError(t('relationshipRequired')); return }
    if (!form.annual_payment_vnd || Number(form.annual_payment_vnd) <= 0) { setFormError(t('annualRequired')); return }

    setSaving(true)
    const url = editMember ? `/api/v1/insurance-members/${editMember.member_id}` : '/api/v1/insurance-members'
    const res = await fetch(url, {
      method: editMember ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        member_name: form.member_name,
        relationship: form.relationship,
        annual_payment_vnd: Number(form.annual_payment_vnd),
        payment_date: form.payment_date || null,
      }),
    })
    if (!res.ok) {
      const { error } = await res.json()
      setFormError(error ?? tCommon('error'))
    } else {
      setShowForm(false)
      await fetchMembers({ force: true })
    }
    setSaving(false)
  }

  async function handleDelete(member: InsuranceMember) {
    setDeletingId(member.member_id)
    const res = await fetch(`/api/v1/insurance-members/${member.member_id}`, { method: 'DELETE' })
    if (res.ok) {
      setConfirmMember(null)
      setSuccessMsg(t('deleted'))
      setTimeout(() => setSuccessMsg(''), 4000)
      await fetchMembers({ force: true })
    }
    setDeletingId(null)
  }

  const totalAnnual = members.reduce((s, m) => s + m.annual_payment_vnd, 0)
  const totalMonthly = members.reduce((s, m) => s + m.monthly_premium_vnd, 0)

  const RELATIONSHIP_COLORS: Record<string, string> = {
    'Self': 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
    'Husband': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    'Wife': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    'Child': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('title')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('total')}: {fmt(totalAnnual)} {t('perYear')} · {fmt(totalMonthly)} {t('perMonth')}
          </p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 h-9 px-4 bg-gray-950 hover:bg-gray-800 text-white text-sm font-bold rounded-md transition-colors">
          <Plus className="h-4 w-4" />
          {t('add')}
        </button>
      </div>

      {successMsg && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300 rounded-lg text-sm">{successMsg}</div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-black/10 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">{tCommon('loading')}</div>
        ) : members.length === 0 ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">{t('empty')}</div>
        ) : (
          <div className="overflow-x-auto p-6">
            <table className="w-full table-fixed">
              <thead>
                <tr className="border-b border-black/10 dark:border-gray-700 text-left">
                  <th className="px-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colName')}</th>
                  <th className="px-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colRelationship')}</th>
                  <th className="px-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase text-right">{t('colAnnual')}</th>
                  <th className="px-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase text-right">{t('colMonthly')}</th>
                  <th className="px-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colPaymentDate')}</th>
                  <th className="px-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase text-center">{tCommon('actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-gray-700">
                {members.map((member) => (
                  <tr key={member.member_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-600 text-white font-semibold shrink-0">
                          {member.member_name.charAt(0)}
                        </div>
                        <span className="font-medium text-gray-900 dark:text-gray-100">{member.member_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${RELATIONSHIP_COLORS[member.relationship] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
                        {member.relationship}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right font-medium text-gray-900 dark:text-gray-100">{fmt(member.annual_payment_vnd)}</td>
                    <td className="px-4 py-4 text-right font-semibold text-violet-600 dark:text-violet-400">{fmt(member.monthly_premium_vnd)}</td>
                    <td className="px-4 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {member.payment_date ? new Date(member.payment_date).toLocaleDateString('vi-VN') : '—'}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(member)} className="h-8 w-8 p-0 flex items-center justify-center border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                          <Edit className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        </button>
                        <button onClick={() => setConfirmMember(member)} className="h-8 w-8 p-0 flex items-center justify-center border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                          <Trash2 className="h-4 w-4 text-red-500 dark:text-red-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Info Card */}
      <div className="p-6 rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500 text-white shrink-0">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <h4 className="font-medium text-green-900 dark:text-green-200 mb-1">{t('infoTitle')}</h4>
            <p className="text-sm text-green-800 dark:text-green-300">{t('infoDesc')}</p>
          </div>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={(e) => { e.preventDefault(); handleSave() }} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{editMember ? t('editModal') : t('addModal')}</h3>
            {formError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('nameLabel')}</label>
                <input type="text" value={form.member_name} onChange={(e) => setForm({ ...form, member_name: e.target.value })}
                  placeholder={t('namePlaceholder')} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('relationshipLabel')}</label>
                <input type="text" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })}
                  placeholder={t('relationshipPlaceholder')} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('annualLabel')}</label>
                <input type="number" value={form.annual_payment_vnd} onChange={(e) => setForm({ ...form, annual_payment_vnd: e.target.value })}
                  placeholder={t('annualPlaceholder')} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                {form.annual_payment_vnd && Number(form.annual_payment_vnd) > 0 && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('monthly')}: {fmt(Math.round(Number(form.annual_payment_vnd) / 12))}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('paymentDateLabel')}</label>
                <input type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">{tCommon('cancel')}</button>
              <button type="submit" disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? tCommon('saving') : tCommon('save')}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmMember && (
        <ConfirmModal
          title={t('deleteModal')}
          message={t('deleteMessage')}
          detail={confirmMember.member_name}
          confirming={deletingId === confirmMember.member_id}
          onConfirm={() => handleDelete(confirmMember)}
          onCancel={() => setConfirmMember(null)}
        />
      )}
    </div>
  )
}
