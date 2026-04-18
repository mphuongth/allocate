import sharp from 'sharp'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, '../public')

// Mobile screenshot — 390×844
const mobileSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844" viewBox="0 0 390 844">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f5f3ff"/>
      <stop offset="100%" stop-color="#ede9fe"/>
    </linearGradient>
  </defs>
  <!-- Background -->
  <rect width="390" height="844" fill="url(#bg)"/>
  <!-- Status bar area -->
  <rect width="390" height="52" fill="#7c3aed"/>
  <!-- App name in header -->
  <text x="20" y="34" font-family="system-ui,sans-serif" font-weight="700" font-size="18" fill="white">Allocate</text>
  <!-- Nav tabs -->
  <rect y="52" width="390" height="48" fill="white"/>
  <rect x="0" y="94" width="390" height="2" fill="#ede9fe"/>
  <text x="20" y="80" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#7c3aed">Overview</text>
  <text x="110" y="80" font-family="system-ui,sans-serif" font-size="13" fill="#9ca3af">Planning</text>
  <text x="190" y="80" font-family="system-ui,sans-serif" font-size="13" fill="#9ca3af">Goals</text>
  <!-- Net worth card -->
  <rect x="16" y="110" width="358" height="110" rx="16" fill="#7c3aed"/>
  <text x="32" y="140" font-family="system-ui,sans-serif" font-size="11" fill="#c4b5fd">Portfolio Value</text>
  <text x="32" y="172" font-family="system-ui,sans-serif" font-weight="700" font-size="28" fill="white">₫2,456,800,000</text>
  <text x="32" y="200" font-family="system-ui,sans-serif" font-size="12" fill="#a5f3fc">↑ +12.4% this month</text>
  <!-- Asset cards -->
  <rect x="16" y="236" width="170" height="90" rx="12" fill="white"/>
  <text x="30" y="262" font-family="system-ui,sans-serif" font-size="10" fill="#9ca3af">Mutual Funds</text>
  <text x="30" y="290" font-family="system-ui,sans-serif" font-weight="700" font-size="16" fill="#111827">₫1,105M</text>
  <text x="30" y="312" font-family="system-ui,sans-serif" font-size="10" fill="#10b981">↑ 45%</text>
  <rect x="204" y="236" width="170" height="90" rx="12" fill="white"/>
  <text x="218" y="262" font-family="system-ui,sans-serif" font-size="10" fill="#9ca3af">Bank Deposits</text>
  <text x="218" y="290" font-family="system-ui,sans-serif" font-weight="700" font-size="16" fill="#111827">₫737M</text>
  <text x="218" y="312" font-family="system-ui,sans-serif" font-size="10" fill="#6b7280">30%</text>
  <!-- Goals section -->
  <text x="20" y="358" font-family="system-ui,sans-serif" font-weight="600" font-size="15" fill="#111827">Savings Goals</text>
  <rect x="16" y="370" width="358" height="72" rx="12" fill="white"/>
  <text x="30" y="396" font-family="system-ui,sans-serif" font-size="13" font-weight="500" fill="#111827">Emergency Fund</text>
  <rect x="30" y="406" width="280" height="6" rx="3" fill="#f3f4f6"/>
  <rect x="30" y="406" width="224" height="6" rx="3" fill="#7c3aed"/>
  <text x="320" y="416" font-family="system-ui,sans-serif" font-size="11" fill="#6b7280">80%</text>
  <text x="30" y="432" font-family="system-ui,sans-serif" font-size="11" fill="#9ca3af">₫80M of ₫100M</text>
  <rect x="16" y="452" width="358" height="72" rx="12" fill="white"/>
  <text x="30" y="478" font-family="system-ui,sans-serif" font-size="13" font-weight="500" fill="#111827">House Down Payment</text>
  <rect x="30" y="488" width="280" height="6" rx="3" fill="#f3f4f6"/>
  <rect x="30" y="488" width="126" height="6" rx="3" fill="#7c3aed"/>
  <text x="320" y="498" font-family="system-ui,sans-serif" font-size="11" fill="#6b7280">45%</text>
  <text x="30" y="514" font-family="system-ui,sans-serif" font-size="11" fill="#9ca3af">₫450M of ₫1B</text>
