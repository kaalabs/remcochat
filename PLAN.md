# RemcoChat — Plan

Minimalistic, modern ChatGPT-like chatbot for **local network use** (no auth). Uses **Vercel AI SDK**, **Vercel AI Elements**, and **Vercel AI Gateway** as the LLM backend.

## Confirmed Scope

### MVP
- Streaming responses + Stop button
- Markdown rendering + code blocks + “copy code”
- Regenerate + response variants selector
- Edit a prior user message + re-run from there (branch via fork)
- Sidebar chat list
- Archive + delete chats
- Export chat (Markdown/JSON)
- Model selector
- Custom instructions: global + per-chat
- Memory across chats (opt-in)
- “Memorize this” (explicit memory capture)
- Temporary chat (no history/no memory)
- Theme (light/dark) + keyboard shortcuts

### Later
- Chat search (`Ctrl/Cmd+K`)
- Image input (vision)
- Voice input / voice mode
- Projects/folders (group chats + files + instructions)

### Not Included
- Canvas editor view
- Custom bots / GPT presets
- File uploads for context

## Stack / Constraints
- Runs on **local server hardware** (LAN).
- No authentication; profiles are **public at LAN level**.
- Use the **latest available versions** of stack components unless inter-component dependencies force otherwise.
- Mandatory:
  - **Vercel AI SDK** (incl. `@ai-sdk/react`)
  - **Vercel AI Elements** (shadcn/ui-based components)
  - **Vercel AI Gateway** as the LLM backend
- Environment:
  - Require `VERCEL_AI_GATEWAY_API_KEY` to be exported in the shell for local runs (accept `AI_GATEWAY_API_KEY` as a compatibility fallback).

## Architecture (MVP)
- **App:** Next.js (Node runtime) + React + Tailwind + shadcn/ui + AI Elements.
- **API:** `/api/chat` streams tokens using Vercel AI SDK (`streamText`) and returns a stream response; supports abort for “Stop”.
- **Persistence:** SQLite on the server (single DB file), via a thin DB layer (default `data/remcochat.sqlite`, override via `REMCOCHAT_DB_PATH`).
- **Profiles:** stored in DB; active profile stored client-side (localStorage). API requests include `profileId`.
- **Prompt assembly order:**
  1. Per-chat instructions (highest priority; if set, they suppress global profile instructions to avoid conflicts across providers)
  2. Global profile instructions (only when chat instructions are empty)
  3. (If enabled) profile memory (captured explicitly via “Memorize this”; lowest priority)
  4. Conversation messages

## Data Model (Suggested)
### Implemented (as of now)
- `profiles`: `id`, `name`, `created_at`, `default_model_id`, `custom_instructions`, `memory_enabled`
- `profile_memory`: `id`, `profile_id`, `content`, `created_at`, `updated_at`
- `chats`: `id`, `profile_id`, `title`, `model_id`, `chat_instructions`, `created_at`, `updated_at`, `archived_at`, `deleted_at`
- `messages`: composite key `(chat_id, id)` with `role`, `parts_json` (AI SDK `UIMessage.parts`), `created_at`, `position`, `turn_user_message_id`, `profile_instructions_revision`, `chat_instructions_revision`

### Planned additions
- `profile_memory`: `id`, `profileId`, `content`, `createdAt`, `updatedAt`
- Variants: unselected assistant responses stored separately (keyed by the user message they answer); selected response remains in the main message stream.
- Fork metadata: `forkedFromChatId`, `forkedFromMessageId` (or equivalent) to support edit+branch.

## UI / UX Flows (Minimal, ChatGPT-like)
- **Sidebar:** profile switcher, “New chat”, chat list (active + archived), per-chat actions (archive/delete).
- **Main chat:** AI Elements `Conversation`/`Message` rendering; per-user-message “Edit” (forks chat).
- **Variants:** per-turn pager (1/N) + “Regenerate”.
- **Fork + variants:** when you edit+fork a user message, the fork preserves the original (pre-edit) assistant response(s) as variants so you can page back to them after regenerating the edited turn.
- **Model selector:** minimal dropdown (restricted to an allowlist), stored per-chat; defaults from profile.
- **Memory capture:** per-message action “Memorize this” that saves a user-selected snippet (or the full message) into profile memory.
- **Composer:** AI Elements `PromptInput`; `Cmd/Ctrl+Enter` send; `Esc` stop.
- **Keyboard shortcuts (polish):** `Esc` stop streaming, `Cmd/Ctrl+/` focus composer, `Cmd/Ctrl+Shift+N` new chat, `Cmd/Ctrl+Shift+L` toggle theme.
- **Settings:** global instructions, per-chat instructions, memory toggle + memory editor, temporary chat toggle, theme toggle.

## Implementation Roadmap
1. Scaffold Next.js + Tailwind + shadcn/ui; install AI SDK; install AI Elements (only required components).
2. Build base layout: sidebar + chat view; responsive minimal styling; theme toggle + persistence.
3. Add model allowlist + selector UI (per-chat; profile default); include `modelId` in requests to `/api/chat`.
4. Implement streaming `/api/chat` via Vercel AI SDK + AI Gateway; wire `useChat()` with abort for Stop.
5. Add profiles: create/switch; route all reads/writes through active `profileId`.
6. Add SQLite persistence: schema + CRUD for chats/messages; sidebar loads from DB; auto-title from first user message.
7. Add regenerate/variants: store multiple assistant responses per `turnId`; UI pager + “Regenerate”.
8. Add edit + branch: editing a past user message **forks** a new chat (copy messages up to that point, replace edited message).
9. Add instructions + memory + temporary chat:
   - Global/per-chat instructions
   - “Memorize this” action → saves memory items + inclusion in system prompt
   - Memory list management (view/delete; edit optional)
   - Temporary chat bypasses persistence + does not read/update memory
10. Add archive/delete + export endpoints: Markdown + JSON.
11. Polish: shortcuts, focus management, small motion, consistent minimal styling.

## Status
- Implemented roadmap steps: 1–10 (details in `PROGRESS.toml`).
- Verified via WebKit E2E (real LLM): profile + chat instructions stay effective across turns, and mid-chat chat-instruction updates take effect (see `e2e/instructions.spec.ts`).
- Verified via WebKit E2E: archive/unarchive, delete, and export endpoints work (see `e2e/instructions.spec.ts`).
- Next up: 11 (polish).

## Testing (No Mocks)
- Add a Playwright smoke test that boots the server and validates:
  - Create profile → create chat → send message → receives streamed tokens
  - Stop works (abort)
  - Regenerate adds a variant
  - Edit forks a chat
  - “Memorize this” creates a memory item and it influences a subsequent chat response
  - Export returns expected content
- Current: `npm run test:e2e` runs a WebKit (Safari-engine) E2E against a dedicated SQLite DB (`data/remcochat-e2e.sqlite`). It uses the real AI Gateway key from your shell (same requirement as `npm run dev/start`).

## Open Decisions
- Model allowlist for the selector (which model ids to offer) and defaults per profile/chat. Initial placeholder allowlist: `openai/gpt-5`, `openai/gpt-4.1-mini`, `anthropic/claude-sonnet-4.5`.
- “Memorize this” UX specifics: snippet selection vs whole-message capture; default formatting/length limits for stored memory.
