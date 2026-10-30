// SVG cleaning by allow-list. The file is parsed as XML, everything that isn't a known-safe SVG element or
// attribute is dropped, and a new file is written from what's left. What we store is exactly what we checked.
import { XMLBuilder, XMLParser } from 'npm:fast-xml-parser@5.11.2'
import { Rejected } from './checks.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'

const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
  'polygon', 'text', 'tspan', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'image',
  'filter', 'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix', 'feComposite', 'feFlood', 'feMerge',
  'feMergeNode', 'feMorphology',
])

const ATTRIBUTES = new Set([
  'id', 'class', 'data-name', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'fr',
  'width', 'height', 'points', 'viewBox', 'preserveAspectRatio', 'transform', 'version', 'overflow', 'display',
  'visibility', 'opacity', 'color', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'clip-path',
  'clip-rule', 'mask', 'filter', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform',
  'spreadMethod', 'patternUnits', 'patternContentUnits', 'patternTransform', 'clipPathUnits', 'maskUnits',
  'maskContentUnits', 'filterUnits', 'primitiveUnits', 'stdDeviation', 'in', 'in2', 'result', 'mode', 'operator',
  'k1', 'k2', 'k3', 'k4', 'values', 'type', 'flood-color', 'flood-opacity', 'radius', 'font-family', 'font-size',
  'font-weight', 'font-style', 'letter-spacing', 'word-spacing', 'text-anchor', 'dominant-baseline', 'dx', 'dy',
  'mix-blend-mode', 'isolation', 'style', 'href', 'xlink:href', 'xml:space', 'xmlns', 'xmlns:xlink',
])

/** Values may point inside the file (url(#id)) but never outside it, and may not hide characters. */
const safeValue = (v: string) =>
  !/[\\<>]|javascript|vbscript|expression|@import|image-set|:\/\/|&#|&[a-z]/i.test(v) &&
  [...v.matchAll(/url\(([^)]*)\)/gi)].every((m) => /^\s*['"]?#[\w.-]+['"]?\s*$/.test(m[1]!))

const safeStyle = (style: string) =>
  style.split(';').every((decl) => {
    if (!decl.trim()) return true
    const [prop, ...rest] = decl.split(':')
    return ATTRIBUTES.has(prop!.trim()) && prop!.trim() !== 'style' && safeValue(rest.join(':'))
  })

type Node = Record<string, unknown> & { ':@'?: Record<string, string> }

const cleanAttrs = (tag: string, attrs: Record<string, string> = {}): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [rawName, value] of Object.entries(attrs)) {
    const name = rawName.slice(2) // '@_' prefix
    if (!ATTRIBUTES.has(name)) continue
    const v = String(value)
    if (name === 'xmlns') {
      if (v === SVG_NS) out[rawName] = v
      continue
    }
    if (name === 'xmlns:xlink') {
      if (v === XLINK_NS) out[rawName] = v
      continue
    }
    if (name === 'href' || name === 'xlink:href') {
      const ok =
        (tag === 'use' && /^#[\w.-]+$/.test(v)) ||
        (tag === 'image' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=\s]+$/.test(v))
      if (ok) out[rawName] = v
      continue
    }
    if (name === 'style') {
      if (safeStyle(v)) out[rawName] = v
      continue
    }
    if (safeValue(v)) out[rawName] = v
  }
  return out
}

/** Keeps allowed elements (and the text inside <text>/<tspan>/<title>/<desc>), drops everything else. */
const cleanNodes = (nodes: Node[], parent: string): Node[] => {
  const out: Node[] = []
  for (const node of nodes) {
    const tag = Object.keys(node).find((k) => k !== ':@')
    if (!tag) continue
    if (tag === '#text') {
      if (['text', 'tspan', 'title', 'desc'].includes(parent)) out.push({ '#text': node['#text'] })
      continue
    }
    // Prefixed names (h:script, x:foreignObject…), comments, CDATA and processing instructions are dropped.
    if (!ELEMENTS.has(tag)) continue
    const children = cleanNodes((node[tag] as Node[]) ?? [], tag)
    const attrs = cleanAttrs(tag, node[':@'])
    const clean: Node = { [tag]: children }
    if (Object.keys(attrs).length) clean[':@'] = attrs
    out.push(clean)
  }
  return out
}

export const cleanSvg = (bytes: Uint8Array): Uint8Array => {
  if (bytes.length > 2 * 1024 * 1024) throw new Rejected('too_large', { max: '2 MB' })
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Rejected('unreadable')
  }
  // Document type declarations can define entities (billion laughs, outside files): refuse them outright.
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Rejected('unsafe_svg')

  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: false,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    processEntities: false,
    htmlEntities: false,
    commentPropName: '#comment',
    cdataPropName: '#cdata',
  })
  let tree: Node[]
  try {
    tree = parser.parse(text) as Node[]
  } catch {
    throw new Rejected('unreadable')
  }
  const root = tree.find((n) => 'svg' in n)
  if (!root) throw new Rejected('unreadable')
  const cleaned = cleanNodes([root], '')
  const svg = cleaned[0]
  if (!svg) throw new Rejected('unreadable')
  svg[':@'] = { ...(svg[':@'] ?? {}), '@_xmlns': SVG_NS }

  const builder = new XMLBuilder({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    suppressEmptyNode: true,
    processEntities: true,
    format: false,
  })
  const out = builder.build(cleaned) as string
  if (!/<(path|rect|circle|ellipse|line|polyline|polygon|text|image|use)[\s/>]/.test(out)) throw new Rejected('unreadable')
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>\n${out}`)
}
