import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemePreferenceControl } from './ThemePreferenceControl'
import { themeInitializationScript, themeStorageKey } from './theme-preference'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('Web theme preference', () => {
  it('applies the saved preference before hydration and restores it after a reload', () => {
    localStorage.setItem(themeStorageKey, 'dark')
    Function(themeInitializationScript)()
    expect(document.documentElement.dataset.theme).toBe('dark')
    render(<ThemePreferenceControl />)
    expect(screen.getByRole('combobox', { name: '颜色主题' })).toHaveValue('dark')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'light' } })
    expect(localStorage.getItem(themeStorageKey)).toBe('light')
    delete document.documentElement.dataset.theme
    Function(themeInitializationScript)()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('defaults to the system and remains usable with unavailable storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => Function(themeInitializationScript)()).not.toThrow()
    render(<ThemePreferenceControl />)
    expect(screen.getByRole('combobox')).toHaveValue('system')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'dark' } })
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('ignores invalid saved values and follows changes from another tab', () => {
    localStorage.setItem(themeStorageKey, 'invalid')
    Function(themeInitializationScript)()
    render(<ThemePreferenceControl />)
    expect(screen.getByRole('combobox')).toHaveValue('system')
    fireEvent(window, new StorageEvent('storage', { key: themeStorageKey, newValue: 'dark' }))
    expect(screen.getByRole('combobox')).toHaveValue('dark')
    fireEvent(window, new StorageEvent('storage', { key: null }))
    expect(screen.getByRole('combobox')).toHaveValue('system')
  })
})
