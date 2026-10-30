// File checks for library uploads. Pure functions: bytes in, verdict out. Nothing here trusts the
// file name or the browser's content type — only the bytes.
import { decode, Image } from 'jsr:@matmen/imagescript@1.3.1'

export type FileType = 'png' | 'jpeg' | 'webp' | 'svg' | 'pdf' | 'otf' | 'ttf' | 'woff' | 'woff2'

export const MIME: Record<FileType, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  otf: 'font/otf',
  ttf: 'font/ttf',
  woff: 'font/woff',
  woff2: 'font/woff2',
}

/** A check failed. `code` maps to a plain-language message in the app; `detail` fills it in. */
export class Rejected extends Error {
  constructor(readonly code: string, readonly detail: Record<string, string | number> = {}) {
    super(code)
  }
}

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v)
const ascii = (b: Uint8Array, from: number, len: number) => String.fromCharCode(...b.subarray(from, from + len))

/** Identifies a file by its first bytes. */
export const sniff = (b: Uint8Array): FileType | null => {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp'
  if (ascii(b, 0, 5) === '%PDF-') return 'pdf'
  if (ascii(b, 0, 4) === 'OTTO') return 'otf'
  if (startsWith(b, [0x00, 0x01, 0x00, 0x00]) || ascii(b, 0, 4) === 'true') return 'ttf'
  if (ascii(b, 0, 4) === 'wOFF') return 'woff'
  if (ascii(b, 0, 4) === 'wOF2') return 'woff2'
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 2048)).replace(/^﻿/, '').trimStart()
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'svg'
  return null
}

/**
 * SVGs are text that browsers can execute. Anything that runs code or pulls in outside files is refused,
 * not cleaned up: a designer re-exports a plain SVG instead.
 */
export const checkSvg = (b: Uint8Array): void => {
  if (b.length > 2 * 1024 * 1024) throw new Rejected('too_large', { max: '2 MB' })
  const text = new TextDecoder('utf-8', { fatal: true }).decode(b)
  const unsafe = [
    /<script[\s>]/i,
    /<foreignObject[\s>]/i,
    /<(iframe|embed|object|audio|video|use\s[^>]*href\s*=\s*["'](?!#))/i,
    /\son[a-z]+\s*=/i,
    /javascript:/i,
    /<!ENTITY/i,
    /@import/i,
    /url\(\s*["']?(?!#|data:image\/(png|jpeg);)/i,
    /(?:xlink:)?href\s*=\s*["'](?!#|data:image\/(png|jpeg);)/i,
  ]
  if (unsafe.some((re) => re.test(text))) throw new Rejected('unsafe_svg')
}

/** PDFs can carry scripts, launch actions and attached files; refuse those. */
export const checkPdf = (b: Uint8Array): void => {
  if (b.length > 25 * 1024 * 1024) throw new Rejected('too_large', { max: '25 MB' })
  const text = new TextDecoder('latin1').decode(b)
  if (/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|OpenAction)\b/.test(text)) throw new Rejected('unsafe_pdf')
}

/** Basic structural check of a font file's table directory. */
export const checkFont = (b: Uint8Array, type: FileType): void => {
  if (b.length > 10 * 1024 * 1024) throw new Rejected('too_large', { max: '10 MB' })
  if (b.length < 64) throw new Rejected('bad_font')
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (type === 'otf' || type === 'ttf') {
    const numTables = view.getUint16(4)
    if (numTables < 4 || numTables > 64 || 12 + numTables * 16 > b.length) throw new Rejected('bad_font')
    for (let i = 0; i < numTables; i++) {
      const offset = view.getUint32(12 + i * 16 + 8)
      const length = view.getUint32(12 + i * 16 + 12)
      if (offset + length > b.length) throw new Rejected('bad_font')
    }
  } else {
    // WOFF/WOFF2 header: total length field must match the file.
    if (view.getUint32(8) !== b.length) throw new Rejected('bad_font')
  }
}

export interface RasterResult {
  bytes: Uint8Array
  type: 'png' | 'jpeg'
  width: number
  height: number
  hasAlpha: boolean
}

/**
 * Decodes and re-encodes a raster image, which strips metadata and anything hidden in the file.
 * `needsTransparency` enforces a real transparent background (player cutouts).
 */
export const processRaster = async (
  b: Uint8Array,
  type: FileType,
  opts: { minShortSide: number; needsTransparency?: boolean; maxBytes?: number },
): Promise<RasterResult> => {
  if (b.length > (opts.maxBytes ?? 30 * 1024 * 1024)) throw new Rejected('too_large', { max: '30 MB' })
  if (type !== 'png' && type !== 'jpeg') throw new Rejected('wrong_type', { allowed: 'PNG, JPG' })
  let img: Image
  try {
    img = (await decode(b)) as Image
  } catch {
    throw new Rejected('unreadable')
  }
  const { width, height } = img
  if (width * height > 50_000_000 || width > 10000 || height > 10000) throw new Rejected('too_big_pixels', { max: '10000 px' })
  if (Math.min(width, height) < opts.minShortSide) {
    throw new Rejected('too_small', { width, height, min: opts.minShortSide })
  }

  // Transparency: count clearly see-through pixels on a sample grid, and look at the corners.
  const px = img.bitmap
  let seeThrough = 0
  let sampled = 0
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 40000)))
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      sampled++
      if (px[(y * width + x) * 4 + 3]! < 16) seeThrough++
    }
  }
  const corner = (x: number, y: number) => px[(y * width + x) * 4 + 3]! < 16
  const transparentCorners = [corner(0, 0), corner(width - 1, 0), corner(0, height - 1), corner(width - 1, height - 1)].filter(Boolean).length
  const hasAlpha = seeThrough / sampled >= 0.05 && transparentCorners >= 2

  if (opts.needsTransparency && !hasAlpha) throw new Rejected('no_transparency')

  const out = hasAlpha || type === 'png' ? await img.encode(1) : await img.encodeJPEG(92)
  return { bytes: out, type: hasAlpha || type === 'png' ? 'png' : 'jpeg', width, height, hasAlpha }
}
