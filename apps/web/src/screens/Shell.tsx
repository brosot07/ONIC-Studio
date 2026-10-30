import type { ReactNode } from 'react'
import type { MessageKey } from '@onic/shared'
import type { Access } from '../lib/access'
import { usePrefs } from '../lib/prefs'
import { PrefsBar } from '../ui/PrefsBar'

export type Page = 'home' | 'brand' | 'players' | 'sponsors' | 'admin-users'

export const Shell = ({
  access,
  page,
  onNavigate,
  onSignOut,
  children,
}: {
  access: Access
  page: Page
  onNavigate: (page: Page) => void
  onSignOut: () => void
  children: ReactNode
}) => {
  const { t } = usePrefs()
  const isAdmin = access.roles.includes('admin')
  const teamLabel: MessageKey = access.team ? `shell.team.${access.team}` : 'shell.team.all'
  const nav: { id: Page; label: MessageKey; show: boolean }[] = [
    { id: 'home', label: 'shell.home', show: true },
    { id: 'brand', label: 'shell.brand', show: true },
    { id: 'players', label: 'shell.players', show: true },
    { id: 'sponsors', label: 'shell.sponsors', show: true },
    { id: 'admin-users', label: 'shell.admin.users', show: isAdmin },
  ]

  return (
    <div className="shell">
      <aside className="sidebar">
        <p className="sidebar-mark">ONIC Studio</p>
        <nav aria-label="ONIC Studio">
          {nav
            .filter((n) => n.show)
            .map((n) => (
              <button key={n.id} type="button" className="nav-item" aria-current={page === n.id ? 'page' : undefined} onClick={() => onNavigate(n.id)}>
                {t(n.label)}
              </button>
            ))}
        </nav>
        <div className="sidebar-foot">
          <p className="me">
            <strong>{access.fullName}</strong>
            <span>{t(teamLabel)}</span>
            <span>{access.roles.map((r) => t(`role.${r}`)).join(', ')}</span>
          </p>
          <button type="button" className="btn btn-quiet" onClick={onSignOut}>
            {t('login.signOut')}
          </button>
        </div>
      </aside>
      <main className="content">
        <div className="content-top">
          <PrefsBar />
        </div>
        {children}
      </main>
    </div>
  )
}
