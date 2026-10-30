# Security

Report anything suspicious to the ONIC Studio Admins. Never paste a key, token or password into an issue, commit,
chat or log.

## Rules that never bend

- No secret in the browser, the repo or the logs. Third-party keys and tokens live in **Supabase Vault** and are read only
  inside **Edge Functions**. The Supabase **secret key** exists only in the Edge Function environment. The web app ships
  only the public project URL and the **publishable** key; row-level security protects the data.
- Signing in is invite-only. Public sign-up is off. Admin and Approver must use two-step sign-in (TOTP); from Phase 1
  privileged actions are enforced in the database with `aal2` (restrictive RLS policies). Not yet in place in Phase 0.
- Publishing is a database state machine (`DRAFT → … → APPROVED → SCHEDULED → PUBLISHED`). Only an Approver with two-step
  sign-in can approve, and only an Edge Function can publish.
- AI agents run server-side, treat all web content, uploads and AI output as data (never instructions), and have no tool
  that publishes, deletes, changes permissions or spends beyond budget.

## Database access (Phase 1)

- Every table in `public` has RLS on (a test fails if one doesn't). Default privileges are revoked, so new tables are
  unreachable until a migration grants access explicitly.
- A **restrictive** policy on every table requires an active account and, for Admin/Approver, a two-step (`aal2`)
  session. Admin and Approver see nothing at all until they enter their code.
- Designers see only their own team's jobs and teammates. Admin and Approver see both teams.
- Nobody approves or finalises their own job, and a designer can't also be an Admin or Approver.
- Designers can't set or raise a job's credit budget, its owner or its timestamps; the server does.
- Jobs change state only through `transition_job()`. QC results, scheduling and publishing are server-only;
  approving, rejecting (with a required note) and finalising need the Approver role with `aal2`. Direct writes to
  `state`, `team_id` or `created_by` are blocked by column grants and a trigger.
- `audit_log` and `job_transitions` reject edits and deletes through the API and from ordinary database sessions
  (a database owner could still disable the trigger; that's what point-in-time backups and the restore drill cover). Logins, role and team changes,
  approvals, invitations, account on/off and "sign out everywhere" are recorded.
- The first Admin is created once with `private.bootstrap_admin()` from the SQL editor; it refuses to run again.
- Tests: `supabase/tests/database/*.test.sql` (48 checks across every role) and `tests/e2e-local` (sign-in
  journeys in a real browser). Supabase advisors must report no issues.

## Asset libraries (Phase 2)

- Brand, Players and Sponsors: Admins (with `aal2`) edit, everyone else reads. Designers never see players who are
  inactive, haven't consented or whose image rights expired, nor sponsors whose contract isn't running; the
  matching files can't be opened either (storage policies follow the same rows). QC will block them too.
- Files live in private buckets. Browsers only get 10-minute signed links. Admins upload into their own folder of a
  private `staging` bucket; nothing reaches a library except through `library-upload`.
- `library-upload` identifies files by their bytes (never the name or browser-supplied type) and enforces size limits.
  - PNG/JPG: the declared size is read from the header *before* decoding (no decompression bombs), animated PNGs
    are refused, and images are decoded and re-encoded (stripping metadata and anything appended). Player cutouts
    need real transparency (also a database check).
  - SVG: parsed as XML and **rebuilt from an allow-list** of SVG elements and attributes. Scripts, event handlers,
    `foreignObject`, animation, `<style>`, prefixed/namespaced elements, CSS escapes, character references in values
    and any link outside the file are dropped; document-type declarations are refused. Parsing is linear-time.
    SVGs are shown through `<img>` only.
  - PDF: names are decoded (`#xx` escapes) and compressed streams unpacked (100 MB cap) before checking for
    JavaScript, launch, attachments, rich media, form submission, remote documents or XFA. PDFs are offered as
    downloads, never opened as a page on the storage site.
  - Fonts: table directory checks only (fonts are stored, not rendered by the browser, until Phase 4).
  - Player videos (MP4/MOV, up to 500 MB): too large to rebuild on the server, so only the first 4 KB are read and
    must be an ISO media `ftyp` box with an expected brand; the file is then streamed into the `players` bucket
    with a fixed `video/mp4` or `video/quicktime` type and only ever played through `<video>` (CSP `media-src` is
    the project's storage host only). Accepted risk: content after the header isn't validated; only Admins with
    two-step sign-in can upload.
- Sub-brands are a table: everyone reads, only an Admin with `aal2` adds, renames or removes (pgTAP-tested).
- Library rows can't be repointed at another file; a new version can only replace a file of the same owner and kind,
  versions are unique per lineage, and replacements are serialised. Every change is in the audit log.
- Older versions stay readable to the people who can see the current one (version history). A signed link made just
  before a player is hidden keeps working for at most 10 minutes.
- Spreadsheet imports store text as typed. Any future export to CSV must prefix cells starting with `= + - @` with `'`.
- The image decoder (`jsr:@matmen/imagescript@1.3.1`, by its author) is pinned; it loads its WebAssembly codec from
  jsr.io at that pinned version.

## Server functions

`admin-users` (invite, change team/role, turn account off/on, sign out everywhere, password link): verifies the
sign-in token, re-reads roles from the database, requires Admin + `aal2`, validates input with zod, rate-limits to 30
changes a minute, writes the audit log, and only answers allowlisted web origins. Admins can't turn off or demote
themselves, and the last Admin can't be removed: every people change runs in one locked database transaction
(`admin_create_profile`, `admin_update_user`, `admin_set_disabled`), so two Admins acting at once can't race past
the check. Audit entries name the Admin who acted. Changing someone's roles ends their sessions.

Password reset from an email link can't bypass two-step sign-in: Supabase refuses a password change from a reset
session (`insufficient_aal`) when the account has an authenticator — checked against the local stack.

Sign-in links in emails carry their one-time code after `#`, so it never reaches the web server's logs, and the app
removes it from the address bar immediately. Idle sign-out ends only this browser's session and counts activity in
any open ONIC Studio tab.

## Web app hardening (Phase 0)

Production headers are set in `apps/web/vercel.json` and mirrored by `vite preview`, so the browser tests check the real
values:

| Header | Value / purpose |
|---|---|
| Content-Security-Policy | `default-src 'none'`; scripts and styles only from our own origin (no inline, no eval); network only to ONIC's Supabase project; no frames; `frame-ancestors 'none'` |
| Strict-Transport-Security | 2 years, subdomains, preload |
| X-Frame-Options | `DENY` |
| X-Content-Type-Options | `nosniff` |
| Referrer-Policy | `no-referrer` |
| Cross-Origin-Opener-Policy / Resource-Policy | `same-origin` |
| Permissions-Policy | camera, microphone, location, payment, USB, clipboard-read all off |

Also: no `dangerouslySetInnerHTML` (lint rule), no `eval`/`new Function` (lint rules), React escapes all text.

Idle timeout: the app signs the user out after 30 minutes without mouse, keyboard or touch input
(`apps/web/src/lib/idle.ts`). The server-side inactivity timeout alone isn't enough, because an open tab keeps
refreshing its token.

Auth settings (`supabase/config.toml`; pushed to the hosted project in Phase 1, with a drift check): sign-up off, anonymous sign-in off,
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
| 0 | CSP allows any `*.supabase.co` host, so stolen data could be sent to another Supabase project | Fixed — CSP names only `yjwmdwuhrjuvafgfvdsc.supabase.co`; a browser test checks another project is blocked |
| 0 | Hosted Supabase auth settings can differ from `config.toml` | Deploy workflow pushes `config.toml` (with the production address) on every deploy; **pending** the Vercel address (`SITE_URL`) |
| 0 | Semgrep registry rules are fetched at run time and can change | Accepted: they only add checks; the scanner image itself is pinned by digest |
| 0 | Skipped CodeQL/dependency-review jobs count as passing | Branch protection requires `verify`, `secrets` and `sast` explicitly |
| 0 | `npm ci` could run a compromised package's install script | `ignore-scripts=true` in `.npmrc`; Dependabot waits 7 days before proposing new versions |
| 0 | Skill vendoring could follow symlinks or accept a fork-only commit or a non-permissive extra licence | Script rejects symlinks, requires the commit to be on upstream's default branch, and fails on extra licence files |
| 1 | Local Edge Runtime in the build sandbox can't load npm packages through its TLS proxy | Local-only: functions were exercised under Deno directly; CI runs the real runtime |
| 1 | Supabase's "sign out everywhere" API needs the user's own token | `revoke_user_sessions()` (server-only) deletes the user's sessions; access tokens expire within 5 minutes |
| 1 | Approver could approve own job; designer could set a budget; last-Admin race; audit actor missing; session-revoke errors ignored; idle sign-out was global and per-tab; email token in query string; deploy secrets visible to every step; SITE_URL unchecked | Fixed (independent review) — covered by new database checks and browser journeys |
| 1 | Production web address missing from the Edge Function origin allowlist | **Pending** Vercel address |
| 1 | Hosted advisor 0029: `my_access` and `transition_job` were SECURITY DEFINER in the exposed schema | Privileged bodies moved to `private`; `public` keeps SECURITY INVOKER wrappers with the same names |
| 1 | The deploy token (`SUPABASE_ACCESS_TOKEN`) has full access to the ONIC Studio project, broader than the deploy needs | Accepted by the Admin for now; it lives only in the protected `production` environment. Narrow it at the next 90-day rotation |
| 2 | Storage policies compared the asset's display name instead of the file path, so no one could open player files | Fixed before release (caught by the new library tests) |
| 2 | Newest imagescript releases (3.x) were published days ago | Pinned to 1.3.1 (2025) until newer versions have settled |
| 2 | Independent review: SVG checks bypassable (namespaced `script`, character references, CSS escapes), quadratic regex, PDF names/compressed streams, image decompression bomb, unchecked version replacement | Fixed: allow-list SVG rebuild, PDF unpack + name decoding + download-only, header size check before decode, replacement checks + unique versions + lock; every bypass is a unit test |
