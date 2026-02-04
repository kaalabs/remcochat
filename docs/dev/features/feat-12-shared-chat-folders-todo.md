## Feature #12 — Shared Chat Folders (Implementation TODO)

Reference spec: [feat-12-shared-chat-folders.md](docs/dev/features/feat-12-shared-chat-folders.md)

Rules:
- Work is executed **one phase at a time**.
- **Do not start** a phase until the prior phase is fully complete (including verification items).
- Items marked **[PARALLEL]** within a phase can be implemented in parallel (no dependencies on other TODOs in that phase).

---

## Phase 0 — Data Model + Server Primitives (Access Rules + Sharing)

Goal:
- Add DB structures for folder sharing (membership table + per-recipient collapsed state).
- Implement server-layer access rules so API/UI layers can be thin:
  - accessible folders = owned + shared
  - accessible chats = owned + chats-in-shared-folders
  - recipients can write messages via `/api/chat` but cannot mutate chat/folder metadata

  - [ ] Add DB schema for folder sharing:
      - [ ] [PARALLEL] `src/server/db.ts`: create `chat_folder_members` table:
          - [ ] columns: `folder_id`, `profile_id`, `collapsed INTEGER NOT NULL DEFAULT 0`, `created_at`
          - [ ] `PRIMARY KEY (folder_id, profile_id)`
          - [ ] FKs: `folder_id → chat_folders(id) ON DELETE CASCADE`, `profile_id → profiles(id) ON DELETE CASCADE`
      - [ ] [PARALLEL] `src/server/db.ts`: add indexes:
          - [ ] `idx_chat_folder_members_profile` on `(profile_id)`
          - [ ] `idx_chat_folder_members_folder` on `(folder_id)`

  - [ ] Extend server folders module to support sharing + accessible listing:
      - [ ] [PARALLEL] `src/server/folders.ts`: extend folder listing to return **accessible** folders for a profile:
          - [ ] include `scope: "owned" | "shared"`
          - [ ] include `ownerName`
          - [ ] include `sharedWithCount` for owned folders
          - [ ] `collapsed` is viewer-specific:
              - [ ] for owned folders: from `chat_folders.collapsed`
              - [ ] for shared folders: from `chat_folder_members.collapsed`
          - [ ] ordering:
              - [ ] owned: `created_at ASC`
              - [ ] shared: group by `ownerName ASC`, then `created_at ASC` within owner
      - [ ] [PARALLEL] `src/server/folders.ts`: add owner-only share primitives:
          - [ ] `shareFolder(profileId, folderId, { targetProfile })`:
              - [ ] validate folder exists and is owned by `profileId`
              - [ ] resolve `targetProfile` (same pattern as list sharing)
              - [ ] reject sharing with owner/self
              - [ ] `INSERT OR IGNORE` membership row with `collapsed = 0`
          - [ ] `unshareFolder(profileId, folderId, { targetProfile })`:
              - [ ] validate folder exists and is owned by `profileId`
              - [ ] resolve `targetProfile`
              - [ ] reject attempts to remove owner/self
              - [ ] delete membership row
          - [ ] `listFolderMembers(profileId, folderId)` (owner only) with `{ profileId, name, createdAt }`
      - [ ] [PARALLEL] `src/server/folders.ts`: allow recipients to update shared-folder collapsed state:
          - [ ] extend existing `updateFolder(...)` logic to:
              - [ ] owner can update `chat_folders` (`name`, `collapsed`)
              - [ ] member can update only `chat_folder_members.collapsed` (reject name changes)

  - [ ] Extend server chat access to include shared chats (folder-derived):
      - [ ] [PARALLEL] `src/server/chats.ts`: extend `listChats(profileId)` to include:
          - [ ] owned chats (`chats.profile_id = profileId`)
          - [ ] shared chats where `chats.folder_id` is a folder shared to `profileId`
          - [ ] include additive metadata: `scope` + `ownerName` (and keep `folderId`)
      - [ ] [PARALLEL] `src/server/chats.ts`: extend `getChat(profileId, chatId)` (or equivalent) to allow access via shared folder membership.
      - [ ] `src/server/chats.ts`: enforce permissions for recipients:
          - [ ] recipients must not be able to update chat metadata (title/model/chatInstructions/folderId), archive/unarchive, or delete
          - [ ] keep message writing via `/api/chat` allowed for accessible chats

  - [ ] Phase 0 verification (must pass):
      - [ ] Boot app against an existing DB (no migration errors).
      - [ ] Create Profile A + Profile B.
      - [ ] In Profile A: create folder “Work” and share it with Profile B.
      - [ ] In Profile B: folder list includes the shared folder with `scope="shared"` and `collapsed` reflects `chat_folder_members.collapsed`.
      - [ ] In Profile A: create a chat and move it into “Work”; Profile B now sees the chat in its `/api/chats?profileId=...` results (derived sharing).
      - [ ] In Profile A: move chat out of “Work”; Profile B loses access to the chat.

---

## Phase 1 — API Routes (Share/Unshare/Members + Accessible Lists)

