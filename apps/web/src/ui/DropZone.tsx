import { useId, useRef, useState, type DragEvent } from 'react'
import { usePrefs } from '../lib/prefs'
import type { UploadOutcome } from '../lib/upload'

interface Status {
  id: string
  name: string
  state: 'checking' | 'added' | 'refused'
  outcome?: UploadOutcome
}

/**
 * Drop files or click to choose. Each file is uploaded and checked one at a time, and the result is shown
 * in plain language right under the box.
 */
export const DropZone = ({
  accept,
  multiple,
  hasFile,
  disabled,
  onUpload,
  onDone,
}: {
  accept: string
  multiple: boolean
  hasFile?: boolean
  disabled?: boolean
  onUpload: (file: File) => Promise<UploadOutcome>
  onDone?: () => void
}) => {
  const { t } = usePrefs()
  const input = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const [over, setOver] = useState(false)
  const [statuses, setStatuses] = useState<Status[]>([])

  const run = async (files: File[]) => {
    const list = multiple ? files : files.slice(0, 1)
    for (const file of list) {
      const id = crypto.randomUUID()
      setStatuses((s) => [{ id, name: file.name, state: 'checking' as const }, ...s].slice(0, 6))
      const outcome = await onUpload(file)
      setStatuses((s) => s.map((x) => (x.id === id ? { ...x, state: outcome.ok ? 'added' : 'refused', outcome } : x)))
    }
    onDone?.()
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (!disabled) void run(Array.from(e.dataTransfer.files))
  }

  return (
    <div className="drop-wrap">
      <label
        htmlFor={inputId}
        className={`drop${over ? ' is-over' : ''}${disabled ? ' is-disabled' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <span>{hasFile && !multiple ? t('drop.replace') : multiple ? t('drop.cta') : t('drop.ctaOne')}</span>
        <input
          ref={input}
          id={inputId}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          className="visually-hidden"
          onChange={(e) => {
            void run(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </label>
      {statuses.length > 0 && (
        <ul className="drop-status" aria-live="polite">
          {statuses.map((s) => (
            <li key={s.id} className={`is-${s.state}`}>
              {s.state === 'checking' && t('drop.checking', { name: s.name })}
              {s.state === 'added' && t('drop.added', { name: s.name })}
              {s.state === 'refused' &&
                t('drop.refused', { name: s.name, reason: t(s.outcome?.message ?? 'common.error.generic', s.outcome?.detail) })}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
