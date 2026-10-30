import { useState, type FormEvent } from 'react'
import type { MessageKey } from '@onic/shared'
import { supabase } from '../../lib/supabase'
import { usePrefs } from '../../lib/prefs'
import { listCell } from '../../lib/csv'
import type { VoiceGuide } from '../../lib/library'
import { ErrorNote } from '../../ui/Notice'

const LANGUAGES = ['id', 'en', 'ph'] as const

/** One voice per Instagram account and language: best past captions and what to avoid. */
export const Voices = ({ voices, isAdmin, onChange }: { voices: VoiceGuide[]; isAdmin: boolean; onChange: () => void }) => {
  const { t } = usePrefs()
  const [account, setAccount] = useState('')
  const [language, setLanguage] = useState<(typeof LANGUAGES)[number]>('id')
  const [samples, setSamples] = useState<string[]>(['', '', '', '', ''])
  const [banned, setBanned] = useState('')
  const [topics, setTopics] = useState('')
  const [error, setError] = useState<MessageKey | null>(null)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const handle = account.trim().replace(/^@/, '')
    if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) return setError('common.error.generic')
    const { error: dbError } = await supabase!.from('voice_guides').upsert(
      {
        account: handle,
        language,
        sample_captions: samples.map((s) => s.trim()).filter(Boolean),
        banned_words: listCell(banned),
        banned_topics: listCell(topics),
      },
      { onConflict: 'account,language' },
    )
    if (dbError) return setError('common.error.generic')
    setError(null)
    setAccount('')
    setSamples(['', '', '', '', ''])
    setBanned('')
    setTopics('')
    onChange()
  }

  return (
    <div className="voices">
      {voices.length > 0 && (
        <ul className="voice-list">
          {voices.map((v) => (
            <li key={v.id}>
              <strong>@{v.account}</strong> · {t(`lang.${v.language}`)} · {t('brand.voice.count', { n: v.sample_captions.length })}
            </li>
          ))}
        </ul>
      )}
      {isAdmin && (
        <form className="stack voice-form" onSubmit={(e) => void save(e)} noValidate>
          <div className="row-form">
            <label className="field">
              <span>{t('brand.voice.account')}</span>
              <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="onic.esports" maxLength={31} />
            </label>
            <label className="field field-narrow">
              <span>{t('brand.voice.language')}</span>
              <select value={language} onChange={(e) => setLanguage(e.target.value as (typeof LANGUAGES)[number])}>
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {t(`lang.${l}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="field">
            <legend>{t('brand.voice.samples')}</legend>
            {samples.map((s, i) => (
              <textarea
                key={i}
                rows={2}
                value={s}
                maxLength={2200}
                onChange={(e) => setSamples(samples.map((x, j) => (j === i ? e.target.value : x)))}
              />
            ))}
          </fieldset>
          <label className="field">
            <span>{t('brand.voice.banned')}</span>
            <input value={banned} onChange={(e) => setBanned(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('brand.voice.bannedTopics')}</span>
            <input value={topics} onChange={(e) => setTopics(e.target.value)} />
          </label>
          {error && <ErrorNote>{t(error)}</ErrorNote>}
          <button type="submit" className="btn btn-quiet">
            {t('library.save')}
          </button>
        </form>
      )}
    </div>
  )
}
