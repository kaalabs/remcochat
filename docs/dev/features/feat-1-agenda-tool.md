# Feature 1: Agenda Tool (Intent Engine Driven)

## Overview
RemcoChat needs an "agenda" tool to manage scheduled items. The tool must be invoked via RemcoChat's intent engine (not by the user manually selecting a UI feature), and must support:

- Create: add new agenda items (description, date, time, duration)
- Update: change existing items
- Delete: remove existing items
- Share: share (and stop sharing) an existing item with another existing profile (like list sharing)
- List: show items for a requested window:
  - today
  - tomorrow
  - this week
  - this month
  - coming N days

The intent engine must also interpret the user's request ("maximum intelligent flexibility") and decide which agenda action to execute, including parsing natural language into structured fields.

This document is a SPEC, not an implementation.

## Goals
- Agenda CRUD + list windows work reliably and are fast (SQLite local storage).
- Natural language is handled by the intent engine (LLM-assisted), not brittle regex.
- The user can refer to items naturally ("move the dentist appointment to 15:00") with sensible disambiguation flows.
- Works with the existing RemcoChat architecture: profiles, chats, tool cards, and `/api/chat` streaming.

## Non-goals (for this feature)
- Full calendar standards support (ICS import/export, recurring events, invitations).
- Multi-user permissions/auth (RemcoChat is LAN/no auth).
- Complex timezone/locale preferences UI. We will support timezone inputs and best-effort defaults.

## User stories
1) "Add dentist tomorrow at 14:00 for 30 minutes."
2) "Move dentist to 15:00."
3) "Change tomorrow's dentist to 45 minutes."
4) "Delete the dentist appointment."
5) "What do I have today?"
6) "Show my agenda for the coming 10 days."
7) "This week, what do I have?"
8) "Share our vacation in June with Caroline."
9) "Stop sharing the vacation item with Caroline."

## Data model
Agenda items are stored per profile (like lists/notes/memory).

### Table: agenda_items
Add a new SQLite table in `src/server/db.ts`:

- `id TEXT PRIMARY KEY`
- `profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE`
- `description TEXT NOT NULL`
- `start_at TEXT NOT NULL` (ISO-8601 timestamp, stored as UTC)
- `duration_minutes INTEGER NOT NULL` (>= 1)
- `timezone TEXT NOT NULL` (IANA zone like `Europe/Amsterdam`; used for display + "today" calculations)
- `created_at TEXT NOT NULL` (ISO-8601)
- `updated_at TEXT NOT NULL` (ISO-8601)
- `deleted_at TEXT` (nullable; optional soft delete)

Indexes:
- `idx_agenda_items_profile_start_at` on `(profile_id, start_at ASC)`
- `idx_agenda_items_profile_updated_at` on `(profile_id, updated_at DESC)`

Notes:
- `start_at` is stored in UTC to simplify range queries.
- `timezone` is stored per item so that it remains stable even if "server timezone" changes.

### Table: agenda_item_members
Sharing should follow the list-sharing pattern (a separate membership table).

- `agenda_item_id TEXT NOT NULL REFERENCES agenda_items(id) ON DELETE CASCADE`
- `profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE`
- `created_at TEXT NOT NULL`
- `PRIMARY KEY (agenda_item_id, profile_id)`

Indexes:
- `idx_agenda_item_members_profile` on `(profile_id)`

Ownership rules:
- The owner is `agenda_items.profile_id`.
- Membership rows represent "shared with" profiles only (the owner is not stored in `agenda_item_members`).
- Only the owner can share/unshare the item (mirrors list behavior).

## Tool surface
Implement a new tool similar to `displayNotes`, `displayList`, etc.

### Tool name
`displayAgenda`

### Tool responsibilities
- Validate/normalize the incoming agenda command.
- Perform the database operation.
- Return structured output for rendering in the chat UI.
- Never call external services.

### Tool input schema (proposed)
The tool is intentionally "low-level": it expects already-structured inputs from the intent engine.

```
type AgendaAction = "create" | "update" | "delete" | "share" | "unshare" | "list";
type AgendaRange =
  | { kind: "today"; timezone?: string }
  | { kind: "tomorrow"; timezone?: string }
  | { kind: "this_week"; timezone?: string; week_start?: "monday" | "sunday" }
  | { kind: "this_month"; timezone?: string }
  | { kind: "next_n_days"; timezone?: string; days: number };

type DisplayAgendaInput =
  | {
      action: "create";
      description: string;
      date: string; // YYYY-MM-DD (in timezone)
      time: string; // HH:MM (24h, in timezone)
      duration_minutes: number;
      timezone?: string; // default: derived (see Timezone rules)
    }
  | {
      action: "update";
      item_id?: string;
      // Optional alternative targeting when item_id is unknown:
      match?: { description?: string; date?: string; time?: string };
      patch: Partial<{
        description: string;
        date: string; // YYYY-MM-DD
        time: string; // HH:MM
        duration_minutes: number;
        timezone: string;
      }>;
    }
  | {
      action: "delete";
      item_id?: string;
      match?: { description?: string; date?: string; time?: string };
    }
  | {
      action: "share" | "unshare";
      item_id?: string;
      match?: { description?: string; date?: string; time?: string };
      target_profile: string; // profile id or name hint (resolved like list sharing)
    }
  | {
      action: "list";
      range: AgendaRange;
      // Optional: include already-started items that still overlap the window.
      include_overlaps?: boolean; // default true
    };
```

