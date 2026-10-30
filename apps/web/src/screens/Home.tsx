import { MAKE_OPTIONS, TEAMS, type MessageKey, type Team } from '@onic/shared'
import { usePrefs } from '../lib/prefs'
import { Setup } from './Setup'
import type { Page } from './Shell'

/**
 * "What do you want to make?" — big cards for the person's team (both teams for Admin/Approver).
 * Cards are previews until the agent team arrives in Phase 5 and 7.
 */
export const Home = ({ team, isAdmin, onNavigate }: { team: Team | null; isAdmin: boolean; onNavigate: (page: Page) => void }) => {
  const { t } = usePrefs()
  const teams: readonly Team[] = team ? [team] : TEAMS

  return (
    <section className="page">
      {isAdmin && <Setup onNavigate={onNavigate} />}
      <h1>{t('home.title')}</h1>
      <p className="lede">{t('home.soon')}</p>
      {teams.map((tm) => (
        <div key={tm} className="make-group">
          {!team && <h2 className="make-team">{t(`home.team.${tm}`)}</h2>}
          <ul className="make-grid">
            {MAKE_OPTIONS[tm].map((id) => (
              <li key={id}>
                <button type="button" className="make-card" disabled aria-describedby={`make-${id}-hint`}>
                  <span className="make-title">{t(`make.${id}` as MessageKey)}</span>
                  <span className="make-hint" id={`make-${id}-hint`}>
                    {t(`make.${id}.hint` as MessageKey)}
                  </span>
                  <span className="make-badge">{t('home.badge.soon')}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
