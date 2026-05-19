// Shared layout for auth pages (login / signup).
// Mobile: single column — brand mark at top, form below.
// Desktop (md+): two-column — navy brand panel left, form panel right.

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-col md:flex-row"
      style={{ minHeight: '100vh', background: 'var(--c-canvas)' }}
    >
      {/* Brand panel — desktop only */}
      <div
        data-testid="auth-brand-panel"
        className="hidden md:flex flex-col justify-between flex-shrink-0"
        style={{ width: 420, background: 'var(--c-navy)', padding: '48px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <svg
            data-testid="brand-mark"
            width="32"
            height="32"
            viewBox="0 0 28 28"
            fill="none"
            aria-label="Cairn"
          >
            <path d="M14 4l7 12H7z" fill="#fff" />
            <path d="M14 12l5 8H9z" fill="#fff" fillOpacity={0.6} />
            <path d="M14 18l3 5H11z" fill="#fff" fillOpacity={0.35} />
          </svg>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>
            Cairn
          </span>
        </div>

        <div>
          <p
            style={{
              margin: '0 0 14px',
              fontSize: 36,
              fontWeight: 600,
              color: '#fff',
              letterSpacing: '-0.025em',
              lineHeight: 1.15,
            }}
          >
            Track what matters.
          </p>
          <p style={{ margin: 0, fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.65 }}>
            Goals, monthly plan, and fund portfolio
            <br />
            all in one place.
          </p>
        </div>

        <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.28)' }}>
          © {new Date().getFullYear()} Cairn
        </p>
      </div>

      {/* Form panel */}
      <div
        data-testid="auth-form-panel"
        className="flex-1 flex flex-col md:items-center md:justify-center"
        style={{ padding: '40px 24px 24px', background: 'var(--c-canvas)' }}
      >
        {/* Mobile-only brand mark */}
        <div
          className="md:hidden"
          style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 36 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/cairn-icon.svg"
            alt="Cairn"
            width={36}
            height={36}
            style={{ borderRadius: 9, flexShrink: 0 }}
          />
          <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--c-ink)' }}>
            Cairn
          </span>
        </div>

        {/* Form content */}
        <div className="flex flex-col flex-1 w-full md:flex-none md:max-w-[400px]">
          {children}
        </div>
      </div>
    </div>
  )
}
