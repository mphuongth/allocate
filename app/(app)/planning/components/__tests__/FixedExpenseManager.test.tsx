import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FixedExpenseManager from '../FixedExpenseManager'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => 'en',
}))

vi.mock('@/lib/formatters', () => ({
  fmt: (n: number) => `₫ ${n}`,
  fmtCompact: (n: number) => `₫ ${n}`,
}))

const expenses = [
  { expense_id: 'fe1', expense_name: 'Rent', amount_vnd: 8_500_000, category: 'Housing', effective_from: null, effective_to: null },
  { expense_id: 'fe2', expense_name: 'Power Bill', amount_vnd: 1_200_000, category: 'Utilities', effective_from: '2026-01-01', effective_to: null },
]

let fetchMock: ReturnType<typeof vi.fn>

function mockFetch(handler?: (url: string, init?: RequestInit) => unknown) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (handler) {
      const custom = handler(url, init)
      if (custom !== undefined) return custom
    }
    if (url.includes('/api/v1/fixed-expenses') && method === 'GET') {
      return { ok: true, json: async () => ({ expenses }) }
    }
    // POST / PUT / DELETE default success
    return { ok: true, json: async () => ({ ...expenses[0], expense_id: 'new' }) }
  })
  // @ts-expect-error test stub
  global.fetch = fetchMock
}

beforeEach(() => mockFetch())
afterEach(() => vi.restoreAllMocks())

describe('FixedExpenseManager — list', () => {
  it('fetches and renders the fixed expense list', async () => {
    render(<FixedExpenseManager onChange={vi.fn()} />)
    expect(await screen.findByText('Rent')).toBeInTheDocument()
    expect(screen.getByText('Power Bill')).toBeInTheDocument()
  })

  it('shows an empty state when there are no expenses', async () => {
    mockFetch((url, init) => {
      if (url.includes('/api/v1/fixed-expenses') && (init?.method ?? 'GET') === 'GET') {
        return { ok: true, json: async () => ({ expenses: [] }) }
      }
      return undefined
    })
    render(<FixedExpenseManager onChange={vi.fn()} />)
    expect(await screen.findByText(/empty/i)).toBeInTheDocument()
  })

  it('exposes an Add button that opens the form', async () => {
    render(<FixedExpenseManager onChange={vi.fn()} />)
    await screen.findByText('Rent')
    await userEvent.click(screen.getByTestId('fe-add'))
    expect(screen.getByTestId('fe-name')).toBeInTheDocument()
    expect(screen.getByTestId('fe-category')).toBeInTheDocument()
    expect(screen.getByTestId('fe-amount')).toBeInTheDocument()
  })
})

describe('FixedExpenseManager — create', () => {
  it('POSTs a new expense and calls onChange', async () => {
    const onChange = vi.fn()
    render(<FixedExpenseManager onChange={onChange} />)
    await screen.findByText('Rent')

    await userEvent.click(screen.getByTestId('fe-add'))
    await userEvent.type(screen.getByTestId('fe-name'), 'Internet')
    await userEvent.selectOptions(screen.getByTestId('fe-category'), 'Utilities')
    await userEvent.type(screen.getByTestId('fe-amount'), '300000')
    await userEvent.click(screen.getByTestId('fe-save'))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/v1/fixed-expenses' && init?.method === 'POST'
      )
      expect(post).toBeTruthy()
      const body = JSON.parse((post![1] as RequestInit).body as string)
      expect(body.expense_name).toBe('Internet')
      expect(body.category).toBe('Utilities')
      expect(body.amount_vnd).toBe(300000)
    })
    expect(onChange).toHaveBeenCalled()
  })

  it('does not POST when required fields are missing', async () => {
    render(<FixedExpenseManager onChange={vi.fn()} />)
    await screen.findByText('Rent')
    await userEvent.click(screen.getByTestId('fe-add'))
    await userEvent.click(screen.getByTestId('fe-save'))

    const post = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/v1/fixed-expenses' && init?.method === 'POST'
    )
    expect(post).toBeFalsy()
  })
})

describe('FixedExpenseManager — edit', () => {
  it('pre-fills the form and PUTs to the expense id', async () => {
    const onChange = vi.fn()
    render(<FixedExpenseManager onChange={onChange} />)
    await screen.findByText('Rent')

    const row = screen.getByTestId('fe-row-fe1')
    await userEvent.click(within(row).getByTestId('fe-edit'))

    const name = screen.getByTestId('fe-name') as HTMLInputElement
    expect(name.value).toBe('Rent')
    await userEvent.clear(name)
    await userEvent.type(name, 'Rent Updated')
    await userEvent.click(screen.getByTestId('fe-save'))

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/v1/fixed-expenses/fe1' && init?.method === 'PUT'
      )
      expect(put).toBeTruthy()
      const body = JSON.parse((put![1] as RequestInit).body as string)
      expect(body.expense_name).toBe('Rent Updated')
    })
    expect(onChange).toHaveBeenCalled()
  })
})

describe('FixedExpenseManager — delete', () => {
  it('DELETEs after confirmation and calls onChange', async () => {
    const onChange = vi.fn()
    render(<FixedExpenseManager onChange={onChange} />)
    await screen.findByText('Rent')

    const row = screen.getByTestId('fe-row-fe1')
    await userEvent.click(within(row).getByTestId('fe-delete'))
    // confirmation appears
    await userEvent.click(screen.getByTestId('fe-delete-confirm'))

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/v1/fixed-expenses/fe1' && init?.method === 'DELETE'
      )
      expect(del).toBeTruthy()
    })
    expect(onChange).toHaveBeenCalled()
  })

  it('centers the delete confirmation in the default (modal) variant', async () => {
    render(<FixedExpenseManager onChange={vi.fn()} />)
    await screen.findByText('Rent')
    await userEvent.click(within(screen.getByTestId('fe-row-fe1')).getByTestId('fe-delete'))
    expect(screen.getByTestId('fe-delete-overlay')).toHaveStyle({ alignItems: 'center' })
  })

  it('anchors the delete confirmation to the bottom in the sheet (mobile) variant', async () => {
    render(<FixedExpenseManager onChange={vi.fn()} variant="sheet" />)
    await screen.findByText('Rent')
    await userEvent.click(within(screen.getByTestId('fe-row-fe1')).getByTestId('fe-delete'))
    expect(screen.getByTestId('fe-delete-overlay')).toHaveStyle({ alignItems: 'flex-end' })

    // Still confirms + deletes from the sheet-style confirmation
    await userEvent.click(screen.getByTestId('fe-delete-confirm'))
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.find(([url, init]) => url === '/api/v1/fixed-expenses/fe1' && init?.method === 'DELETE')
      ).toBeTruthy()
    })
  })
})
