// Admin › Users: invite people, change their team and roles, turn accounts off and on,
// sign someone out everywhere, and send a fresh password link.
// Only Admins who signed in with two-step verification can call this.
import { z } from 'npm:zod@4.6.7'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import { isAllowedOrigin } from '../_shared/config.ts'
import { HttpError, handle, json } from '../_shared/http.ts'
import { audit, rateLimit, requireAdmin, serverClient } from '../_shared/supabase.ts'

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
  if (designer.length === 1 && (roles.includes('approver') || roles.includes('admin')))
    throw new HttpError(400, 'designer_and_approver', 'A designer can’t also be an Admin or Approver — nobody approves their own work.')
}

/** Turns database refusals from the people-management functions into plain language. */
const fromDb = (error: { code?: string; hint?: string | null; message?: string }): HttpError => {
  if (error.hint === 'last_admin') return new HttpError(400, 'last_admin', 'ONIC Studio needs at least one Admin.')
  if (error.code === 'P0002') return new HttpError(404, 'not_found', 'That person no longer exists.')
  if (error.code === '22023') return new HttpError(400, 'invalid_roles', 'That combination of team and role isn’t allowed.')
  if (error.code === '23505') return new HttpError(409, 'exists', 'Someone with this email already has an account.')
  return new HttpError(500, 'server_error', 'Something went wrong on our side. Try again in a minute.')
}

const revokeSessions = async (db: SupabaseClient, userId: string): Promise<number> => {
  const { data, error } = await db.rpc('revoke_user_sessions', { p_user: userId })
  if (error) throw fromDb(error)
  return data as number
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
        const { data: existing } = await db.from('profiles').select('id').eq('email', email).maybeSingle()
        if (existing) throw new HttpError(409, 'exists', 'Someone with this email already has an account.')

        const { data: invited, error } = await db.auth.admin.inviteUserByEmail(email, {
          redirectTo: linkTarget(req),
          data: { full_name: body.full_name },
        })
        if (error || !invited.user) throw new HttpError(400, 'invite_failed', 'The invite couldn’t be sent. Check the email address.')
        const userId = invited.user.id

        const { error: pErr } = await db.rpc('admin_create_profile', {
          p_actor: caller.id, p_user: userId, p_email: email, p_full_name: body.full_name, p_team: body.team, p_roles: roles,
        })
        if (pErr) {
          await db.auth.admin.deleteUser(userId)
          throw fromDb(pErr)
        }
        return json(req, 200, { ok: true, user_id: userId })
      }

      case 'update': {
        if (body.roles) notSelf(caller.id, body.user_id, 'change the roles of')
        if (body.roles && body.team !== undefined) checkTeamAndRoles(body.team, [...new Set(body.roles)])
        const { data: rolesChanged, error } = await db.rpc('admin_update_user', {
          p_actor: caller.id,
          p_user: body.user_id,
          p_full_name: body.full_name ?? null,
          p_team_set: body.team !== undefined,
          p_team: body.team ?? null,
          p_roles: body.roles ? [...new Set(body.roles)] : null,
        })
        if (error) throw fromDb(error)
        // New permissions must not ride on an old session.
        if (rolesChanged) await revokeSessions(db, body.user_id)
        return json(req, 200, { ok: true })
      }

      case 'disable': {
        notSelf(caller.id, body.user_id, 'turn off')
        // Database first: it refuses if this would leave no active Admin, and ends their sessions.
        const { error } = await db.rpc('admin_set_disabled', { p_actor: caller.id, p_user: body.user_id, p_disabled: true })
        if (error) throw fromDb(error)
        const { error: bErr } = await db.auth.admin.updateUserById(body.user_id, { ban_duration: '876000h' })
        if (bErr) throw bErr
        return json(req, 200, { ok: true })
      }

      case 'enable': {
        const { error } = await db.rpc('admin_set_disabled', { p_actor: caller.id, p_user: body.user_id, p_disabled: false })
        if (error) throw fromDb(error)
        const { error: bErr } = await db.auth.admin.updateUserById(body.user_id, { ban_duration: 'none' })
        if (bErr) throw bErr
        return json(req, 200, { ok: true })
      }

      case 'sign_out_everywhere': {
        const sessions = await revokeSessions(db, body.user_id)
        await audit(db, caller.id, 'user.signed_out_everywhere', body.user_id, { sessions })
        return json(req, 200, { ok: true, sessions })
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
