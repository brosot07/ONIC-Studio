import type { ReactNode } from 'react'
import { PrefsBar } from './PrefsBar'

/** Yellow wordmark panel on the left, the form on the right. Used by every sign-in step. */
export const AuthLayout = ({ children }: { children: ReactNode }) => (
  <div className="login">
    <section className="login-brand" aria-hidden="true">
      <p className="wordmark">
        <span>ONIC</span>
        <span>Studio</span>
      </p>
    </section>
    <section className="login-panel">
      <PrefsBar />
      <div className="login-form">{children}</div>
    </section>
  </div>
)
