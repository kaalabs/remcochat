# RemcoChat — SPEC: Sidebar Chat Folders (Feature #11)

## 1) Problem Definition
RemcoChat’s sidebar chat history overview is a flat list. As chat count grows, it becomes hard to keep related chats together (e.g. “Work”, “Home”, “Ideas”), especially without authentication and with multiple profiles.

This feature introduces **Folders** in the sidebar so users can:
- create folders,
- move existing chats into folders,
- collapse/expand folders, and
- keep folder expand/collapse state persistent between sessions.

Folders can be deleted; when deleted, **chats inside are moved back to the root level** (unfiled) rather than deleted.

## 2) Goals
- Add first-class **Folder** groups to the sidebar chat overview.
- Folders are **always visible** in the sidebar list (even when empty) and can be **collapsed/expanded**.
- Folder collapsed/expanded state is **persistent between sessions** and stored **server-side per profile**.
- Users can create folders and move existing persisted chats into/out of folders.
- Users can delete a folder; deleting moves contained chats to the root level (unfiled) with no data loss.
- Respect the existing profile boundary model: folders are per-profile and only affect the active profile’s chats.

## 3) Non-goals
- Drag-and-drop (v1 uses menu-driven move).
- Multi-select / bulk move operations.
- Folder nesting (“folders inside folders”).
- Global folders across profiles.
- Search/filtering across chats and folders.
- Per-user folder UI state (there is no auth; collapse state is per-profile in v1).

## 4) UX / Interaction Spec

### 4.1 Terminology
- **Folder**: a named group in the sidebar that can contain 0..N chats.
- **Unfiled / Root level**: chats with no folder assigned.
- **Collapsed folder**: folder row visible, chat rows hidden.
- **Expanded folder**: folder row visible, chat rows visible.

### 4.2 Sidebar Layout (High-level)
Within the existing sidebar chat area for the active profile:
1) **Folders section** (a list of folder rows, each expandable)
2) **Unfiled chats** (existing chat rows, unchanged)
3) **Archived chats** (existing archived area, unchanged)

Folders are listed even when empty so they remain visible “anchors” in the sidebar.

### 4.3 Create Folder
Entry point:
- Add a **New folder** action in the sidebar header area near **New chat**.

Flow:
1) User triggers **New folder**.
2) A small modal dialog opens:
   - Title: “New folder”
   - Input: folder name (single line)
   - Primary: **Create**
   - Secondary: **Cancel**
3) On success:
   - Folder appears in the **Folders** section (default state: expanded).
   - Focus remains stable; no chat navigation occurs.

Validation:
- Trim name on save.
- Reject empty/whitespace-only names.
- Max length: 60 chars (UI + server).
- Enforce uniqueness per profile (case-insensitive): folder names must be unique within a profile.

### 4.4 Rename Folder (v1)
Entry point:
- Folder row overflow menu (`…`) includes **Rename**.

