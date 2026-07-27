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

// A counting semaphore that bounds how many wrapped operations run at once.
// Used to cap the TOTAL number of concurrent outbound HTTP requests across the
// whole NAV scrape — bounding scrapes per URL isn't enough, because a single
// scrape (Dragon Capital) fans out ~15 provider requests of its own (#515).
export class Semaphore {
  private available: number
  private readonly waiters: Array<() => void> = []

  constructor(permits: number) {
    this.available = Math.max(1, Math.floor(permits) || 1)
  }

  // Waiting for a permit is part of an operation's elapsed time, so a caller
  // with a deadline has to be able to give up while queued. Without this, an
  // "absolute" timeout created by the caller only starts once it reaches the
  // front of the queue, and the real bound becomes queue time + timeout (#530).
  private async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason
    if (this.available > 0) {
      this.available--
      return
    }
    await new Promise<void>((resolve, reject) => {
      const waiter = () => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }
      const onAbort = () => {
        // Drop out of the queue so release() never hands a permit to a waiter
        // that has already given up — that permit would be lost.
        const i = this.waiters.indexOf(waiter)
        if (i !== -1) this.waiters.splice(i, 1)
        reject(signal!.reason)
      }
      this.waiters.push(waiter)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  private release(): void {
    const next = this.waiters.shift()
    if (next) next()
    else this.available++
  }

  // Run `fn` once a permit is free, always releasing it (even on throw). Pass a
  // signal to abandon the wait — `fn` then never runs and no permit is consumed.
  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal)
    try {
      return await fn()
    } finally {
      this.release()
    }
  }
}
