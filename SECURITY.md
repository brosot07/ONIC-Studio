# Security

Report anything suspicious to the ONIC Studio Admins. Never paste a key, token or password into an issue, commit,
chat or log.

## Rules that never bend

- No secret in the browser, the repo or the logs. Third-party keys and tokens live in **Supabase Vault** and are read only
  inside **Edge Functions**. The Supabase **secret key** exists only in the Edge Function environment. The web app ships
  only the public project URL and the **publishable** key; row-level security protects the data.
- Signing in is invite-only. Public sign-up is off. Admin and Approver must use two-step sign-in (TOTP); privileged
  actions are enforced in the database with `aal2`.
- Publishing is a database state machine (`DRAFT → … → APPROVED → SCHEDULED → PUBLISHED`). Only an Approver with two-step
  sign-in can approve, and only an Edge Function can publish.
- AI agents run server-side, treat all web content, uploads and AI output as data (never instructions), and have no tool
  that publishes, deletes, changes permissions or spends beyond budget.

## Web app hardening (Phase 0)

Production headers are set in `apps/web/vercel.json` and mirrored by `vite preview`, so the browser tests check the real
values:

| Header | Value / purpose |
|---|---|
| Content-Security-Policy | `default-src 'none'`; scripts and styles only from our own origin (no inline, no eval); network only to Supabase; no frames; `frame-ancestors 'none'` |
| Strict-Transport-Security | 2 years, subdomains, preload |
| X-Frame-Options | `DENY` |
| X-Content-Type-Options | `nosniff` |
| Referrer-Policy | `no-referrer` |
| Cross-Origin-Opener-Policy / Resource-Policy | `same-origin` |
| Permissions-Policy | camera, microphone, location, payment, USB, clipboard-read all off |

Also: no `dangerouslySetInnerHTML` (lint rule), no `eval`/`new Function` (lint rules), React escapes all text.

Auth settings (`supabase/config.toml`, mirrored on the hosted project in Phase 1): sign-up off, anonymous sign-in off,
12+ character passwords with upper/lower/digit/symbol, access tokens expire after 5 minutes, refresh-token rotation,
30-minute inactivity timeout, 12-hour session limit, TOTP on.

## CI checks

| Check | Where | Blocks merge |
|---|---|---|
| `npm audit --audit-level=high` | ci.yml | yes |
| Typecheck, lint, unit tests, build, browser tests | ci.yml | yes |
| gitleaks 8.30.1 (checksum-verified binary) over full history | ci.yml | yes |
| Semgrep (TypeScript, React, secrets, GitHub Actions rules) | ci.yml | yes |
| CodeQL (security-extended) | codeql.yml | yes, once enabled* |
| Dependency review | dependency-review.yml | yes, once enabled* |
| Dependabot (npm + Actions, weekly) | dependabot.yml | — |

All Actions are pinned to commit SHAs; workflows default to `contents: read`; checkout never keeps credentials.

\* CodeQL, dependency review, secret scanning and push protection on a **private** repo need GitHub's paid Code Security
/ Secret Protection. They're switched on with the repo variable `GHAS_ENABLED=true`. Until then gitleaks and Semgrep
cover the same ground in CI.

## Reviewed findings

| Phase | Finding | Decision |
|---|---|---|
| 0 | Supabase Edge Functions get only a few seconds of processing time per call, which may not be enough for server-side rendering of posts | Verify in Phase 4; fallback is a Vercel function that holds no third-party secrets |
| 0 | Supabase session is stored in browser storage, so an XSS could read it | Mitigated by a strict CSP (no inline/eval, no third-party scripts), React escaping, the no-raw-HTML lint rule, 5-minute access tokens and the 30-minute idle timeout |
| 0 | Electronegativity no longer applies (moved from desktop to web) | Replaced by header + CSP browser tests and Semgrep |
