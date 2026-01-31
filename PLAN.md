# RemcoChat — Plan

Minimalistic, modern ChatGPT-like chatbot for **local network use** (no auth). Uses **Vercel AI SDK** + **Vercel AI Elements** with a **configurable AI gateway provider** (default: Vercel AI Gateway).

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
- “Memorize this” (explicit memory capture with confirmation + remember/save intents)
- Intent router (cheap LLM gate) for memory/weather workflows
- Memory-derived answers shown as a card (brain icon)
- Temporary chat (no history/no memory)
- Theme (light/dark) + keyboard shortcuts
- Optional agentic web tools (search/fetch) exposed to tool-capable models (model decides when to use)
- Generative UI tools: weather + forecast cards (Open-Meteo), to-do/grocery list cards (shareable across profiles), agenda card, timezones card, URL summary card, quick notes card

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
- LLM backend (provider abstraction):
  - Configured via `config.toml` (see “Provider abstraction deliverables” below).
  - Active provider is **global** and can be switched via API (**no auth/gating**; LAN-only assumption).
  - Switching is **persistent** (stored in DB).
  - `config.toml` defines provider connection info (`base_url`, `api_key_env`) and an allowlist (`allowed_model_ids`, `default_model_id`, optional `modelsdev_provider_id`).
  - Model metadata (label/capabilities/adapter type) is resolved via the `modelsdev` CLI at runtime and cached in-memory until server restart.
  - `base_url` is required for every provider (explicit endpoints; no implicit SDK defaults).
- Environment:
  - Today: require `VERCEL_AI_GATEWAY_API_KEY` to be exported in the shell for local runs.
  - After provider abstraction: required keys depend on the configured + active provider (kept in env / `.env`, not in `config.toml`).
  - Optional admin tools gated by `REMCOCHAT_ENABLE_ADMIN=1` (see README).

## Architecture (MVP)
- **App:** Next.js (Node runtime) + React + Tailwind + shadcn/ui + AI Elements.
- **API:** `/api/chat` streams tokens using Vercel AI SDK (`streamText`) and returns a stream response; supports abort for “Stop”.
- **Persistence:** SQLite on the server (single DB file), via a thin DB layer (default `data/remcochat.sqlite`, override via `REMCOCHAT_DB_PATH`).
- **Profiles:** stored in DB; active profile stored client-side (localStorage). API requests include `profileId`.
- **Profile lifecycle:** create, switch, and delete profiles (deleting a profile removes its chats + memories).
- **Prompt assembly order:**
  1. Per-chat instructions (highest priority; if set, they suppress global profile instructions to avoid conflicts across providers)
  2. Global profile instructions (only when chat instructions are empty)
  3. (If enabled) profile memory (captured explicitly via “Memorize this” / remember/save intents + confirmation; lowest priority)
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
- **Sidebar:** profile switcher, “New chat”, chat list (active + archived), per-chat actions (archive/delete); profile settings include delete profile.
- **Main chat:** AI Elements `Conversation`/`Message` rendering; per-user-message “Edit” (forks chat).
- **Variants:** per-turn pager (1/N) + “Regenerate”.
- **Fork + variants:** when you edit+fork a user message, the fork preserves the original (pre-edit) assistant response(s) as variants so you can page back to them after regenerating the edited turn.
- **Model selector:** minimal dropdown (restricted to an allowlist), stored per-chat; defaults from profile; “New chat” seeds with the last-used model.
- **Memory capture:** per-message action “Memorize this” (or remember/save in chat) that saves a user-selected snippet (or the full message) into profile memory after confirmation.
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
   - “Memorize this” action → saves memory items (after confirmation) + inclusion in system prompt
   - Memory list management (view/delete; edit optional)
   - Temporary chat bypasses persistence + does not read/update memory
10. Add archive/delete + export endpoints: Markdown + JSON.
11. Polish: shortcuts, focus management, small motion, consistent minimal styling.

