// Run an async mapper over `items` with at most `limit` in flight at once.
// Results are returned in input order. Unlike an unbounded `Promise.all`, this
// caps how many outbound operations (e.g. NAV scrapes) run concurrently (#515).
//
// A rejecting mapper rejects the whole call (same as Promise.all); callers that
// want per-item errors should have the mapper resolve to a result object.
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workerCount = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))

  async function worker() {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
