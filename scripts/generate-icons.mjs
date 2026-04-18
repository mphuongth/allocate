import sharp from 'sharp'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, '../public')

// Allocate brand palette — navy base, emerald lead, mint secondary.
// Keeping these in one place makes a future rebrand a one-line change.
const COLORS = {
  navy:      '#0F2A4A',
  navyDeep:  '#081A30',
  navyMid:   '#163A61',
  blueMid:   '#3B5A82',
  emerald:   '#10B981',
  mint:      '#34D399',
  cream:     '#F8FAFC',
}

// Donut allocation segments. Percentages sum to 100; order is clockwise from 12.
// The first (lead) segment gets the strongest color.
const SHARES = [
  { pct: 40, color: COLORS.emerald },
  { pct: 25, color: COLORS.mint    },
  { pct: 20, color: COLORS.blueMid },
  { pct: 15, color: COLORS.navyMid },
]

// Visual knobs, all as ratios of `size` so the glyph scales crisply from 32 → 1024.
const GEOM = {
  cornerRadius: 0.203, // ~104/512 — a friendly squircle-like curvature
  ringOuter:    0.344, // ~176/512
  ringInner:    0.203, // ~104/512
  centerDot:    0.047, // ~24/512
  segmentGapDeg: 3,    // angular gap between segments, in degrees
}

function ringSegment(cx, cy, rOut, rIn, aStart, aEnd, fill) {
  const rad = (deg) => (deg * Math.PI) / 180
  const x1o = cx + rOut * Math.cos(rad(aStart))
  const y1o = cy + rOut * Math.sin(rad(aStart))
  const x2o = cx + rOut * Math.cos(rad(aEnd))
  const y2o = cy + rOut * Math.sin(rad(aEnd))
  const x2i = cx + rIn  * Math.cos(rad(aEnd))
  const y2i = cy + rIn  * Math.sin(rad(aEnd))
  const x1i = cx + rIn  * Math.cos(rad(aStart))
  const y1i = cy + rIn  * Math.sin(rad(aStart))
  const large = (((aEnd - aStart) % 360) + 360) % 360 > 180 ? 1 : 0
  const d =
    `M ${x1o.toFixed(3)} ${y1o.toFixed(3)} ` +
    `A ${rOut} ${rOut} 0 ${large} 1 ${x2o.toFixed(3)} ${y2o.toFixed(3)} ` +
    `L ${x2i.toFixed(3)} ${y2i.toFixed(3)} ` +
    `A ${rIn} ${rIn} 0 ${large} 0 ${x1i.toFixed(3)} ${y1i.toFixed(3)} Z`
  return `<path d="${d}" fill="${fill}"/>`
}

function buildSvg(size, { withBackground = true } = {}) {
  const cx = size / 2
  const cy = size / 2
  const rOut   = size * GEOM.ringOuter
  const rIn    = size * GEOM.ringInner
  const dotR   = size * GEOM.centerDot
  const radius = withBackground ? Math.round(size * GEOM.cornerRadius) : 0

  // Build segments walking clockwise from top (-90°), leaving equal angular gaps.
  const totalGap = GEOM.segmentGapDeg * SHARES.length
  const totalDeg = 360 - totalGap
  let angle = -90
  const segs = SHARES.map(({ pct, color }) => {
    const span = totalDeg * (pct / 100)
    const path = ringSegment(cx, cy, rOut, rIn, angle, angle + span, color)
    angle += span + GEOM.segmentGapDeg
    return path
  }).join('')

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
  const centerDot = withBackground
    ? `<circle cx="${cx}" cy="${cy}" r="${dotR}" fill="${COLORS.cream}"/>`
    : '' // on a transparent version the hole shows through — no dot

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${defs}${bgRect}${segs}${centerDot}</svg>`
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
