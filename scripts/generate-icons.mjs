import sharp from 'sharp'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, '../public')

// Cairn brand palette — navy base, emerald lead, mint secondary.
// Keeping these in one place makes a future palette tweak a one-line change.
const COLORS = {
  navy:      '#0F2A4A',
  navyDeep:  '#081A30',
  navyMid:   '#163A61',
  blueMid:   '#3B5A82',
  emerald:   '#10B981',
  mint:      '#34D399',
  cream:     '#F8FAFC',
}

// Cairn mark: four stacked "stones" of decreasing width, slightly offset for
// the hand-balanced feel of a real trail cairn. Each entry is specified as
// ratios of the canvas size so the glyph scales crisply from 32 → 1024.
//
// Stones are listed bottom → top. `w` is width ratio, `h` is height ratio,
// `dx` is horizontal offset (ratio) from the canvas center, positive = right.
// `y` is the top-edge y-position as a ratio of the canvas.
const STONES = [
  { w: 0.547, h: 0.113, y: 0.703, dx: -0.008, color: COLORS.blueMid }, // widest base
  { w: 0.430, h: 0.098, y: 0.574, dx:  0.012, color: COLORS.navyMid }, // slight right
  { w: 0.328, h: 0.086, y: 0.457, dx: -0.016, color: COLORS.emerald }, // brand pop
  { w: 0.203, h: 0.070, y: 0.355, dx:  0.008, color: COLORS.cream    }, // peak marker
]

// Visual knobs. `stoneRadiusScale` sets each stone's corner radius as a
// fraction of its own height — higher = pebbles, lower = slabs.
const GEOM = {
  cornerRadius: 0.203,      // ~104/512 squircle-ish rounded square
  stoneRadiusScale: 0.42,   // stones read as rounded-rectangles, not ovals
}

function stoneRect(size, stone, { withShadow = false } = {}) {
  const w = size * stone.w
  const h = size * stone.h
  const x = (size - w) / 2 + size * stone.dx
  const y = size * stone.y
  const r = Math.min(h * GEOM.stoneRadiusScale, w / 2)
  const shadow = withShadow
    ? `<rect x="${x}" y="${y + h * 0.18}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#000" opacity="0.08"/>`
    : ''
  return `${shadow}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${stone.color}"/>`
}

function buildSvg(size, { withBackground = true } = {}) {
  const radius = withBackground ? Math.round(size * GEOM.cornerRadius) : 0
  const stones = STONES.map((s) => stoneRect(size, s)).join('')

  const defs = withBackground
    ? `<defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${COLORS.navy}"/>
          <stop offset="1" stop-color="${COLORS.navyDeep}"/>
        </linearGradient>
      </defs>`
    : ''
  const bgRect = withBackground
    ? `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="url(#bg)"/>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${defs}${bgRect}${stones}</svg>`
}

const pngIcons = [
  { filename: 'icon-192.png',         size: 192 },
  { filename: 'icon-512.png',         size: 512 },
  { filename: 'apple-touch-icon.png', size: 180 },
  { filename: 'favicon-32.png',       size: 32  },
]

for (const { filename, size } of pngIcons) {
  await sharp(Buffer.from(buildSvg(size)))
    .png()
    .toFile(resolve(publicDir, filename))
  console.log(`Generated public/${filename}`)
}

// Also emit a crisp master SVG (rendered version matches the 512 PNG) and a
// transparent variant handy for embedding in dark-mode UIs or marketing pages.
writeFileSync(resolve(publicDir, 'cairn-icon.svg'), buildSvg(512))
console.log('Generated public/cairn-icon.svg')

writeFileSync(
  resolve(publicDir, 'cairn-icon-transparent.svg'),
  buildSvg(512, { withBackground: false }),
)
console.log('Generated public/cairn-icon-transparent.svg')
