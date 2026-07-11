// Builds the production Content-Security-Policy.
//
// `script-src` uses a per-request nonce + 'strict-dynamic' instead of
// 'unsafe-inline'/'unsafe-eval': an injected inline <script> (or eval'd string)
// won't execute because it lacks the nonce, and 'strict-dynamic' lets the
// nonce'd first-party scripts load the rest of the bundle. `'self'` is kept only
// as a CSP2 fallback (CSP3 browsers that honour 'strict-dynamic' ignore it).
//
// `style-src` intentionally keeps 'unsafe-inline' — inline styles can't run
// JavaScript, and nonce-ing every style block (incl. framework/font styles) is
// impractical. The primary XSS lever is script execution, which this closes.
export function buildContentSecurityPolicy(
  nonce: string,
  opts: { connectExtra?: string } = {},
): string {
  const connectExtra = opts.connectExtra ?? ''
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co${connectExtra}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
}

// Extra connect-src origins for a local Supabase stack (E2E against
// `supabase start`). Only emitted for http://localhost|127.0.0.1 URLs, so the
// production policy (https://*.supabase.co only) is unaffected.
export function localSupabaseConnectExtra(supabaseUrl: string | undefined): string {
  const url = supabaseUrl ?? ''
  return /^http:\/\/(127\.0\.0\.1|localhost)/.test(url)
    ? ` ${url} ${url.replace(/^http/, 'ws')}`
    : ''
}
