export type ThemePreference = 'system' | 'light' | 'dark'

export const themeStorageKey = 'devflow.web.theme'

export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system'
}

// Runs in <head> before content paints. CSS handles system changes without JS.
export const themeInitializationScript = `(()=>{let theme='system';try{const saved=localStorage.getItem('${themeStorageKey}');if(saved==='light'||saved==='dark')theme=saved}catch{}document.documentElement.dataset.theme=theme})()`
