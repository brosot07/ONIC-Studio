import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { PLAYER_ACCEPT, PLAYER_ASSET_KINDS, PLAYER_CSV_COLUMNS, type MessageKey } from '@onic/shared'
import { supabase } from '../../lib/supabase'
import { usePrefs } from '../../lib/prefs'
import { loadPlayers, playerUsable, type Player } from '../../lib/library'
import { displayName, signedUrls, uploadToLibrary } from '../../lib/upload'
import { DropZone } from '../../ui/DropZone'
import { ErrorNote } from '../../ui/Notice'
import { CsvImport } from './CsvImport'
import { FileTiles } from './FileTiles'

type Draft = Omit<Player, 'id' | 'player_assets'> & { id?: string }
const empty: Draft = { name: '', ign: '', role_lane: '', team_name: '', status: 'active', rights_expires_on: null, consent: false }

const toRow = (d: Draft) => ({
  name: d.name.trim(),
  ign: d.ign.trim(),
  role_lane: d.role_lane?.trim() || null,
  team_name: d.team_name?.trim() || null,
  status: d.status,
  rights_expires_on: d.rights_expires_on || null,
  consent: d.consent,
})

export const usePlayers = () => {
  const [players, setPlayers] = useState<Player[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const fetchAll = useCallback(async () => {
    const p = await loadPlayers()
    return { p, u: await signedUrls('players', p.flatMap((x) => x.player_assets.map((a) => a.path))) }
  }, [])
  const reload = useCallback(() => void fetchAll().then((r) => (setPlayers(r.p), setUrls(r.u))), [fetchAll])
  useEffect(() => {
    let live = true
    void fetchAll().then((r) => live && (setPlayers(r.p), setUrls(r.u)))
    return () => {
      live = false
    }
  }, [fetchAll])
  return { players, urls, reload }
}

export const savePlayerCsvRow = async (r: Record<string, string>): Promise<string | null> => {
  if (!r['name'] || !r['ign']) return 'name and ign are required'
  const status = (r['status'] || 'active').toLowerCase()
  if (!['active', 'inactive', 'loaned'].includes(status)) return 'status must be active, inactive or loaned'
  const rights = r['rights_expires_on'] || null
  if (rights && !/^\d{4}-\d{2}-\d{2}$/.test(rights)) return 'rights_expires_on must look like 2027-12-31'
  const { error } = await supabase!.from('players').insert({
    name: r['name'],
    ign: r['ign'],
    role_lane: r['role_lane'] || null,
    team_name: r['team_name'] || null,
    status,
    rights_expires_on: rights,
    consent: /^(y|yes|ya|true|1)$/i.test(r['consent'] ?? ''),
    notes: r['notes'] || null,
  })
  return error ? (error.code === '23505' ? 'already in the list' : 'could not be saved') : null
}

export const Players = ({ isAdmin }: { isAdmin: boolean }) => {
  const { t } = usePrefs()
  const { players, urls, reload } = usePlayers()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  const [query, setQuery] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (draft) dialog.current?.showModal()
    else dialog.current?.close()
  }, [draft])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!draft || !draft.name.trim() || !draft.ign.trim()) return setError('login.error.missing')
    const row = toRow(draft)
    const { error: dbError } = draft.id
      ? await supabase!.from('players').update(row).eq('id', draft.id)
      : await supabase!.from('players').insert(row)
    if (dbError) return setError('common.error.generic')
    setError(null)
    setDraft(null)
    reload()
  }

  const retire = async (id: string) => {
    await supabase!.from('player_assets').update({ is_current: false }).eq('id', id)
    reload()
  }

  const shown = players.filter((p) => `${p.ign} ${p.name} ${p.team_name ?? ''}`.toLowerCase().includes(query.toLowerCase()))

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>{t('players.title')}</h1>
          <p className="lede">{t('players.lede')}</p>
        </div>
        {isAdmin && (
          <button type="button" className="btn btn-primary" onClick={() => setDraft({ ...empty })}>
            {t('players.add')}
          </button>
        )}
      </div>
      <p className="hint">{isAdmin ? t('players.hiddenNote') : t('library.readOnly')}</p>
      {isAdmin && (
        <CsvImport
          filename="onic-players.csv"
          columns={PLAYER_CSV_COLUMNS}
          example={['Name Surname', 'IGN', 'Gold Lane', 'ONIC ID MLBB', 'active', '2027-12-31', 'yes', '']}
          save={savePlayerCsvRow}
          onDone={reload}
        />
      )}
      <label className="field field-inline">
        <span>{t('library.search')}</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {shown.length === 0 && <p className="empty">{t('library.empty')}</p>}
      <ul className="entity-list">
        {shown.map((p) => (
          <li key={p.id} className="entity">
            <div className="entity-head">
              <div>
                <strong className="cell-name">{p.ign}</strong>
                <span className="cell-sub">
                  {[p.name, p.role_lane, p.team_name].filter(Boolean).join(' · ')}
                </span>
              </div>
              <div className="entity-meta">
                <span className="pill">{t(`players.status.${p.status}`)}</span>
                <span className="pill">{p.consent ? t('players.consent') : t('players.noConsent')}</span>
                {p.rights_expires_on && (
                  <span className="pill">
                    {t('players.col.rights')} {p.rights_expires_on}
                  </span>
                )}
                {isAdmin && !playerUsable(p) && <span className="pill pill-needed">{t('players.status.hidden')}</span>}
                {isAdmin && (
                  <button type="button" className="btn btn-small" onClick={() => setDraft({ ...p })}>
                    {t('admin.users.edit')}
                  </button>
                )}
              </div>
            </div>
            <FileTiles
              tiles={p.player_assets.map((a) => ({ id: a.id, name: a.name, path: a.path, label: t(`players.kind.${a.kind as 'cutout'}`) }))}
              urls={urls}
              onRemove={isAdmin ? (tile) => void retire(tile.id) : undefined}
            />
            {isAdmin && (
              <div className="entity-drops">
                {PLAYER_ASSET_KINDS.map((kind) => (
                  <div key={kind}>
                    <p className="drop-label">{t(`players.kind.${kind}`)}</p>
                    <DropZone
                      accept={PLAYER_ACCEPT[kind]}
                      multiple
                      onUpload={(file) => uploadToLibrary(file, { library: 'players', player_id: p.id, kind, name: `${p.ign} ${displayName(file)}` })}
                      onDone={reload}
                    />
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      <dialog ref={dialog} className="dialog" onClose={() => setDraft(null)}>
        {draft && (
          <form className="stack" onSubmit={(e) => void save(e)} noValidate>
            <h2>{draft.id ? t('admin.users.edit') : t('players.add')}</h2>
            <label className="field">
              <span>{t('players.form.name')}</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={120} />
            </label>
            <label className="field">
              <span>{t('players.form.ign')}</span>
              <input value={draft.ign} onChange={(e) => setDraft({ ...draft, ign: e.target.value })} maxLength={60} />
            </label>
            <div className="row-form">
              <label className="field">
                <span>{t('players.form.role')}</span>
                <input value={draft.role_lane ?? ''} onChange={(e) => setDraft({ ...draft, role_lane: e.target.value })} maxLength={60} />
              </label>
              <label className="field">
                <span>{t('players.form.team')}</span>
                <input value={draft.team_name ?? ''} onChange={(e) => setDraft({ ...draft, team_name: e.target.value })} maxLength={80} />
              </label>
            </div>
            <div className="row-form">
              <label className="field">
                <span>{t('players.col.status')}</span>
                <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Draft['status'] })}>
                  {(['active', 'inactive', 'loaned'] as const).map((s) => (
                    <option key={s} value={s}>
                      {t(`players.status.${s}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t('players.form.rights')}</span>
                <input
                  type="date"
                  value={draft.rights_expires_on ?? ''}
                  onChange={(e) => setDraft({ ...draft, rights_expires_on: e.target.value || null })}
                />
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={draft.consent} onChange={(e) => setDraft({ ...draft, consent: e.target.checked })} />
              {t('players.form.consent')}
            </label>
            {error && <ErrorNote>{t(error)}</ErrorNote>}
            <div className="dialog-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setDraft(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary">
                {t('library.save')}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </section>
  )
}
