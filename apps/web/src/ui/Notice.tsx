import type { ReactNode } from 'react'

export const ErrorNote = ({ children }: { children: ReactNode }) => (
  <p className="form-error" role="alert">
    {children}
  </p>
)

export const OkNote = ({ children }: { children: ReactNode }) => (
  <p className="form-ok" role="status">
    {children}
  </p>
)
