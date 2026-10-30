import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { SPONSOR_ACCEPT, SPONSOR_ASSET_KINDS, SPONSOR_CSV_COLUMNS, type MessageKey } from '@onic/shared'
import { supabase } from '../../lib/supabase'
import { usePrefs } from '../../lib/prefs'
import { listCell } from '../../lib/csv'
import { loadSponsors, sponsorRunning, today, type Sponsor } from '../../lib/library'
import { displayName, signedUrls, uploadToLibrary } from '../../lib/upload'
import { DropZone } from '../../ui/DropZone'
import { ErrorNote } from '../../ui/Notice'
import { CsvImport } from './CsvImport'
import { FileTiles } from './FileTiles'

interface Draft {
  id?: string
  name: string
  tier: string
  instagram_handle: string
  contract_start: string
  contract_end: string
  monthly_deliverables: string
  mandatory_tags: string
  hashtags: string
  conflicts: string
  placement_rules: string
  min_logo_px: string
}

const empty: Draft = {
  name: '', tier: '', instagram_handle: '', contract_start: '', contract_end: '', monthly_deliverables: '',
  mandatory_tags: '', hashtags: '', conflicts: '', placement_rules: '', min_logo_px: '',
}

const fromSponsor = (s: Sponsor): Draft => ({
  id: s.id,
  name: s.name,
  tier: s.tier ?? '',
  instagram_handle: s.instagram_handle ?? '',
  contract_start: s.contract_start ?? '',
  contract_end: s.contract_end ?? '',
  monthly_deliverables: s.monthly_deliverables?.toString() ?? '',
  mandatory_tags: s.mandatory_tags.join(', '),
  hashtags: s.hashtags.join(', '),
  conflicts: s.conflicts.join(', '),
  placement_rules: s.placement_rules ?? '',
  min_logo_px: s.min_logo_px?.toString() ?? '',
})

const toRow = (d: Draft) => ({
  name: d.name.trim(),
  tier: d.tier.trim() || null,
  instagram_handle: d.instagram_handle.trim().replace(/^@/, '') || null,
  contract_start: d.contract_start || null,
  contract_end: d.contract_end || null,
  monthly_deliverables: d.monthly_deliverables ? Number(d.monthly_deliverables) : null,
  mandatory_tags: listCell(d.mandatory_tags),
  hashtags: listCell(d.hashtags),
  conflicts: listCell(d.conflicts),
  placement_rules: d.placement_rules.trim() || null,
  min_logo_px: d.min_logo_px ? Number(d.min_logo_px) : null,
})