### Tool output schema (proposed)
```
type AgendaItemOutput = {
  id: string;
  description: string;
  start_at: string; // ISO-8601 UTC
  end_at: string;   // ISO-8601 UTC
  duration_minutes: number;
  timezone: string;
  owner_profile_id: string;
  owner_profile_name?: string;
  scope: "owned" | "shared";
  shared_with_count: number;
  // Preformatted display strings (client convenience):
  local_date: string; // YYYY-MM-DD in timezone
  local_time: string; // HH:MM in timezone
  viewer_local_date: string; // YYYY-MM-DD in viewer timezone
  viewer_local_time: string; // HH:MM in viewer timezone
};

type DisplayAgendaOutput =
  | {
      ok: true;
      action: "create" | "update" | "delete" | "share" | "unshare";
      message: string;
      item?: AgendaItemOutput;
      items?: AgendaItemOutput[]; // optional follow-up listing after mutation
    }
  | {
      ok: true;
      action: "list";
      range_label: string;
      timezone: string;
      items: AgendaItemOutput[];
    }
  | {
      ok: false;
      error: string;
      // For ambiguity: show candidates to let the user pick.
      candidates?: AgendaItemOutput[];
    };
```

UI rendering:
- Add a new `AgendaCard` component similar to `NotesCard`/`ListCard`.
- The card should render:
  - range header (for list)
  - items grouped by day (optional)
  - stable item identifiers (show a short id suffix and/or an index)

## Intent engine integration
The agenda tool must be triggered by RemcoChat's intent engine. In RemcoChat today, the closest primitives are:
- `shouldRouteIntent()` in `src/app/api/chat/route.ts` (pre-check heuristic)
- `routeIntent()` in `src/server/intent-router.ts` (LLM classification)

We will extend this pattern to include agenda.

### Step 1: Route classification ("is this an agenda request?")
Extend `src/server/intent-router.ts`:
- Add new intent: `agenda`
- Update the router prompt to include agenda as a choice
- Extend the schema to include agenda fields (see below)

Proposed new `IntentRoute` variant:
```
{ intent: "agenda"; confidence: number; agenda_command_json: string }
```

Why `agenda_command_json`:
- Keeps the top-level router minimal (still "classify latest user message").
- Allows the router to return a structured command payload without introducing a second LLM call in the simplest cases.

Alternative (recommended for robustness):
- Keep the top-level router purely classification (`agenda` vs `none`) and then call a dedicated `routeAgendaCommand()` extractor (Step 2). This improves maintainability and reduces prompt coupling.

### Step 2: Agenda command extraction ("what operation and fields?")
Add `src/server/agenda-intent.ts`:
- Uses `generateObject()` + Zod to return a `DisplayAgendaInput` shape.
- Must handle:
  - create/update/delete/share/unshare/list
  - date/time/duration extraction
  - list windows: today/tomorrow/this week/this month/next n days
  - follow-up phrasing referencing previous results ("delete the second one")

Extractor prompt requirements:
- Operate ONLY on the latest user message + (optional) recent agenda tool outputs if present.
- Prefer asking for missing required fields instead of guessing:
  - create requires all of: description, date, time, duration_minutes
  - list for `next_n_days` requires `days`
- If target for update/delete is ambiguous, return an error state requesting clarification (or return candidates for the UI).

### Step 3: `/api/chat` fast-path execution
In `src/app/api/chat/route.ts`, before running the main `streamText()` model response:
- If not regenerate AND last user message qualifies for intent routing:
  - Call `routeIntent()` with the latest user message.
  - If intent === `agenda`:
    - If the chat is temporary: return a short refusal message ("Temporary chats do not save agenda. Turn off Temp...").
    - Else:
      - Call `routeAgendaCommand()` (or parse router payload if Step 1 returns it)
      - Execute `displayAgenda` tool server-side
      - Return a tool UI stream response (like the existing `uiWeatherResponse` pattern)

This ensures the tool is triggered by the intent engine, not by the base chat model "deciding" to call tools.

### Step 4: Update the heuristic gate
Update `shouldRouteIntent()` in `src/app/api/chat/route.ts` to include agenda hints so we only invoke the intent router when useful, e.g.:
- "agenda", "calendar", "schedule", "appointment", "meeting"
- Dutch: "agenda", "afspraak", "meeting", "kalender", "plan"
- Also include relative time words commonly used: "today/tomorrow/this week/next X days"

