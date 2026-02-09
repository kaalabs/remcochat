# RemcoChat — SPEC: Desktop Collapsible + Resizable Sidebar (Feature #13)

## 1) Problem Definition
The desktop sidebar currently has a fixed width (`18rem`) and cannot be collapsed. On wider screens this wastes horizontal space for users who prefer a narrow shell, and on smaller desktop/laptop screens users cannot reclaim space for the conversation area.

We need desktop-only sidebar controls that let users:
- collapse/expand the sidebar, and
- resize the expanded sidebar width.

Any chosen width must persist across browser sessions in the same browser profile.

## 2) Goals
- Add a desktop-only collapse/expand control for the left sidebar.
- Add a desktop-only drag handle to resize sidebar width.
- Persist sidebar UI state (collapsed + width) in browser `localStorage`.
- Preserve current mobile behavior (`md:hidden` drawer) without regressions.
- Keep existing sidebar content/flows unchanged (folders/chats/profile controls).

## 3) Non-goals
- No server-side persistence for sidebar UI state.
- No cross-device or cross-browser sync.
- No changes to mobile drawer sizing/behavior.
- No redesign of sidebar contents or chat list information architecture.

## 4) UX / Interaction Spec

### 4.1 Responsive Scope
- `mobile/tablet (< md)`: unchanged drawer behavior (`sidebarOpen` dialog).
- `desktop (>= md)`: persistent inline sidebar supports collapse and resize.

### 4.2 Collapse / Expand (Desktop)
Controls:
- Add a desktop-only toggle button in the sidebar header (expanded state).
- Add a desktop-only toggle button in the main header when sidebar is collapsed (to reopen quickly).

Behavior:
- Collapse hides sidebar content area and removes the resize handle from interaction.
- Expand restores sidebar at the last saved expanded width.
- Initial default on first visit: expanded.

Accessibility:
- Toggle button must have stable `aria-label` values for both actions.
- Toggle state exposed with `aria-pressed` or equivalent stateful semantics.

### 4.3 Resize (Desktop)
Controls:
- A vertical drag handle at the right edge of the sidebar.

Behavior:
- Dragging horizontally updates width in real time.
- Width is clamped to `[minWidth, maxWidth]`.
- Proposed defaults:
  - `defaultWidth = 288px` (`18rem`)
  - `minWidth = 240px`
  - `maxWidth = 560px`
- Optional quality-of-life: double-click handle resets to default width.

Interaction constraints:
- Resize only works while sidebar is expanded.
- Text selection and accidental clicks should be suppressed while dragging.

### 4.4 Persistence Rules
Persist locally in browser:
- `collapsed` (boolean)
- `width` (number, px)

Persistence behavior:
- Save on collapse toggle and on resize end (or throttled during resize).
- Load once on client mount.
- Validate loaded shape; fallback to defaults on invalid/corrupt payload.
- Clamp loaded width to current `[minWidth, maxWidth]` bounds.

Scope:
- Stored per browser profile, shared across RemcoChat profiles on that browser.

## 5) Data / API Changes
- No DB changes.
- No server API changes.
- Client-side only state in `localStorage`.

## 6) Technical Design (Proposed)

### 6.1 State Model (`src/app/home-client.tsx`)
Add desktop shell state:
- `isDesktopSidebarCollapsed: boolean`
- `desktopSidebarWidthPx: number`
- `isSidebarResizing: boolean` (ephemeral drag state)

Storage key:
- `remcochat:desktopSidebar:v1`

Stored payload:
```json
{ "collapsed": false, "width": 288 }
```

### 6.2 Layout Refactor
Current desktop layout:
- `md:grid-cols-[18rem_1fr]`

Proposed:
- Drive grid columns from state (inline style or CSS variable), e.g.:
  - expanded: `${width}px 1fr`
  - collapsed: `0px 1fr` (or compact icon rail if chosen during implementation)
- Keep mobile path unchanged.

### 6.3 Resize Implementation
Recommended approach:
- Add a slim right-edge handle element in the desktop sidebar container.
- On pointer down:
  - capture start X + start width,
  - attach pointer move/up listeners,
  - compute `nextWidth = clamp(startWidth + deltaX)`.
- On pointer up/cancel:
  - remove listeners,
  - persist final width.

### 6.4 Existing State Compatibility
- Reuse current defensive `localStorage` parsing style already used for:
  - folder group collapse state (`remcochat:folderGroupCollapsed:<profileId>`)
  - active profile/chat/model preferences.
- Maintain current `sidebarOpen` behavior for mobile drawer only.

### 6.5 i18n + Test IDs
Add i18n keys (EN + NL), e.g.:
- `sidebar.collapse.aria`
- `sidebar.expand.aria`
- `sidebar.resize_handle.aria`

Add deterministic test ids:
- `sidebar:desktop-toggle`
- `sidebar:desktop-resize-handle`
- `sidebar:desktop` (desktop aside root)

## 7) Edge Cases
- Corrupt JSON in localStorage: ignore and use defaults.
- Width below min or above max after viewport changes: clamp.
- Collapsed state persisted with stale width: keep width for later restore.
- Fast drag + window blur/pointer cancel: must clean up listeners and end resize mode.
- SSR/hydration: read/write storage only in effects/client event handlers.

## 8) Test Strategy (No Mocks)

### 8.1 Unit
- Add tests for deserialize + validate + clamp helper(s), including:
  - missing payload
  - invalid JSON
  - invalid field types
  - out-of-range widths

### 8.2 E2E (Playwright, desktop viewport)
New spec (example: `e2e/sidebar-desktop-shell.spec.ts`):
1. Open app at desktop viewport.
2. Assert desktop sidebar is visible and expanded by default.
3. Drag resize handle to a larger width; assert width changed.
4. Reload; assert resized width persisted.
5. Collapse sidebar; assert hidden/collapsed desktop sidebar.
6. Reload; assert collapsed state persisted.
7. Expand sidebar; assert previous width restored.

Regression check:
- Existing `e2e/mobile-shell.spec.ts` remains green (drawer behavior unchanged).

## 9) Acceptance Criteria
- Desktop users can collapse and expand sidebar via explicit control.
- Desktop users can resize sidebar with a drag handle.
- Selected width persists across reload/new tab in the same browser profile.
- Collapsed/expanded state persists across reload/new tab in the same browser profile.
- Mobile drawer behavior remains unchanged.