export const useSponsors = () => {
  const [sponsors, setSponsors] = useState<Sponsor[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const fetchAll = useCallback(async () => {
    const s = await loadSponsors()
    return { s, u: await signedUrls('sponsors', s.flatMap((x) => x.sponsor_assets.map((a) => a.path))) }
  }, [])
  const reload = useCallback(() => void fetchAll().then((r) => (setSponsors(r.s), setUrls(r.u))), [fetchAll])
  useEffect(() => {
    let live = true
    void fetchAll().then((r) => live && (setSponsors(r.s), setUrls(r.u)))
    return () => {
      live = false
    }
  }, [fetchAll])
  return { sponsors, urls, reload }
}

const saveSponsorCsvRow = async (r: Record<string, string>): Promise<string | null> => {
  if (!r['name']) return 'name is required'
  for (const k of ['contract_start', 'contract_end']) {
    if (r[k] && !/^\d{4}-\d{2}-\d{2}$/.test(r[k]!)) return `${k} must look like 2027-12-31`
  }
  const { error } = await supabase!.from('sponsors').insert({
    ...toRow({
      name: r['name'],
      tier: r['tier'] ?? '',
      instagram_handle: r['instagram_handle'] ?? '',
      contract_start: r['contract_start'] ?? '',
      contract_end: r['contract_end'] ?? '',
      monthly_deliverables: r['monthly_deliverables'] ?? '',
      mandatory_tags: r['mandatory_tags'] ?? '',
      hashtags: r['hashtags'] ?? '',
      conflicts: r['conflicts'] ?? '',
      placement_rules: r['placement_rules'] ?? '',
      min_logo_px: r['min_logo_px'] ?? '',
    }),
    mentions: listCell(r['mentions']),
  })
  return error ? (error.code === '23505' ? 'already in the list' : 'could not be saved — check dates and numbers') : null
}

export const Sponsors = ({ isAdmin }: { isAdmin: boolean }) => {
  const { t } = usePrefs()
  const { sponsors, urls, reload } = useSponsors()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<MessageKey | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (draft) dialog.current?.showModal()
    else dialog.current?.close()
  }, [draft])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!draft || !draft.name.trim()) return setError('login.error.missing')
    const row = toRow(draft)
    const { error: dbError } = draft.id
      ? await supabase!.from('sponsors').update(row).eq('id', draft.id)
      : await supabase!.from('sponsors').insert(row)
    if (dbError) return setError('common.error.generic')
    setError(null)
    setDraft(null)
    reload()
  }

  const retire = async (id: string) => {
    await supabase!.from('sponsor_assets').update({ is_current: false }).eq('id', id)
    reload()
  }

  const field = (key: keyof Draft, label: MessageKey, type = 'text') =>
    draft && (
      <label className="field">
        <span>{t(label)}</span>
        <input type={type} value={draft[key] ?? ''} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
      </label>
    )

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>{t('sponsors.title')}</h1>
          <p className="lede">{t('sponsors.lede')}</p>
        </div>
        {isAdmin && (
          <button type="button" className="btn btn-primary" onClick={() => setDraft({ ...empty })}>
            {t('sponsors.add')}
          </button>
        )}
      </div>
      {!isAdmin && <p className="hint">{t('library.readOnly')}</p>}
      {isAdmin && (
        <CsvImport
          filename="onic-sponsors.csv"
          columns={SPONSOR_CSV_COLUMNS}
          example={['Brand name', 'Gold', 'brandhandle', '@brandhandle', '#ONICxBrand', '@brandhandle', '4', today(), '2027-12-31', 'Competitor A; Competitor B', 'Logo bottom-right', '120', '0.5']}
          save={saveSponsorCsvRow}
          onDone={reload}
        />
      )}
      {sponsors.length === 0 && <p className="empty">{t('library.empty')}</p>}
      <ul className="entity-list">
        {sponsors.map((s) => (
          <li key={s.id} className="entity">
            <div className="entity-head">
              <div>
                <strong className="cell-name">{s.name}</strong>
                <span className="cell-sub">
                  {[s.tier, s.instagram_handle && `@${s.instagram_handle}`, s.monthly_deliverables != null && `${s.monthly_deliverables} × ${t('sponsors.col.deliverables').toLowerCase()}`]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <div className="entity-meta">
                {(s.contract_start || s.contract_end) && (
                  <span className="pill">
                    {s.contract_start ?? '…'} → {s.contract_end ?? '…'}
                  </span>
                )}
                {!sponsorRunning(s) && (
                  <span className="pill pill-needed">
                    {s.contract_end && s.contract_end < today() ? t('sponsors.ended') : t('sponsors.notStarted')}
                  </span>
                )}
                {isAdmin && (
                  <button type="button" className="btn btn-small" onClick={() => setDraft(fromSponsor(s))}>
                    {t('admin.users.edit')}
                  </button>
                )}
              </div>
            </div>
            <FileTiles
              tiles={s.sponsor_assets.map((a) => ({ id: a.id, name: a.name, path: a.path, label: t(`sponsors.kind.${a.kind as 'logo_light'}`) }))}
              urls={urls}
              onRemove={isAdmin ? (tile) => void retire(tile.id) : undefined}
            />
            {isAdmin && (
              <div className="entity-drops">
                {SPONSOR_ASSET_KINDS.map((kind) => {
                  const current = s.sponsor_assets.find((a) => a.kind === kind)
                  return (
                    <div key={kind}>
                      <p className="drop-label">{t(`sponsors.kind.${kind}`)}</p>
                      <DropZone
                        accept={SPONSOR_ACCEPT[kind]}
                        multiple={false}
                        hasFile={Boolean(current)}
                        onUpload={(file) =>
                          uploadToLibrary(file, {
                            library: 'sponsors',
                            sponsor_id: s.id,
                            kind,
                            name: `${s.name} ${displayName(file)}`,
                            replaces: current?.lineage_id,
                          })
                        }
                        onDone={reload}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </li>
        ))}
      </ul>

      <dialog ref={dialog} className="dialog dialog-wide" onClose={() => setDraft(null)}>
        {draft && (
          <form className="stack" onSubmit={(e) => void save(e)} noValidate>
            <h2>{draft.id ? t('admin.users.edit') : t('sponsors.add')}</h2>
            {field('name', 'sponsors.form.name')}
            <div className="row-form">
              {field('tier', 'sponsors.form.tier')}
              {field('instagram_handle', 'sponsors.form.handle')}
            </div>
            <div className="row-form">
              {field('contract_start', 'sponsors.form.start', 'date')}
              {field('contract_end', 'sponsors.form.end', 'date')}
              {field('monthly_deliverables', 'sponsors.form.deliverables', 'number')}
            </div>
            {field('mandatory_tags', 'sponsors.form.tags')}
            {field('hashtags', 'sponsors.form.hashtags')}
            {field('conflicts', 'sponsors.form.conflicts')}
            <div className="row-form">
              {field('placement_rules', 'sponsors.form.rules')}
              {field('min_logo_px', 'sponsors.form.minLogo', 'number')}
            </div>
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
