import { LANGS } from '@onic/shared'
import { usePrefs, type ThemePref } from '../lib/prefs'

const THEMES: ThemePref[] = ['system', 'light', 'dark']

export const PrefsBar = () => {
  const { lang, setLang, theme, setTheme, t } = usePrefs()
  return (
    <div className="prefs">
      <div className="segmented" role="group" aria-label={t('settings.language')}>
        {LANGS.map((code) => (
          <button key={code} type="button" aria-pressed={lang === code} onClick={() => setLang(code)}>
            {code === 'id' ? 'Bahasa' : 'English'}
          </button>
        ))}
      </div>
      <label className="select">
        <span className="visually-hidden">{t('settings.theme')}</span>
        <select value={theme} onChange={(e) => setTheme(e.target.value as ThemePref)}>
          {THEMES.map((value) => (
            <option key={value} value={value}>
              {t(`settings.theme.${value}`)}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
