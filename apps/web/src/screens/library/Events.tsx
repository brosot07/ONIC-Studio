import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { MessageKey } from '@onic/shared'
import { supabase } from '../../lib/supabase'
import { usePrefs } from '../../lib/prefs'
import {
  EVENT_KINDS,
  loadEventMedia,
  loadEvents,
  loadPlayerMedia,
  loadPlayers,
  loadSubBrands,
  previewPath,
  type EventKind,
  type EventMedia,
  type EventRow,
  type Player,
} from '../../lib/library'
import { displayName, signedUrls, uploadToLibrary } from '../../lib/upload'
import { DropZone } from '../../ui/DropZone'
import { ErrorNote } from '../../ui/Notice'
import { MediaGrid } from './MediaGrid'

const ACCEPT = '.jpg,.jpeg,.png,.mp4,.mov'

type Draft = {
  id?: string
  name: string
  kind: EventKind
  starts_on: string
  ends_on: string
  sub_brand: string
  opponent: string
  location: string
}
const today = () => new Date().toISOString().slice(0, 10)
const emptyDraft = (): Draft => ({
  name: '',
  kind: 'match_day',
  starts_on: today(),
  ends_on: '',
  sub_brand: '',
  opponent: '',
  location: '',
})

/** Signed links for previews (and full files, for opening). */
const signMedia = (media: EventMedia[]) => signedUrls('events', [...new Set(media.flatMap((m) => [previewPath(m), m.path]))])

/** Removes stored files first (so nothing is left behind), then the rows. Stops if the files can't be removed. */
const removeMedia = async (media: EventMedia[]) => {
  const paths = media.flatMap((m) => (m.thumb_path ? [m.path, m.thumb_path] : [m.path]))
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await supabase!.storage.from('events').remove(paths.slice(i, i + 100))
    if (error) return false
  }
  const ids = media.map((m) => m.id)
  for (let i = 0; i < ids.length; i += 100)
    await supabase!
      .from('event_media')
      .delete()
      .in('id', ids.slice(i, i + 100))
  return true
}

const usePlayerNames = () => {
  const [players, setPlayers] = useState<Player[]>([])
  useEffect(() => {
    let live = true
    void loadPlayers().then((p) => live && setPlayers(p))
    return () => {
      live = false
    }
  }, [])
  const names = useMemo(() => Object.fromEntries(players.map((p) => [p.id, p.ign])), [players])
  return { players, names }
}

