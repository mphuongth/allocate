// Shared layout for auth pages (login / signup).
// Centered single-column: Cairn logo above the form card.

function CairnMark({ size = 32, testId }: { size?: number; testId?: string }) {
  const h = Math.round(size * 0.85)
  return (
    <svg width={size} height={h} viewBox="110 180 283 240" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }} data-testid={testId}>
      <rect x="111.872" y="359.936" width="280.064" height="57.856" rx="24.3" fill="#3B5A82"/>
      <rect x="152.064" y="293.888" width="220.16" height="50.176" rx="21.07" fill="#163A61"/>
      <rect x="163.84" y="233.984" width="167.936" height="44.032" rx="18.49" fill="#10B981"/>
      <rect x="208.128" y="181.76" width="103.936" height="35.84" rx="15.05" fill="#0F2A4A"/>
    </svg>
  )
}

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
          <CairnMark size={32} testId="brand-mark" />
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
