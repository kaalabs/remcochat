# RemcoChat — SPEC: Editable Allowed Models (Config-TOML-Backed) + Admin Model Inventory (Feature #9)

## 1) Problem Definition
Today, the set of models that appear in the user chat UI’s **Model** picker is derived from:
- `config.toml` → `providers.<id>.allowed_model_ids` (per provider), and
- `modelsdev` metadata (labels/capabilities/types).

However:
- The Admin panel can only *view* the currently-allowed models (via `/api/admin/models-catalog`) and cannot show the full model inventory.
- There is no Admin UI to edit `allowed_model_ids`.
- Changing allowed models requires manual editing of `config.toml`, and it is easy to break the app (e.g. removing the provider default model or the router model).

## 2) Goals
- Admin can browse/search **all models** available for every provider configured in `config.toml`.
- Admin can clearly see which models are currently **allowed** (i.e. will show up in the user chat UI Model picker when that provider is active).
- Admin can change each provider’s `default_model_id` from the Admin UI (and the chosen default is always included in `allowed_model_ids`).
- Admin can mutate allowed models and **persist** changes by writing back to `config.toml` (so changes survive restart).
- Admin changes are validated so they cannot create a config state that will fail to load at restart.
- After saving, the server applies changes immediately (reset in-memory config + models catalog caches), and users see updated model picker options after a page refresh.

## 3) Non-goals
- Adding/removing providers, editing API keys, or changing `base_url` from the UI.
- Implementing auth / RBAC for Admin (Admin remains gated by `REMCOCHAT_ENABLE_ADMIN`, consistent with current behavior).
- Changing the global “active provider” persistence mechanism (still stored in DB via existing endpoint).
- Re-architecting the end-user Model picker UI (beyond reflecting the updated allowlist).

## 4) UX / Interaction Spec (Admin)

### 4.1 New Admin Card: “Allowed models”
Add a new card to `/admin` (placed near the existing “Models catalog” section; can replace it if desired):
- Title: **Allowed models**
- Description copy (explicitly connects allowlist → user Model picker):
  - “These are the models that appear in the user chat UI Model picker (per provider). Changes are written to `config.toml`.”

### 4.2 Provider grouping
For each provider configured in `config.toml` (`config.providers`):
- Render an expandable `<details>` panel (collapsed by default) with:
  - Provider name + id
  - `default_model_id` (editable)
  - Count badges: `allowed`, `total`

This keeps the page fast even for providers with large inventories.

### 4.3 Model list behavior (performance-aware)
Inside each provider panel:
- A search input (client-side filtering).
- A toggle:
  - Default: **Show allowed only** (prevents rendering thousands of rows).
  - Optional: **Show all** to render/filter the entire inventory.
- A model row shows:
  - checkbox (allowed/not allowed)
  - label + id
  - capability badges (tools/reasoning/temperature/attachments/structured output)
  - model “type” (adapter) label (e.g. `openai_responses`, `anthropic_messages`) in monospace
  - optional “source” description already used in the app (e.g. OpenAI/Anthropic/Google)

### 4.4 Required models (cannot be deselected)
Some models must remain allowed to keep the config valid:
- Provider default model: `providers.<id>.default_model_id`
- Router model (only if router enabled and `app.router.provider_id == <id>`): `app.router.model_id`

UX rules:
- These rows render as checked + disabled, with a small badge:
  - `Default` and/or `Router`
- Hover/help text explains why it is locked.

### 4.5 Save / Cancel workflow
Edits are “draft” state per provider panel:
- If the admin toggles models, the panel shows a “Unsaved changes” hint.
- Actions:
  - **Save** (persist to `config.toml` and apply immediately)
  - **Reset** (revert panel draft to current server state)

On Save success:
- Show a green success notice.
- Update counts.
- (Optional) show a note: “Users must refresh their page to fetch updated model options.”

On Save failure:
- Keep draft state.
- Show error message returned by the API (e.g. file not writable, invalid model id, modelsdev missing model, etc.).

## 5) API / Persistence

### 5.1 GET: Admin model inventory (all models)
New endpoint:
- `GET /api/admin/models-inventory`
- Guarded by `isAdminEnabled()` (same as other admin endpoints).

Response shape (proposal):
```json
{
  "loadedAt": "2026-01-31T00:00:00.000Z",
  "configPath": "/abs/path/to/config.toml",
  "providers": [
    {
      "id": "opencode",
      "name": "OpenCode Zen",
      "modelsdevProviderId": "opencode",
      "baseUrl": "https://…",
      "apiKeyEnv": "OPENCODE_API_KEY",
      "defaultModelId": "gpt-5.2",
      "requiredModelIds": ["gpt-5.2", "…maybe router model…"],
      "allowedModelIds": ["gpt-5.2", "…"],
      "models": [
        {
          "id": "gpt-5.2",
          "label": "GPT-5.2",
          "description": "OpenAI",
          "modelType": "openai_responses",
          "capabilities": { "tools": true, "reasoning": true, "temperature": false, "attachments": false, "structuredOutput": true },
          "supported": true
        }
      ]
    }
  ]
}
```

