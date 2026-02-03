## Feature #11 — Sidebar Chat Folders (Implementation TODO)

Reference spec: [feat-11-chat-folders.md](docs/dev/features/feat-11-chat-folders.md)

Rules:
- Work is executed **one phase at a time**.
- **Do not start** a phase until the prior phase is fully complete (including verification items).
- Items marked **[PARALLEL]** within a phase can be implemented in parallel (no dependencies on other TODOs in that phase).

---

## Phase 0 — Data Model + Server Primitives

Goal:
- Add DB structures for folders + chat→folder association.
- Implement server-layer CRUD + invariants so API/UI layers can be thin.

  - [x] Add DB schema for folders:
      - [x] [PARALLEL] `src/server/db.ts`: create `chat_folders` table (`id`, `profile_id`, `name`, `created_at`, `updated_at`).
      - [x] [PARALLEL] `src/server/db.ts`: create indexes (at minimum `profile_id`, and a stable ordering index like `profile_id, created_at ASC`).
      - [x] [PARALLEL] `src/server/db.ts`: add `collapsed INTEGER NOT NULL DEFAULT 0` to `chat_folders` (0=expanded, 1=collapsed).
      - [x] Implement folder name uniqueness per profile (case-insensitive):
          - [x] Add unique index `(profile_id, name COLLATE NOCASE)`
          - [x] Ensure server returns a clear “folder name already exists” error on create/rename.

  - [x] Add DB schema for chat→folder link:
      - [x] [PARALLEL] `src/server/db.ts`: add nullable `chats.folder_id` via `PRAGMA table_info(chats)` check + `ALTER TABLE`.
      - [x] [PARALLEL] `src/server/db.ts`: add index for grouping/filtering (e.g. `(profile_id, folder_id)` or `(folder_id)`).

  - [x] Add server module for folders:
      - [x] Create `src/server/folders.ts` with:
          - [x] `listFolders(profileId)`
          - [x] `createFolder(profileId, { name })`
          - [x] `renameFolder(profileId, folderId, { name })`
          - [x] `setFolderCollapsed(profileId, folderId, { collapsed })` (or fold into update helper)
          - [x] `deleteFolder(profileId, folderId)` that moves chats to root (`folder_id = NULL`) and deletes the folder in a single transaction.
      - [x] Enforce invariants:
          - [x] Trim `name`, reject empty/whitespace-only.
          - [x] Enforce max length = 60 (match spec; align with any existing shared constants/patterns).
          - [x] Validate folder belongs to the profile for update/delete.

  - [x] Extend server chat updates to support folder moves:
      - [x] Update `src/server/chats.ts` (or equivalent) to accept `folderId?: string | null` in `updateChatForProfile(...)`.
      - [x] Validate folder exists and belongs to profile when `folderId !== null`.
      - [x] Ensure moving folders does **not** bump `updated_at` (organizational change).

  - [x] Phase 0 verification (must pass):
      - [x] Boot app against an existing DB (no migration errors).
      - [x] Create folder row(s) and verify they persist in SQLite.
      - [x] Assign a chat to a folder and verify `chats.folder_id` updates correctly.
      - [x] Delete a folder and verify all its chats now have `folder_id = NULL`.

---

## Phase 1 — API Routes (Folders + Move Chat)

Goal:
- Expose folder CRUD + chat move via Next.js API routes, profile-scoped like existing endpoints.

  - [x] Add folders API:
      - [x] [PARALLEL] Create `src/app/api/folders/route.ts`:
          - [x] `GET /api/folders?profileId=...` → `{ folders }`
          - [x] `POST /api/folders` with `{ profileId, name }` → `{ folder }`
      - [x] [PARALLEL] Create `src/app/api/folders/[folderId]/route.ts`:
          - [x] `PATCH /api/folders/:folderId` with `{ profileId, name?, collapsed? }` → `{ folder }`
          - [x] `DELETE /api/folders/:folderId` with `{ profileId }` → `{ ok: true }`
      - [x] Match existing error contract patterns (`Missing profileId.`, status codes, etc.).

  - [x] Extend chat update endpoint to support `folderId`:
      - [x] [PARALLEL] Update `src/app/api/chats/[chatId]/route.ts` `PATCH` body parsing to include `folderId?: string | null`.
      - [x] [PARALLEL] Ensure server-side validation rejects folder ids from other profiles.

  - [x] Phase 1 verification (must pass):
      - [x] `GET /api/folders?profileId=...` returns created folders.
      - [x] `POST /api/folders` creates a folder and returns it.
      - [x] `PATCH /api/chats/:chatId` with `folderId` moves a chat.
      - [x] `DELETE /api/folders/:folderId` moves chats to root and removes the folder.