## Status
- Implemented roadmap steps: 1–10 (details in `PROGRESS.toml`).
- Implemented roadmap step 11 (polish): shortcuts/focus, archived-collapsible sidebar, accent color, icon-only controls, and consistent minimal styling.
- Verified via WebKit E2E (real LLM): profile + chat instructions stay effective across turns, and mid-chat chat-instruction updates take effect (see `e2e/instructions.spec.ts`).
- Verified via WebKit E2E: archive/unarchive, delete, and export endpoints work (see `e2e/instructions.spec.ts`).
- Verified via WebKit E2E: weather tool renders a weather card (see `e2e/weather-tool.spec.ts`).
- Next up: pick the next roadmap item.

## Testing (No Mocks)
- Add a Playwright smoke test that boots the server and validates:
  - Create profile → create chat → send message → receives streamed tokens
  - Stop works (abort)
  - Regenerate adds a variant
  - Edit forks a chat
  - “Memorize this” creates a memory item and it influences a subsequent chat response
  - Weather tool renders a weather card
  - Export returns expected content
- Current: `npm run test:e2e` runs a WebKit (Safari-engine) E2E against a dedicated SQLite DB (`data/remcochat-e2e.sqlite`). It uses the real AI Gateway key from your shell (same requirement as `npm run dev/start`).
- Also run the end-user smoke via `agent-browser`: `npm run test:agent-browser`.

## Hardening (Optional)
- Admin backup/export + reset tools are available when `REMCOCHAT_ENABLE_ADMIN=1` is set:
  - Export all data: `GET /api/admin/export`
  - Reset all data (wipe DB): `POST /api/admin/reset` with `{ "confirm": "RESET" }`

## Open Decisions
- Provider configuration: `config.toml` is the source of truth for providers + allowed models + defaults; `modelsdev` is the source of truth for model metadata/capabilities.
- “Memorize this” UX specifics: snippet selection vs whole-message capture; default formatting/length limits for stored memory.

## Provider abstraction deliverables (config.toml)

Goal: introduce a global `config.toml` that defines multiple AI gateway providers and their allowed models, and provide an API abstraction to switch the active provider at runtime (global + persistent). No auth/gating on the switching API (LAN-only assumption).

### Deliverable 1 — Config foundation (read-only)
**Deliverable**
- Add `config.toml.example` (tracked) and load `config.toml` (untracked) as the global config file.
- Implement config loader + validation and expose a read-only model catalog via `GET /api/providers` (providers + allowed models + derived metadata + default provider).

**Definition of Done**
- App fails fast with a clear error when `config.toml` is missing (no internal fallback defaults).
- `config.toml` is ignored by git; `config.toml.example` documents the schema.
- `GET /api/providers` returns the configured providers and their allowed models.

**Testcase**
- `npm run test:e2e -- -g "Providers config endpoint"`

### Deliverable 2 — Persistent active provider + switching API
**Deliverable**
- Persist `active_provider_id` globally in DB (not per profile).
- Add `PUT /api/providers/active` to switch provider (no auth/gating). Validate that the provider exists in `config.toml`.
- Extend `GET /api/providers` to include the active provider id.

**Definition of Done**
- Switching provider updates the DB setting and affects subsequent API responses.
- If the active provider is removed from `config.toml`, the app safely falls back to the config default.

**Testcase**
- `npm run test:e2e -- -g "Switch active provider"`

### Deliverable 3 — Config-driven model list (replace hardcoded allowlist)
**Deliverable**
- Replace `src/lib/models.ts` allowlist/validation with config-driven models per provider.
- Update the UI model selector to fetch models from `GET /api/providers` (active provider only).
- Ensure server-side validation clamps invalid/unknown models to a safe default from the active provider.

**Definition of Done**
- No hardcoded model allowlist remains; only models present in `config.toml` are selectable/accepted.
- Existing chats/profiles with an invalid model id are migrated or clamped to a configured default.

**Testcase**
- `npm run test:e2e -- -g "Model selector uses config models"`

### Deliverable 4 — Provider adapters for `/api/chat`
**Deliverable**
- Route `/api/chat` model creation through the active provider, using a model-level adapter selection.
- Adapter selection is derived from `modelsdev` provider/model metadata (npm adapter) and mapped to RemcoChat model types (`vercel_ai_gateway`, `openai_responses`, `openai_compatible`, `anthropic_messages`, `google_generative_ai`).
- Implement at minimum the current Vercel AI Gateway adapter (preserving existing behavior), plus at least one additional adapter when configured in `config.toml`.

