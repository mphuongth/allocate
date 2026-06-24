// Shared net-worth history model for the Overview net-worth cards. Previously
// NetWorthCard (mobile) and DesktopNetWorthPanel (desktop) each duplicated this
// range list + fetch and held their own timeRange — so switching breakpoints
// reset the selected range to 1Y (#363 review #5). The state now lives in
// DashboardClient and is fed to both cards; this module is the shared vocabulary.

export const TIME_RANGES = ['1M', '3M', '6M', '1Y', 'All'] as const
export type TimeRange = typeof TIME_RANGES[number]

export const RANGE_PARAM: Record<TimeRange, string> = {
  '1M': '1m', '3M': '3m', '6M': '6m', '1Y': '1y', 'All': 'all',
}

export interface ChartPoint { label: string; value: number }

/** Fetch the net-worth history series for a range. Resolves to [] on any failure. */
export async function fetchNetWorthHistory(
  range: TimeRange,
  fetchFn: typeof fetch = fetch,
): Promise<ChartPoint[]> {
  try {
    const res = await fetchFn(`/api/v1/dashboard/history?range=${RANGE_PARAM[range]}`, { cache: 'no-store' })
    if (!res.ok) return []
    return (await res.json()) as ChartPoint[]
  } catch {
    return []
  }
}
