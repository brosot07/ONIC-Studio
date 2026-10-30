import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.13'
import { Image } from 'jsr:@matmen/imagescript@1.3.1'
import { checkFont, checkPdf, checkSvg, processRaster, Rejected, sniff } from './checks.ts'

const enc = (s: string) => new TextEncoder().encode(s)

/** A test image: a yellow block, optionally on a transparent background. */
const picture = async (w: number, h: number, transparentBackground: boolean, as: 'png' | 'jpeg' = 'png') => {
  const img = new Image(w, h)
  img.fill(transparentBackground ? 0x00000000 : 0xffffffff)
  img.drawBox(Math.floor(w / 4), Math.floor(h / 4), Math.floor(w / 2), Math.floor(h / 2), 0xffd31aff)
  return as === 'png' ? await img.encode(1) : await img.encodeJPEG(90)
}

Deno.test('identifies files by their bytes, not their name', async () => {
  assertEquals(sniff(await picture(10, 10, true)), 'png')
  assertEquals(sniff(await picture(10, 10, false, 'jpeg')), 'jpeg')
  assertEquals(sniff(enc('%PDF-1.7\n...')), 'pdf')
  assertEquals(sniff(enc('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg')
  assertEquals(sniff(enc('<html><script>alert(1)</script></html>')), null)
  assertEquals(sniff(enc('MZ\x90\x00 an .exe renamed to .png')), null)
})

Deno.test('a transparent cutout is accepted and rebuilt as PNG', async () => {
  const r = await processRaster(await picture(900, 1200, true), 'png', { minShortSide: 800, needsTransparency: true })
  assertEquals([r.type, r.width, r.height, r.hasAlpha], ['png', 900, 1200, true])
})

Deno.test('a cutout with a solid background is refused', async () => {
  const err = await assertRejects(
    async () => processRaster(await picture(900, 1200, false), 'png', { minShortSide: 800, needsTransparency: true }),
    Rejected,
  )
  assertEquals(err.code, 'no_transparency')
})

Deno.test('a JPG can never be a cutout', async () => {
  const err = await assertRejects(
    async () => processRaster(await picture(900, 1200, false, 'jpeg'), 'jpeg', { minShortSide: 800, needsTransparency: true }),
    Rejected,
  )
  assertEquals(err.code, 'no_transparency')
})

Deno.test('images that are too small are refused with their size', async () => {
  const err = await assertRejects(async () => processRaster(await picture(300, 400, true), 'png', { minShortSide: 800 }), Rejected)
  assertEquals([err.code, err.detail['width'], err.detail['min']], ['too_small', 300, 800])
})

Deno.test('garbage pretending to be a PNG is refused', async () => {
  const fake = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
  const err = await assertRejects(async () => processRaster(fake, 'png', { minShortSide: 1 }), Rejected)
  assertEquals(err.code, 'unreadable')
})

Deno.test('plain SVG logos pass', () => {
  checkSvg(enc('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="10" height="10"/><use xlink:href="#g"/></svg>'))
})

Deno.test('SVGs with code or outside links are refused', () => {
  const bad = [
    '<svg><script>alert(1)</script></svg>',
    '<svg onload="alert(1)"></svg>',
    '<svg><a href="javascript:alert(1)"><rect/></a></svg>',
    '<svg><foreignObject><iframe src="https://evil"/></foreignObject></svg>',
    '<svg><image href="https://tracker.example/pixel.png"/></svg>',
    '<svg><style>@import url(https://evil/x.css)</style></svg>',
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
  ]
  for (const s of bad) assertThrows(() => checkSvg(enc(s)), Rejected, 'unsafe_svg')
})

Deno.test('PDFs with scripts or attachments are refused', () => {
  checkPdf(enc('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'))
  assertThrows(() => checkPdf(enc('%PDF-1.7\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>')), Rejected, 'unsafe_pdf')
  assertThrows(() => checkPdf(enc('%PDF-1.7\n<< /Type /EmbeddedFile >>')), Rejected, 'unsafe_pdf')
})

Deno.test('broken font files are refused', () => {
  const ttf = new Uint8Array(64)
  ttf.set([0x00, 0x01, 0x00, 0x00, 0x00, 0x40]) // claims 64 tables in a 64-byte file
  assertThrows(() => checkFont(ttf, 'ttf'), Rejected, 'bad_font')
})
