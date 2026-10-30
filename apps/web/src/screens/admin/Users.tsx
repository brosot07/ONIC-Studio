import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ROLES, type MessageKey, type Role, type Team } from '@onic/shared'
import { supabase } from '../../lib/supabase'
import { usePrefs } from '../../lib/prefs'
import { callFunction } from '../../lib/access'
import { ErrorNote, OkNote } from '../../ui/Notice'

interface Person {
  id: string
  full_name: string
  email: string
  disabled: boolean
  last_sign_in_at: string | null
  team: Team | null
  roles: Role[]
}

type Draft = { id?: string; full_name: string; email: string; team: Team | null; roles: Role[] }

const emptyDraft: Draft = { full_name: '', email: '', team: 'social', roles: ['social_designer'] }

const fetchPeople = async (): Promise<Person[] | null> => {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, disabled, last_sign_in_at, teams(slug), user_roles(role)')
    .order('full_name')
  if (error) return null
  return (data ?? []).map((p) => ({
    id: p.id as string,
    full_name: p.full_name as string,
    email: p.email as string,
    disabled: p.disabled as boolean,
    last_sign_in_at: p.last_sign_in_at as string | null,
    team: (p.teams as unknown as { slug: Team } | null)?.slug ?? null,
    roles: ((p.user_roles as unknown as { role: Role }[]) ?? []).map((r) => r.role),
  }))
}

