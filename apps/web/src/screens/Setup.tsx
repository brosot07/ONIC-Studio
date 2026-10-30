import { BRAND_SLOTS, PLAYER_CSV_COLUMNS, type MessageKey } from '@onic/shared'
import { usePrefs } from '../lib/prefs'
import { playerUsable, sponsorRunning } from '../lib/library'
import { ReadyChip } from '../ui/Chip'
import { BrandSlotRow, slotAssets } from './library/BrandSlotRow'
import { useBrand } from './library/Brand'
import { CsvImport } from './library/CsvImport'
import { savePlayerCsvRow, usePlayers } from './library/Players'
import { useSponsors } from './library/Sponsors'
import type { Page } from './Shell'

const Item = ({
  title,
  hint,
  ready,
  optional,
  onOpen,
  children,
}: {
  title: string
  hint: string
  ready: boolean
  optional?: boolean
  onOpen?: () => void
  children?: React.ReactNode
}) => {
  const { t } = usePrefs()
  return (
    <div className="slot">
      <div className="slot-head">
        <h3>{title}</h3>
        <ReadyChip ready={ready} optional={optional} />
      </div>
      <p className="hint">{hint}</p>
      {children}
      {onOpen && (
        <button type="button" className="btn btn-small" onClick={onOpen}>
          {t('setup.open')}
        </button>
      )}
    </div>
  )
}

/** Admin checklist on Home: everything the design team needs, each with its own drop zone. */
export const Setup = ({ onNavigate }: { onNavigate: (page: Page) => void }) => {
  const { t } = usePrefs()
  const brand = useBrand()
  const { players, reload: reloadPlayers } = usePlayers()
  const { sponsors } = useSponsors()

  const activePlayers = players.filter(playerUsable)
  const withCutout = activePlayers.filter((p) => p.player_assets.some((a) => a.kind === 'cutout'))
  const runningSponsors = sponsors.filter(sponsorRunning)
  const withLogos = runningSponsors.filter(
    (s) => s.sponsor_assets.some((a) => a.kind === 'logo_light') && s.sponsor_assets.some((a) => a.kind === 'logo_dark'),
  )

  const checks: boolean[] = [
    ...BRAND_SLOTS.filter((s) => s.required).map((s) => slotAssets(s, brand.assets).length > 0),
    brand.colors.length > 0,
    brand.voices.some((v) => v.sample_captions.length >= 3),
    players.length > 0,
    activePlayers.length > 0 && withCutout.length === activePlayers.length,
    sponsors.length > 0,
    runningSponsors.length > 0 && withLogos.length === runningSponsors.length,
  ]
  const done = checks.filter(Boolean).length
  if (done === checks.length) return null

  const section = (key: MessageKey) => <h2 className="section-title">{t(key)}</h2>

  return (
    <section className="setup" aria-labelledby="setup-title">
      <div className="setup-head">
        <div>
          <h2 id="setup-title">{t('setup.title')}</h2>
          <p className="lede">{t('setup.lede')}</p>
        </div>
        <div className="setup-progress" role="img" aria-label={t('setup.progress', { done, total: checks.length })}>
          <span>{t('setup.progress', { done, total: checks.length })}</span>
          <span className="bar">
            <span style={{ width: `${(done / checks.length) * 100}%` }} />
          </span>
        </div>
      </div>

      {section('setup.section.brand')}
      <div className="slots">
        {BRAND_SLOTS.map((slot) => (
          <BrandSlotRow key={slot.id} slot={slot} assets={brand.assets} urls={brand.urls} isAdmin onChange={brand.reload} />
        ))}
        <Item title={t('setup.palette')} hint={t('setup.palette.hint')} ready={brand.colors.length > 0} onOpen={() => onNavigate('brand')} />
        <Item
          title={t('setup.voice')}
          hint={t('setup.voice.hint')}
          ready={brand.voices.some((v) => v.sample_captions.length >= 3)}
          onOpen={() => onNavigate('brand')}
        />
      </div>

      {section('setup.section.players')}
      <div className="slots">
        <Item title={t('setup.players.list')} hint={t('setup.players.list.hint')} ready={players.length > 0} onOpen={() => onNavigate('players')}>
          <CsvImport
            filename="onic-players.csv"
            columns={PLAYER_CSV_COLUMNS}
            example={['Name Surname', 'IGN', 'Gold Lane', 'ONIC ID MLBB', 'active', '2027-12-31', 'yes', '']}
            save={savePlayerCsvRow}
            onDone={reloadPlayers}
          />
        </Item>
        <Item
          title={t('setup.players.cutouts')}
          hint={t('setup.players.cutouts.hint', { done: withCutout.length, total: activePlayers.length })}
          ready={activePlayers.length > 0 && withCutout.length === activePlayers.length}
          onOpen={() => onNavigate('players')}
        />
      </div>

      {section('setup.section.sponsors')}
      <div className="slots">
        <Item title={t('setup.sponsors.list')} hint={t('setup.sponsors.list.hint')} ready={sponsors.length > 0} onOpen={() => onNavigate('sponsors')} />
        <Item
          title={t('setup.sponsors.logos')}
          hint={t('setup.sponsors.logos.hint', { done: withLogos.length, total: runningSponsors.length })}
          ready={runningSponsors.length > 0 && withLogos.length === runningSponsors.length}
          onOpen={() => onNavigate('sponsors')}
        />
      </div>
    </section>
  )
}
