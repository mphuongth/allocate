import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import { LandingProductTour } from '../LandingProductTour'
import viMessages from '../../../messages/vi.json'
import enMessages from '../../../messages/en.json'

// The landing page used to show exactly two hand-drawn CSS mockups and six text-only
// feature cards — so the one question a visitor has before handing over an email ("what
// does this thing actually look like?") went unanswered for four of the app's screens.
// The tour answers it with real screenshots of the real app, one per screen, captured by
// scripts/generate-tour-screenshots.mjs.
//
// The screenshots are baked per locale (public/tour/{screen}-{locale}.png) because the app
// UI inside them is localized: serving the Vietnamese shots to an English visitor would
// show them an interface they cannot read. These tests pin that pairing, since it is the
// kind of thing that silently rots the next time a screen is added.

function renderIn(locale: 'vi' | 'en') {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'vi' ? viMessages : enMessages}
      timeZone="Asia/Ho_Chi_Minh"
    >
      <LandingProductTour />
    </NextIntlClientProvider>,
  )
}

describe('LandingProductTour — tabs', () => {
  it('renders one tab per app screen, labelled with the app’s own nav copy', () => {
    renderIn('vi')
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(4)
    // Reuses nav.* — the same keys the real Sidebar renders — so the tour cannot advertise
    // a screen name the app does not use.
    expect(tabs.map(t => t.textContent)).toEqual(['Tổng quan', 'Kế hoạch', 'Quỹ', 'Cài đặt'])
  })

  it('selects the first tab by default and exposes it to assistive tech', () => {
    renderIn('vi')
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
  })

  it('switches the visible screenshot when another tab is clicked', async () => {
    const user = userEvent.setup()
    renderIn('vi')
    expect(screen.getByRole('img')).toHaveAttribute('src', expect.stringContaining('dashboard-vi'))

    await user.click(screen.getByRole('tab', { name: 'Quỹ' }))

    expect(screen.getByRole('tab', { name: 'Quỹ' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('img')).toHaveAttribute('src', expect.stringContaining('funds-vi'))
  })

  it('shows the caption belonging to the selected screen, not a stale one', async () => {
    const user = userEvent.setup()
    renderIn('vi')
    expect(screen.getByText(viMessages.landing.tourDashboardBody)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Kế hoạch' }))

    expect(screen.getByText(viMessages.landing.tourPlanningBody)).toBeInTheDocument()
    expect(screen.queryByText(viMessages.landing.tourDashboardBody)).not.toBeInTheDocument()
  })
})

describe('LandingProductTour — locale pairing', () => {
  it('serves the Vietnamese screenshots on the Vietnamese page', () => {
    renderIn('vi')
    expect(screen.getByRole('img')).toHaveAttribute('src', expect.stringContaining('-vi.png'))
  })

  it('serves the English screenshots on the English page', () => {
    renderIn('en')
    expect(screen.getByRole('img')).toHaveAttribute('src', expect.stringContaining('-en.png'))
    expect(screen.getByRole('img')).not.toHaveAttribute('src', expect.stringContaining('-vi.png'))
  })

  it('keeps the locale when switching screens', async () => {
    const user = userEvent.setup()
    renderIn('en')
    await user.click(screen.getByRole('tab', { name: 'Settings' }))
    expect(screen.getByRole('img')).toHaveAttribute('src', expect.stringContaining('settings-en.png'))
  })
})

describe('LandingProductTour — art direction', () => {
  // A 1440px-wide desktop capture scaled into a ~350px phone column is unreadable — which
  // defeats the whole point of the section. The app has genuinely separate mobile views, so
  // small screens get the mobile captures instead, via <picture> (which fetches only the
  // one that matches, unlike a display:none pair).
  function sources() {
    return Array.from(document.querySelectorAll('picture source'))
  }

  it('offers the mobile capture to small screens', () => {
    renderIn('vi')
    const mobile = sources().find(s => s.getAttribute('media')?.includes('max-width'))
    expect(mobile).toBeDefined()
    expect(mobile!.getAttribute('srcset')).toContain('dashboard-vi-mobile.png')
  })

  it('falls back to the desktop capture everywhere else', () => {
    renderIn('vi')
    expect(screen.getByRole('img')).toHaveAttribute('src', expect.stringContaining('dashboard-vi.png'))
    expect(screen.getByRole('img')).not.toHaveAttribute('src', expect.stringContaining('-mobile'))
  })

  it('keeps both variants in step when the screen and locale change', async () => {
    const user = userEvent.setup()
    renderIn('en')
    await user.click(screen.getByRole('tab', { name: 'Plan' }))

    expect(screen.getByRole('img')).toHaveAttribute('src', expect.stringContaining('planning-en.png'))
    const mobile = sources().find(s => s.getAttribute('media')?.includes('max-width'))
    expect(mobile!.getAttribute('srcset')).toContain('planning-en-mobile.png')
  })
})

describe('LandingProductTour — accessibility', () => {
  it('gives every screenshot a localized alt naming the screen', async () => {
    const user = userEvent.setup()
    renderIn('vi')
    // Not "screenshot" / "image" — a screen reader user should learn which screen this is.
    expect(screen.getByRole('img')).toHaveAccessibleName(/Tổng quan/)

    await user.click(screen.getByRole('tab', { name: 'Quỹ' }))
    expect(screen.getByRole('img')).toHaveAccessibleName(/Quỹ/)
  })

  it('wires the tabs to the panel with the tablist pattern', () => {
    renderIn('vi')
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    const panel = screen.getByRole('tabpanel')
    const selected = screen.getAllByRole('tab').find(t => t.getAttribute('aria-selected') === 'true')!
    expect(panel).toHaveAttribute('aria-labelledby', selected.id)
    expect(selected).toHaveAttribute('aria-controls', panel.id)
  })

  it('moves between tabs with the arrow keys, wrapping at the ends', async () => {
    const user = userEvent.setup()
    renderIn('vi')
    const tabs = screen.getAllByRole('tab')

    // Roving tabindex: only the selected tab is in the tab order.
    expect(tabs[0]).toHaveAttribute('tabindex', '0')
    expect(tabs[1]).toHaveAttribute('tabindex', '-1')

    await user.tab()
    await user.keyboard('{ArrowRight}')
    expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(screen.getAllByRole('tab')[3]).toHaveAttribute('aria-selected', 'true')
  })
})
