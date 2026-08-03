// The settings page's option tables (#603).
//
// Desktop rendered the theme and language choices as inline chips, mobile as
// bottom-sheet pickers, and each declared its own copy of what the choices are
// — plus a third hand-written if/else on mobile to summarise the current one in
// the row. The price-source rows (fund NAV, gold) were duplicated outright. One
// table each, here, so adding or renaming a choice is a single edit.
//
// Deliberately NOT shared: the chips and the picker rows themselves. Desktop
// applies a choice on click; the mobile sheets are select-then-Apply, which is
// the right shape for a thumb and the wrong one for a settings pane.

import { Sun, Moon, Settings, Globe, TrendingUp, Coins, type LucideIcon } from 'lucide-react'
import type { ThemeChoice } from '@/components/layout/ThemeProvider'

/** next-intl's `t` for the 'settings' namespace, as the views already hold it. */
export type Translate = (key: string) => string

/** What both views need to render a user: passed down from the server page. */
export interface SettingsViewProps {
  email: string
  initials: string
  displayName: string
}

/** How long the "Saved" flash stays up before the profile editor closes. */
export const SAVE_FLASH_MS = 1400

export interface ChoiceOption<T> {
  value: T
  label: string
  /** The icon as a *component* — desktop renders it at 13px, mobile at 18px. */
  Icon: LucideIcon
}

export function themeOptions(t: Translate): ChoiceOption<ThemeChoice>[] {
  return [
    { value: 'light',  label: t('appearanceLight'),  Icon: Sun },
    { value: 'dark',   label: t('appearanceDark'),   Icon: Moon },
    { value: 'system', label: t('appearanceSystem'), Icon: Settings },
  ]
}

/** The current theme, as the mobile Appearance row summarises it. */
export function themeLabel(choice: ThemeChoice, t: Translate): string {
  return themeOptions(t).find(o => o.value === choice)?.label ?? t('appearanceSystem')
}

export function localeOptions(t: Translate): ChoiceOption<string>[] {
  return [
    { value: 'en', label: t('languageEnglish'),    Icon: Globe },
    { value: 'vi', label: t('languageVietnamese'), Icon: Globe },
  ]
}

/** The current language, as the mobile Language row summarises it. */
export function localeLabel(locale: string, t: Translate): string {
  return localeOptions(t).find(o => o.value === locale)?.label ?? t('languageEnglish')
}

export interface PriceSource {
  key: 'nav' | 'gold'
  label: string
  note: string
  color: string
  Icon: LucideIcon
}

/** What a price sync refreshes, as listed under the Sync now button. */
export function priceSources(t: Translate): PriceSource[] {
  return [
    { key: 'nav',  label: t('fundNav'),   note: t('fundNavNote'), color: '#2563eb',            Icon: TrendingUp },
    { key: 'gold', label: t('goldPrice'), note: t('goldNote'),    color: 'var(--c-fund-gold)', Icon: Coins },
  ]
}
