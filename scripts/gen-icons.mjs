import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const pub = join(__dir, '../public')
const appDir = join(__dir, '../app')

// Transparent SVG: browser favicon (no dark background — OS/browser provides context)
const svgTransparent = readFileSync(join(pub, 'cairn-icon-transparent.svg'))
// Opaque SVG: PWA manifest / apple-touch icons (dark rounded-square background)
const svgOpaque = readFileSync(join(pub, 'cairn-icon.svg'))

const icons = [
  { file: 'favicon-32.png',        size: 32,  svg: svgTransparent },
  { file: 'icon-192.png',          size: 192, svg: svgOpaque      },
  { file: 'icon-512.png',          size: 512, svg: svgOpaque      },
  { file: 'apple-touch-icon.png',  size: 180, svg: svgOpaque      },
]

for (const { file, size, svg } of icons) {
  await sharp(svg).resize(size, size).png().toFile(join(pub, file))
  console.log(`✓ ${file} (${size}x${size})`)
}

// Generate favicon.ico: an ICO file embedding a 32x32 PNG from the transparent SVG.
// ICO format allows embedding raw PNG data directly (supported since Vista/Win7).
const png32 = await sharp(svgTransparent).resize(32, 32).png().toBuffer()

// ICO header: reserved(2) + type=1(2) + count=1(2)
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)  // reserved
header.writeUInt16LE(1, 2)  // type: ICO
header.writeUInt16LE(1, 4)  // 1 image

// Directory entry (16 bytes): width, height, colors, reserved, planes, bitCount, size(4), offset(4)
const dirEntry = Buffer.alloc(16)
dirEntry.writeUInt8(32, 0)                     // width: 32
dirEntry.writeUInt8(32, 1)                     // height: 32
dirEntry.writeUInt8(0, 2)                      // no palette
dirEntry.writeUInt8(0, 3)                      // reserved
dirEntry.writeUInt16LE(1, 4)                   // color planes
dirEntry.writeUInt16LE(32, 6)                  // bits per pixel
dirEntry.writeUInt32LE(png32.length, 8)        // size of image data
dirEntry.writeUInt32LE(6 + 16, 12)             // offset = header + one dir entry

const ico = Buffer.concat([header, dirEntry, png32])
writeFileSync(join(appDir, 'favicon.ico'), ico)
console.log(`✓ favicon.ico (32x32, ${ico.length}B)`)
