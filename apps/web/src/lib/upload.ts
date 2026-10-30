import type { MessageKey } from '@onic/shared'
import { supabase } from './supabase'

export type UploadTarget =
  | { library: 'brand'; kind: string; brand?: string; variant?: string | null; name: string; replaces?: string }
  | { library: 'players'; player_id: string; kind: string; name: string; replaces?: string }
  | { library: 'sponsors'; sponsor_id: string; kind: string; name: string; replaces?: string }

export interface UploadOutcome {
  ok: boolean
  /** Plain-language reason when refused. */
  message?: MessageKey
  detail?: Record<string, string | number>
}

const REJECTION_KEYS: Record<string, MessageKey> = {
  wrong_type: 'upload.error.wrong_type',
  too_large: 'upload.error.too_large',
  too_small: 'upload.error.too_small',
  too_big_pixels: 'upload.error.too_big_pixels',
  no_transparency: 'upload.error.no_transparency',
  unsafe_svg: 'upload.error.unsafe_svg',
  unsafe_pdf: 'upload.error.unsafe_pdf',
  bad_font: 'upload.error.bad_font',
  unreadable: 'upload.error.unreadable',
  animated: 'upload.error.animated',
}

/** Name shown in the library: the file name without its extension. */
export const displayName = (file: File) => file.name.replace(/\.[^.]+$/, '').slice(0, 160) || 'Untitled'

/**
 * Sends a file to the private staging area, then asks the server to check it and move it into the library.
 * Nothing reaches a library without passing the server's checks.
 */
export const uploadToLibrary = async (file: File, target: UploadTarget): Promise<UploadOutcome> => {
  if (!supabase) return { ok: false, message: 'common.error.generic' }
  const video = target.library === 'players' && target.kind === 'video'
  if (file.size > (video ? 500 : 50) * 1024 * 1024) return { ok: false, message: 'upload.error.too_large', detail: { max: video ? '500 MB' : '50 MB' } }
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) return { ok: false, message: 'common.error.generic' }

  const stagingPath = `${user.user.id}/${crypto.randomUUID()}`
  const { error: stageError } = await supabase.storage.from('staging').upload(stagingPath, file, {
    contentType: 'application/octet-stream',
    upsert: false,
  })
  if (stageError) return { ok: false, message: 'common.error.network' }

  const { error } = await supabase.functions.invoke('library-upload', { body: { ...target, staging_path: stagingPath } })
  if (!error) return { ok: true }
  const context = (error as { context?: Response }).context
  if (context && typeof context.json === 'function') {
    try {
      const payload = (await context.json()) as { error?: string; detail?: Record<string, string | number> }
      const key = payload.error ? REJECTION_KEYS[payload.error] : undefined
      if (key) return { ok: false, message: key, detail: payload.detail ?? {} }
    } catch {
      // fall through
    }
  }
  return { ok: false, message: 'common.error.generic' }
}

/** Short-lived links (10 minutes) to show private library files. */
export const signedUrls = async (bucket: 'brand' | 'players' | 'sponsors', paths: string[]): Promise<Record<string, string>> => {
  if (!supabase || paths.length === 0) return {}
  // PDFs are signed as downloads, so they never open as a page on the storage site.
  const pdfs = paths.filter((p) => p.endsWith('.pdf'))
  const others = paths.filter((p) => !p.endsWith('.pdf'))
  const [a, b] = await Promise.all([
    others.length ? supabase.storage.from(bucket).createSignedUrls(others, 600) : Promise.resolve({ data: [] }),
    pdfs.length ? supabase.storage.from(bucket).createSignedUrls(pdfs, 600, { download: true }) : Promise.resolve({ data: [] }),
  ])
  const out: Record<string, string> = {}
  for (const d of [...(a.data ?? []), ...(b.data ?? [])]) if (d.path && d.signedUrl) out[d.path] = d.signedUrl
  return out
}
