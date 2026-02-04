# RemcoChat — SPEC: Shared Chat Folders (Feature #12)

## 1) Problem Definition
RemcoChat supports multiple profiles (LAN / no auth) and already supports sharing of certain entities across profiles (e.g. lists and agenda items via membership tables). Chat folders (Feature #11) help organize chats within a profile, but folders are currently private to the owning profile.

This feature introduces the ability to **share a chat folder with another profile**. When a folder is shared:
- The folder itself becomes visible to the recipient profile(s).
- **All chats in that folder are accessible** to the recipient profile(s).
- Sharing follows the folder: moving a chat out of a shared folder stops sharing for that chat; adding/moving a chat into a shared folder makes it shared automatically.

The UI must clearly indicate that a folder is shared (via the folder icon). Individual chats inside a shared folder do **not** need separate “shared” markers; the folder context is sufficient.

## 2) Goals
- Share/unshare a folder with another existing profile (same pattern as list/agenda sharing).
- Share/unshare effects apply to **all chats within the folder**:
  - Unsharing a folder stops access to all its chats for that profile.
  - Moving a chat out of a shared folder stops sharing for that chat.
  - Deleting a chat stops sharing for that chat (obvious).
  - New chats added to a shared folder are automatically shared.
- Keep the existing “folders are per profile” model: a shared folder has a single **owner profile**; sharing grants access to other profiles.
- Make shared folders visually distinct via an icon affordance on the folder row.
- Preserve current behavior that chats in a folder don’t need additional markers.

## 3) Non-goals (v1)
- Direct “share a single chat” UX (chat sharing is folder-derived only).
- Sharing outside the local RemcoChat instance (no links, invites, or external identities).
- Permissions/auth beyond profile boundaries (RemcoChat remains LAN/no auth).
- “Personal views” of a shared folder (renaming a shared folder locally, custom ordering, per-recipient hiding, etc.).
- Nested folders.

## 4) UX / Interaction Spec

### 4.1 Terminology
- **Owner**: the profile that created the folder (`chat_folders.profile_id`).
- **Recipient / member**: a profile that the folder is shared with.
- **Shared folder**:
  - For the owner: a folder that has 1..N members.
  - For a recipient: any folder owned by another profile that they have membership for.

### 4.2 Sidebar Layout
Within the existing sidebar chat area for the active profile:
- Show **Owned folders** as today (Feature #11).
- Add a **Shared folders** section (recommended) beneath owned folders, grouped by owner profile name when multiple owners exist:
  - `Shared from Remco`
  - `Shared from Caroline`

Rationale: shared folders can collide in name (“Work”), and grouping by owner keeps it understandable without marking every chat.

### 4.3 Shared Folder Visual Indicator (Folder Icon)
Folder rows that are shared must be visually distinct:
- Add a small “shared” indicator on the folder icon (e.g. link/people overlay).
- Apply indicator in both views:
  - Owner view: show indicator when `sharedWithCount > 0`.
  - Recipient view: show indicator always (folder is shared by definition).

Chats inside the folder remain visually unchanged.

### 4.4 Share Folder
Entry point:
- Folder row overflow menu (`…`) includes **Share folder…** (owner only).

Flow:
1) Owner clicks **Share folder…**
2) Modal opens:
   - Title: “Share folder”
   - Input: target profile (search/select by name; same resolving rules as list sharing)
   - Primary: **Share**
   - Secondary: **Cancel**
   - Helper text: “This will share all chats in this folder.”
3) On success:
   - Folder remains in place; its icon shows the shared indicator.
   - (Optional) show a small “Shared with Caroline” toast.

Validation / errors:
- Target profile must exist.
- Reject sharing with self (owner).
- Sharing is idempotent (share twice does nothing).

### 4.5 Manage Sharing / Stop Sharing
Entry points:
- Folder row overflow menu (`…`) includes **Manage sharing…** (owner only) if folder has members.
- Within the manage dialog, show a list of members with per-member **Stop sharing** actions.

Flow:
1) Owner opens **Manage sharing…**
2) Dialog lists:
   - Owner (read-only, not removable)
   - Members: each with a “Stop sharing” button
3) Stopping sharing immediately removes access for that profile.

Recipient UX on removal:
- The shared folder disappears from their sidebar.
- If they currently have a chat open from that folder:
  - Next attempted load/stream should return an error (“Chat is no longer shared with this profile.”) and the client should navigate back to a safe state (e.g. home + show a toast).

### 4.6 Recipient Capabilities (What can recipients do?)
To keep behavior predictable and to avoid recipients restructuring someone else’s organization:
- Recipients can:
  - View shared chats.
  - Continue the conversation (send new messages) in a shared chat.
- Recipients cannot:
  - Rename/delete the shared folder.
  - Share/unshare the shared folder with others.
  - Move chats into/out of the shared folder (folder organization is owner-controlled).
  - Change chat metadata (title/model/instructions), archive/unarchive, or delete the chat (owner-only).

Note: “continue the conversation” writes to the same underlying chat, so all participants see the same message history.

