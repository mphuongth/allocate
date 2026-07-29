'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { clearAppCaches } from '@/lib/clientCache'
import { AuthLayout } from '../AuthLayout'

/**
 * Ownership handoff between the email-confirmation callback and the app (#565).
 *
 * `app/auth/callback/route.ts` is a *server* redirect, so no client code has run
 * to tell the service worker that the account changed. Landing on `/dashboard`
 * directly means the very first authenticated navigation is made while a
 * previous account may still own the caches — and if that request fails, the
 * worker answers it from their cached HTML, which carries their own ownership
 * claim and re-asserts it before anything can correct the record.
 *
 * So the callback lands here first. This route has no cached entry of its own to
 * be served from: offline, it resolves to the offline fallback, which is safe.
 * Clearing rather than announcing keeps it simple and fails closed — the new
 * account starts with a cold cache, which is what a new account on this device
 * should have.
 */
export default function CompletePage() {
  const t = useTranslations('auth')

  useEffect(() => {
    // Never strand the user here: entering the app matters more than the purge,
    // and a browser without Cache Storage has nothing to purge anyway.
    clearAppCaches()
      .catch(() => {})
      .then(() => window.location.replace('/dashboard'))
  }, [])

  return (
    <AuthLayout>
      <div data-testid="auth-card" className="cn-auth-card">
        <p className="cn-auth-sub" style={{ margin: 0 }}>{t('completingSignIn')}</p>
      </div>
    </AuthLayout>
  )
}
