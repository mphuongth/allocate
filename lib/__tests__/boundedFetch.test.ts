import { describe, it, expect, vi, afterEach } from 'vitest'
import { boundedFetchText } from '../boundedFetch'

// Every outbound scrape must be bounded: an absolute timeout, a hard byte cap on
// the streamed body, and a status check before anything is parsed (#530).
//
// This logic already existed inside lib/scrape-fund-nav.ts but was module-
// private, so lib/scrape-gold.ts fetched completely unguarded. Extracting it
// gives both scrapers one implementation to be correct in — and adds the status
// check the NAV version was missing.

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
}

const enc = new TextEncoder()

afterEach(() => {
  vi.restoreAllMocks()
})

describe('boundedFetchText', () => {
  it('returns the body for a normal response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(streamOf([enc.encode('<html>ok</html>')]), { status: 200 }),
    )
    await expect(boundedFetchText('https://example.test')).resolves.toBe('<html>ok</html>')
  })

  it('reassembles a body split across chunks', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(streamOf([enc.encode('abc'), enc.encode('def'), enc.encode('ghi')]), { status: 200 }),
    )
    await expect(boundedFetchText('https://example.test')).resolves.toBe('abcdefghi')
  })

  // Without this, a 404/500 error page is handed to the price parser, which then
  // reports a confusing "price row not found" instead of "the site is down".
  it('rejects a non-2xx response with the status, not a parse error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(streamOf([enc.encode('<html>Not Found</html>')]), { status: 404 }),
    )
    // The error names the status, so the caller can tell an outage from a layout
    // change — the error page is never handed to a price parser.
    await expect(boundedFetchText('https://example.test')).rejects.toThrow(/404/)
  })

  // Throwing without cancelling leaves the transfer open while the semaphore
  // permit is already released, so a run of error responses can hold more than
  // the cap's worth of sockets — quietly defeating the process-wide limit this
  // helper exists to enforce.
  it('cancels the error response body instead of leaving the transfer open', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(enc.encode('x')) }, // never ends on its own
      cancel() { cancelled = true },
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 500 }))
    await expect(boundedFetchText('https://example.test')).rejects.toThrow(/500/)
    expect(cancelled).toBe(true)
  })

  it('still reports the status when cancelling the body itself fails', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(enc.encode('x')) },
      cancel() { throw new Error('socket already gone') },
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 502 }))
    // The cancel failure must not mask the actual problem.
    await expect(boundedFetchText('https://example.test')).rejects.toThrow(/502/)
  })

  it('rejects a 500 as well as a 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(streamOf([enc.encode('boom')]), { status: 500 }),
    )
    await expect(boundedFetchText('https://example.test')).rejects.toThrow(/500/)
  })

  it('rejects a body that exceeds the byte cap', async () => {
    const big = new Uint8Array(1024)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(streamOf([big, big, big]), { status: 200 }),
    )
    await expect(boundedFetchText('https://example.test', { maxBytes: 2048 })).rejects.toThrow(/exceeded/i)
  })

  it('accepts a body exactly at the cap', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(streamOf([new Uint8Array(2048)]), { status: 200 }),
    )
    await expect(boundedFetchText('https://example.test', { maxBytes: 2048 })).resolves.toHaveLength(2048)
  })

  it('stops reading as soon as the cap is passed rather than draining the body', async () => {
    let chunksPulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksPulled++
        if (chunksPulled > 50) return controller.close()
        controller.enqueue(new Uint8Array(1024))
      },
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }))
    await expect(boundedFetchText('https://example.test', { maxBytes: 2048 })).rejects.toThrow(/exceeded/i)
    // 3 pulls take it past 2048; anything close to 50 means the cap didn't stop it.
    expect(chunksPulled).toBeLessThan(10)
  })

  it('passes an abort signal so a hung upstream cannot hold the request open', async () => {
    let signal: AbortSignal | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      signal = (init as RequestInit | undefined)?.signal as AbortSignal | undefined
      return new Response(streamOf([enc.encode('ok')]), { status: 200 })
    })
    await boundedFetchText('https://example.test', { timeoutMs: 5_000 })
    expect(signal).toBeInstanceOf(AbortSignal)
  })

  it('surfaces the abort when the upstream exceeds the timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const s = (init as RequestInit | undefined)?.signal as AbortSignal | undefined
      return new Promise((_resolve, reject) => {
        s?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'TimeoutError')))
      })
    })
    await expect(boundedFetchText('https://example.test', { timeoutMs: 20 })).rejects.toThrow()
  })

  // The deadline must cover the wait for a permit, not just the request. One
  // Dragon Capital scrape queues ~15 requests behind a cap of 6, so a gold
  // refresh can sit in that queue — and a timeout that only starts on
  // acquisition makes the real bound "queue time + 10s", not 10s.
  it('applies the deadline to the wait for a permit, not just the fetch', async () => {
    const { httpSemaphore } = await import('../boundedFetch')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(streamOf([enc.encode('ok')]), { status: 200 }),
    )

    // Occupy every permit so the call below can only queue.
    let releaseAll: () => void = () => {}
    const blockers = Array.from({ length: 6 }, () =>
      httpSemaphore.run(() => new Promise<void>((r) => {
        const prev = releaseAll
        releaseAll = () => { prev(); r() }
      })),
    )

    await expect(
      boundedFetchText('https://example.test', { timeoutMs: 20 }),
    ).rejects.toThrow()
    // Never even reached the request: it gave up while queued.
    expect(fetchSpy).not.toHaveBeenCalled()

    releaseAll()
    await Promise.all(blockers)
  })

  it('forwards caller headers to the upstream request', async () => {
    let init: RequestInit | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, i) => {
      init = i as RequestInit
      return new Response(streamOf([enc.encode('ok')]), { status: 200 })
    })
    await boundedFetchText('https://example.test', { headers: { 'User-Agent': 'test-agent' } })
    expect((init?.headers as Record<string, string>)['User-Agent']).toBe('test-agent')
  })
})
