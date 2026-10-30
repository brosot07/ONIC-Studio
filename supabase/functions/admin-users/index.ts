// Admin › Users: invite people, change their team and roles, turn accounts off and on,
// sign someone out everywhere, and send a fresh password link.
// Only Admins who signed in with two-step verification can call this.
import { z } from 'npm:zod@4.6.7'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import { isAllowedOrigin } from '../_shared/config.ts'
import { HttpError, handle, json } from '../_shared/http.ts'
import { audit, rateLimit, requireAdmin, serverClient } from '../_shared/supabase.ts'

const ORG_ID = '00000000-0000-4000-8000-000000000001'
const role = z.enum(['admin', 'approver', 'social_designer', 'merch_designer'])
const team = z.enum(['social', 'merch']).nullable()
const uuid = z.uuid()
const name = z.string().trim().min(1).max(120)

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('invite'), email: z.email().max(320), full_name: name, team, roles: z.array(role).min(1).max(4) }),
  z.object({ action: z.literal('update'), user_id: uuid, full_name: name.optional(), team: team.optional(), roles: z.array(role).min(1).max(4).optional() }),
  z.object({ action: z.literal('disable'), user_id: uuid }),
  z.object({ action: z.literal('enable'), user_id: uuid }),
  z.object({ action: z.literal('sign_out_everywhere'), user_id: uuid }),
  z.object({ action: z.literal('send_password_link'), user_id: uuid }),
])
type Body = z.infer<typeof Body>

/** A designer works in exactly one team, and the team must match the designer role. */
const checkTeamAndRoles = (teamSlug: 'social' | 'merch' | null, roles: string[]) => {
  const designer = roles.filter((r) => r.endsWith('_designer'))
  if (designer.length > 1) throw new HttpError(400, 'one_team', 'A person can be a designer in one team only.')
  if (designer[0] === 'social_designer' && teamSlug !== 'social')
    throw new HttpError(400, 'team_mismatch', 'A Social Designer must be in the Social Media team.')
  if (designer[0] === 'merch_designer' && teamSlug !== 'merch')
    throw new HttpError(400, 'team_mismatch', 'A Merch Designer must be in the Merchandise team.')
  if (designer.length === 0 && teamSlug !== null)
    throw new HttpError(400, 'team_without_role', 'Only designers belong to a team. Admins and Approvers see both teams.')
}

const teamId = async (db: SupabaseClient, slug: 'social' | 'merch' | null): Promise<string | null> => {
  if (!slug) return null
  const { data, error } = await db.from('teams').select('id').eq('slug', slug).single()
  if (error) throw error
  return data.id as string
}

const adminCount = async (db: SupabaseClient): Promise<number> => {
  const { data, error } = await db.from('user_roles').select('user_id, profiles!inner(disabled)').eq('role', 'admin').eq('profiles.disabled', false)
  if (error) throw error
  return data.length
}

const linkTarget = (req: Request): string => {
  const origin = req.headers.get('Origin')
  if (!isAllowedOrigin(origin)) throw new HttpError(403, 'origin', 'Open ONIC Studio from its usual address and try again.')
  return `${origin}/auth/confirm`
}

const notSelf = (callerId: string, userId: string, what: string) => {
  if (callerId === userId) throw new HttpError(400, 'self', `You can’t ${what} your own account. Ask the other Admin.`)
}

