import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { usePathname } from 'next/navigation'
import MobileBottomTabs from '../MobileBottomTabs'
import { useMaturingDepositsCount } from '../useMaturingDepositsCount'

vi.mock('next/navigation', () => ({ usePathname: vi.fn() }))
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))
vi.mock('../useMaturingDepositsCount', () => ({ useMaturingDepositsCount: vi.fn() }))

const mockPathname = vi.mocked(usePathname)
const mockCount = vi.mocked(useMaturingDepositsCount)

function addButton() {
  return screen.queryByRole('button', { name: 'Add transaction' })
}

beforeEach(() => {
  mockPathname.mockReturnValue('/dashboard')
  mockCount.mockReturnValue(0)
})

describe('MobileBottomTabs — center add button (#FAB→tab-bar)', () => {
  // The add action moved off a floating FAB into a permanent center button in the
  // tab bar, so it can never cover the "Cần xử lý" card and is consistent everywhere.
  it.each(['/dashboard', '/planning', '/funds', '/settings', '/funds/abc-123'])(
    'renders the center add button on %s (present on every page)',
    (path) => {
      mockPathname.mockReturnValue(path)
      render(<MobileBottomTabs onAdd={() => {}} />)
      expect(addButton()).toBeInTheDocument()
    },
  )

  it('shows the add button even while term deposits need a maturity decision', () => {
    mockPathname.mockReturnValue('/dashboard')
    mockCount.mockReturnValue(3)
    render(<MobileBottomTabs onAdd={() => {}} />)
    expect(addButton()).toBeInTheDocument()
  })

  it('calls onAdd when the center button is tapped', () => {
    const onAdd = vi.fn()
    render(<MobileBottomTabs onAdd={onAdd} />)
    fireEvent.click(addButton()!)
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('still renders the four navigation tabs as links', () => {
    render(<MobileBottomTabs onAdd={() => {}} />)
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(4)
  })

  it('still shows the maturity badge on the Overview tab when deposits are due', () => {
    mockCount.mockReturnValue(2)
    render(<MobileBottomTabs onAdd={() => {}} />)
    expect(screen.getByTestId('nav-maturity-badge')).toHaveTextContent('2')
  })
})
