import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// The OAuth error page must give the user a usable, no-JavaScript way forward
// under production CSP: a plain link back to login (#516).
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))

import AuthCodeErrorPage from '../page'

describe('AuthCodeErrorPage (#516)', () => {
  it('renders a plain link back to /auth/login as the recovery path', async () => {
    render(await AuthCodeErrorPage())
    const link = screen.getByRole('link', { name: 'goToLogin' })
    expect(link).toHaveAttribute('href', '/auth/login')
  })

  it('shows the failure title and message', async () => {
    render(await AuthCodeErrorPage())
    expect(screen.getByText('oauthErrorTitle')).toBeInTheDocument()
    expect(screen.getByText('oauthErrorMessage')).toBeInTheDocument()
  })
})
