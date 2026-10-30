# ONIC Studio — working rules

- Never write a secret (API key, token, password, Supabase secret key) into a file, commit, log or chat. Secrets go in
  Supabase Vault or GitHub Secrets only. The web app may only hold the public Supabase URL and publishable key.
- Everything a designer sees is plain language in Bahasa Indonesia and English (`packages/shared/src/i18n.ts`). No
  prompts, model names or API terms outside Admin screens.
- Every table gets RLS, deny-by-default (`auto_expose_new_tables = false`). Privileged actions require `aal2`.
- Agents and anything that needs a secret run in Supabase Edge Functions, never in the browser.
- Before pushing: `npm audit --audit-level=high && npm run typecheck && npm run lint && npm test && npm run test:e2e`.
- Phase plan and decisions: README.md, SECURITY.md.
