import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { messages, type Lang, type MessageKey } from '@onic/shared'

export type ThemePref = 'system' | 'light' | 'dark'

interface Prefs {
  lang: Lang
  setLang: (lang: Lang) => void
  theme: ThemePref
  setTheme: (theme: ThemePref) => void
  t: (key: MessageKey) => string
}

const PrefsContext = createContext<Prefs | null>(null)

const read = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try {
    const v = localStorage.getItem(key)
    return allowed.includes(v as T) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Preference just won't persist.
  }
}

export const PrefsProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLangState] = useState<Lang>(() => read('onic.lang', ['id', 'en'], 'id'))
  const [theme, setThemeState] = useState<ThemePref>(() =>
    read('onic.theme', ['system', 'light', 'dark'], 'system'),
  )

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') delete root.dataset['theme']
    else root.dataset['theme'] = theme
  }, [theme])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    write('onic.lang', next)
  }, [])
  const setTheme = useCallback((next: ThemePref) => {
    setThemeState(next)
    write('onic.theme', next)
  }, [])
  const t = useCallback((key: MessageKey) => messages[lang][key], [lang])

  const value = useMemo(() => ({ lang, setLang, theme, setTheme, t }), [lang, setLang, theme, setTheme, t])
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
}

export const usePrefs = (): Prefs => {
  const ctx = useContext(PrefsContext)
  if (!ctx) throw new Error('usePrefs outside PrefsProvider')
  return ctx
}
