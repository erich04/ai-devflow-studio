'use client'

import { useEffect, useState } from 'react'
import { parseThemePreference, themeStorageKey, type ThemePreference } from './theme-preference'

export function ThemePreferenceControl() {
  const [preference, setPreference] = useState<ThemePreference>('system')

  useEffect(() => {
    setPreference(parseThemePreference(document.documentElement.dataset.theme))
    function onStorage(event: StorageEvent) {
      if (event.key !== themeStorageKey && event.key !== null) return
      const next = parseThemePreference(event.newValue)
      document.documentElement.dataset.theme = next
      setPreference(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function changeTheme(value: string) {
    const next = parseThemePreference(value)
    document.documentElement.dataset.theme = next
    setPreference(next)
    try {
      localStorage.setItem(themeStorageKey, next)
    } catch {
      // The current page remains usable when browser storage is unavailable.
    }
  }

  return (
    <label className="theme-preference-control">
      <span>主题</span>
      <select aria-label="颜色主题" value={preference} onChange={(event) => changeTheme(event.target.value)}>
        <option value="system">跟随系统</option>
        <option value="light">浅色</option>
        <option value="dark">深色</option>
      </select>
    </label>
  )
}
