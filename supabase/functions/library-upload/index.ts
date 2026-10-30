// Library uploads: an Admin drops a file into their staging folder, then calls this function.
// The file is identified by its bytes, checked for its purpose (a player cutout must be transparent, an SVG
// must not contain code, …), re-encoded when it's an image, and only then moved into the library.
import { z } from 'npm:zod@4.6.7'
import { HttpError, handle, json } from '../_shared/http.ts'
import { rateLimit, requireAdmin, requireCaller, serverClient } from '../_shared/supabase.ts'
import { checkFont, checkPdf, MIME, processRaster, Rejected, sniff, sniffVideo, type FileType } from './checks.ts'
import { cleanSvg } from './svg.ts'

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
    kind: z.enum(['cutout', 'headshot', 'action', 'video']),
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
  z.object({
    library: z.literal('events'),
    staging_path: z.string().max(300),
    event_id: uuid,
    name,
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
  'players:video': { types: ['mp4', 'mov'] },
  'sponsors:logo_light': { types: ['svg', 'png'], minShortSide: 256 },
  'sponsors:logo_dark': { types: ['svg', 'png'], minShortSide: 256 },
  'sponsors:logo_mono': { types: ['svg', 'png'], minShortSide: 256 },
  'sponsors:guideline': { types: ['pdf'] },
}

/** Event files: Admins with two-step sign-in, or Social designers. Roles come from the database, never the browser. */
const requireEventUploader = async (req: Request, db: ReturnType<typeof serverClient>) => {
  const caller = await requireCaller(req, db)
  if (caller.roles.includes('admin') && caller.aal === 'aal2') return caller
  if (caller.roles.includes('social_designer') && (caller.aal === 'aal2' || !caller.roles.some((r) => r === 'admin' || r === 'approver'))) return caller
  throw new HttpError(403, 'not_allowed', 'Only Admins and Social designers can add event photos.')
}

const MAX_FILE = 50 * 1024 * 1024
const MAX_VIDEO = 500 * 1024 * 1024

const LABEL: Record<FileType, string> = {
  png: 'PNG', jpeg: 'JPG', webp: 'WebP', svg: 'SVG', pdf: 'PDF', otf: 'OTF', ttf: 'TTF', woff: 'WOFF', woff2: 'WOFF2',
  mp4: 'MP4', mov: 'MOV',
}

/** Reads only the first 4 KB of a staged file (even if storage ignores the range) and its total size. */
const readHead = async (db: ReturnType<typeof serverClient>, stagingPath: string) => {
  const { data: signed, error: signErr } = await db.storage.from('staging').createSignedUrl(stagingPath, 300)
  if (signErr || !signed) throw new Rejected('missing')
  const head = await fetch(signed.signedUrl, { headers: { Range: 'bytes=0-4095' } })
  if (!head.ok || !head.body) throw new Rejected('missing')
  const total = Number(head.headers.get('content-range')?.split('/')[1] ?? head.headers.get('content-length') ?? 0)
  const reader = head.body.getReader()
  const first = new Uint8Array(4096)
  let got = 0
  while (got < first.length) {
    const { done, value } = await reader.read()
    if (done) break
    const take = value.subarray(0, first.length - got)
    first.set(take, got)
    got += take.length
  }
  await reader.cancel()
  return { url: signed.signedUrl, first: first.subarray(0, got), total }
}

/** Downloads a staged file, refusing it as soon as it passes `max` bytes (never buffers more than that). */
const readCapped = async (url: string, max: number, maxLabel: string): Promise<Uint8Array> => {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Rejected('missing')
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) {
      await reader.cancel()
      throw new Rejected('too_large', { max: maxLabel })
    }
    parts.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/**
 * Videos are checked by their first bytes and size, then streamed from staging into a library bucket
 * without loading the whole file into memory. While streaming, the first bytes must still be the ones that
 * were checked (the file can't be swapped in between) and the size limit is enforced on what actually flows.
 */
const streamVideo = async (
  db: ReturnType<typeof serverClient>,
  head: Awaited<ReturnType<typeof readHead>>,
  type: 'mp4' | 'mov',
  bucket: 'players' | 'events',
  pathNoExt: string,
) => {
  if (!head.total) throw new Rejected('unreadable')
  if (head.total > MAX_VIDEO) throw new Rejected('too_large', { max: '500 MB' })
  const full = await fetch(head.url)
  if (!full.ok || !full.body) throw new Rejected('missing')
  const expected = head.first.subarray(0, 64)
  let seen = 0
  let problem: Rejected | null = null
  const guard = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      for (let i = 0; i < chunk.length && seen + i < expected.length; i++) {
        if (chunk[i] !== expected[seen + i]) problem = new Rejected('wrong_type', { allowed: 'MP4, MOV' })
      }
      seen += chunk.length
      if (seen > MAX_VIDEO) problem = new Rejected('too_large', { max: '500 MB' })
      if (problem) throw problem
      ctl.enqueue(chunk)
    },
  })
  const path = `${pathNoExt}.${type}`
  const { error } = await db.storage.from(bucket).upload(path, full.body.pipeThrough(guard), { contentType: MIME[type], upsert: false, duplex: 'half' })
  if (problem || error) {
    await db.storage.from(bucket).remove([path])
    throw problem ?? error
  }
  return { path, mime: MIME[type], bytes: seen }
}

