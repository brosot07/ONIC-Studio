// Library uploads: an Admin drops a file into their staging folder, then calls this function.
// The file is identified by its bytes, checked for its purpose (a player cutout must be transparent, an SVG
// must not contain code, …), re-encoded when it's an image, and only then moved into the library.
import { z } from 'npm:zod@4.6.7'
import { HttpError, handle, json } from '../_shared/http.ts'
import { rateLimit, requireAdmin, serverClient } from '../_shared/supabase.ts'
import { checkFont, checkPdf, checkSvg, MIME, processRaster, Rejected, sniff, type FileType } from './checks.ts'

const uuid = z.uuid()
const name = z.string().trim().min(1).max(160)
const tags = z.array(z.string().trim().min(1).max(40)).max(20).default([])

const Body = z.discriminatedUnion('library', [
  z.object({
    library: z.literal('brand'),
    staging_path: z.string().max(300),
    kind: z.enum(['logo', 'font', 'background', 'texture', 'template', 'guideline', 'other']),
    brand: z.string().trim().min(1).max(60).default('ONIC'),
    variant: z.string().regex(/^[a-z_]{1,30}$/).nullable().default(null),
    name,
    tags,
    replaces: uuid.optional(),
  }),
  z.object({
    library: z.literal('players'),
    staging_path: z.string().max(300),
    player_id: uuid,
    kind: z.enum(['cutout', 'headshot', 'action']),
    name,
    tags,
    replaces: uuid.optional(),
  }),
  z.object({
    library: z.literal('sponsors'),
    staging_path: z.string().max(300),
    sponsor_id: uuid,
    kind: z.enum(['logo_light', 'logo_dark', 'logo_mono', 'guideline']),
    name,
    replaces: uuid.optional(),
  }),
])
type Body = z.infer<typeof Body>

/** Which file types each slot accepts, and the shortest side an image needs. */
const RULES: Record<string, { types: FileType[]; minShortSide?: number; transparent?: boolean }> = {
  'brand:logo': { types: ['svg', 'png'], minShortSide: 256 },
  'brand:font': { types: ['otf', 'ttf', 'woff', 'woff2'] },
  'brand:background': { types: ['png', 'jpeg'], minShortSide: 1080 },
  'brand:texture': { types: ['png', 'jpeg'], minShortSide: 512 },
  'brand:template': { types: ['png', 'jpeg', 'svg', 'pdf'], minShortSide: 1080 },
  'brand:guideline': { types: ['pdf'] },
  'brand:other': { types: ['png', 'jpeg', 'svg', 'pdf'], minShortSide: 256 },
  'players:cutout': { types: ['png'], minShortSide: 800, transparent: true },
  'players:headshot': { types: ['jpeg', 'png'], minShortSide: 600 },
  'players:action': { types: ['jpeg', 'png'], minShortSide: 800 },
  'sponsors:logo_light': { types: ['svg', 'png'], minShortSide: 256 },
  'sponsors:logo_dark': { types: ['svg', 'png'], minShortSide: 256 },
  'sponsors:logo_mono': { types: ['svg', 'png'], minShortSide: 256 },
  'sponsors:guideline': { types: ['pdf'] },
}

const LABEL: Record<FileType, string> = {
  png: 'PNG', jpeg: 'JPG', webp: 'WebP', svg: 'SVG', pdf: 'PDF', otf: 'OTF', ttf: 'TTF', woff: 'WOFF', woff2: 'WOFF2',
}

Deno.serve(
  handle(async (req) => {
    const db = serverClient()
    const caller = await requireAdmin(req, db)
    await rateLimit(db, caller.id, 'library-upload', 60, 60)

    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new HttpError(400, 'invalid', 'Some details are missing or not valid.')
    const body: Body = parsed.data

    // Only the caller's own staging folder, no path tricks.
    const prefix = `${caller.id}/`
    if (!body.staging_path.startsWith(prefix) || body.staging_path.includes('..') || body.staging_path.split('/').length !== 2) {
      throw new HttpError(400, 'invalid', 'Some details are missing or not valid.')
    }
    const removeStaged = () => db.storage.from('staging').remove([body.staging_path])

    try {
      const { data: blob, error: dlErr } = await db.storage.from('staging').download(body.staging_path)
      if (dlErr || !blob) throw new Rejected('missing')
      const original = new Uint8Array(await blob.arrayBuffer())
      if (original.length === 0) throw new Rejected('unreadable')
      if (original.length > 50 * 1024 * 1024) throw new Rejected('too_large', { max: '50 MB' })

      const rule = RULES[`${body.library}:${body.kind}`]!
      const type = sniff(original)
      if (!type || !rule.types.includes(type)) {
        throw new Rejected('wrong_type', { allowed: rule.types.map((t) => LABEL[t]).join(', ') })
      }

      // Check (and for images, rebuild) the file.
      let bytes: Uint8Array = original
      let finalType: FileType = type
      let width: number | null = null
      let height: number | null = null
      let hasAlpha = false
      if (type === 'png' || type === 'jpeg') {
        const r = await processRaster(original, type, { minShortSide: rule.minShortSide ?? 1, needsTransparency: rule.transparent })
        ;({ bytes, width, height, hasAlpha } = r)
        finalType = r.type
      } else if (type === 'svg') checkSvg(original)
      else if (type === 'pdf') checkPdf(original)
      else checkFont(original, type)

      const ext = finalType === 'jpeg' ? 'jpg' : finalType
      const owner = body.library === 'players' ? body.player_id : body.library === 'sponsors' ? body.sponsor_id : body.kind
      const path = `${owner}/${body.kind}/${crypto.randomUUID()}.${ext}`

      const { error: upErr } = await db.storage.from(body.library).upload(path, bytes, { contentType: MIME[finalType], upsert: false })
      if (upErr) throw upErr

      const row: Record<string, unknown> = {
        kind: body.kind, name: body.name, path, mime: MIME[finalType], bytes: bytes.length, width, height,
      }
      if (body.library === 'brand') Object.assign(row, { brand: body.brand, variant: body.variant, tags: body.tags })
      if (body.library === 'players') Object.assign(row, { player_id: body.player_id, tags: body.tags, has_alpha: hasAlpha })
      if (body.library === 'sponsors') Object.assign(row, { sponsor_id: body.sponsor_id })

      const { data: id, error: regErr } = await db.rpc('library_add_file', {
        p_actor: caller.id, p_library: body.library, p_row: row, p_replaces: body.replaces ?? null,
      })
      if (regErr) {
        await db.storage.from(body.library).remove([path])
        throw regErr
      }
      await removeStaged()
      return json(req, 200, { ok: true, id, path, width, height })
    } catch (err) {
      await removeStaged()
      if (err instanceof Rejected) {
        // 422: the file was understood and refused. The app turns `code` into a plain-language message.
        return json(req, 422, { error: err.code, detail: err.detail, message: err.code })
      }
      throw err
    }
  }),
)
