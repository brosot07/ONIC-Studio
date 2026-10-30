import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { PLAYER_ACCEPT, PLAYER_ASSET_KINDS, PLAYER_CSV_COLUMNS, type MessageKey } from '@onic/shared'
import { supabase } from '../../lib/supabase'
import { usePrefs } from '../../lib/prefs'
import { loadPlayerMedia, loadPlayers, playerUsable, previewPath, type EventMedia, type Player } from '../../lib/library'
import { displayName, signedUrls, uploadToLibrary } from '../../lib/upload'
import { DropZone } from '../../ui/DropZone'
import { ErrorNote } from '../../ui/Notice'
import { CsvImport } from './CsvImport'
import { FileTiles } from './FileTiles'
import { MediaGrid } from './MediaGrid'

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
  const [openId, setOpenId] = useState<string | null>(null)
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

  const dialogEl = (
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
  )

  const open = players.find((p) => p.id === openId)
  if (open)
    return (
      <PlayerDetail
        player={open}
        urls={urls}
        isAdmin={isAdmin}
        onBack={() => setOpenId(null)}
        onEdit={() => setDraft({ ...open })}
        onRetire={(id) => void retire(id)}
        onChange={reload}
        dialog={dialogEl}
      />
    )

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
      <ul className="player-grid">
        {shown.map((p) => {
          const face = p.player_assets.find((a) => a.kind === 'cutout') ?? p.player_assets.find((a) => a.kind === 'headshot')
          return (
            <li key={p.id}>
              <button type="button" className="player-card" onClick={() => setOpenId(p.id)}>
                <span className="player-face">
                  {face && urls[face.path] ? <img src={urls[face.path]} alt="" loading="lazy" /> : <span>{p.ign.slice(0, 2)}</span>}
                </span>
                <strong className="cell-name">{p.ign}</strong>
                <span className="cell-sub">{[p.name, p.team_name].filter(Boolean).join(' · ')}</span>
                <span className="entity-meta">
                  <span className="pill">{t(`players.status.${p.status}`)}</span>
                  {isAdmin && !playerUsable(p) && <span className="pill pill-needed">{t('players.status.hidden')}</span>}
                  <span className="cell-sub">{t('players.files', { n: p.player_assets.length })}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {dialogEl}
    </section>
  )
}

/** One player's page: profile photos and videos, plus every event photo they're tagged in. */
const PlayerDetail = ({
  player: p,
  urls,
  isAdmin,
  onBack,
  onEdit,
  onRetire,
  onChange,
  dialog,
}: {
  player: Player
  urls: Record<string, string>
  isAdmin: boolean
  onBack: () => void
  onEdit: () => void
  onRetire: (id: string) => void
  onChange: () => void
  dialog: ReactNode
}) => {
  const { t } = usePrefs()
  const [media, setMedia] = useState<EventMedia[]>([])
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    let live = true
    void loadPlayerMedia(p.id).then(async (m) => {
      const u = await signedUrls('events', [...new Set(m.flatMap((x) => [previewPath(x), x.path]))])
      if (live) {
        setMedia(m)
        setMediaUrls(u)
      }
    })
    return () => {
      live = false
    }
  }, [p.id])

  return (
    <section className="page">
      <button type="button" className="link back" onClick={onBack}>
        ← {t('players.back')}
      </button>
      <div className="page-head">
        <div>
          <h1>{p.ign}</h1>
          <p className="lede">{[p.name, p.role_lane, p.team_name].filter(Boolean).join(' · ')}</p>
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
            <button type="button" className="btn btn-small" onClick={onEdit}>
              {t('admin.users.edit')}
            </button>
          )}
        </div>
      </div>

      <h2 className="section-title">{t('players.profile')}</h2>
      <FileTiles
        tiles={p.player_assets.map((a) => ({ id: a.id, name: a.name, path: a.path, label: t(`players.kind.${a.kind as 'cutout'}`) }))}
        urls={urls}
        onRemove={isAdmin ? (tile) => onRetire(tile.id) : undefined}
      />
      {isAdmin && (
        <div className="entity-drops">
          {PLAYER_ASSET_KINDS.map((kind) => (
            <div key={kind}>
              <p className="drop-label">{t(`players.kind.${kind}`)}</p>
              <DropZone
                accept={PLAYER_ACCEPT[kind]}
                multiple
                concurrency={2}
                onUpload={(file) => uploadToLibrary(file, { library: 'players', player_id: p.id, kind, name: `${p.ign} ${displayName(file)}` })}
                onDone={onChange}
              />
            </div>
          ))}
        </div>
      )}

      <h2 className="section-title">{t('players.eventPhotos')}</h2>
      {media.length === 0 ? (
        <p className="empty">{t('players.eventPhotos.none', { name: p.ign })}</p>
      ) : (
        <MediaGrid media={media} urls={mediaUrls} playerNames={{ [p.id]: p.ign }} caption={(m) => m.events?.name} />
      )}
      {dialog}
    </section>
  )
}
