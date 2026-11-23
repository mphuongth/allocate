/**
 * Per-request phase timings, reported as a `Server-Timing` response header.
 *
 * The header is what the browser's network panel and
 * `PerformanceResourceTiming.serverTiming` read, so a slow load can be broken
 * down from the response itself — without access to the host's logs.
 */
export interface ServerTiming {
  /** Run `work`, recording how long it took under `name` — also when it throws. */
  measure<T>(name: string, work: () => PromiseLike<T>): Promise<T>
  /**
   * The header value: each phase in the order it ran, then `total` — wall-clock
   * since the timer was created, so it includes the time between phases.
   */
  header(): string
}

export function createServerTiming(now: () => number = () => performance.now()): ServerTiming {
  const startedAt = now()
  const phases: { name: string; ms: number }[] = []
  const entry = (name: string, ms: number) => `${name};dur=${ms.toFixed(1)}`

  return {
    async measure(name, work) {
      const phaseStartedAt = now()
      try {
        return await work()
      } finally {
        phases.push({ name, ms: now() - phaseStartedAt })
      }
    },
    header() {
      return [...phases.map((p) => entry(p.name, p.ms)), entry('total', now() - startedAt)].join(', ')
    },
  }
}
