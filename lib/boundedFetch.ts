import { Semaphore } from './concurrency'

// Every outbound scrape is bounded so a slow, oversized or broken upstream can't
// hang a serverless function, exhaust its memory, or feed an error page to a
// price parser (#515, #530).
export const SCRAPE_TIMEOUT_MS = 10_000
export const SCRAPE_MAX_BYTES = 2 * 1024 * 1024 // 2 MB — the pages we scrape are tens of KB

// Process-wide cap on concurrent outbound provider requests. This bounds the
// TRUE fan-out regardless of how it nests, so no route can open an unbounded
// number of sockets by looping. Every fetch below goes through this gate.
//
// The per-fund fan-out it was written against is gone — NAVs now come from one
// Fmarket request rather than a scrape per provider page — but the gate stays as
// the backstop for whatever calls this next.
const MAX_CONCURRENT_HTTP = 6
export const httpSemaphore = new Semaphore(MAX_CONCURRENT_HTTP)

// fetch(url).text() with an absolute timeout, a status check, and a hard byte
// cap on the streamed body.
//
// Lives here rather than inside one scraper because both the NAV and the gold
// scraper need it: gold was fetching completely unguarded, and copying the logic
// would have left two implementations to keep correct.
//
// The status check is the part the original NAV version lacked. Without it a
// 404 or 500 error page is handed to the price parser, which reports something
// like "price row not found" — indistinguishable from a layout change, and
// pointing the reader at the wrong problem.
//
// The cap is enforced while streaming, not after: reading a huge body into
// memory first and measuring it afterwards would be the very failure being
// guarded against, so the reader is cancelled the moment the limit is passed.
export async function boundedFetchText(
  url: string,
  init: RequestInit & { timeoutMs?: number; maxBytes?: number } = {},
): Promise<string> {
  const { timeoutMs = SCRAPE_TIMEOUT_MS, maxBytes = SCRAPE_MAX_BYTES, ...rest } = init

  // The clock starts HERE, before queuing for a permit — not inside the
  // callback. Waiting is part of the elapsed time: one Dragon Capital scrape
  // queues ~15 requests behind a cap of 6, so a deadline that only started on
  // acquisition made the real bound "queue time + timeoutMs" rather than the
  // absolute one it advertises. The same signal aborts the wait, the request and
  // the body read, so it bounds the whole operation.
  const signal = AbortSignal.timeout(timeoutMs)

  return httpSemaphore.run(async () => {
    const res = await fetch(url, { ...rest, signal })
    if (!res.ok) {
      // Cancel before throwing. The semaphore permit is released as soon as this
      // callback returns, so an un-cancelled error body would keep its transfer
      // open past the permit — and a run of error responses could then hold more
      // than MAX_CONCURRENT_HTTP sockets, defeating the very cap this helper
      // exists to enforce. Swallow a cancel failure: it isn't actionable and
      // must not mask the status, which is the real problem.
      await res.body?.cancel().catch(() => {})
      throw new Error(`Upstream responded ${res.status} for ${new URL(url).host}`)
    }

    const reader = res.body?.getReader()
    if (!reader) return res.text()

    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error(`Response exceeded ${maxBytes} bytes`)
      }
      chunks.push(value)
    }

    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder().decode(merged)
  }, signal)
}