---

## Phase 2 — UI (Sidebar Folders + Persistent Collapse State)

Goal:
- Implement the sidebar folders UX: create folder, show always-visible folders list, collapse/expand with persistence, move chats via menus, delete folder behavior.

  - [x] Add server-backed persistence for collapsed/expanded state:
      - [x] [PARALLEL] Folder list response includes `collapsed` and UI renders disclosure state from the server.
      - [x] [PARALLEL] Toggling a folder calls `PATCH /api/folders/:folderId` with `{ collapsed }`.
      - [x] Ensure default: new folders start **expanded** (`collapsed = false`).

  - [x] Add folder fetching + state management:
      - [x] [PARALLEL] Add a client fetcher for `/api/folders` and integrate with existing profile switching behavior.
      - [x] Decide refresh strategy after mutations (optimistic update vs refetch); keep consistent with chats refresh patterns.

  - [x] Render folders section in the sidebar:
      - [x] In the chat history overview component (likely `src/app/home-client.tsx`), group chats by `folderId`.
      - [x] Render folders section before unfiled chats.
      - [x] Ensure folders are visible even when empty (folder row still renders).
      - [x] Expand/collapse hides/shows the chat rows under that folder.

  - [x] Create folder UI:
      - [x] Add “New folder” entry point in the sidebar header area.
      - [x] Modal dialog with validation (trim, non-empty, max length).
      - [x] On success, render folder immediately and ensure it is expanded by default.

  - [x] Rename folder UI:
      - [x] Folder overflow menu includes “Rename”.
      - [x] Modal dialog with validation (trim, non-empty, max length, unique per profile).
      - [x] On success, sidebar updates immediately.

  - [x] Delete folder UI:
      - [x] Folder overflow menu (`…`) includes “Delete folder”.
      - [x] Confirmation dialog explains chats move to root.
      - [x] On success, folder disappears; affected chats show up unfiled; persisted collapse state for that id is removed/ignored.

  - [x] Move chat UI:
      - [x] Chat overflow menu includes “Move to folder…”.
      - [x] Menu shows:
          - [x] “No folder” option
          - [x] One option per folder
      - [x] Selecting an option moves the chat immediately (calls `PATCH /api/chats/:chatId` with `folderId`).
      - [x] Ensure this exists in both active and archived lists (per spec); archived list can remain flat but still supports changing `folderId`.

  - [x] Phase 2 verification (must pass):
      - [x] Create a folder and see it in the sidebar (even if empty).
      - [x] Collapse a folder, reload the page, and confirm it stays collapsed for that profile.
      - [x] Move a chat into a folder and confirm it appears under that folder.
      - [x] Delete a folder and confirm contained chats reappear unfiled.

---

## Phase 3 — Tests (No Mocks) + Hard Verification

Goal:
- Add unit + E2E coverage for core invariants and the end-to-end UX.

  - [x] Unit tests:
      - [x] [PARALLEL] Folder name validation (trim, empty reject, max length).
      - [x] [PARALLEL] Delete folder moves chats to root (`folder_id = NULL`) in a single transaction.
      - [x] [PARALLEL] Chat move validation rejects cross-profile folder ids.
      - [x] [PARALLEL] Chat move does not bump `updated_at` (if the codebase currently asserts this behavior).

  - [x] Playwright E2E:
      - [x] [PARALLEL] Add E2E for:
          - [x] create profile
          - [x] create two chats
          - [x] create folder “Work”
          - [x] move one chat into “Work”
          - [x] collapse “Work” → moved chat hidden
          - [x] reload → still collapsed
          - [x] delete folder → moved chat appears unfiled

  - [ ] Phase 3 verification (must pass):
      - [x] `npm run test:unit`
      - [x] `npm run test:e2e`

---

## Phase 4 (Optional) — Rename Folder + Ordering Polish

Goal:
- Ship optional UX and ordering improvements without changing core semantics.

  - [ ] Folder ordering:
      - [ ] Decide whether to add `position` now (future-proofing) or keep `created_at` ordering.
      - [ ] If adding `position`, add DB + server ordering and a migration-safe default value.

  - [ ] Phase 4 verification (must pass):
      - [ ] Rename folder persists across reloads.
      - [ ] Folder ordering remains stable and deterministic.
