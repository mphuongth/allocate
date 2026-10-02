import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RenewThresholdCard from '../RenewThresholdCard'

// The deposit rate at or above which a maturing deposit is suggested for
// renewal, below which it is suggested for a move to its target fund. Same
// rules as the inflation card: an empty field is "not chosen" (the app default,
// 8%, applies), and saving this one must not send — and so must not clear — the
// inflation rate stored in the same row.

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
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ inflation_rate_pct: 4.5, renew_min_rate_pct: null }) })
})

const field = () => screen.getByRole('textbox', { name: /renew at or above/i })
const lastPut = () => JSON.parse(fetchMock.mock.calls.find(c => c[1]?.method === 'PUT')![1].body)
const save = async () => userEvent.click(screen.getByRole('button', { name: /save renewal threshold/i }))

describe('RenewThresholdCard', () => {
  it('starts empty and shows the 8% default it falls back to', async () => {
    render(<RenewThresholdCard />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(field()).toHaveValue('')
    expect(field()).toHaveAttribute('placeholder', '8')
  })

  it('loads the threshold the user chose, not the inflation rate beside it', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ inflation_rate_pct: 4.5, renew_min_rate_pct: 8.5 }) })
    render(<RenewThresholdCard />)
    await waitFor(() => expect(field()).toHaveValue('8.5'))
  })

  it('saves only the threshold, so the inflation rate is left alone', async () => {
    render(<RenewThresholdCard />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await userEvent.type(field(), '7,5')
    await save()
    await waitFor(() => expect(lastPut()).toEqual({ renew_min_rate_pct: 7.5 }))
  })

  it('clears back to the default when emptied', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ inflation_rate_pct: null, renew_min_rate_pct: 9 }) })
    render(<RenewThresholdCard />)
    await waitFor(() => expect(field()).toHaveValue('9'))
    await userEvent.clear(field())
    await save()
    await waitFor(() => expect(lastPut()).toEqual({ renew_min_rate_pct: null }))
  })

  it('refuses a rate the column would reject', async () => {
    render(<RenewThresholdCard />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await userEvent.type(field(), '120')
    expect(screen.getByRole('button', { name: /save renewal threshold/i })).toBeDisabled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('says what the threshold decides', async () => {
    render(<RenewThresholdCard />)
    expect(screen.getByTestId('renew-threshold-hint')).toHaveTextContent(/renew principal and interest/i)
    expect(screen.getByTestId('renew-threshold-hint')).toHaveTextContent(/target fund/i)
  })

  it('tells the user when the save failed', async () => {
    render(<RenewThresholdCard />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    await userEvent.type(field(), '8')
    await save()
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("Couldn't save the renewal threshold"))
  })
})
