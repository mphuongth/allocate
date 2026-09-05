import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InflationRateCard from '../InflationRateCard'

// The one control for the app's only planning assumption. What matters here is
// that it never invents a position for the user: an empty field is "not chosen"
// and stays that way, a typed 0 is "assume no inflation" and is saved as 0, and
// the card says out loud that the number is an assumption rather than a
// published figure.

const { toastErrorMock } = vi.hoisted(() => ({ toastErrorMock: vi.fn() }))

vi.mock('next-intl', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const en = require('../../../../../messages/en.json')
  return {
    useTranslations: (ns?: string) => (key: string) =>
      (ns ? en[ns] : en)?.[key] ?? key,
  }
})

vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: vi.fn() } }))

const fetchMock = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ inflation_rate_pct: null }) })
})

const lastPut = () => JSON.parse(fetchMock.mock.calls.find(c => c[1]?.method === 'PUT')![1].body)
const save = async () => userEvent.click(screen.getByRole('button', { name: /save assumed rate/i }))

describe('InflationRateCard', () => {
  it('starts empty for a user who has never chosen a rate', async () => {
    render(<InflationRateCard />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: /assumed rate/i })).toHaveValue(''))
    // …and shows the default it will fall back to, so "empty" is not a mystery.
    expect(screen.getByRole('textbox', { name: /assumed rate/i })).toHaveAttribute('placeholder', '4')
  })

  it('loads the rate the user chose before', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ inflation_rate_pct: 4.5 }) })
    render(<InflationRateCard />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: /assumed rate/i })).toHaveValue('4.5'))
  })

  it('saves a typed rate', async () => {
    render(<InflationRateCard />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await userEvent.type(screen.getByRole('textbox', { name: /assumed rate/i }), '5')
    await save()
    await waitFor(() => expect(lastPut()).toEqual({ inflation_rate_pct: 5 }))
  })

  it('saves a typed zero as zero, not as "not chosen"', async () => {
    render(<InflationRateCard />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await userEvent.type(screen.getByRole('textbox', { name: /assumed rate/i }), '0')
    await save()
    await waitFor(() => expect(lastPut()).toEqual({ inflation_rate_pct: 0 }))
  })

  it('clears the assumption when the field is emptied', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ inflation_rate_pct: 4.5 }) })
    render(<InflationRateCard />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: /assumed rate/i })).toHaveValue('4.5'))
    await userEvent.clear(screen.getByRole('textbox', { name: /assumed rate/i }))
    await save()
    await waitFor(() => expect(lastPut()).toEqual({ inflation_rate_pct: null }))
  })

  it('refuses to send a rate the column would reject', async () => {
    render(<InflationRateCard />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await userEvent.type(screen.getByRole('textbox', { name: /assumed rate/i }), '150')
    expect(screen.getByRole('button', { name: /save assumed rate/i })).toBeDisabled()
    await save()
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'PUT')).toBe(false)
  })

  it('confirms a successful save', async () => {
    render(<InflationRateCard />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await userEvent.type(screen.getByRole('textbox', { name: /assumed rate/i }), '5')
    await save()
    expect(await screen.findByText(/saved/i)).toBeInTheDocument()
  })

  it('reports a failed save instead of pretending it stuck', async () => {
    render(<InflationRateCard />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'nope' }) })
    await userEvent.type(screen.getByRole('textbox', { name: /assumed rate/i }), '5')
    await save()
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled())
    expect(screen.queryByText(/^saved$/i)).toBeNull()
  })

  it('says the number is an assumption, and grounds it in the published record', async () => {
    render(<InflationRateCard />)
    const hint = await screen.findByTestId('inflation-rate-hint')
    // The user's own question was "how do I know what to put here" — the card
    // has to answer it without pretending the answer is a measurement.
    expect(hint.textContent).toMatch(/3%/)
    expect(hint.textContent).toMatch(/4\.5%/)
  })

  it('survives a settings read that fails, rather than blocking the page', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    render(<InflationRateCard />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: /assumed rate/i })).toHaveValue(''))
  })
})
