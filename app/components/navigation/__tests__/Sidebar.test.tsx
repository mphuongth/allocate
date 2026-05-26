import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Sidebar from '../Sidebar'
import { NavigationProvider, useNavigation } from '../NavigationContext'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}))

function renderSidebar(props: { email: string; initials: string; userName: string }) {
  return render(
    <NavigationProvider userName={props.userName}>
      <Sidebar email={props.email} initials={props.initials} />
    </NavigationProvider>
  )
}

describe('Sidebar — avatar', () => {
  it('derives initials from the display name, not the email', () => {
    // Email-derived initials would be "MT" (from "minhtran061192").
    // Display-name-derived initials should be "MP" (from "Minh Phuong").
    // The component must prefer the display name.
    renderSidebar({
      email: 'minhtran061192@gmail.com',
      initials: 'MT',
      userName: 'Minh Phuong',
    })
    expect(screen.getByText('MP')).toBeInTheDocument()
    expect(screen.queryByText('MT')).not.toBeInTheDocument()
  })

  it('uses up to two initials from a multi-word display name', () => {
    renderSidebar({
      email: 'a@b.com',
      initials: 'A',
      userName: 'Alice Bob Carol',
    })
    expect(screen.getByText('AB')).toBeInTheDocument()
  })

  it('falls back to the initials prop when display name is empty', () => {
    renderSidebar({
      email: 'a@b.com',
      initials: 'AB',
      userName: '',
    })
    expect(screen.getByText('AB')).toBeInTheDocument()
  })

  it('renders avatar with --c-btn-primary background so it stays navy in dark mode', () => {
    // In dark mode --c-navy resolves to white, so an avatar using --c-navy
    // becomes white-on-white. --c-btn-primary stays navy in both themes.
    renderSidebar({
      email: 'a@b.com',
      initials: 'AB',
      userName: 'Alice Bob',
    })
    const avatar = screen.getByText('AB')
    expect(avatar.style.background).toContain('--c-btn-primary')
    expect(avatar.style.background).not.toContain('--c-navy')
  })
})

describe('Sidebar — nav item hover', () => {
  it('changes background and color on hover of an inactive nav item', () => {
    renderSidebar({
      email: 'a@b.com',
      initials: 'AB',
      userName: 'Alice Bob',
    })
    // 'dashboard' is the active route (mocked); pick an inactive one.
    const inactiveLink = screen.getByRole('link', { name: 'planning' }) as HTMLAnchorElement

    const initialBg = inactiveLink.style.background
    fireEvent.mouseEnter(inactiveLink)
    expect(inactiveLink.style.background).not.toBe(initialBg)
    expect(inactiveLink.style.background).toContain('--c-card-2')

    fireEvent.mouseLeave(inactiveLink)
    expect(inactiveLink.style.background).toBe(initialBg)
  })

  it('does not change background on hover of the active nav item', () => {
    renderSidebar({
      email: 'a@b.com',
      initials: 'AB',
      userName: 'Alice Bob',
    })
    const activeLink = screen.getByRole('link', { name: 'dashboard' }) as HTMLAnchorElement
    const initialBg = activeLink.style.background
    fireEvent.mouseEnter(activeLink)
    expect(activeLink.style.background).toBe(initialBg)
  })
})

describe('Sidebar — reacts to NavigationContext userName changes', () => {
  function NameUpdater({ to }: { to: string }) {
    const { setUserName } = useNavigation()
    return (
      <button type="button" data-testid="update-name" onClick={() => setUserName(to)}>
        update
      </button>
    )
  }

  it('updates avatar initials when setUserName is called (no refresh required)', () => {
    render(
      <NavigationProvider userName="Alice Bob">
        <Sidebar email="a@b.com" initials="AB" />
        <NameUpdater to="Minh Phuong" />
      </NavigationProvider>
    )

    expect(screen.getByText('AB')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('update-name'))
    expect(screen.getByText('MP')).toBeInTheDocument()
    expect(screen.queryByText('AB')).not.toBeInTheDocument()
  })

  it('updates the full-name label when setUserName is called', () => {
    render(
      <NavigationProvider userName="Alice Bob">
        <Sidebar email="a@b.com" initials="AB" />
        <NameUpdater to="Minh Phuong" />
      </NavigationProvider>
    )

    expect(screen.getByText('Alice Bob')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('update-name'))
    expect(screen.getByText('Minh Phuong')).toBeInTheDocument()
  })
})