**Definition of Done**
- `/api/chat` uses the active provider when resolving a model id.
- Existing behavior remains unchanged when using the default Vercel AI Gateway config.

**Testcase**
- `npm run test:e2e -- -g "Chat uses active provider"`

### Deliverable 5 — Admin panel route for provider switching
**Deliverable**
- Add an admin panel page route (e.g. `/admin`) that lists configured providers and lets you switch the global active provider.
- Use the existing `PUT /api/providers/active` endpoint; no auth/gating (LAN-only assumption).

**Definition of Done**
- When `REMCOCHAT_ENABLE_ADMIN=1`, `/admin` is accessible and shows the current active provider.
- Switching provider from `/admin` updates the persisted `active_provider_id` and is reflected in `GET /api/providers`.
- When admin is disabled, `/admin` is not accessible.

**Testcase**
- `npm run test:e2e -- -g "Admin panel switches provider"`

### Deliverable 6 — Models.dev-backed model catalog (modelsdev CLI)
**Deliverable**
- Make `modelsdev` the source of truth for model metadata (label/capabilities/adapter type), with `config.toml` only providing provider connection info + an allowlist.
- Resolve model catalog via `modelsdev` CLI at runtime and cache it in-memory until server restart (no persisted `api.json` snapshots).
- Fail-fast on: missing `modelsdev`, unknown `modelsdev` provider id, unknown allowlisted model id, or unsupported adapter mapping.
- Expose a full per-provider model inventory (from `modelsdev`) via an admin API route and surface it in the admin UI for observability + editing.
- Allow admins to edit per-provider `allowed_model_ids`, `default_model_id`, and `app.router.model_id` from `/admin`, writing changes back to `config.toml` (atomic write) so changes persist across restarts.

**Definition of Done**
- `GET /api/providers` returns model metadata derived from `modelsdev` for each allowlisted model.
- Switching active provider changes the active model list without requiring a rebuild (server restart still required for updated `modelsdev` metadata).
- Admin can browse all models per provider and edit which ones are allowed (and the router model) via `/admin` (persists to `config.toml`).

**Testcase**
- `npm run test:e2e`

### Deliverable 7 — Complete model-type adapters (Choice A: “any model type”)
**Deliverable**
- Ensure RemcoChat includes a concrete adapter for every supported model `type` in the config schema (`vercel_ai_gateway`, `openai_responses`, `openai_compatible`, `anthropic_messages`, `google_generative_ai`).
- Add E2E assertions that the `/api/chat` UI stream contains real text output and no silent `error` chunks (prevents false positives).

**Definition of Done**
- Every model `type` supported by the schema is wired to a server-side adapter that returns a streamable AI SDK `LanguageModel`.
- `/api/chat` reliably triggers weather tools when asked (card only; no duplicate text output).
- E2E API-level chat tests fail on stream errors instead of passing silently.

**Testcase**
- `npm run test:e2e`
- Optional (requires OpenCode Gemini access): `REMCOCHAT_E2E_ENABLE_GOOGLE_GEMINI=1 npm run test:e2e -- -g "Google Generative AI model type"`

### Deliverable 8 — Model capability badges (tools / reasoning / temperature / files / JSON)
**Deliverable**
- Use `modelsdev` capability flags as the single source of truth:
  - `tool_call` → `tools`
  - `reasoning` → `reasoning`
  - `temperature` → `temperature`
  - `attachment` → `attachments`
  - `structured_output` → `structuredOutput`
- Expose capabilities via `GET /api/providers` and render them as badges in the model picker.
- Make `/api/chat` respect capabilities (tools + temperature gating).

**Definition of Done**
- Model picker renders capability badges for every model and includes a `Reasoning` badge.
- `/api/chat` never attempts tool calling when the selected model lacks `tools`.
- `/api/chat` never sends `temperature` when the selected model lacks `temperature`.

**Testcase**
- `npm run test:e2e`

## Spec — Model Types (Any Gateway / Any Model API)

