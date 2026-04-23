## Summary

Replaces the purple-gradient `A` placeholder with a segmented allocation-donut mark that literally pictures the product's core action: **allocating** money across the segments of your financial life. Same output filenames, same sizes — drop-in replacement, no wiring changes needed in layouts, manifest, or `<link>` tags.

**Palette**

| Token | Hex | Use |
| --- | --- | --- |
| `navy` | `#0F2A4A` | icon background (top of gradient) |
| `navyDeep` | `#081A30` | icon background (bottom of gradient) |
| `emerald` | `#10B981` | lead segment (40%) |
| `mint` | `#34D399` | second segment (25%) |
| `blueMid` | `#3B5A82` | third segment (20%) |
| `navyMid` | `#163A61` | fourth segment (15%) |
| `cream` | `#F8FAFC` | center dot |

**What changed**

- Rewrote `scripts/generate-icons.mjs` with parameterized donut geometry. Palette, segment shares, and visual ratios are constants at the top of the file — future tweaks are one-liners.
- Emits two new vector masters alongside the raster icons:
  - `public/allocate-icon.svg` — full mark with rounded-square navy background
  - `public/allocate-icon-transparent.svg` — rings only, for placing on arbitrary backgrounds
- Regenerated `public/favicon-32.png`, `public/apple-touch-icon.png`, `public/icon-192.png`, `public/icon-512.png`.
- Declared `sharp` in `package.json`. The icon-generation script was importing it but the package was only resolving transitively — now it's a proper dependency.

**Why a donut**

The segmented donut reads three ways at once, and all three are on-brand for Allocate:

1. A budget pie — concrete and recognizable.
2. A hub — layered rings radiating from the user at the center ("you").
3. A target — the lead emerald segment as the active allocation.

It also scales honestly from 1024px down to 32px (verified) without losing its silhouette.

## Test plan

- [ ] `npm run generate-icons` runs cleanly and produces all four PNGs plus the two SVG masters
- [ ] Vercel preview shows the new favicon in the browser tab
- [ ] Installing the PWA (iOS Safari → Add to Home Screen) shows the donut at expected sharpness
- [ ] Android install prompt uses `icon-192.png` / `icon-512.png` correctly
- [ ] Mark visually balanced in both light and dark OS themes on the preview deployment
