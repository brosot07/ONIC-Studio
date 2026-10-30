import { useEffect, useId, useRef, useState, type DragEvent } from 'react'
import { usePrefs } from '../lib/prefs'
import type { UploadOutcome } from '../lib/upload'

interface Status {
  id: string
  name: string
  state: 'waiting' | 'checking' | 'added' | 'refused'
  outcome?: UploadOutcome
}

/** Bulk drops show a running count instead of one line per file. */
const BULK = 6

const matches = (file: File, accept: string) => {
  const exts = accept.split(',').map((a) => a.trim().toLowerCase())
  const name = file.name.toLowerCase()
  return exts.some((e) => name.endsWith(e))
}

/** Every file inside dropped folders (and their sub-folders). */
const filesFromDrop = async (e: DragEvent): Promise<File[]> => {
  const entries = Array.from(e.dataTransfer.items)
    .map((i) => i.webkitGetAsEntry?.())
    .filter((x): x is FileSystemEntry => !!x)
  if (entries.length === 0 || entries.every((x) => x.isFile)) return Array.from(e.dataTransfer.files)
  const out: File[] = []
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      out.push(await new Promise<File>((ok, fail) => (entry as FileSystemFileEntry).file(ok, fail)))
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail))
        if (batch.length === 0) break
        for (const child of batch) await walk(child)
      }
    }
  }
  for (const entry of entries) await walk(entry)
  return out
}

/**
 * Drop files (or whole folders) or click to choose. Files are uploaded and checked a few at a time, and the result
 * is shown in plain language right under the box.
 */
export const DropZone = ({
  accept,
  multiple,
  hasFile,
  disabled,
  folders,
  concurrency = 1,
  onUpload,
  onDone,
}: {
  accept: string
  multiple: boolean
  hasFile?: boolean
  disabled?: boolean
  /** Also take whole folders (match-day photo dumps). */
  folders?: boolean
  concurrency?: number
  onUpload: (file: File) => Promise<UploadOutcome>
  onDone?: () => void
}) => {
  const { t } = usePrefs()
  const inputId = useId()
  const folderInput = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [statuses, setStatuses] = useState<Status[]>([])
  const [skipped, setSkipped] = useState(0)

  useEffect(() => {
    // Not in React's attribute list; lets the browser pick a whole folder.
    folderInput.current?.setAttribute('webkitdirectory', '')
  }, [])

  const run = async (picked: File[]) => {
    // Folders hold all sorts (RAW files, sidecars, .DS_Store); skip what this box can't take and say how many.
    const usable = folders ? picked.filter((f) => !f.name.startsWith('.') && matches(f, accept)) : picked
    setSkipped(picked.length - usable.length)
    const list = multiple ? usable : usable.slice(0, 1)
    if (list.length === 0) return
    const queue = list.map((file) => ({ id: crypto.randomUUID(), file }))
    setStatuses(queue.map((q) => ({ id: q.id, name: q.file.name, state: 'waiting' as const })))
    let next = 0
    const worker = async () => {
      while (next < queue.length) {
        const { id, file } = queue[next++]!
        setStatuses((s) => s.map((x) => (x.id === id ? { ...x, state: 'checking' } : x)))
        const outcome = await onUpload(file)
        setStatuses((s) => s.map((x) => (x.id === id ? { ...x, state: outcome.ok ? 'added' : 'refused', outcome } : x)))
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
    onDone?.()
  }

  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (!disabled) void run(folders ? await filesFromDrop(e) : Array.from(e.dataTransfer.files))
  }

  const done = statuses.filter((s) => s.state === 'added' || s.state === 'refused').length
  const refused = statuses.filter((s) => s.state === 'refused')
  const bulk = statuses.length > BULK
  const line = (s: Status) => (
    <li key={s.id} className={`is-${s.state}`}>
      {(s.state === 'checking' || s.state === 'waiting') && t('drop.checking', { name: s.name })}
      {s.state === 'added' && t('drop.added', { name: s.name })}
      {s.state === 'refused' && t('drop.refused', { name: s.name, reason: t(s.outcome?.message ?? 'common.error.generic', s.outcome?.detail) })}
    </li>
  )

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
        onDrop={(e) => void onDrop(e)}
      >
        <span>{hasFile && !multiple ? t('drop.replace') : folders ? t('drop.ctaFolders') : multiple ? t('drop.cta') : t('drop.ctaOne')}</span>
        <input
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
      {folders && !disabled && (
        <label className="link drop-folder">
          {t('drop.chooseFolder')}
          <input
            ref={folderInput}
            type="file"
            multiple
            className="visually-hidden"
            onChange={(e) => {
              void run(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
        </label>
      )}
      {bulk && (
        <div className="drop-progress" role="status">
          <span>{t('drop.progress', { done, total: statuses.length, refused: refused.length })}</span>
          <progress max={statuses.length} value={done} />
        </div>
      )}
      {skipped > 0 && <p className="hint">{t('drop.skipped', { n: skipped })}</p>}
      {statuses.length > 0 && (
        <ul className="drop-status" aria-live="polite">
          {bulk ? refused.map(line) : statuses.map(line)}
        </ul>
      )}
    </div>
  )
}