### 4.7 Automatic Sharing Rules (Core Invariants)
Folder membership is the *source of truth* for sharing:
- **A chat is accessible to a profile if and only if:**
  - the profile is the chat owner (`chats.profile_id = profileId`), OR
  - the chat is in a folder for which the profile is a member (`chats.folder_id ∈ shared folders for profileId`).

Consequences:
- Unsharing a folder immediately removes access to all chats currently in it.
- Moving a chat out of a shared folder immediately removes access for members of the old folder.
- Moving a chat into a shared folder immediately grants access to members of the new folder.
- New chats created in a shared folder are automatically accessible to all folder members (no extra per-chat “share” bookkeeping).

### 4.8 Delete Folder / Delete Chat Interactions
- If an owner deletes a folder (Feature #11 behavior moves chats to root), then:
  - Folder membership rows are deleted (via FK cascade).
  - The folder disappears for recipients and access to those chats stops (because chats are no longer in that folder).
- If an owner deletes a chat inside a shared folder:
  - Chat is gone for everyone who had access; sharing is inherently stopped.

## 5) Data Model / Persistence

### 5.1 DB: New `chat_folder_members` Table
Add a new SQLite membership table (mirrors `list_members` / `agenda_item_members`):

- `folder_id TEXT NOT NULL REFERENCES chat_folders(id) ON DELETE CASCADE`
- `profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE`
- `collapsed INTEGER NOT NULL DEFAULT 0` — per-recipient collapsed state (`0 = expanded`, `1 = collapsed`)
- `created_at TEXT NOT NULL`
- `PRIMARY KEY (folder_id, profile_id)`

Indexes:
- `idx_chat_folder_members_profile` on `(profile_id)`
- `idx_chat_folder_members_folder` on `(folder_id)`

Ownership rules:
- Folder owner is `chat_folders.profile_id`.
- Membership rows represent “shared with” profiles only (the owner is not stored in this table).
- Only the owner can add/remove membership rows (share/unshare).
State rules:
- `chat_folders.collapsed` remains the owner’s collapse state for owned folders (Feature #11).
- `chat_folder_members.collapsed` stores the recipient’s collapse state for shared folders.

### 5.2 No Per-Chat Membership Table (Intentional)
Chats become shared strictly by folder membership. There is no `chat_members` table in v1.

Rationale:
- All required behaviors (unshare folder, move chat out, delete chat, add new chat) are naturally enforced by `chats.folder_id` + `chat_folder_members`.
- Avoids synchronization bugs between “folder shared” vs “chat shared”.

### 5.3 “Shared” Computations
For folders:
- `sharedWithCount` for an owner folder is `COUNT(chat_folder_members WHERE folder_id = folder.id)`.
- Recipient can treat any folder returned via membership join as `scope = shared`.

For chats:
- A chat is “shared” from the perspective of a profile if access is via membership (not ownership).
- UI does not need to display this per chat, but the server may still expose `scope` / `ownerProfileId` for permission checks and safe UX.

## 6) API

### 6.1 List Accessible Folders (Owned + Shared)
Extend folder listing to return **accessible** folders for a profile.

`GET /api/folders?profileId=<id>`

Response:
```json
{
  "folders": [
    {
      "id": "folder_123",
      "profileId": "owner_profile_id",
      "name": "Work",
      "collapsed": false,
      "createdAt": "...",
      "updatedAt": "...",
      "scope": "owned",
      "sharedWithCount": 2,
      "ownerName": "Remco"
    },
    {
      "id": "folder_999",
      "profileId": "other_owner_profile_id",
      "name": "Project X",
      "collapsed": false,
      "createdAt": "...",
      "updatedAt": "...",
      "scope": "shared",
      "sharedWithCount": 0,
      "ownerName": "Caroline"
    }
  ]
}
```

Notes:
- Existing UI fields remain; `scope/sharedWithCount/ownerName` are additive.
- `collapsed` is **viewer-specific**:
  - For `scope="owned"`, it is derived from `chat_folders.collapsed`.
  - For `scope="shared"`, it is derived from `chat_folder_members.collapsed`.
- Ordering:
  - Owned folders: `created_at ASC` (unchanged from Feature #11).
  - Shared folders: grouped by `ownerName ASC`, then `createdAt ASC` within each owner group.

### 6.2 Share Folder
`POST /api/folders/:folderId/share`

Request:
```json
{ "profileId": "<ownerProfileId>", "targetProfile": "<profile id or name hint>" }
```

Response:
```json
{ "ok": true }
```

Server behavior:
- Validate folder exists and is owned by `profileId`.
- Resolve `targetProfile` similarly to list sharing.
- Insert membership row with `INSERT OR IGNORE` and `collapsed = 0` (expanded) for the recipient by default.

### 6.3 Unshare Folder (Stop sharing with a profile)
`POST /api/folders/:folderId/unshare`

Request:
```json
{ "profileId": "<ownerProfileId>", "targetProfile": "<profile id or name hint>" }
```

Response:
```json
{ "ok": true }
```

Server behavior:
- Validate folder exists and is owned by `profileId`.
- Resolve target profile.
- Delete membership row; reject attempts to “unshare” the owner.

### 6.4 List Folder Members (Owner only)
`GET /api/folders/:folderId/members?profileId=<ownerProfileId>`

Response:
```json
{
  "members": [
    { "profileId": "caroline_id", "name": "Caroline", "createdAt": "..." }
  ]
}
```

### 6.5 Update Folder (Owner) / Update Shared Folder State (Recipient)
Extend the existing folder update endpoint so it supports:
- Owner updating folder fields (rename + owner collapsed state).
- Recipient updating **their** shared folder collapsed state.

`PATCH /api/folders/:folderId`

Request (owner):
```json
{ "profileId": "<ownerProfileId>", "name": "New name", "collapsed": true }
```

Request (recipient, shared folder):
```json
{ "profileId": "<recipientProfileId>", "collapsed": true }
```

Response:
```json
{ "folder": { "...": "..." } }
```

Server behavior:
- If `profileId` is the folder owner:
  - Allow updating `name` and/or `collapsed` on `chat_folders`.
- Else if `profileId` is a member of the folder:
  - Reject `name` updates (owner-only).
  - Allow updating `chat_folder_members.collapsed`.
- Else:
  - Return a not-found / not-accessible error.

### 6.6 List Accessible Chats (Owned + Shared via Folder Membership)
Extend chat listing to return chats accessible to a profile.

`GET /api/chats?profileId=<id>`

Response extends existing chat shape with additive metadata:
```json
{
  "chats": [
    {
      "id": "chat_1",
      "profileId": "owner_profile_id",
      "folderId": "folder_999",
      "scope": "shared",
      "ownerName": "Caroline"
    }
  ]
}
```

Notes:
- UI does not need to mark shared chats; folder context is sufficient.
- Server should use `scope` to enforce “owner-only metadata operations” (see §4.6).

### 6.7 Chat Access for Streaming (`/api/chat`)
For `POST /api/chat` with `{ profileId, chatId }`:
- Allow streaming when the profile can access the chat via ownership or shared folder membership (see §4.7).
- Preserve existing write path for messages (messages are stored under `chat_id` and become visible to all who can access the chat).

## 7) Implementation Notes (Proposed)
- DB:
  - Add `chat_folder_members` to `src/server/db.ts`.
- Server queries:
  - Extend folder listing (`src/server/folders.ts` or a new module) to return owned + shared folders.
  - Extend chat listing / `getChat` (`src/server/chats.ts`) to allow access via shared folder membership.
  - Add server helpers:
    - `shareFolder(profileId, folderId, targetProfileIdentifier)`
    - `unshareFolder(profileId, folderId, targetProfileIdentifier)`
    - `listFolderMembers(profileId, folderId)`
- API routes:
  - Add new routes:
    - `src/app/api/folders/[folderId]/share/route.ts`
    - `src/app/api/folders/[folderId]/unshare/route.ts`
    - `src/app/api/folders/[folderId]/members/route.ts`
- Permissions:
  - Keep rename/delete folder owner-only.
  - Keep chat metadata mutation owner-only; recipients can still post messages via `/api/chat`.
- UI:
  - Add shared indicator to folder icon.
  - Add folder overflow items (Share folder…, Manage sharing…).
  - Add “Shared folders” section (or equivalent grouping) in sidebar.

## 8) Test Strategy (No Mocks)

### 8.1 Unit
- Membership invariants:
  - Only owner can share/unshare.
  - Cannot share with self.
  - Sharing is idempotent.
  - Unsharing removes access via membership join.
- Access rules:
  - `listChats(profileId)` includes chats in folders shared to that profile.
  - Moving a chat out of a shared folder removes it from recipient access (derived).

### 8.2 E2E (Playwright)
1) Create Profile A and Profile B.
2) In Profile A: create folder “Work” and create chat “Spec draft”; move chat into “Work”.
3) In Profile A: share folder “Work” with Profile B.
4) Switch to Profile B:
   - Verify “Work” shows under shared folders with shared icon.
   - Verify chat appears inside it and can be opened.
5) In Profile A: move the chat out of “Work”.
6) In Profile B: verify the chat disappears from the shared folder (and cannot be opened).
7) In Profile A: create a new chat in “Work”; verify it appears for Profile B without additional sharing steps.
8) In Profile A: stop sharing “Work” with Profile B; verify folder disappears for Profile B.

## 9) Migration / Backwards Compatibility
- Existing DBs: adding `chat_folder_members` is additive; no data migration required.
- Existing folder and chat endpoints can keep their current response fields; new fields (`scope`, `ownerName`, `sharedWithCount`) are additive.
- No changes to existing chat folder behavior for single-profile users.

## 10) Open Decisions
1) **Collapsed state for shared folders:** Decision = **B**. Persist per-recipient collapse state in `chat_folder_members.collapsed` and expose it through `GET /api/folders` / update via `PATCH /api/folders/:folderId`.
2) **Shared folder ordering:** Order shared folders by **owner name**, then `created_at ASC` within each owner group.
3) **Prompt/memory behavior in shared chats:** Apply profile memory/instructions **as usual** (per active profile) when participating in a shared chat.