</svg>`

// Desktop screenshot — 1280×800
const desktopSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f9fafb"/>
      <stop offset="100%" stop-color="#f5f3ff"/>
    </linearGradient>
  </defs>
  <!-- Background -->
  <rect width="1280" height="800" fill="url(#bg)"/>
  <!-- Sidebar -->
  <rect width="240" height="800" fill="white"/>
  <rect x="240" width="1" height="800" fill="#e5e7eb"/>
  <!-- Sidebar logo -->
  <rect x="20" y="20" width="36" height="36" rx="8" fill="#7c3aed"/>
  <text x="38" y="44" font-family="system-ui,sans-serif" font-weight="700" font-size="18" fill="white" text-anchor="middle">A</text>
  <text x="68" y="44" font-family="system-ui,sans-serif" font-weight="700" font-size="16" fill="#111827">Allocate</text>
  <!-- Sidebar items -->
  <rect x="12" y="76" width="216" height="36" rx="8" fill="#f5f3ff"/>
  <text x="44" y="100" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="#7c3aed">Asset Overview</text>
  <text x="44" y="136" font-family="system-ui,sans-serif" font-size="13" fill="#6b7280">Monthly Plan</text>
  <text x="44" y="172" font-family="system-ui,sans-serif" font-size="13" fill="#6b7280">Fund Library</text>
  <text x="44" y="208" font-family="system-ui,sans-serif" font-size="13" fill="#6b7280">Settings</text>
  <!-- Main content -->
  <!-- Header -->
  <rect x="240" width="1040" height="60" fill="white"/>
  <rect x="240" y="60" width="1040" height="1" fill="#e5e7eb"/>
  <text x="268" y="38" font-family="system-ui,sans-serif" font-weight="700" font-size="20" fill="#111827">Asset Overview</text>
  <!-- Stat cards -->
  <rect x="268" y="84" width="220" height="96" rx="12" fill="#7c3aed"/>
  <text x="288" y="110" font-family="system-ui,sans-serif" font-size="11" fill="#c4b5fd">Portfolio Value</text>
  <text x="288" y="140" font-family="system-ui,sans-serif" font-weight="700" font-size="20" fill="white">₫2,456,800,000</text>
  <text x="288" y="164" font-family="system-ui,sans-serif" font-size="11" fill="#a5f3fc">↑ +12.4%</text>
  <rect x="508" y="84" width="220" height="96" rx="12" fill="white"/>
  <text x="528" y="110" font-family="system-ui,sans-serif" font-size="11" fill="#9ca3af">Total Invested</text>
  <text x="528" y="140" font-family="system-ui,sans-serif" font-weight="700" font-size="20" fill="#111827">₫2,100,000,000</text>
  <text x="528" y="164" font-family="system-ui,sans-serif" font-size="11" fill="#6b7280">Across 4 assets</text>
  <rect x="748" y="84" width="220" height="96" rx="12" fill="white"/>
  <text x="768" y="110" font-family="system-ui,sans-serif" font-size="11" fill="#9ca3af">Gain / Loss</text>
  <text x="768" y="140" font-family="system-ui,sans-serif" font-weight="700" font-size="20" fill="#10b981">+₫356,800,000</text>
  <text x="768" y="164" font-family="system-ui,sans-serif" font-size="11" fill="#10b981">+17.0%</text>
  <!-- Goals grid -->
  <text x="268" y="214" font-family="system-ui,sans-serif" font-weight="600" font-size="15" fill="#111827">Savings Goals</text>
  <rect x="268" y="228" width="330" height="140" rx="12" fill="white"/>
  <text x="288" y="256" font-family="system-ui,sans-serif" font-size="13" font-weight="500" fill="#111827">Emergency Fund</text>
  <rect x="288" y="268" width="270" height="8" rx="4" fill="#f3f4f6"/>
  <rect x="288" y="268" width="216" height="8" rx="4" fill="#7c3aed"/>
  <text x="288" y="296" font-family="system-ui,sans-serif" font-size="12" fill="#9ca3af">₫80M of ₫100M · 80% complete</text>
  <rect x="618" y="228" width="330" height="140" rx="12" fill="white"/>
  <text x="638" y="256" font-family="system-ui,sans-serif" font-size="13" font-weight="500" fill="#111827">House Down Payment</text>
  <rect x="638" y="268" width="270" height="8" rx="4" fill="#f3f4f6"/>
  <rect x="638" y="268" width="121" height="8" rx="4" fill="#7c3aed"/>
  <text x="638" y="296" font-family="system-ui,sans-serif" font-size="12" fill="#9ca3af">₫450M of ₫1B · 45% complete</text>
  <!-- Allocation table -->
  <text x="268" y="398" font-family="system-ui,sans-serif" font-weight="600" font-size="15" fill="#111827">Allocation</text>
  <rect x="268" y="412" width="680" height="44" rx="0" fill="#f9fafb"/>
  <text x="288" y="438" font-family="system-ui,sans-serif" font-size="12" font-weight="500" fill="#6b7280">Asset</text>
  <text x="480" y="438" font-family="system-ui,sans-serif" font-size="12" font-weight="500" fill="#6b7280">Value</text>
  <text x="620" y="438" font-family="system-ui,sans-serif" font-size="12" font-weight="500" fill="#6b7280">Gain/Loss</text>
  <text x="780" y="438" font-family="system-ui,sans-serif" font-size="12" font-weight="500" fill="#6b7280">Share</text>
  <rect x="268" y="456" width="680" height="1" fill="#e5e7eb"/>
  <text x="288" y="484" font-family="system-ui,sans-serif" font-size="13" fill="#111827">Mutual Funds</text>
  <text x="480" y="484" font-family="system-ui,sans-serif" font-size="13" fill="#111827">₫1,105,560,000</text>
  <text x="620" y="484" font-family="system-ui,sans-serif" font-size="13" fill="#10b981">+₫205,560,000</text>
  <text x="780" y="484" font-family="system-ui,sans-serif" font-size="13" fill="#6b7280">45%</text>
</svg>`

await sharp(Buffer.from(mobileSvg)).png().toFile(resolve(publicDir, 'screenshot-mobile.png'))
console.log('Generated public/screenshot-mobile.png')

await sharp(Buffer.from(desktopSvg)).png().toFile(resolve(publicDir, 'screenshot-desktop.png'))
console.log('Generated public/screenshot-desktop.png')
