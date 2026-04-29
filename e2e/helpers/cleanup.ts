type CleanupFn = () => Promise<void>

export function makeCleanupStack() {
  const stack: CleanupFn[] = []
  return {
    add(fn: CleanupFn) { stack.push(fn) },
    async run() {
      for (const fn of stack.reverse()) {
        await fn().catch((err) => console.error('Cleanup error:', err))
      }
      stack.length = 0
    },
  }
}