export const Events = ({ isAdmin, canAdd, userId }: { isAdmin: boolean; canAdd: boolean; userId: string }) => {
  const { t } = usePrefs()
  const [events, setEvents] = useState<EventRow[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<EventKind | ''>('')
  const [playerId, setPlayerId] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const { players, names } = usePlayerNames()

  const reload = useCallback(() => void loadEvents().then(setEvents), [])
  useEffect(() => {
    let live = true
    void loadEvents().then((e) => live && setEvents(e))
    return () => {
      live = false
    }
  }, [])

  const open = events.find((e) => e.id === openId)
  if (open)
    return (
      <EventDetail
        event={open}
        players={players}
        names={names}
        isAdmin={isAdmin}
        canEdit={isAdmin || (canAdd && open.created_by === userId)}
        userId={userId}
        canAdd={canAdd}
        onBack={() => (setOpenId(null), reload())}
        onEdit={() =>
          setDraft({
            ...emptyDraft(),
            ...open,
            ends_on: open.ends_on ?? '',
            sub_brand: open.sub_brand ?? '',
            opponent: open.opponent ?? '',
            location: open.location ?? '',
          })
        }
        onDeleted={() => (setOpenId(null), reload())}
        dialog={<EventForm draft={draft} onClose={() => setDraft(null)} onSaved={() => (setDraft(null), reload())} />}
      />
    )

  const q = query.trim().toLowerCase()
  const shown = events.filter(
    (e) => (!kind || e.kind === kind) && (!q || [e.name, e.opponent, e.location, e.sub_brand].some((v) => v?.toLowerCase().includes(q))),
  )

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>{t('events.title')}</h1>
          <p className="lede">{t('events.lede')}</p>
        </div>
        {canAdd && (
          <button type="button" className="btn btn-primary" onClick={() => setDraft(emptyDraft())}>
            {t('events.new')}
          </button>
        )}
      </div>
      {!canAdd && <p className="hint">{t('events.readOnly')}</p>}

      <div className="filters">
        <label className="field">
          <span>{t('events.search')}</span>
          <input type="search" value={query} placeholder={t('events.search.placeholder')} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label className="field field-narrow-l">
          <span>{t('events.filter.kind')}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as EventKind | '')}>
            <option value="">{t('events.filter.allKinds')}</option>
            {EVENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`events.kind.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field field-narrow-l">
          <span>{t('events.byPlayer')}</span>
          <select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
            <option value="">{t('events.byPlayer.pick')}</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.ign}
              </option>
            ))}
          </select>
        </label>
      </div>

      {playerId ? (
        <PlayerPhotos playerId={playerId} names={names} />
      ) : (
        <>
          {events.length === 0 && <p className="empty">{t('events.empty')}</p>}
          {events.length > 0 && shown.length === 0 && <p className="empty">{t('events.noMatch')}</p>}
          <ul className="event-grid">
            {shown.map((e) => (
              <li key={e.id}>
                <button type="button" className="event-card" onClick={() => setOpenId(e.id)}>
                  <span className="event-date">{e.ends_on ? `${e.starts_on} → ${e.ends_on}` : e.starts_on}</span>
                  <strong>{e.name}</strong>
                  <span className="cell-sub">{[e.sub_brand, e.opponent && `vs ${e.opponent}`, e.location].filter(Boolean).join(' · ')}</span>
                  <span className="event-foot">
                    <span className="pill">{t(`events.kind.${e.kind}`)}</span>
                    <span className="cell-sub">
                      {t('events.count', {
                        photos: e.event_media.filter((m) => m.kind === 'photo').length,
                        videos: e.event_media.filter((m) => m.kind === 'video').length,
                      })}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <EventForm draft={draft} onClose={() => setDraft(null)} onSaved={(id) => (setDraft(null), reload(), setOpenId(id))} />
    </section>
  )
}

/** Every photo a player is tagged in, across all events. */
const PlayerPhotos = ({ playerId, names }: { playerId: string; names: Record<string, string> }) => {
  const { t } = usePrefs()
  const [media, setMedia] = useState<EventMedia[] | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    let live = true
    void loadPlayerMedia(playerId).then(async (m) => {
      const u = await signMedia(m)
      if (live) {
        setMedia(m)
        setUrls(u)
      }
    })
    return () => {
      live = false
    }
  }, [playerId])
  if (!media) return null
  if (media.length === 0) return <p className="empty">{t('events.byPlayer.none', { name: names[playerId] ?? '' })}</p>
  return <MediaGrid media={media} urls={urls} playerNames={names} caption={(m) => m.events?.name} />
}

const EventDetail = ({
  event,
  players,
  names,
  isAdmin,
  canEdit,
  canAdd,
  userId,
  onBack,
  onEdit,
  onDeleted,
  dialog,
}: {
  event: EventRow
  players: Player[]
  names: Record<string, string>
  isAdmin: boolean
  canEdit: boolean
  canAdd: boolean
  userId: string
  onBack: () => void
  onEdit: () => void
  onDeleted: () => void
  dialog: ReactNode
}) => {
  const { t } = usePrefs()
  const [media, setMedia] = useState<EventMedia[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [show, setShow] = useState('')
  const [busy, setBusy] = useState(false)
  const top = useRef<HTMLDivElement>(null)

  const fetchMedia = useCallback(async () => {
    const m = await loadEventMedia(event.id)
    return { m, u: await signMedia(m) }
  }, [event.id])
  const reload = useCallback(() => void fetchMedia().then((r) => (setMedia(r.m), setUrls(r.u))), [fetchMedia])
  useEffect(() => {
    let live = true
    void fetchMedia().then((r) => live && (setMedia(r.m), setUrls(r.u)))
    return () => {
      live = false
    }
  }, [fetchMedia])

  const shown = media.filter((m) =>
    !show ? true : show === 'untagged' ? m.event_media_players.length === 0 : m.event_media_players.some((p) => p.player_id === show),
  )
  // Designers tag and remove only what they uploaded; Admins handle everything.
  const mine = (m: EventMedia) => isAdmin || m.created_by === userId
  const picked = media.filter((m) => selected.has(m.id) && mine(m))
  const notMine = media.filter((m) => selected.has(m.id) && !mine(m)).length

  const toggleTag = async (playerId: string) => {
    if (picked.length === 0) return
    setBusy(true)
    const allHave = picked.every((m) => m.event_media_players.some((p) => p.player_id === playerId))
    if (allHave) {
      await supabase!
        .from('event_media_players')
        .delete()
        .eq('player_id', playerId)
        .in(
          'media_id',
          picked.map((m) => m.id),
        )
    } else {
      const missing = picked.filter((m) => !m.event_media_players.some((p) => p.player_id === playerId))
      await supabase!.from('event_media_players').insert(missing.map((m) => ({ media_id: m.id, player_id: playerId })))
    }
    setBusy(false)
    reload()
  }

  const removeSelected = async () => {
    if (!window.confirm(t('events.remove.confirm', { n: picked.length }))) return
    setBusy(true)
    await removeMedia(picked)
    setSelected(new Set())
    setBusy(false)
    reload()
  }

  const deleteEvent = async () => {
    if (!window.confirm(t('events.delete.confirm'))) return
    if (!(await removeMedia(media))) return window.alert(t('common.error.generic'))
    await supabase!.from('events').delete().eq('id', event.id)
    onDeleted()
  }

  return (
    <section className="page" ref={top}>
      <button type="button" className="link back" onClick={onBack}>
        ← {t('events.back')}
      </button>
      <div className="page-head">
        <div>
          <p className="event-date">{event.ends_on ? `${event.starts_on} → ${event.ends_on}` : event.starts_on}</p>
          <h1>{event.name}</h1>
          <p className="lede">
            {[t(`events.kind.${event.kind}`), event.sub_brand, event.opponent && `vs ${event.opponent}`, event.location].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="entity-meta">
          {canEdit && (
            <button type="button" className="btn btn-small" onClick={onEdit}>
              {t('events.edit')}
            </button>
          )}
          {isAdmin && (
            <button type="button" className="btn btn-small btn-danger" onClick={() => void deleteEvent()}>
              {t('events.delete')}
            </button>
          )}
        </div>
      </div>

      {canAdd && (
        <DropZone
          accept={ACCEPT}
          multiple
          folders
          concurrency={3}
          onUpload={(file) =>
            uploadToLibrary(file, {
              library: 'events',
              event_id: event.id,
              name: displayName(file),
            })
          }
          onDone={reload}
        />
      )}

      {media.length === 0 ? (
        <p className="empty">{t('events.noMedia')}</p>
      ) : (
        <>
          <div className="filters">
            <label className="field field-narrow-l">
              <span>{t('events.show')}</span>
              <select value={show} onChange={(e) => setShow(e.target.value)}>
                <option value="">{t('events.show.all')}</option>
                <option value="untagged">{t('events.show.untagged')}</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.ign}
                  </option>
                ))}
              </select>
            </label>
            {canAdd && (
              <div className="select-actions">
                <span className="cell-sub">{t('events.select.count', { n: selected.size })}</span>
                <button type="button" className="btn btn-small" onClick={() => setSelected(new Set(shown.map((m) => m.id)))}>
                  {t('events.select.all')}
                </button>
                {selected.size > 0 && (
                  <button type="button" className="btn btn-small" onClick={() => setSelected(new Set())}>
                    {t('events.select.clear')}
                  </button>
                )}
              </div>
            )}
          </div>
          {canAdd && <p className="hint">{t('events.select.hint')}</p>}
          {canAdd && selected.size > 0 && (
            <div className="tag-panel" role="region" aria-label={t('events.tag.title')}>
              <p>
                <strong>{t('events.tag.title')}</strong> <span className="cell-sub">{t('events.tag.hint')}</span>
              </p>
              {notMine > 0 && <p className="hint">{t('events.tag.notMine', { n: notMine })}</p>}
              {players.length === 0 && <p className="hint">{t('events.tag.noPlayers')}</p>}
              <div className="chip-row">
                {players.map((p) => {
                  const on = picked.length > 0 && picked.every((m) => m.event_media_players.some((x) => x.player_id === p.id))
                  return (
                    <button key={p.id} type="button" className="chip-toggle" aria-pressed={on} disabled={busy} onClick={() => void toggleTag(p.id)}>
                      {p.ign}
                    </button>
                  )
                })}
              </div>
              <button type="button" className="link danger" disabled={busy} onClick={() => void removeSelected()}>
                {t('events.remove')}
              </button>
            </div>
          )}
          <MediaGrid
            media={shown}
            urls={urls}
            playerNames={names}
            selected={canAdd ? selected : undefined}
            onSelect={canAdd ? setSelected : undefined}
          />
        </>
      )}
      {dialog}
    </section>
  )
}

const EventForm = ({ draft, onClose, onSaved }: { draft: Draft | null; onClose: () => void; onSaved: (id: string) => void }) => {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (draft) ref.current?.showModal()
    else ref.current?.close()
  }, [draft])
  return (
    <dialog ref={ref} className="dialog" onClose={onClose}>
      {draft && <EventFields initial={draft} onClose={onClose} onSaved={onSaved} />}
    </dialog>
  )
}

const EventFields = ({ initial, onClose, onSaved }: { initial: Draft; onClose: () => void; onSaved: (id: string) => void }) => {
  const { t } = usePrefs()
  const [form, setForm] = useState<Draft>(initial)
  const [error, setError] = useState<MessageKey | null>(null)
  const [teams, setTeams] = useState<string[]>([])

  useEffect(() => {
    let live = true
    void loadSubBrands().then((b) => live && setTeams(b))
    return () => {
      live = false
    }
  }, [])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return setError('events.form.missing')
    const row = {
      name: form.name.trim().replace(/\s+/g, ' '),
      kind: form.kind,
      starts_on: form.starts_on || today(),
      ends_on: form.ends_on && form.ends_on >= form.starts_on ? form.ends_on : null,
      sub_brand: form.sub_brand || null,
      opponent: form.opponent.trim() || null,
      location: form.location.trim() || null,
    }
    const res = form.id
      ? await supabase!.from('events').update(row).eq('id', form.id).select('id').single()
      : await supabase!.from('events').insert(row).select('id').single()
    if (res.error || !res.data) return setError('common.error.generic')
    onSaved(res.data.id as string)
  }

  return (
    <form className="stack" onSubmit={(e) => void save(e)} noValidate>
      <h2>{form.id ? t('events.edit') : t('events.new')}</h2>
      <label className="field">
        <span>{t('events.form.name')}</span>
        <input value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
      </label>
      <p className="hint">{t('events.form.nameHint')}</p>
      <div className="row-form">
        <label className="field">
          <span>{t('events.filter.kind')}</span>
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as EventKind })}>
            {EVENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`events.kind.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('events.form.subBrand')}</span>
          <select value={form.sub_brand} onChange={(e) => setForm({ ...form, sub_brand: e.target.value })}>
            <option value="">{t('events.form.none')}</option>
            {teams.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="row-form">
        <label className="field">
          <span>{t('events.form.date')}</span>
          <input type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} />
        </label>
        <label className="field">
          <span>{t('events.form.endDate')}</span>
          <input type="date" value={form.ends_on} min={form.starts_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} />
        </label>
      </div>
      <div className="row-form">
        <label className="field">
          <span>{t('events.form.opponent')}</span>
          <input value={form.opponent} maxLength={80} onChange={(e) => setForm({ ...form, opponent: e.target.value })} />
        </label>
        <label className="field">
          <span>{t('events.form.location')}</span>
          <input value={form.location} maxLength={120} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </label>
      </div>
      {error && <ErrorNote>{t(error)}</ErrorNote>}
      <div className="dialog-actions">
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn btn-primary">
          {t('library.save')}
        </button>
      </div>
    </form>
  )
}
