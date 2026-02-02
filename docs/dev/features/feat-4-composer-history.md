# RemcoChat — SPEC: Composer Prompt History (Feature #4)

## 1) Problem Definition
In RemcoChat, once a user submits a message the composer is cleared. Reusing or iterating on a previous prompt requires copying from the message list (slow and error-prone).

Feature #4 requests a keyboard-first flow:
- Pressing `ArrowUp` in the composer recalls the previous prompt text.
- Repeating `ArrowUp` walks back through the chat’s prompt history.

## 2) Goals
- `ArrowUp` recalls the most recent **user** prompt from the current chat session.
- Repeated `ArrowUp` steps further back through prior user prompts (oldest → newest navigation is possible).
- `ArrowDown` steps forward; returning past the most recent history entry restores the user’s pre-navigation draft.
- Works with multi-line prompts without breaking normal cursor movement within the textarea.
- No new UI elements required (purely keyboard behavior).
- Works for both temporary chats and persisted chats (history source is the in-memory `messages` list).

## 3) Non-goals
- Global prompt history across chats/profiles/devices.
- Persisting prompt history as a separate DB table or audit log.
- Editing past messages (that remains the responsibility of “Edit & fork”).
- Search, filtering, or fuzzy-find over history.
- Any new settings screen toggle (v1 is always-on).

## 4) UX / Interaction Spec

### 4.1 Terminology
- **History**: the list of submitted user prompt texts in the current chat (chronological).
- **Draft**: the composer contents when the user starts navigating history (often empty).
- **History cursor**: an index into `[0..history.length]` where `history.length` represents “draft”.

### 4.2 History Source
History is derived from the current `messages` array:
- Include only messages with `role === "user"`.
- Extract text from `parts` of type `text`.
- Exclude prompts that are empty/whitespace after trimming.
- Keep duplicates (if the user sent the same prompt twice, it appears twice).

### 4.3 Key Handling Rules (Textarea)
The textarea should only intercept arrow keys when the user is not actively using them for text navigation:

**Ignore history navigation (do not intercept) when:**
- IME composition is active (`isComposing` / `nativeEvent.isComposing`).
- Any modifier key is held (`shift`, `alt`, `ctrl`, `meta`).
- There is an active selection (`selectionStart !== selectionEnd`).

**`ArrowUp` triggers history navigation only when the caret is on the first line**:
- Determine “first line” by checking that the text before the caret contains no `\n`.
- If triggered and a previous history entry exists, prevent default and navigate backward.

**`ArrowDown` triggers history navigation only when the caret is on the last line**:
- Determine “last line” by checking that the text after the caret contains no `\n`.
- If triggered and a next history entry exists (or draft restore is possible), prevent default and navigate forward.

This preserves normal up/down cursor movement inside multi-line prompts while still enabling history traversal when the caret is already at the top/bottom boundary.

### 4.4 Navigation Behavior
Let `history` be an array of prompt strings, and `cursor` be an integer:
- Initial state: `cursor = history.length` (draft).
- On first navigation away from draft (`cursor` moves from `history.length` to a history entry), store `draftText = currentInput`.

**On `ArrowUp` (when rule 4.3 allows):**
- If `history.length === 0`: no-op.
- If `cursor > 0`:
  - If `cursor === history.length`: set `draftText = currentInput`.
  - Set `cursor = cursor - 1`.
  - Set composer input to `history[cursor]`.
  - Place caret at end of text.
- If `cursor === 0`: no-op (do not wrap).

**On `ArrowDown` (when rule 4.3 allows):**
- If `history.length === 0`: no-op.
- If `cursor < history.length`:
  - Set `cursor = cursor + 1`.
  - If `cursor === history.length`: restore composer input to `draftText`.
  - Else set composer input to `history[cursor]`.
  - Place caret at end of text.
- If `cursor === history.length`: no-op.

### 4.5 Reset Conditions
Reset history navigation state (`cursor = history.length`, `draftText = ""`) when:
- A message is successfully submitted (composer is cleared).
- The active chat session changes (including switching between temporary and persisted chats).
- The `messages` list is replaced from server load for a different chat.

## 5) Implementation Notes (Proposed)
Primary integration point: `src/app/home-client.tsx` (owns `messages`, `input`, `setInput`).

Suggested approach:
- Add a small local hook (e.g. `useComposerPromptHistory`) that:
  - derives `history` from `messages`
  - stores `cursor` + `draftText` in `useState`
  - exposes an `onKeyDown` handler for the textarea
- Update `PromptInputTextarea` to support composing its internal key handling with a caller-provided `onKeyDown` (merge behavior rather than overriding) so Enter-to-send and attachment shortcuts remain intact.

## 6) Test Strategy (No Mocks)
### 6.1 Unit tests
- Validate history extraction from `messages` (user-only, text-only, trimmed).
- Validate key navigation state machine:
  - empty draft → `ArrowUp` recalls last prompt
  - repeated `ArrowUp` walks back
  - `ArrowDown` walks forward and restores draft
  - no wrap at ends
  - respects “first line / last line” gating
  - does not intercept during IME composition

### 6.2 E2E (agent-browser)
Add a focused test using existing `data-testid="composer:textarea"`:
- Send two messages.
- Press `ArrowUp` twice and assert textarea value matches the 2 prompts in reverse order.
- Press `ArrowDown` twice and assert it returns to the most recent prompt then to the original draft (empty).

## 7) Open Decisions
1) Should history navigation be disabled while `status !== "ready"` (streaming/submitted), or always available? Decision: YES
2) Should `ArrowUp` also work when the caret is not on the first line (i.e., “always navigate”), or keep the boundary-only behavior specified here? Decision: NO (= `arrowUp` only works when caret on first line)
3) Should navigating history also clear local attachments (if present) to avoid accidentally resending files? Decision: Yes
