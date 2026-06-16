import type { ThemePreference } from './domain'

export function resolveThemePreference(
  preference: ThemePreference,
  systemTheme: 'light' | 'dark',
): 'light' | 'dark' {
  return preference === 'system' ? systemTheme : preference
}

export function parseThemePreference(value: string | null | undefined): ThemePreference {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value
  }

  return 'system'
}
