import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { usePrefs } from '../../lib/prefs'
import type { BrandColor } from '../../lib/library'
import { ErrorNote } from '../../ui/Notice'

export const Palette = ({ colors, isAdmin, onChange }: { colors: BrandColor[]; isAdmin: boolean; onChange: () => void }) => {
  const { t } = usePrefs()
  const [name, setName] = useState('')
  const [hex, setHex] = useState('#')
  const [bad, setBad] = useState(false)

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const value = hex.trim().toUpperCase()
    if (!/^#[0-9A-F]{6}$/.test(value) || !name.trim()) return setBad(true)
    setBad(false)
    const { error } = await supabase!.from('brand_colors').insert({ name: name.trim(), hex: value, sort: colors.length })
    if (error) return setBad(true)
    setName('')
    setHex('#')
    onChange()
  }

  const remove = async (id: string) => {
    await supabase!.from('brand_colors').delete().eq('id', id)
    onChange()
  }

  return (
    <div className="palette">
      <ul className="swatches">
        {colors.map((c) => (
          <li key={c.id} className="swatch">
            <span className="swatch-chip" style={{ background: c.hex }} />
            <span>
              <strong>{c.name}</strong>
              <code>{c.hex}</code>
            </span>
            {isAdmin && (
              <button type="button" className="link" onClick={() => void remove(c.id)}>
                {t('library.delete')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {isAdmin && (
        <form className="row-form" onSubmit={(e) => void add(e)} noValidate>
          <label className="field">
            <span>{t('brand.palette.name')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </label>
          <label className="field field-narrow">
            <span>{t('brand.palette.hex')}</span>
            <input value={hex} onChange={(e) => setHex(e.target.value)} maxLength={7} />
          </label>
          <button type="submit" className="btn btn-quiet">
            {t('library.add')}
          </button>
        </form>
      )}
      {bad && <ErrorNote>{t('brand.palette.badHex')}</ErrorNote>}
    </div>
  )
}