Important: do NOT make this regex list too broad; it should only decide whether to call the intent router, not the final intent.

## Timezone rules
Agenda range queries and date/time parsing depend on a timezone.

Rules (in order):
1) If the user explicitly provides a timezone (IANA zone or recognizable city) and the intent extractor can confidently map it to an IANA zone, use it.
2) Else use server-local timezone as default.
3) Store the resolved timezone on the agenda item.

Range calculations:
- "today": [start-of-day, end-of-day) in the chosen timezone.
- "tomorrow": next day in timezone.
- "this week": from week_start (default monday) to +7 days in timezone.
- "this month": from first day of month to first day of next month in timezone.
- "next_n_days": from now (or start-of-today) to +N days in timezone (SPEC decision: use start-of-today for predictable results).

Inclusion logic:
- Default: include items that overlap the window:
  - item.start_at < range_end AND item.end_at > range_start

## Disambiguation and safe mutations
Update/delete require a target item.

Rules:
- If `item_id` is provided, act directly.
- Else attempt `match` search by:
  - date + time + description tokens (best effort)
- If multiple matches:
  - Return `{ ok: false, error: "...", candidates: [...] }`
  - The assistant should ask the user which item to use (by index or by id suffix).

Permissions (owner-only):
- Only the item owner can update or delete an item (mirrors list behavior).
- If the active profile is not the owner, return an error explaining that the owner must perform the operation.

Deletions:
- No additional confirmation step is required if the user explicitly asked to delete and the target is unambiguous.
- If ambiguous, ask a clarification question.

Sharing:
- Share/unshare require:
  - an unambiguous target item (same disambiguation rules as update/delete), and
  - a target profile identifier (`target_profile`) that resolves to an existing profile.
- If the target profile is missing or ambiguous, ask which profile to use.
- Only the owner can share/unshare. If the active profile is not the owner, return an error explaining that the owner must perform the operation (mirror list behavior).

## Viewer local time output
When listing agenda items (including shared items), the tool output must include both:
- the item's own local time (based on `item.timezone`), and
- the viewer's local time (based on the request/viewer timezone).

Proposed additions:
- `DisplayAgendaInput.action=list` accepts `range.timezone` as the viewer timezone (default: server-local timezone).
- `AgendaItemOutput` includes:
  - `viewer_local_date` (YYYY-MM-DD in viewer timezone)
  - `viewer_local_time` (HH:MM in viewer timezone)

## API endpoints (optional; tool-first is preferred)
If needed for admin/debugging, add:
- `GET /api/profiles/:profileId/agenda?range=today|tomorrow|this_week|this_month|next_n_days&days=N`
- `POST /api/profiles/:profileId/agenda` (create)
- `PATCH /api/profiles/:profileId/agenda/:itemId` (update)
- `DELETE /api/profiles/:profileId/agenda/:itemId` (delete)
- `POST /api/profiles/:profileId/agenda/:itemId/share` (share; body: target_profile)
- `POST /api/profiles/:profileId/agenda/:itemId/unshare` (stop sharing; body: target_profile)

However, in the normal UX this should be accessed via `displayAgenda` tool to keep behavior consistent with other RemcoChat tools.

## Acceptance criteria
- User can add an item with description/date/time/duration and it appears in "today/tomorrow".
- User can list "this week", "this month", and "coming 7 days".
- User can update an item (time/duration/description) with natural language.
- User can delete an item; ambiguous targets prompt a clarification with candidates.
- User can share and stop sharing an item with another profile with natural language.
- When listing agenda, items shared with the active profile are included and clearly marked as shared (owner shown).
- Shared items show both the item's local time and the viewer's local time.
- Agenda operations are triggered by the intent engine fast-path (no reliance on the base model deciding to call tools).
- Temporary chat mode refuses agenda mutations (consistent with memory behavior).
- Unit tests cover:
  - range window computations
  - overlap inclusion
  - disambiguation logic when multiple candidates exist

## Implementation sketch (file-level plan)
- `src/server/db.ts`: add `agenda_items` + `agenda_item_members` tables + indexes + safe migration.
- `src/server/agenda.ts`: CRUD + list helpers (pure DB).
- `src/server/intent-router.ts`: add `agenda` intent option.
- `src/server/agenda-intent.ts`: `routeAgendaCommand()` extractor (Zod schema + prompt).
- `src/ai/tools.ts`: add `displayAgenda` tool.
- `src/app/api/chat/route.ts`: add intent fast-path handler and tool UI response.
- `src/components/agenda-card.tsx`: render tool output.
- `src/app/home-client.tsx`: render `tool-displayAgenda` parts.
- `tests/*`: unit tests for date windows + db ops.
- `e2e/*`: smoke test: add + list + update + delete.
