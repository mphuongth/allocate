## Summary

Swap the donut mark for a **stacked-stones** silhouette so the logo actually reinforces the name. The donut was the right mark for "Allocate" — it pictured budget allocation as a pie chart. For "Cairn" the metaphor was off: a cairn is a stack of stones marking a trail, not a radial chart.

Same navy + emerald palette. Same output filenames. No call-site changes — `<link rel="icon">`, `<img src="/cairn-icon.svg">`, and the PWA manifest all resolve to the new mark automatically.

### Design

Four stones (bottom → top), decreasing width, with small alternating horizontal offsets (±8 px) for the hand-balanced feel of a real trail cairn rather than a rigid column.

- **Bottom stone** (blueMid) — the broadest base, grounds the stack
- **Second stone** (navyMid) — inset slightly right
- **Third stone** (emerald) — the brand pop, visible even at 32 px
- **Peak stone** (cream on dark backgrounds, navy on light) — reads as the trail marker

Stone corner radius ≈ 42% of each stone's height — rounded-rectangle boulders, not ovals, not slabs.

### Parameterized the same way the donut was

`scripts/generate-icons.mjs` still keeps the palette and geometry as constants at the top:

```js
const STONES = [
  { w: 0.547, h: 0.113, y: 0.703, dx: -0.008, color: COLORS.blueMid },
  { w: 0.430, h: 0.098, y: 0.574, dx:  0.012, color: COLORS.navyMid },
  { w: 0.328, h: 0.086, y: 0.457, dx: -0.016, color: COLORS.emerald },
  { w: 0.203, h: 0.070, y: 0.355, dx:  0.008, color: COLORS.cream   },
]
```

All values are ratios of the canvas size so the glyph scales crisply from 32 → 1024. Rebalancing the silhouette (adding a fifth stone, nudging the emerald up, tightening offsets) is a single-array edit.

### What changed

- `scripts/generate-icons.mjs` — rewritten around the `STONES` config (no arc math, much shorter)
- `public/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `favicon-32.png` — regenerated from the new script
- `public/cairn-icon.svg`, `cairn-icon-transparent.svg` — new vector masters
- `public/cairn-wordmark.svg`, `cairn-wordmark-dark.svg` — wordmarks rebuilt with the stones glyph replacing the donut

### Test plan

- [ ] `npm run generate-icons` runs cleanly and produces all PNGs + both SVGs
- [ ] Browser tab favicon shows the stacked stones (not the donut)
- [ ] PWA install on iOS Safari / Android — installed icon is the stones; add-to-home-screen preview shows the new mark
- [ ] Landing header and footer render the new icon (served from `/cairn-icon.svg`)
- [ ] The stones are distinguishable at 32 px (favicon size) — specifically the emerald third stone should still read as a color pop
