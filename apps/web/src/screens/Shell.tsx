import { useState, type ReactNode } from 'react'
import type { MessageKey } from '@onic/shared'
import type { Access } from '../lib/access'
import { usePrefs } from '../lib/prefs'
import { PrefsBar } from '../ui/PrefsBar'

export type Page = 'home' | 'brand' | 'players' | 'events' | 'sponsors' | 'admin-users'

const LIBRARY: { id: Page; label: MessageKey }[] = [
  { id: 'brand', label: 'shell.brand' },
  { id: 'players', label: 'shell.players' },
  { id: 'events', label: 'shell.events' },
  { id: 'sponsors', label: 'shell.sponsors' },
]

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
  const inLibrary = LIBRARY.some((l) => l.id === page)
  const [libraryOpen, setLibraryOpen] = useState(inLibrary)
  const item = (id: Page, label: MessageKey, extra = '') => (
    <button key={id} type="button" className={`nav-item${extra}`} aria-current={page === id ? 'page' : undefined} onClick={() => onNavigate(id)}>
      {t(label)}
    </button>
  )

  return (
    <div className="shell">
      <aside className="sidebar">
        <p className="sidebar-mark">ONIC Studio</p>
        <nav aria-label="ONIC Studio">
          {item('home', 'shell.home')}
          <button
            type="button"
            className="nav-item nav-group"
            aria-expanded={libraryOpen || inLibrary}
            aria-controls="nav-library"
            onClick={() => setLibraryOpen(!(libraryOpen || inLibrary))}
          >
            {t('shell.library')}
            <span className="nav-caret" aria-hidden="true" />
          </button>
          {(libraryOpen || inLibrary) && (
            <div id="nav-library" className="nav-sub">
              {LIBRARY.map((l) => item(l.id, l.label, ' nav-subitem'))}
            </div>
          )}
          {isAdmin && item('admin-users', 'shell.admin.users')}
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
