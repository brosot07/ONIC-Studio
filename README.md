# ONIC Studio

A web app for ONIC Esports' Design department. Social and merch designers order Instagram content and merchandise
designs from a team of AI agents; the Head of Design approves every job before it's scheduled or marked final.
Designers never see prompts, model names or API settings.

## How it fits together

- **apps/web** — the website designers sign in to (React + Vite, hosted on Vercel). Holds no secrets: only the public
  Supabase URL and publishable key.
- **supabase/** — database schema, row-level security, Edge Functions, scheduled jobs. Every third-party key and token
  lives in Supabase Vault and is read only inside Edge Functions. The AI agents run here, not in the browser.
- **packages/shared** — job states, roles and every word shown to designers (Bahasa Indonesia + English).
- **skills-vendor/** — permissively licensed agent skills, pinned to exact commits. See `skills-vendor/NOTICES.md`.

## Local development

Requirements: Node.js 22.12+, Docker (for local Supabase).

```bash
npm ci
cp apps/web/.env.example apps/web/.env   # public URL + publishable key only
npm run dev                              # http://localhost:5173
```

Checks (the same ones CI runs):

```bash
npm audit --audit-level=high
npm run typecheck
npm run lint
npm test
npm run test:e2e                          # builds, serves with production security headers, runs browser tests
```

Refresh bundled skills: `npm run vendor-skills` (update the commit pins in `scripts/vendor-skills.mjs` first).

## Build phases

0 Setup · 1 Auth, roles, RLS · 2 Asset libraries · 3 Claude proxy, Higgsfield, budgets · 4 Layout engine + match-day
templates · 5 Social agent pipeline, QC, approvals · 6 Instagram publishing + Analyst · 7 Merch flow · 8 Domain, guides,
threat model, pentest checklist.

Security rules and reviewed findings: [SECURITY.md](SECURITY.md).
