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
