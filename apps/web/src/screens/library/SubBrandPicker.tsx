import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { usePrefs } from '../../lib/prefs'
import { loadSubBrands } from '../../lib/library'
import { ErrorNote } from '../../ui/Notice'

const ADD = '__add__'

/** Pick which sub-brand a logo belongs to, or add a new sub-brand to the list. */
export const SubBrandPicker = ({ value, onPick }: { value: string; onPick: (name: string) => void }) => {
  const { t } = usePrefs()
  const [names, setNames] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<'exists' | 'generic' | null>(null)

  const refresh = useCallback(async () => {
    const list = await loadSubBrands()
    setNames(list)
    return list
  }, [])

  useEffect(() => {
    let live = true
    void loadSubBrands().then((list) => {
      if (!live) return
      setNames(list)
      if (!value && list[0]) onPick(list[0])
    })
    return () => {
      live = false
    }
  }, [value, onPick])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const name = draft.trim().replace(/\s+/g, ' ')
    if (!name) return
    setProblem(null)
    if (names.some((n) => n.toLowerCase() === name.toLowerCase())) return setProblem('exists')
    const { error } = await supabase!.from('sub_brands').insert({ name })
    if (error) return setProblem(error.code === '23505' ? 'exists' : 'generic')
    await refresh()
    onPick(name)
    setDraft('')
    setAdding(false)
  }

  if (adding)
    return (
      <>
        <form className="row-form" onSubmit={(e) => void add(e)} noValidate>
          <label className="field field-inline">
            <span>{t('slot.subBrand.newName')}</span>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={60} placeholder="ONIC MY" autoFocus />
          </label>
          <button type="submit" className="btn btn-quiet" disabled={!draft.trim()}>
            {t('library.add')}
          </button>
          <button type="button" className="link" onClick={() => (setAdding(false), setProblem(null))}>
            {t('common.cancel')}
          </button>
        </form>
        {problem && <ErrorNote>{t(problem === 'exists' ? 'slot.subBrand.exists' : 'common.error.generic')}</ErrorNote>}
      </>
    )

  return (
    <label className="field field-inline">
      <span>{t('slot.subBrand')}</span>
      <select value={value} onChange={(e) => (e.target.value === ADD ? setAdding(true) : onPick(e.target.value))}>
        {names.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
        <option value={ADD}>{t('slot.subBrand.add')}</option>
      </select>
    </label>
  )
}