Flow mirrors “Rename chat” (Feature #5):
- Modal: “Rename folder”
- Single-line input with current name
- Enter saves, Esc cancels

Validation rules match “Create Folder” (trim, non-empty, max length, per-profile unique).

### 4.5 Delete Folder
Entry point:
- Folder row overflow menu (`…`) includes **Delete folder**.

Confirmation dialog:
- Title: “Delete folder?”
- Body: “Chats in this folder will be moved to the root level.”
- Primary: **Delete**
- Secondary: **Cancel**

Success behavior:
- Folder row disappears.
- Any chats previously in the folder appear unfiled (root level) immediately.
- Any persisted collapsed state for that folder disappears with it.

### 4.6 Expand / Collapse Folder
Folder rows use a disclosure affordance (chevron):
- Clicking the chevron (or the folder row) toggles collapsed/expanded.

Persistence:
- Toggling a folder updates `chat_folders.collapsed` for that folder (see §5.3 / §6.3).
- Default state for a new folder is **expanded**.

### 4.7 Moving Chats Into/Out of Folders
Entry point:
- Chat row overflow menu (`…`) includes **Move to folder…** (in both active and archived lists).

Menu behavior:
- Shows a radio-like list:
  - “No folder” (root level)
  - One item per folder (by folder display order)
- Selecting an item immediately moves the chat (no extra confirmation).

Restrictions:
- Temporary chats are not moveable (consistent with other “persisted only” features); the menu item is hidden or disabled with a tooltip.

### 4.8 Ordering Rules
- Folders order (v1): stable by `created_at ASC`.
- Chats inside a folder: existing chat ordering rules (typically `updated_at DESC`).
- Unfiled chats: existing chat ordering rules.
- Moving a chat between folders should **not** modify `updated_at` (organizational changes shouldn’t reorder by “activity”).

## 5) Data Model / Persistence

### 5.1 DB: New `chat_folders` Table
Proposed SQLite table:
- `id` (string UUID)
- `profile_id` (string, required, indexed)
- `name` (string, required)
- `collapsed` (integer, required, default 0) — `0 = expanded`, `1 = collapsed`
- `created_at` (timestamp)
- `updated_at` (timestamp)

Indexes / constraints:
- Unique (case-insensitive) folder name per profile:
  - `(profile_id, name COLLATE NOCASE)` unique
- Ordering:
  - `(profile_id, created_at ASC)`

### 5.2 DB: Add Optional `folder_id` to `chats`
Add nullable `folder_id`:
- `chats.folder_id` references `chat_folders.id` (logical FK; SQLite FK optional)
- When a folder is deleted, all chats with that `folder_id` are set to `NULL`.

### 5.3 UI Persistence: Folder Collapsed State
Persist collapsed state server-side in `chat_folders.collapsed` (per profile, per folder).

Notes:
- Because RemcoChat has no auth, this state is effectively shared by anyone using the same profile.
- New folders default to `collapsed = 0` (expanded).

## 6) API

### 6.1 List Folders
`GET /api/folders?profileId=<id>`

Response:
```json
{ "folders": [ { "id": "...", "name": "...", "collapsed": false, "createdAt": "...", "updatedAt": "..." } ] }
```

### 6.2 Create Folder
`POST /api/folders`

Request:
```json
{ "profileId": "<id>", "name": "Work" }
```

Response:
```json
{ "folder": { ... } }
```

Server behavior:
- Enforce per-profile unique folder name (case-insensitive).
- New folder defaults to `collapsed = false` (expanded).

### 6.3 Update Folder (Rename + Collapse State)
`PATCH /api/folders/:folderId`

Request:
```json
{ "profileId": "<id>", "name": "New name", "collapsed": true }
```

Response:
```json
{ "folder": { ... } }
```

Server behavior:
- Allow updating `name` and/or `collapsed`.
- Validate per-profile name uniqueness when `name` changes.

### 6.4 Delete Folder
`DELETE /api/folders/:folderId`

Request:
```json
{ "profileId": "<id>" }
```

Response:
```json
{ "ok": true }
```

Server behavior:
- Validate folder belongs to `profileId`.
- In a single transaction:
  - set `chats.folder_id = NULL` where `folder_id = :folderId`
  - delete (or soft-delete) the folder row

### 6.5 Move Chat to Folder
Extend the existing chat update endpoint:
- `PATCH /api/chats/:chatId`

Add optional `folderId`:
```json
{ "profileId": "<id>", "folderId": "<folderId-or-null>" }
```

Server behavior:
- Validate chat belongs to profile.
- If `folderId` is non-null: validate folder exists and belongs to profile.
- Update chat `folder_id` without bumping `updated_at` (organizational change).

## 7) Implementation Notes (Proposed)
- Server:
  - Add folder CRUD helpers in `src/server/` (e.g. `src/server/folders.ts`).
  - Extend chat update helper (`updateChatForProfile(...)`) to accept `folderId`.
  - Add schema migration for `chat_folders` + `chats.folder_id`.
- API routes:
  - New routes under `src/app/api/folders/...` mirroring existing patterns (requires `profileId`).
  - Extend `src/app/api/chats/[chatId]/route.ts` `PATCH` body to accept `folderId`.
  - UI:
  - Sidebar rendering in `src/app/home-client.tsx`:
    - Fetch folders for active profile alongside chats.
    - Group chats by `folderId`.
    - Render folder disclosure rows + grouped chats.
    - Add “New folder” action and folder row menus (rename/delete).
    - Add “Move to folder…” item in chat menus (active + archived).
    - Use server-backed `folder.collapsed` for disclosure state, and `PATCH /api/folders/:folderId` to toggle.

## 8) Test Strategy (No Mocks)

### 8.1 Unit
- Folder validation:
  - trims name
  - rejects empty
  - enforces max length
- Deleting a folder moves chats to root:
  - create folder + assign chats + delete folder
  - verify chats have `folder_id = NULL`

### 8.2 E2E (Playwright)
1) Create profile.
2) Create two chats.
3) Create folder “Work”.
4) Move one chat into “Work”.
5) Collapse “Work” and assert moved chat is hidden.
6) Reload page and assert “Work” is still collapsed.
7) Delete “Work” and assert the moved chat reappears at root level.

## 9) Migration / Backwards Compatibility
- Existing chats default to `folder_id = NULL` and appear unfiled.
- If folder rename is deferred, the DB/API still supports it; UI can ship later.

## 10) Open Decisions
1) Should folders apply to archived chats visually (grouped), or keep archived list flat and only preserve `folder_id` for when unarchiving? Decision: keep archived list flat in v1; preserve `folder_id` silently.
2) Should folder ordering be purely creation-time, or should we add `position` now for future drag/reorder? Decision: creation-time ordering (`created_at ASC`) in v1 (no `position`).
3) Should moving chats bump `updated_at`? Decision: no (organizational changes shouldn’t look like “activity”).
