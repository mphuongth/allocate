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
          <svg
            data-testid="brand-mark"
            width="36"
            height="36"
            viewBox="0 0 28 28"
            fill="none"
            aria-hidden="true"
          >
            <path d="M14 4l7 12H7z" fill="var(--c-navy)" />
            <path d="M14 12l5 8H9z" fill="var(--c-navy)" fillOpacity={0.5} />
            <path d="M14 18l3 5H11z" fill="var(--c-navy)" fillOpacity={0.25} />
          </svg>
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
