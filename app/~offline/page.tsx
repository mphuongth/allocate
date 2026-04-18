export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/cairn-icon.svg"
          alt="Cairn logo"
          width={64}
          height={64}
          className="mx-auto mb-6 h-16 w-16 rounded-2xl"
        />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          You&apos;re offline
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mb-8">
          This page isn&apos;t available offline. Pages you&apos;ve already visited can still be
          viewed — go back or wait until you&apos;re connected.
        </p>
        <a
          href="/dashboard"
          className="inline-flex items-center px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Go back
        </a>
      </div>
    </div>
  )
}