Deno.serve(
  handle(async (req) => {
    const db = serverClient()
    const caller = await requireAdmin(req, db)
    await rateLimit(db, caller.id, 'admin-users', 30, 60)

    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new HttpError(400, 'invalid', 'Some details are missing or not valid. Check the form and try again.')
    const body: Body = parsed.data

    switch (body.action) {
      case 'invite': {
        const roles = [...new Set(body.roles)]
        checkTeamAndRoles(body.team, roles)
        const email = body.email.toLowerCase()
        const { data: existing } = await db.from('profiles').select('id').ilike('email', email).maybeSingle()
        if (existing) throw new HttpError(409, 'exists', 'Someone with this email already has an account.')

        const { data: invited, error } = await db.auth.admin.inviteUserByEmail(email, {
          redirectTo: linkTarget(req),
          data: { full_name: body.full_name },
        })
        if (error || !invited.user) throw new HttpError(400, 'invite_failed', 'The invite couldn’t be sent. Check the email address.')
        const userId = invited.user.id

        try {
          const tid = await teamId(db, body.team)
          const { error: pErr } = await db.from('profiles').insert({ id: userId, org_id: ORG_ID, team_id: tid, full_name: body.full_name, email })
          if (pErr) throw pErr
          const { error: rErr } = await db.from('user_roles').insert(roles.map((r) => ({ user_id: userId, role: r })))
          if (rErr) throw rErr
          const { error: iErr } = await db.from('invitations').insert({ email, user_id: userId, roles, team_id: tid, invited_by: caller.id })
          if (iErr) throw iErr
        } catch (e) {
          await db.auth.admin.deleteUser(userId)
          throw e
        }
        await audit(db, caller.id, 'user.invited', userId, { roles, team: body.team })
        return json(req, 200, { ok: true, user_id: userId })
      }

      case 'update': {
        const { data: current, error } = await db.from('profiles').select('team_id, teams(slug)').eq('id', body.user_id).maybeSingle()
        if (error) throw error
        if (!current) throw new HttpError(404, 'not_found', 'That person no longer exists.')
        const { data: currentRoles } = await db.from('user_roles').select('role').eq('user_id', body.user_id)
        const roles = body.roles ? [...new Set(body.roles)] : (currentRoles ?? []).map((r) => r.role as string)
        const currentSlug = ((current as unknown as { teams: { slug: 'social' | 'merch' } | null }).teams?.slug ?? null)
        const nextTeam = body.team === undefined ? currentSlug : body.team
        checkTeamAndRoles(nextTeam, roles)

        const hadAdmin = (currentRoles ?? []).some((r) => r.role === 'admin')
        if (hadAdmin && !roles.includes('admin')) {
          notSelf(caller.id, body.user_id, 'remove Admin from')
          if ((await adminCount(db)) <= 1) throw new HttpError(400, 'last_admin', 'ONIC Studio needs at least one Admin.')
        }

        const patch: Record<string, unknown> = {}
        if (body.full_name) patch['full_name'] = body.full_name
        if (body.team !== undefined) patch['team_id'] = await teamId(db, body.team)
        if (Object.keys(patch).length) {
          const { error: uErr } = await db.from('profiles').update(patch).eq('id', body.user_id)
          if (uErr) throw uErr
        }
        if (body.roles) {
          const before = new Set((currentRoles ?? []).map((r) => r.role as string))
          const remove = [...before].filter((r) => !roles.includes(r))
          const add = roles.filter((r) => !before.has(r))
          if (remove.length) {
            const { error: dErr } = await db.from('user_roles').delete().eq('user_id', body.user_id).in('role', remove)
            if (dErr) throw dErr
          }
          if (add.length) {
            const { error: aErr } = await db.from('user_roles').insert(add.map((r) => ({ user_id: body.user_id, role: r })))
            if (aErr) throw aErr
          }
          // New permissions must not ride on an old session.
          if (remove.length || add.length) await db.rpc('revoke_user_sessions', { p_user: body.user_id })
        }
        await audit(db, caller.id, 'user.updated', body.user_id, { team: nextTeam, roles })
        return json(req, 200, { ok: true })
      }

      case 'disable': {
        notSelf(caller.id, body.user_id, 'turn off')
        const { data: target } = await db.from('user_roles').select('role').eq('user_id', body.user_id).eq('role', 'admin')
        if (target?.length && (await adminCount(db)) <= 1) throw new HttpError(400, 'last_admin', 'ONIC Studio needs at least one Admin.')
        const { error: bErr } = await db.auth.admin.updateUserById(body.user_id, { ban_duration: '876000h' })
        if (bErr) throw bErr
        const { error } = await db.from('profiles').update({ disabled: true }).eq('id', body.user_id)
        if (error) throw error
        await db.rpc('revoke_user_sessions', { p_user: body.user_id })
        return json(req, 200, { ok: true })
      }

      case 'enable': {
        const { error: bErr } = await db.auth.admin.updateUserById(body.user_id, { ban_duration: 'none' })
        if (bErr) throw bErr
        const { error } = await db.from('profiles').update({ disabled: false }).eq('id', body.user_id)
        if (error) throw error
        return json(req, 200, { ok: true })
      }

      case 'sign_out_everywhere': {
        const { data, error } = await db.rpc('revoke_user_sessions', { p_user: body.user_id })
        if (error) throw error
        await audit(db, caller.id, 'user.signed_out_everywhere', body.user_id, { sessions: data })
        return json(req, 200, { ok: true, sessions: data })
      }

      case 'send_password_link': {
        const { data: profile } = await db.from('profiles').select('email, disabled').eq('id', body.user_id).maybeSingle()
        if (!profile) throw new HttpError(404, 'not_found', 'That person no longer exists.')
        if (profile.disabled) throw new HttpError(400, 'disabled', 'Turn this account back on first.')
        const { error } = await db.auth.resetPasswordForEmail(profile.email as string, { redirectTo: linkTarget(req) })
        if (error) throw new HttpError(400, 'send_failed', 'The email couldn’t be sent. Try again in a minute.')
        await audit(db, caller.id, 'user.password_link_sent', body.user_id)
        return json(req, 200, { ok: true })
      }
    }
  }),
)
