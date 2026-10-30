/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, commas and newlines inside quotes. */
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',' || c === ';') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      if (row.some((f) => f.trim() !== '')) rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  row.push(field)
  if (row.some((f) => f.trim() !== '')) rows.push(row)
  return rows
}

/** Rows as objects keyed by the (lower-cased, trimmed) header row. */
export const csvRecords = (text: string): Record<string, string>[] => {
  const [header, ...rows] = parseCsv(text)
  if (!header) return []
  const keys = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'))
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}

/** Offers a CSV file to download, e.g. an empty template with the right headers. */
export const downloadCsv = (filename: string, headers: readonly string[], example: string[] = []) => {
  const quote = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const body = [headers.join(','), example.map(quote).join(',')].filter(Boolean).join('\n') + '\n'
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** "a; b, c" → ['a', 'b', 'c'] for list columns such as hashtags. */
export const listCell = (v: string | undefined): string[] =>
  (v ?? '')
    .split(/[;,|]/)
    .map((s) => s.trim())
    .filter(Boolean)