Notes:
- `models` is the full inventory for that provider (derived from `modelsdev providers show <modelsdevProviderId>`).
- `supported=false` for models whose adapter npm cannot be mapped to a RemcoChat `ModelType`. Unsupported models remain visible but cannot be selected.

### 5.2 PUT: Persist allowlist to config.toml
New endpoint:
- `PUT /api/admin/providers/allowed-models`

Body:
```json
{
  "providerId": "opencode",
  "allowedModelIds": ["gpt-5.2", "gpt-5.2-codex"]
}
```

Server validation:
- Provider must exist in current `getConfig().providers`.
- `allowedModelIds` must:
  - be non-empty
  - be unique (dedupe server-side)
  - contain `providers.<id>.default_model_id`
  - contain `app.router.model_id` if router is enabled for that provider
  - exist in the provider’s `modelsdev` inventory
  - be `supported=true` by RemcoChat’s model adapter mapping

Persistence behavior:
- Write changes back to the real `config.toml` file (at `REMCOCHAT_CONFIG_PATH` or repo `config.toml`).
- Use an atomic write (write temp file in same dir, then rename).
- After write, reset in-memory caches:
  - config cache (`getConfig()` cache)
  - modelsdev catalog cache (`getModelsDevCatalog()` cache)

Response:
```json
{ "ok": true }
```

### 5.3 PUT: Update provider default model
New endpoint:
- `PUT /api/admin/providers/default-model`

Body:
```json
{
  "providerId": "opencode",
  "defaultModelId": "gpt-5.2"
}
```

Server behavior:
- Validate model exists in provider inventory and is supported.
- Persist `providers.<id>.default_model_id` to `config.toml`.
- Ensure `defaultModelId` is present in `allowed_model_ids` (auto-include if missing).
- Reset config + modelsdev caches.

## 6) Config.toml Writing Strategy (Comment-Preserving)
We want edits to “stick” without trashing the rest of the file.

Proposed approach:
- Parse TOML for validation (existing zod schema + `@iarna/toml`).
- For writing, do a *targeted text patch*:
  - Locate `[providers.<providerId>]` table region.
  - Replace the `allowed_model_ids = [...]` value with a freshly rendered multi-line array.

Formatting rules (stable output):
```toml
allowed_model_ids = [
  "model-a",
  "model-b",
]
```

Fail-fast rules:
- If the provider table or `allowed_model_ids` assignment cannot be found, return a 500 with a clear message instead of guessing and corrupting the config.

## 7) Model Picker Impact (User Chat UI)
No UI redesign required; behavior is:
- The user Model picker options remain sourced from `/api/providers`.
- `/api/providers` continues to return only the active provider’s `allowed_model_ids` (now admin-editable).
- After an admin saves a new allowlist:
  - server-side caches are reset so `/api/providers` reflects the updated allowlist immediately
  - users need a page refresh to fetch the updated providers payload (current client only fetches once on mount)

## 8) Implementation Notes (Proposed)
- Add a new server module to build full per-provider model inventories using the existing `modelsdev providers show` plumbing.
- Add a config writer utility (config path reuse from `src/server/config.ts`).
- Extend `src/app/admin/admin-client.tsx`:
  - Fetch `/api/admin/models-inventory`
  - Render provider panels with search + “show allowed only” toggle
  - Maintain draft state and call the new PUT endpoint

## 9) Test Strategy (No Mocks)

### 9.1 Unit
- Config writer:
  - correctly replaces `allowed_model_ids` for a provider in a sample TOML string
  - preserves unrelated sections
  - rejects missing provider table / missing key
- Validation:
  - cannot remove provider `default_model_id`
  - cannot remove router model when router enabled
  - rejects unknown model ids (not present in modelsdev inventory)

### 9.2 E2E (Playwright)
1) Start app with admin enabled and a config that includes at least 1 provider.
2) Go to `/admin` → Allowed models.
3) Enable an additional model (from inventory) and Save.
4) Navigate to `/` and refresh → assert Model picker includes the newly allowed model.
5) Disable a previously allowed non-required model and Save.
6) Refresh `/` → assert Model picker no longer includes it.

## 10) Open Decisions
1) Ordering: when saving, should `allowed_model_ids` preserve prior order + append new items, or should it be sorted (e.g. by label/id)? Proposal: preserve existing order and append newly-enabled models.
2) “Models catalog” card: keep as a read-only debug view, or replace it entirely with the new allowlist editor?
3) Router coupling: should the Admin UI also allow changing `app.router.model_id` to avoid “locked” router models? Proposal: v1 locks router model removal; router editing stays manual.
