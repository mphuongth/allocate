# REQ-9: Assets Dashboard - Comprehensive Financial Overview

## Overview
Multi-section dashboard aggregating financial data (goals, funds, insurance) with calculated metrics (net worth, P&L, progress) in an organized, responsive layout.

## Key Sections
1. **Net Worth Card** — total assets, liabilities, net worth, overall P&L %
2. **Goals Section** — each goal: target, current value, P&L, progress bar; collapsible with fund breakdown
3. **Funds Section** — grouped by goal; unallocated funds in separate section
4. **Insurance Section** — coverage type, annual premium, amount saved, progress, status badge
5. **Unallocated Section** — funds with no goal assigned

## API Endpoints Needed
- GET /api/v1/dashboard/overview — aggregates all data
- PATCH /api/v1/fund-investments/[id]/goal — reassign fund to goal

## Acceptance Criteria (36 items — see acceptance-criteria.md)

## Insurance Status Logic
- on_track: nextPaymentDate > today + 7 days (green)
- upcoming: today ≤ nextPaymentDate ≤ today + 7 days (yellow)
- overdue: nextPaymentDate < today (red)
- completed: status === 'completed' (gray)

## Sort Options (localStorage persisted)
- Manual Order, Progress High-to-Low, Progress Low-to-High, Alphabetical

## Responsive Layout
- Mobile (<768px): single-column, collapsible sections
- Tablet (768-1023px): 2-column grid
- Desktop (1024px+): multi-column grid
