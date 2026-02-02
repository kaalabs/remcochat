# RemcoChat — SPEC: Rename Chat Titles (Feature #5)

## 1) Problem Definition
RemcoChat shows a sidebar list of chats. Chat titles are currently either:
- inferred from the first user message (auto-title), or
- empty and rendered as “New chat”.

There is no UI to rename an existing chat title, which makes it harder to keep the sidebar organized once you have many historical chats.

## 2) Goals
- Allow renaming a persisted chat’s title from the sidebar (active + archived lists).
- Changes persist in the DB and reflect immediately in the sidebar.
- Keep the interaction keyboard-friendly (Enter to save, Esc to cancel).
- Enforce a hard title limit of 200 characters (matches server validation).
- Keep the feature local-only (no auth; respects profile boundaries as best as possible).

## 3) Non-goals
- Automatic “AI summarization” of chat titles (beyond the existing first-message auto-title).
- Bulk rename / multi-select operations.
- Chat search, folders, or any other sidebar re-architecture.
- Renaming temporary chats (they are not persisted).

## 4) UX / Interaction Spec

### 4.1 Entry Point
For each chat row in the sidebar (both active and archived), add a menu item:
- **Rename**
- Location: chat overflow menu (`…`) alongside Archive/Export/Delete.
- Disabled whenever chat actions are disabled today (e.g. no active profile, `status !== "ready"`).

### 4.2 Rename Dialog
Selecting **Rename** opens a small modal dialog:
- Title: “Rename chat”
- Body: a single-line text input (prefilled with the current chat title; empty is allowed as an initial value).
- Primary action: **Save**
- Secondary action: **Cancel**

Focus/keyboard rules:
- Autofocus the input when the dialog opens.
- `Enter` triggers **Save** (only when the current input is valid).
- `Esc` triggers **Cancel** (close without changes).

Validation rules:
- Trim input before saving.
- Reject empty/whitespace-only titles (Save disabled and/or inline error).
- Reject titles longer than 200 characters (Save disabled and/or inline error).

Success behavior:
- Title updates in the sidebar immediately.
- Dialog closes.
- If the user is in the mobile drawer, keep current behavior: close the drawer only if the user explicitly navigates to a chat (rename should not unexpectedly close navigation UI).

Error behavior:
- If the save request fails, keep the dialog open and show a compact error message.

### 4.3 Ordering Behavior
Renaming counts as a chat update:
- The chat’s `updated_at` is updated.
- As a result, the chat may move to the top of the list (current ordering is `updated_at DESC`).

## 5) API / Persistence
Use the existing chat update endpoint:
- `PATCH /api/chats/:chatId`

Request payload:
```json
{ "profileId": "<activeProfileId>", "title": "<newTitle>" }
```

Server behavior:
- Validate `profileId` is present and matches the chat’s `profile_id` (consistent with archive/delete endpoints).
- Apply trimming and enforce max length (<= 200).
- Update `updated_at`.

Response payload:
```json
{ "chat": { ...updatedChat } }
```

## 6) Implementation Notes (Proposed)
- UI: `src/app/home-client.tsx`
  - Add dialog state: `renameOpen`, `renameChatId`, `renameDraft`, `renameSaving`, `renameError`.
  - Add a shared “Rename” menu item in both active and archived chat menus.
  - After saving, update local `chats` state and call `refreshChats(...)` to re-sync ordering.
- API: `src/app/api/chats/[chatId]/route.ts`
  - Extend `PATCH` to require and validate `profileId` for write operations.
- Server: `src/server/chats.ts`
  - Prefer a profile-aware update helper (e.g. reuse `assertChatWritable(...)`) when applying title patches.

## 7) Test Strategy (No Mocks)

### 7.1 Unit
- Server-side title validation:
  - trims whitespace
  - rejects > 200 chars
  - rejects profile mismatch (when enforced)
- Endpoint behavior:
  - `PATCH /api/chats/:id` returns updated chat title

### 7.2 E2E (Playwright)
Add an E2E covering the full UX:
1) Create profile.
2) Create a chat by sending a message (ensures it appears in sidebar).
3) Open chat menu → Rename → set a new title → Save.
4) Assert sidebar shows the new title.
5) Reload page → assert title persists.
6) (Archived path) Archive chat → open archived list → rename again → assert updated title.

## 8) Open Decisions
1) Should empty titles be allowed as a way to “reset to auto-title”, or should we keep empty invalid and add an explicit “Reset title” menu item later? Decision: keep empty invalid in v1.
2) Should renaming bump `updated_at` (and thus reorder chats), or should title changes preserve ordering? Decision: bump `updated_at` (simple, consistent with current sorting).

