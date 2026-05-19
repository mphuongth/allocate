// Shared layout for auth pages (login / signup).
// Centered single-column: Cairn logo above the form card.

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--c-canvas)',
        padding: '24px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 380,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          alignItems: 'center',
        }}
      >
        {/* Cairn logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            data-testid="brand-mark"
            src="/cairn-icon.svg"
            alt="Cairn"
            width={36}
            height={36}
            style={{ borderRadius: 9, flexShrink: 0 }}
          />
          <span
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: '-0.03em',
              color: 'var(--c-navy)',
            }}
          >
            Cairn
          </span>
        </div>

        {children}
      </div>
    </div>
  )
}