/** Downloads a staged image (at most 50 MB, checked before and during the download), then checks and rebuilds it. */
const rebuildImage = async (head: Awaited<ReturnType<typeof readHead>>, types: FileType[], minShortSide: number, thumb?: number) => {
  if (head.total > MAX_FILE) throw new Rejected('too_large', { max: '50 MB' })
  const original = await readCapped(head.url, MAX_FILE, '50 MB')
  if (original.length === 0) throw new Rejected('unreadable')
  const type = sniff(original)
  if (!type || !types.includes(type)) throw new Rejected('wrong_type', { allowed: types.map((t) => LABEL[t]).join(', ') })
  return {
    type,
    original,
    raster: type === 'png' || type === 'jpeg' ? await processRaster(original, type, { minShortSide, thumb, maxBytes: MAX_FILE }) : null,
  }
}

/** Event photos and videos: Admins (with two-step sign-in) and Social designers. */
const addEventFile = async (req: Request, db: ReturnType<typeof serverClient>, body: Extract<Body, { library: 'events' }>, caller: { id: string }) => {
  const head = await readHead(db, body.staging_path)
  const video = sniffVideo(head.first)
  if (video) {
    // Videos are big: a tighter limit per minute and per day than photos.
    await rateLimit(db, caller.id, 'event-video', 30, 60)
    await rateLimit(db, caller.id, 'event-video-day', 300, 86400)
  }
  let out: { path: string; mime: string; bytes: number; width: number | null; height: number | null; kind: 'photo' | 'video'; thumb?: string }
  if (video) {
    out = { ...(await streamVideo(db, head, video, 'events', `${body.event_id}/${crypto.randomUUID()}`)), width: null, height: null, kind: 'video' }
  } else {
    const r = await rebuildImage(head, ['jpeg', 'png'], 600, 480)
    if (!r.raster) throw new Rejected('wrong_type', { allowed: 'JPG, PNG, MP4, MOV' })
    const ext = r.raster.type === 'jpeg' ? 'jpg' : 'png'
    const id = crypto.randomUUID()
    const path = `${body.event_id}/${id}.${ext}`
    const thumb = `${body.event_id}/${id}.thumb.jpg`
    const { error } = await db.storage.from('events').upload(path, r.raster.bytes, { contentType: MIME[r.raster.type], upsert: false })
    if (error) throw error
    const { error: thumbErr } = await db.storage.from('events').upload(thumb, r.raster.thumb!, { contentType: 'image/jpeg', upsert: false })
    if (thumbErr) {
      await db.storage.from('events').remove([path])
      throw thumbErr
    }
    out = { path, mime: MIME[r.raster.type], bytes: r.raster.bytes.length, width: r.raster.width, height: r.raster.height, kind: 'photo', thumb }
  }
  const { data: id, error: regErr } = await db.rpc('event_add_media', {
    p_actor: caller.id,
    p_row: { event_id: body.event_id, kind: out.kind, name: body.name, path: out.path, thumb_path: out.thumb ?? null, mime: out.mime, bytes: out.bytes, width: out.width, height: out.height },
  })
  if (regErr) {
    await db.storage.from('events').remove(out.thumb ? [out.path, out.thumb] : [out.path])
    throw regErr
  }
  return json(req, 200, { ok: true, id, path: out.path })
}

Deno.serve(
  handle(async (req) => {
    const db = serverClient()
    const parsed = Body.safeParse(await req.json().catch(() => null))
    // Event files may come from Social designers too; every other library is Admin-only.
    const caller = parsed.success && parsed.data.library === 'events' ? await requireEventUploader(req, db) : await requireAdmin(req, db)
    if (!parsed.success) throw new HttpError(400, 'invalid', 'Some details are missing or not valid.')
    const body: Body = parsed.data
    // Bulk uploads from a match day can be a few hundred files.
    await rateLimit(db, caller.id, body.library === 'events' ? 'event-upload' : 'library-upload', body.library === 'events' ? 300 : 60, 60)

    // Only the caller's own staging folder, no path tricks.
    const prefix = `${caller.id}/`
    if (!body.staging_path.startsWith(prefix) || body.staging_path.includes('..') || body.staging_path.split('/').length !== 2) {
      throw new HttpError(400, 'invalid', 'Some details are missing or not valid.')
    }
    const removeStaged = () => db.storage.from('staging').remove([body.staging_path])

    try {
      if (body.library === 'events') {
        const res = await addEventFile(req, db, body, caller)
        await removeStaged()
        return res
      }
      if (body.library === 'players' && body.kind === 'video') {
        const head = await readHead(db, body.staging_path)
        const video = sniffVideo(head.first)
        if (!video) throw new Rejected('wrong_type', { allowed: 'MP4, MOV' })
        const out = await streamVideo(db, head, video, 'players', `${body.player_id}/video/${crypto.randomUUID()}`)
        const { data: id, error: regErr } = await db.rpc('library_add_file', {
          p_actor: caller.id,
          p_library: 'players',
          p_row: { kind: 'video', name: body.name, path: out.path, mime: out.mime, bytes: out.bytes, width: null, height: null, player_id: body.player_id, tags: body.tags, has_alpha: false },
          p_replaces: body.replaces ?? null,
        })
        if (regErr) {
          await db.storage.from('players').remove([out.path])
          throw regErr
        }
        await removeStaged()
        return json(req, 200, { ok: true, id, path: out.path })
      }

      const head = await readHead(db, body.staging_path)
      if (head.total > MAX_FILE) throw new Rejected('too_large', { max: '50 MB' })
      const original = await readCapped(head.url, MAX_FILE, '50 MB')
      if (original.length === 0) throw new Rejected('unreadable')

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
        const r = await processRaster(original, type, { minShortSide: rule.minShortSide ?? 1, needsTransparency: rule.transparent, maxBytes: MAX_FILE })
        ;({ bytes, width, height, hasAlpha } = r)
        finalType = r.type
      } else if (type === 'svg') bytes = cleanSvg(original)
      else if (type === 'pdf') await checkPdf(original)
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
