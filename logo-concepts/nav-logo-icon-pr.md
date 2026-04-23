## Summary

Wire the Cairn icon into the in-app navigation. Landing, auth, offline, and favicon already show the mark — only the sidebar, mobile header, and mobile drawer were still rendering text-only wordmarks ("Cairn", plus a bare "C" in the collapsed sidebar). This closes that gap so the brand reads consistently once signed in.

### Changes

- **Sidebar** — icon + "Cairn" wordmark when expanded; icon only when collapsed (the placeholder "C" letter is gone)
- **Mobile Header** — icon + wordmark lockup in the center position (was text-only)
- **MobileDrawer** — icon + wordmark at the top of the drawer (was text-only)

No new assets or script changes — the icon is served from the existing `/cairn-icon.svg`. Sized at 28–32px so it sits at the same visual weight as the adjacent wordmark text.

### Test plan

- [ ] **Desktop sidebar**: expanded shows the stones icon next to "Cairn"; collapsed shows just the icon (no letter)
- [ ] **Mobile header**: center shows icon + "Cairn" side by side instead of text only
- [ ] **Mobile drawer**: top of the drawer shows icon + "Cairn"; close (X) button stays on the right
- [ ] **Dark mode**: icon tile retains its navy background; wordmark switches to cream via `text-brand`
- [ ] **Keyboard nav** in the drawer: focus trap still works (icon image isn't focusable, so nothing regressed)
