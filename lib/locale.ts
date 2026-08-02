// Persist the chosen locale for a year; callers refresh the router afterward.
//
// Lives in lib/ rather than the settings module because the landing page's
// language toggle needs it too, and a landing component reaching into
// app/(app)/settings/ would be the wrong direction. It was duplicated there
// (#537) — inline in the component, where `document.cookie = …` trips
// react-hooks/immutability: the rule can't tell a render from an event handler,
// and a module-scope function is outside its remit either way.
export function setLocaleCookie(next: string): void {
  document.cookie = `locale=${next};path=/;max-age=31536000;SameSite=Lax`
}

/**
 * The two locales the app ships messages for. The default is Vietnamese —
 * an unrecognised value falls back to it rather than 404-ing a translation.
 */
export const APP_LOCALES = ['vi', 'en'] as const
export type AppLocale = (typeof APP_LOCALES)[number]
export const DEFAULT_LOCALE: AppLocale = 'vi'

/**
 * Allowlist check for a locale that arrived from outside — a cookie, a query
 * string, a request body. The PDF report route takes a locale from the client
 * and nothing else, so this is the whole of what it will accept (#594).
 */
export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (APP_LOCALES as readonly string[]).includes(value)
}
