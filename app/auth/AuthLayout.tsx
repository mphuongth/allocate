// Shared layout for auth pages (login / signup).
// Mobile (issue #243): full-bleed screen — brand pinned top-left, large hero
// heading, form flush to the top. Desktop: centered single-column card with the
// Cairn logo above. The responsive switch lives in the scoped <style> below so
// the page components can stay styling-light.

const authStyles = `
.cn-auth-root {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--c-canvas);
  padding: 74px 24px 24px;
}
.cn-auth-col {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 28px;
}
.cn-auth-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.cn-auth-wordmark {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--c-navy);
}
.cn-auth-card {
  width: 100%;
}
.cn-auth-title {
  margin: 0 0 8px;
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.025em;
  line-height: 1.15;
  color: var(--c-ink);
}
.cn-auth-sub {
  margin: 0 0 28px;
  font-size: 14px;
  color: var(--c-muted);
}
.cn-auth-alt {
  margin: 0;
  font-size: 13px;
  color: var(--c-muted);
  text-align: center;
}

@media (min-width: 640px) {
  .cn-auth-root {
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .cn-auth-col {
    max-width: 380px;
    gap: 20px;
    align-items: center;
  }
  .cn-auth-brand {
    margin-bottom: 8px;
  }
  .cn-auth-wordmark {
    font-size: 22px;
    letter-spacing: -0.03em;
  }
  .cn-auth-card {
    background: var(--c-card);
    border: 1px solid var(--c-line);
    border-radius: var(--r-card);
    box-shadow: var(--shadow-card);
    padding: 28px 24px;
  }
  .cn-auth-title {
    margin-bottom: 4px;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .cn-auth-sub {
    margin-bottom: 22px;
    font-size: 13px;
  }
}
`

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
    <div className="cn-auth-root">
      <style dangerouslySetInnerHTML={{ __html: authStyles }} />
      <div className="cn-auth-col">
        {/* Cairn logo */}
        <div className="cn-auth-brand">
          <CairnMark size={32} testId="brand-mark" />
          <span className="cn-auth-wordmark">Cairn</span>
        </div>

        {children}
      </div>
    </div>
  )
}