Goal: RemcoChat must be able to talk to **any model** exposed by an AI gateway/provider, as long as the model’s API protocol can be derived from `modelsdev` metadata and mapped to a server-side adapter. Providers can host **mixed model protocols** (as OpenCode Zen does), so protocol is a **model characteristic**.

### Definitions
- **Provider**: an AI gateway endpoint + credentials (`base_url`, `api_key_env`) and a set of allowed models.
- **Model**: a selectable RemcoChat model id stored in DB/UI (and passed through as the provider-native model id); protocol is derived from `modelsdev`.
- **Model type**: the protocol/SDK adapter used to create an AI SDK `LanguageModel` for `streamText` (not a “provider type”).
- **Adapter**: server-side implementation that can stream text and (optionally) tools for a given model type.

### Config Contract (v2 + modelsdev)
- `config.toml` is the source of truth for **allowed models** and provider connection info; `modelsdev` is the source of truth for model metadata (adapter + capabilities).
- Fail-fast:
  - missing `config.toml` → app must not start
  - missing `providers.<id>.base_url` / `api_key_env` → app must not start
  - missing `modelsdev` CLI → app must not start
  - unknown `modelsdev` provider id / allowlisted model id → app must not start
  - unknown model type (no adapter mapping) → app must not start
- Provider fields (required):
  - `name`, `base_url`, `api_key_env`, `default_model_id`, `allowed_model_ids[]`
  - optional: `modelsdev_provider_id` (defaults to provider id)

### Built-in Model Types (must exist in RemcoChat)
Each model type defines (a) which AI SDK package is used, (b) how `base_url` is interpreted, and (c) which protocol endpoint path is implied by the SDK.

Minimum required set to cover the major gateway ecosystems:
- `vercel_ai_gateway`
  - SDK: `@ai-sdk/gateway`
  - Used for Vercel AI Gateway.
- `openai_responses`
  - SDK: `@ai-sdk/openai`
  - Protocol: OpenAI “Responses” (`POST {base_url}/responses`).
- `openai_compatible`
  - SDK: `@ai-sdk/openai-compatible`
  - Protocol: OpenAI-compatible “Chat Completions” (`POST {base_url}/chat/completions`).
- `anthropic_messages`
  - SDK: `@ai-sdk/anthropic`
  - Protocol: Anthropic Messages (`POST {base_url}/messages`).
- `google_generative_ai`
  - SDK: `@ai-sdk/google`
  - Protocol: Gemini via Google Generative AI API (and gateway equivalents, when supported).

The type strings above are stable ids; adding a new model type means adding a new adapter and registering it.

### OpenCode Zen Mapping (Reference)
OpenCode Zen exposes multiple protocols behind one gateway:
- GPT models: `/responses` → `openai_responses`
- Claude/MiniMax: `/messages` → `anthropic_messages`
- GLM/Kimi/Qwen/Grok/Big Pickle: `/chat/completions` → `openai_compatible`
- Gemini: `/models/<id>` (gateway-specific) → `google_generative_ai`

### Adapter Requirements (Server)
For each supported model type, RemcoChat must provide an adapter that:
- Creates an AI SDK `LanguageModel` instance using `provider.base_url` + `provider.api_key_env`.
- Supports streaming via `streamText`.
- Works with RemcoChat tools (weather, forecast, memory) when the underlying protocol supports tool calling.

### Model Capabilities (modelsdev)
Some “model types” differ in capabilities (tool calling, reasoning, vision, structured output, temperature support).
RemcoChat uses `modelsdev` capability flags as the source of truth so it can:
- avoid passing unsupported settings (e.g. temperature)
- hide/disable features that require tools when a model cannot tool-call
- later: enable multimodal UI only for models that support it

### Testing Requirements (No Mocks)
- Every built-in model type must have E2E coverage that validates:
  - the model type is visible via `GET /api/providers`
  - selecting a model of that type yields `x-remcochat-model-type` on `/api/chat`
  - the request succeeds and streams at least one token
  - note: the Google/Gemini path depends on upstream access; the test is gated by `REMCOCHAT_E2E_ENABLE_GOOGLE_GEMINI=1` so the default suite stays green when Gemini is disabled for the current key
