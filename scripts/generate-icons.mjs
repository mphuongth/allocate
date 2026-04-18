import sharp from 'sharp'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, '../public')

function buildSvg(size) {
  const radius = Math.round(size * 0.18)
  const fontSize = Math.round(size * 0.52)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7c3aed"/>
      <stop offset="100%" stop-color="#9333ea"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="url(#g)"/>
  <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle"
    font-family="system-ui,-apple-system,sans-serif" font-weight="700"
    font-size="${fontSize}" fill="white">A</text>
</svg>`
}

const icons = [
  { filename: 'icon-192.png',         size: 192 },
  { filename: 'icon-512.png',         size: 512 },
  { filename: 'apple-touch-icon.png', size: 180 },
  { filename: 'favicon-32.png',       size: 32  },
]

for (const { filename, size } of icons) {
  await sharp(Buffer.from(buildSvg(size))).png().toFile(resolve(publicDir, filename))
  console.log(`Generated public/${filename}`)
}