Goal:
- Expose folder sharing endpoints and make existing folder/chat list endpoints return accessible (owned + shared) data.
- Ensure server/API enforce owner-only vs recipient permissions as defined in the spec.

  - [ ] Add folder sharing API routes:
      - [ ] [PARALLEL] Create `src/app/api/folders/[folderId]/share/route.ts`:
          - [ ] `POST /api/folders/:folderId/share` with `{ profileId, targetProfile }` → `{ ok: true }`
      - [ ] [PARALLEL] Create `src/app/api/folders/[folderId]/unshare/route.ts`:
          - [ ] `POST /api/folders/:folderId/unshare` with `{ profileId, targetProfile }` → `{ ok: true }`
      - [ ] [PARALLEL] Create `src/app/api/folders/[folderId]/members/route.ts`:
          - [ ] `GET /api/folders/:folderId/members?profileId=...` → `{ members }`

  - [ ] Extend existing folders API behavior:
      - [ ] `src/app/api/folders/route.ts`:
          - [ ] `GET /api/folders?profileId=...` returns accessible folders and includes additive fields (`scope`, `ownerName`, `sharedWithCount`)
      - [ ] `src/app/api/folders/[folderId]/route.ts`:
          - [ ] `PATCH /api/folders/:folderId` supports:
              - [ ] owner updates (`name`, owner `collapsed`)
              - [ ] recipient updates (only `collapsed`, stored in `chat_folder_members`)

  - [ ] Extend existing chats API behavior:
      - [ ] `src/app/api/chats/route.ts`:
          - [ ] `GET /api/chats?profileId=...` returns accessible chats (owned + shared) with additive fields (`scope`, `ownerName`)
      - [ ] `src/app/api/chats/[chatId]/route.ts`:
          - [ ] enforce owner-only for `PATCH` and `DELETE` when the chat is shared-access (recipient) rather than owned

  - [ ] Phase 1 verification (must pass):
      - [ ] `POST /api/folders/:folderId/share` shares the folder and is idempotent.
      - [ ] `GET /api/folders/:folderId/members?profileId=...` lists members for the owner only.
      - [ ] `POST /api/folders/:folderId/unshare` removes membership and the folder disappears for the recipient.
      - [ ] Recipient cannot `PATCH /api/chats/:chatId` or `DELETE /api/chats/:chatId` for shared chats (clear error).
      - [ ] Recipient can still use `/api/chat` for a shared chat and receives a streamed response.

---

## Phase 2 — UI (Shared Folders + Sharing Management + Permissions)

Goal:
- Make shared folders obvious and usable in the sidebar.
- Provide owner-only sharing UX and recipient-safe restrictions.

  - [ ] Shared folder rendering + grouping:
      - [ ] In sidebar folder rendering (likely `src/app/home-client.tsx`):
          - [ ] Render a “Shared folders” section beneath owned folders.
          - [ ] Group shared folders by `ownerName` and within each group order by `createdAt ASC`.
          - [ ] Show folders even when empty (still render the folder row).
          - [ ] Use the `collapsed` value from `/api/folders` (viewer-specific).

  - [ ] Shared icon indicator on folder rows:
      - [ ] Owned folders: show shared indicator when `sharedWithCount > 0`.
      - [ ] Shared folders (recipient view): always show shared indicator.

  - [ ] Folder overflow menu additions (owner only):
      - [ ] Add “Share folder…” action to owned folders.
      - [ ] Add “Manage sharing…” action when `sharedWithCount > 0`.
      - [ ] Share dialog:
          - [ ] target profile selection (name/id lookup)
          - [ ] helper text “This will share all chats in this folder.”
      - [ ] Manage sharing dialog:
          - [ ] list members via `GET /api/folders/:folderId/members`
          - [ ] per-member “Stop sharing” (calls `POST /api/folders/:folderId/unshare`)

  - [ ] Recipient restrictions:
      - [ ] Shared folder rows:
          - [ ] hide/disable rename + delete folder actions
          - [ ] hide/disable “Share folder…” / “Manage sharing…” actions
      - [ ] Shared chats:
          - [ ] hide/disable chat metadata actions (rename, change model, instructions), archive/unarchive, delete, and move-to-folder
          - [ ] keep “open chat” and “send message” fully functional

  - [ ] Unshare / removal UX safety:
      - [ ] If a shared folder is removed while the recipient has a chat open from it:
          - [ ] handle server error (“no longer shared”) and navigate back to a safe UI state with a toast.

  - [ ] Phase 2 verification (must pass):
      - [ ] Owner shares folder → recipient sees folder under “Shared folders” with shared icon.
      - [ ] Recipient can open a shared chat and continue the conversation.
      - [ ] Owner moves chat out of shared folder → recipient immediately loses access (chat disappears).
      - [ ] Owner stops sharing → shared folder disappears for recipient.
      - [ ] Recipient can collapse/expand shared folder and state persists (via `chat_folder_members.collapsed`).

---

## Phase 3 — Tests (No Mocks)

Goal:
- Lock in access rules and derived sharing behavior.

  - [ ] Unit tests:
      - [ ] `chat_folder_members` share primitives:
          - [ ] only owner can share/unshare
          - [ ] cannot share with self
          - [ ] sharing is idempotent
      - [ ] access rules:
          - [ ] `listChats(profileId)` includes chats in folders shared to that profile
          - [ ] moving a chat out of a shared folder removes recipient access
          - [ ] recipient cannot mutate chat metadata (owner-only enforcement)
      - [ ] collapse state:
          - [ ] owner `chat_folders.collapsed` is independent from recipient `chat_folder_members.collapsed`

  - [ ] E2E (Playwright):
      - [ ] Create Profile A and Profile B.
      - [ ] In Profile A: create folder “Work”; create chat “Spec draft”; move chat into “Work”.
      - [ ] In Profile A: share folder “Work” with Profile B.
      - [ ] Switch to Profile B:
          - [ ] Verify “Work” appears under shared folders with shared icon.
          - [ ] Verify chat appears inside it and can be opened.
      - [ ] In Profile A: move the chat out of “Work”.
      - [ ] In Profile B: verify the chat disappears and cannot be opened.
      - [ ] In Profile A: move a new chat into “Work”; verify it appears for Profile B without additional sharing steps.
      - [ ] In Profile A: stop sharing “Work” with Profile B; verify folder disappears for Profile B.
