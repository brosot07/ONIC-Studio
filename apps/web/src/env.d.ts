/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public project URL, e.g. https://<ref>.supabase.co. Not a secret. */
  readonly VITE_SUPABASE_URL?: string
  /** Publishable (client) key. Safe to ship; RLS protects the data. Never the secret key. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
