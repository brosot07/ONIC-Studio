import { useState } from 'react'
import { usePrefs } from '../../lib/prefs'
import { csvRecords, downloadCsv } from '../../lib/csv'
import { ErrorNote, OkNote } from '../../ui/Notice'

/**
 * Template download + spreadsheet import. `save` turns one row into a database write and returns an
 * error message for that row, or null when it worked.
 */
export const CsvImport = ({
  filename,
  columns,
  example,
  save,
  onDone,
}: {
  filename: string
  columns: readonly string[]
  example: string[]
  save: (row: Record<string, string>) => Promise<string | null>
  onDone: () => void
}) => {
  const { t } = usePrefs()
  const [done, setDone] = useState<number | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const importFile = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) return setErrors([t('upload.error.too_large', { max: '2 MB' })])
    setBusy(true)
    const rows = csvRecords(await file.text())
    const failed: string[] = []
    let ok = 0
    for (const [i, row] of rows.entries()) {
      const reason = await save(row)
      if (reason) failed.push(t('library.csv.failed', { row: i + 2, reason }))
      else ok++
    }
    setBusy(false)
    setDone(ok)
    setErrors(failed.slice(0, 20))
    onDone()
  }

  return (
    <div className="csv">
      <div className="csv-actions">
        <button type="button" className="btn btn-quiet" onClick={() => downloadCsv(filename, columns, example)}>
          {t('library.csv.template')}
        </button>
        <label className={`btn btn-quiet${busy ? ' is-disabled' : ''}`}>
          {busy ? t('common.working') : t('library.csv.import')}
          <input
            type="file"
            accept=".csv,text/csv"
            className="visually-hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void importFile(f)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      <p className="hint">{t('library.csv.help')}</p>
      {done !== null && <OkNote>{t('library.csv.done', { n: done })}</OkNote>}
      {errors.map((e) => (
        <ErrorNote key={e}>{e}</ErrorNote>
      ))}
    </div>
  )
}