export const Users = ({ meId }: { meId: string }) => {
  const { t } = usePrefs()
  const [people, setPeople] = useState<Person[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<MessageKey | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)

  const load = useCallback(async () => {
    const result = await fetchPeople()
    if (result) setPeople(result)
    else setError(t('common.error.generic'))
  }, [t])

  useEffect(() => {
    let cancelled = false
    void fetchPeople().then((result) => {
      if (cancelled) return
      if (result) setPeople(result)
      else setError(t('common.error.generic'))
    })
    return () => {
      cancelled = true
    }
  }, [t])

  useEffect(() => {
    if (draft) dialog.current?.showModal()
    else dialog.current?.close()
  }, [draft])

  const act = async (body: Record<string, unknown>, done: MessageKey) => {
    setBusy(true)
    setError(null)
    setOk(null)
    const result = await callFunction('admin-users', body)
    setBusy(false)
    if (result.message !== undefined || result.data === undefined) {
      setError(result.message ?? t('common.error.generic'))
      return false
    }
    setOk(done)
    await load()
    return true
  }

  const submitDraft = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    const ok = draft.id
      ? await act({ action: 'update', user_id: draft.id, full_name: draft.full_name, team: draft.team, roles: draft.roles }, 'admin.users.form.saved')
      : await act({ action: 'invite', email: draft.email, full_name: draft.full_name, team: draft.team, roles: draft.roles }, 'admin.users.form.sent')
    if (ok) setDraft(null)
  }

  const toggleRole = (role: Role) => {
    if (!draft) return
    const roles = draft.roles.includes(role) ? draft.roles.filter((r) => r !== role) : [...draft.roles, role]
    // Designer roles pick the team; only one designer role at a time.
    let next = roles
    let team = draft.team
    if (role === 'social_designer' && !draft.roles.includes(role)) {
      next = roles.filter((r) => r !== 'merch_designer')
      team = 'social'
    }
    if (role === 'merch_designer' && !draft.roles.includes(role)) {
      next = roles.filter((r) => r !== 'social_designer')
      team = 'merch'
    }
    if (!next.some((r) => r.endsWith('_designer'))) team = null
    setDraft({ ...draft, roles: next, team })
  }

  const status = (p: Person): MessageKey =>
    p.disabled ? 'admin.users.status.off' : p.last_sign_in_at ? 'admin.users.status.active' : 'admin.users.status.invited'

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>{t('admin.users.title')}</h1>
          <p className="lede">{t('admin.users.lede')}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setDraft({ ...emptyDraft })}>
          {t('admin.users.invite')}
        </button>
      </div>

      {ok && <OkNote>{t(ok)}</OkNote>}
      {error && !draft && <ErrorNote>{error}</ErrorNote>}

      {people && people.length === 0 && <p className="empty">{t('admin.users.empty')}</p>}
      {people && people.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t('admin.users.col.name')}</th>
              <th scope="col">{t('admin.users.col.team')}</th>
              <th scope="col">{t('admin.users.col.roles')}</th>
              <th scope="col">{t('admin.users.col.status')}</th>
              <th scope="col">
                <span className="visually-hidden">{t('admin.users.edit')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className={p.disabled ? 'is-off' : undefined}>
                <td>
                  <strong className="cell-name">{p.full_name}</strong>
                  <span className="cell-sub">{p.email}</span>
                </td>
                <td>{t(p.team ? `shell.team.${p.team}` : 'shell.team.all')}</td>
                <td>{p.roles.map((r) => t(`role.${r}`)).join(', ')}</td>
                <td>
                  <span className={`pill pill-${status(p).split('.').pop()}`}>{t(status(p))}</span>
                </td>
                <td>
                  <div className="row-actions">
                  <button type="button" className="btn btn-small" disabled={busy}
                    onClick={() => setDraft({ id: p.id, full_name: p.full_name, email: p.email, team: p.team, roles: p.roles })}>
                    {t('admin.users.edit')}
                  </button>
                  {!p.disabled && (
                    <button type="button" className="btn btn-small" disabled={busy}
                      onClick={() => void act({ action: 'send_password_link', user_id: p.id }, 'admin.users.passwordLink.done')}>
                      {t('admin.users.passwordLink')}
                    </button>
                  )}
                  <button type="button" className="btn btn-small" disabled={busy}
                    onClick={() => void act({ action: 'sign_out_everywhere', user_id: p.id }, 'admin.users.signOutEverywhere.done')}>
                    {t('admin.users.signOutEverywhere')}
                  </button>
                  {p.id !== meId &&
                    (p.disabled ? (
                      <button type="button" className="btn btn-small" disabled={busy}
                        onClick={() => void act({ action: 'enable', user_id: p.id }, 'admin.users.form.saved')}>
                        {t('admin.users.enable')}
                      </button>
                    ) : (
                      <button type="button" className="btn btn-small btn-danger" disabled={busy}
                        onClick={() => window.confirm(t('admin.users.disable.confirm')) && void act({ action: 'disable', user_id: p.id }, 'admin.users.form.saved')}>
                        {t('admin.users.disable')}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <dialog ref={dialog} className="dialog" onClose={() => setDraft(null)}>
        {draft && (
          <form className="stack" onSubmit={(e) => void submitDraft(e)} noValidate>
            <h2>{draft.id ? t('admin.users.edit') : t('admin.users.invite')}</h2>
            <label className="field">
              <span>{t('admin.users.form.name')}</span>
              <input value={draft.full_name} onChange={(e) => setDraft({ ...draft, full_name: e.target.value })} required maxLength={120} />
            </label>
            {!draft.id && (
              <label className="field">
                <span>{t('admin.users.form.email')}</span>
                <input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} required />
              </label>
            )}
            <fieldset className="field">
              <legend>{t('admin.users.form.roles')}</legend>
              {ROLES.map((role) => (
                <label key={role} className="check">
                  <input type="checkbox" checked={draft.roles.includes(role)} onChange={() => toggleRole(role)} />
                  {t(`role.${role}`)}
                </label>
              ))}
            </fieldset>
            <p className="hint">
              {t('admin.users.form.team')}: {t(draft.team ? `shell.team.${draft.team}` : 'admin.users.form.team.none')}
            </p>
            <p className="hint">{t('admin.users.mfaNote')}</p>
            {error && <ErrorNote>{error}</ErrorNote>}
            <div className="dialog-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setDraft(null)}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || draft.roles.length === 0 || !draft.full_name.trim()}>
                {busy ? t('common.working') : draft.id ? t('common.save') : t('admin.users.form.send')}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </section>
  )
}
