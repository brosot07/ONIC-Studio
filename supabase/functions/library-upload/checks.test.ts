import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1.0.13'
import { Image } from 'jsr:@matmen/imagescript@1.3.1'
import { checkFont, checkPdf, jpegOrientation, processRaster, Rejected, sniff, sniffVideo } from './checks.ts'
import { cleanSvg } from './svg.ts'

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
  assertEquals(sniff(enc('<!DOCTYPE svg [<!ENTITY ns "x">]><svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg')
  assertEquals(sniff(enc('<html><script>alert(1)</script></html>')), null)
  assertEquals(sniff(enc('<html><body><svg></svg></body></html>')), null)
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

const dec = (b: Uint8Array) => new TextDecoder().decode(b)

Deno.test('plain SVG logos pass and keep their shapes', () => {
  const out = dec(
    cleanSvg(
      enc(
        '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#FFD31A"/></linearGradient></defs><rect fill="url(#g)" width="10" height="10" style="opacity:.5"/><use xlink:href="#g"/></svg>',
      ),
    ),
  )
  for (const part of ['<rect', 'fill="url(#g)"', 'viewBox="0 0 10 10"', 'stop-color="#FFD31A"', 'xlink:href="#g"', 'opacity:.5']) {
    if (!out.includes(part)) throw new Error(`missing ${part} in ${out}`)
  }
})

Deno.test('SVGs lose anything that could run code or load outside files', () => {
  const attacks = [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="1" height="1"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(document.domain)</h:script><rect width="1" height="1"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="http://www.w3.org/2000/svg"><s:script>alert(1)</s:script><rect width="1" height="1"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><x:foreignObject xmlns:x="http://www.w3.org/2000/svg"><iframe src="https://evil"/></x:foreignObject><rect width="1" height="1"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="#x"><animate attributeName="href" values="&#106;avascript:alert(1)"/><rect width="1" height="1"/></a></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" style="fill:\\75rl(https://evil/x.svg)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="image-set(&quot;https://evil/x.png&quot; 1x)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://tracker.example/pixel.png"/><rect width="1" height="1"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil/x.css)</style><rect width="1" height="1"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil/sprite.svg#a"/><rect width="1" height="1"/></svg>',
  ]
  for (const a of attacks) {
    let out: string
    try {
      out = dec(cleanSvg(enc(a)))
    } catch (e) {
      if (e instanceof Rejected) continue // refused outright is also safe
      throw e
    }
    if (/script|onload|foreignObject|iframe|animate|javascript|https?:\/\/(?!www\.w3\.org)|style>|image-set|\\75/i.test(out)) {
      throw new Error(`not cleaned: ${out}`)
    }
  }
})

Deno.test('SVGs with document type declarations are refused', () => {
  assertThrows(() => cleanSvg(enc('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>')), Rejected, 'unsafe_svg')
})

Deno.test('a huge pathological SVG is handled in linear time', () => {
  const t = performance.now()
  try {
    cleanSvg(enc('<svg xmlns="http://www.w3.org/2000/svg">' + '<use '.repeat(300_000)))
  } catch {
    // refused is fine; it just mustn't hang
  }
  if (performance.now() - t > 3000) throw new Error('too slow')
})

const deflate = async (text: string) =>
  new Uint8Array(await new Response(new Blob([enc(text)]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())

Deno.test('PDFs with scripts, attachments or hidden actions are refused', async () => {
  await checkPdf(enc('%PDF-1.7\n1 0 obj << /Type /Catalog /OpenAction [3 0 R /Fit] >> endobj\n%%EOF'))
  await assertRejects(() => checkPdf(enc('%PDF-1.7\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>')), Rejected, 'unsafe_pdf')
  await assertRejects(() => checkPdf(enc('%PDF-1.7\n<< /Type /EmbeddedFile >>')), Rejected, 'unsafe_pdf')
  await assertRejects(() => checkPdf(enc('%PDF-1.7\n<< /S /J#61vaScript /JS (x) >>')), Rejected, 'unsafe_pdf')
  await assertRejects(() => checkPdf(enc('%PDF-1.7\n<< /S /SubmitForm /F (https://evil) >>')), Rejected, 'unsafe_pdf')
  const hidden = await deflate('<< /S /JavaScript /JS (app.alert(1)) >>')
  const pdf = new Uint8Array([...enc('%PDF-1.7\n5 0 obj << /Type /ObjStm /Filter /FlateDecode >> stream\n'), ...hidden, ...enc('\nendstream endobj\n%%EOF')])
  await assertRejects(() => checkPdf(pdf), Rejected, 'unsafe_pdf')
})

Deno.test('a tiny PNG claiming to be gigantic is refused before decoding', async () => {
  const bomb = new Uint8Array(64)
  bomb.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(bomb.buffer).setUint32(16, 60000)
  new DataView(bomb.buffer).setUint32(20, 60000)
  const err = await assertRejects(() => processRaster(bomb, 'png', { minShortSide: 1 }), Rejected)
  assertEquals(err.code, 'too_big_pixels')
})

Deno.test('broken font files are refused', () => {
  const ttf = new Uint8Array(64)
  ttf.set([0x00, 0x01, 0x00, 0x00, 0x00, 0x40]) // claims 64 tables in a 64-byte file
  assertThrows(() => checkFont(ttf, 'ttf'), Rejected, 'bad_font')
})

Deno.test('videos are recognised by their ftyp box, not their name', () => {
  const box = (brand: string, size = 24) => {
    const b = new Uint8Array(64)
    new DataView(b.buffer).setUint32(0, size)
    b.set(new TextEncoder().encode('ftyp' + brand), 4)
    return b
  }
  assertEquals(sniffVideo(box('isom')), 'mp4')
  assertEquals(sniffVideo(box('mp42')), 'mp4')
  assertEquals(sniffVideo(box('qt  ')), 'mov')
  assertEquals(sniffVideo(box('heic')), null) // a photo container, not a video
  assertEquals(sniffVideo(box('isom', 4)), null) // impossible box size
  assertEquals(sniffVideo(new TextEncoder().encode('<html><body>ftypisom</body></html>')), null)
  assertEquals(sniffVideo(new Uint8Array(8)), null)
})

Deno.test('sideways phone photos are stored upright', async () => {
  const wide = new Image(40, 20).fill(0xffffffff)
  wide.setPixelAt(1, 1, 0xff0000ff)
  const jpeg = await wide.encodeJPEG(95)
  // Insert an EXIF block saying "rotate 90° clockwise to view" (orientation 6), little-endian.
  const tiff = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
  const payload = [...new TextEncoder().encode('Exif\0\0'), ...tiff]
  const app1 = [0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload]
  const withExif = new Uint8Array([...jpeg.subarray(0, 2), ...app1, ...jpeg.subarray(2)])
  assertEquals(jpegOrientation(withExif), 6)
  assertEquals(jpegOrientation(jpeg), 1)
  const r = await processRaster(withExif, 'jpeg', { minShortSide: 10 })
  assertEquals([r.width, r.height], [20, 40])
  const out = await Image.decode(r.bytes)
  // The red corner (top-left of the sideways original) ends up top-right once turned clockwise.
  const [red, , blue] = Image.colorToRGBA(out.getPixelAt(20, 1))
  assertEquals(red > 200 && blue < 80, true)
})
