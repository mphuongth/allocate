import sharp from 'sharp'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const pub = join(__dir, '../public')
const svg = readFileSync(join(pub, 'cairn-icon.svg'))

const sizes = [
  { file: 'favicon-32.png',        size: 32  },
  { file: 'icon-192.png',          size: 192 },
  { file: 'icon-512.png',          size: 512 },
  { file: 'apple-touch-icon.png',  size: 180 },
]

for (const { file, size } of sizes) {
  await sharp(svg).resize(size, size).png().toFile(join(pub, file))
  console.log(`✓ ${file} (${size}x${size})`)
}
