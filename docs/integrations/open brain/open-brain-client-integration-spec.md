# Open Brain Client Integration Spec

Status: Draft v0.1  
Audience: RemcoChat implementers and Open Brain API implementers  
Scope: Client-side and server-side integration contract between RemcoChat and Open Brain  
Architecture mode: REST-first, private-by-default, LAN/Tailnet only

## 1. Purpose

This document specifies how RemcoChat integrates with Open Brain as a separate private service.

It defines:

- ownership and visibility semantics;
- deterministic capture versus conversational retrieval/review flows;
- the internal intent-and-projection contract inside RemcoChat;
- mapping rules from RemcoChat messages and UI actions to Open Brain REST requests;
- typed result contracts for transcript cards and tool rendering;
- status, error, idempotency, and rollout rules.

This is an integration specification, not an implementation guide for the full Open Brain server.

## 2. Design Drivers

The integration is shaped by five constraints:

1. RemcoChat remains the primary client and workflow host.
2. Open Brain remains a separate service and canonical knowledge store.
3. The first rollout is additive; it does not replace current lightweight profile memory.
4. Explicit capture is preferred over automatic mirroring of all chat transcripts.
5. Deterministic capture actions and conversational retrieval/review flows are different interaction modes and must not be collapsed into one code path.

## 3. Non-Goals for v1

The following are out of scope for the first client integration:

- replacing RemcoChat profile memory;
- automatic background capture of all chats;
- public or internet-facing exposure;
- global visibility semantics;
- binary attachment storage inside Open Brain;
- fully generic multimodal capture;
- cross-app federation beyond the private Open Brain REST service;
- MCP as the core contract.

## 4. Normative Language

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative.

## 5. System Boundary

```text
Browser UI / chat transcript / message actions / skills
    ↓
RemcoChat server entrypoints
    ↓
OpenBrainService (authoritative integration layer)
    ├─ intent builders
    ├─ projection builders
    ├─ policy enforcement
    ├─ DTO mappers
    └─ OpenBrainClient (HTTP)
            ↓
       Open Brain REST API
            ↓
     Open Brain storage + workers
```

### 5.1 Boundary ownership

RemcoChat owns:

- chats;
- messages;
- profiles;
- folders;
- UI state;
- existing lightweight profile memory in the short term;
- user interaction semantics;
- source message resolution;
- capture projection construction;
- caller identity and viewer context.

Open Brain owns:

- explicit captures;
- semantic retrieval;
- enrichment jobs;
- review generation;
- imports;
- reindexing;
- audit-grade eventing for brain items.

## 6. Authoritative Construction Point

The internal intent-and-projection contract **MUST** be constructed inside RemcoChat’s trusted server layer.

It **MUST NOT** be constructed:

- in the browser;
- in raw skill markdown;
- in ad hoc tool prompts;
- in Open Brain itself;
- inside the model/tool loop for deterministic UI actions.

The construction point is:

1. after request authentication and active profile resolution;
2. after chat/message/source lookup;
3. before any outbound REST call to Open Brain.

## 7. Integration Modes

There are three integration modes.

### 7.1 Deterministic command mode

Used for:

- Save to Brain;
- Save answer to Brain;
- patch labels or visibility;
- delete or archive;
- retry failed capture.

Rules:

- deterministic commands **MUST NOT** depend on the chat model loop;
- deterministic commands **MUST** go through a direct server-side call to `OpenBrainService`;
- deterministic commands **SHOULD** return receipts/cards/toasts rather than assistant prose.

### 7.2 Conversational tool mode

Used for:

- Search Brain;
- Weekly Review;
- memory migration workflows;
- capture-template workflows;
- review or summarization flows that benefit from conversational framing.

Rules:

- these flows **MAY** use tool calls and skills;
- tool handlers **MUST** converge on the same `OpenBrainService` contract as deterministic commands;
- tools and skills **MUST NOT** embed raw HTTP logic.

### 7.3 Optional dedicated panel mode

Used only if a future standalone UI panel requires direct fetches without the model loop.

Rules:

- panel endpoints **MUST** still call the same `OpenBrainService`;
- panel endpoints **MUST NOT** bypass projection, policy, or ownership checks.

## 8. Core Principles

1. **Private by default.** Every capture starts as private unless the user explicitly chooses otherwise.
2. **No silent dual-write.** Writing to Open Brain does not also write to current profile memory unless an explicit workflow says so.
3. **Content provenance is preserved.** Every capture includes source and projection metadata.
4. **Captured source text is immutable.** The original captured content is not silently rewritten by later UI edits.
5. **Retrieval is typed.** Open Brain results are rendered from typed DTOs, not parsed from generic text.
6. **Prompt safety is explicit.** User-facing display snippets and model-facing context blocks are distinct fields.
7. **Additive rollout.** v1 adds Open Brain alongside the current memory feature.

## 9. Ownership and Visibility Contract

### 9.1 Ownership model

Every Open Brain item **MUST** have one `owner_profile_id`.

`owner_profile_id`:

- **MUST** be derived by RemcoChat server-side from the active profile context;
- **MUST NOT** be supplied by the browser as a trusted field;
- **MUST** be included in every server-to-server create/search/patch/delete request.

`actor_profile_id` identifies the authenticated actor performing the action.

`actor_profile_id` and `owner_profile_id` may be the same in v1.

### 9.2 Visibility model

v1 visibility values are:

- `private`
- `shared_chat`
- `shared_profiles`

`global` is forbidden in v1.

### 9.3 Visibility semantics

#### `private`

Visible only to the owner profile.

#### `shared_chat`

Visible to participants of the source shared chat **as captured at save time**.

Rules:

- the item **MUST** store `source_chat_id`;
- the item **MUST** store an `allowed_profile_ids` snapshot derived by RemcoChat at capture time;
- enforcement **MUST NOT** rely solely on a live chat lookup.

#### `shared_profiles`

Visible only to an explicit allow-list of profile IDs.

Rules:

- the item **MUST** store `allowed_profile_ids`;
- the allow-list **MUST** be resolved server-side.

### 9.4 Default visibility

Default visibility is always `private`.

Even inside a shared chat, captures **MUST** default to `private` unless the user explicitly selects a shared mode.

### 9.5 Viewer filtering

Search and fetch operations **MUST** be filtered by viewer context.

The browser **MUST NOT** supply final viewer authority. RemcoChat server-side context is authoritative.

## 10. Temporary Chat Policy

### 10.1 Read policy

Reading from Open Brain is allowed in temporary chats.

This includes:

- semantic search;
- recent items;
- weekly review;
- retrieval-augmented answers.

### 10.2 Write policy

Writing from temporary chats is allowed only through explicit user action.

Rules:

- no automatic or background capture is allowed from temporary chats;
- deterministic capture from a temporary chat **MUST** require explicit action;
- the capture **MUST** include `origin_ephemeral = true` in provenance;
- if the product team wants extra friction, a second confirmation step **MAY** be added.

### 10.3 Policy consequence

Temporary chats remain non-persistent by default, but the user may intentionally preserve a specific item into Open Brain.

## 11. Internal RemcoChat Contract

This section defines the canonical internal contract. All UI actions, tools, skills, and optional panel routes **MUST** converge on these types or equivalent generated types.

### 11.1 Caller context

```ts
interface OpenBrainCallerContext {
  actorProfileId: string;
  activeProfileId: string;
  requestId: string;
  chatId?: string;
  isTemporaryChat: boolean;
  chatParticipantProfileIds?: string[];
  allowedShareTargetProfileIds?: string[];
}
```

Rules:

- this context is server-only;
- it is populated after request auth and source resolution;
- browser code never constructs it directly.

### 11.2 Capture source types

```ts
type BrainCaptureSource =
  | {
      type: "user_message";
      chatId: string;
      messageId: string;
      role: "user";
    }
  | {
      type: "assistant_message";
      chatId: string;
      messageId: string;
      role: "assistant";
    }
  | {
      type: "selection";
      chatId: string;
      text: string;
      sourceMessageIds?: string[];
    }
  | {
      type: "manual_note";
      text: string;
      chatId?: string;
      sourceMessageIds?: string[];
    };
```

### 11.3 Capture projections

```ts
type BrainProjection =
  | {
      type: "user_message_text";
      includeAttachmentRefs?: boolean;
    }
  | {
      type: "assistant_final_answer";
      includeToolRefs?: boolean;
    }
  | {
      type: "assistant_summary";
      includeToolRefs?: boolean;
    }
  | {
      type: "selection_text";
    }
  | {
      type: "tool_result_summary";
      toolCallIds: string[];
      includeRawOutput?: false;
    }
  | {
      type: "attachment_references";
      attachmentIds: string[];
    };
```

### 11.4 Required v1 support

RemcoChat v1 **MUST** support:

- `user_message_text`
- `assistant_final_answer`
- `selection_text`

RemcoChat v1 **MAY** support:

- `assistant_summary`
- `tool_result_summary`
- `attachment_references`
- `manual_note`

### 11.5 Capture intent

```ts
type BrainVisibility = "private" | "shared_chat" | "shared_profiles";

interface BrainCaptureIntent {
  kind: "capture";
  source: BrainCaptureSource;
  projection: BrainProjection;
  requestedVisibility?: BrainVisibility;
  sharedWithProfileIds?: string[];
  kindHint?: string;
  titleHint?: string;
  labels?: string[];
  explicitFromTemporaryChat?: boolean;
}
```

### 11.6 Search intent

```ts
interface BrainSearchIntent {
  kind: "search";
  query: string;
  limit?: number;
  includeShared?: boolean;
  filters?: {
    kinds?: string[];
    labels?: string[];
    sourceTypes?: Array<BrainCaptureSource["type"]>;
    capturedAfter?: string;
    capturedBefore?: string;
  };
  resultMode?: "ui" | "tool" | "llm_context";
}
```

### 11.7 Weekly review intent

```ts
interface WeeklyReviewIntent {
  kind: "weekly_review";
  period?: {
    start: string;
    end: string;
    timezone?: string;
  };
  includeShared?: boolean;
  forceRecompute?: boolean;
  resultMode?: "ui" | "tool";
}
```

### 11.8 Patch intent

```ts
interface BrainPatchIntent {
  kind: "patch";
  itemId: string;
  ops: {
    title?: string | null;
    visibility?: BrainVisibility;
    sharedWithProfileIds?: string[];
    addLabels?: string[];
    removeLabels?: string[];
    userNote?: string | null;
  };
}
```

### 11.9 Delete intent

```ts
interface BrainDeleteIntent {
  kind: "delete";
  itemId: string;
  mode?: "soft";
}
```

Hard delete is not part of the normal v1 client contract.

## 12. Canonical Projection Rules

### 12.1 User message capture

For `user_message_text`:

- concatenate visible user text parts in order;
- preserve paragraph boundaries where possible;
- exclude UI-only wrapper text;
- exclude system metadata and hidden fields;
- include attachment references only if `includeAttachmentRefs = true`;
- preserve `chatId`, `messageId`, `role`, and timestamp as provenance.

### 12.2 Assistant final answer capture

For `assistant_final_answer`:

- concatenate the user-visible final assistant text in display order;
- exclude hidden chain-of-thought, tool call arguments, and internal routing state;
- preserve markdown structure if present;
- include only tool references, not raw tool payloads, when `includeToolRefs = true`;
- if there is no user-visible answer text, this projection is invalid and should fall back to `tool_result_summary` or be rejected.

### 12.3 Assistant summary capture

For `assistant_summary`:

- the projection expresses user intent to save a concise version of an assistant turn;
- RemcoChat may send the visible answer plus a projection type hint;
- Open Brain may perform the summarization asynchronously;
- deterministic UI actions should prefer `assistant_final_answer` unless summary mode is explicit.

### 12.4 Selection capture

For `selection_text`:

- store the exact selected text;
- include source message IDs when known;
- preserve provenance pointing back to the source chat or messages;
- do not silently widen the selection to the full message body.

### 12.5 Tool result summary capture

For `tool_result_summary`:

- store a concise summary of the tool outcome;
- preserve tool invocation references;
- raw tool payloads should not be stored by default;
- if raw tool payload capture is ever added, it must be an explicit debug/admin mode, not a normal user capture mode.

### 12.6 Attachment references

For `attachment_references`:

- store attachment metadata only in v1;
- do not inline binary data;
- preserve filename, media type, size, local identifier, and source message linkage when available;
- textual extraction should be a separate import or enrichment concern.

### 12.7 Provenance requirements

Every projected capture **MUST** retain enough provenance to answer:

- who captured it;
- from which profile;
- from which chat and message, if any;
- whether the source was temporary;
- what projection was used;
- what attachment and tool references were preserved;
- what visibility mode was chosen.

## 13. Internal Projected Capture Shape

Before the REST call is made, the internal service constructs a normalized projected capture.

```ts
interface BrainAttachmentRef {
  attachmentId: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
}

interface BrainToolRef {
  toolCallId: string;
  toolName: string;
  summary?: string;
}

interface BrainProvenance {
  system: "remcochat";
  sourceType: BrainCaptureSource["type"];
  projectionType: BrainProjection["type"];
  chatId?: string;
  messageId?: string;
  role?: "user" | "assistant";
  sourceMessageIds?: string[];
  originEphemeral: boolean;
}

interface BrainProjectedCapture {
  contentRaw: string;
  contentFormat: "plain_text" | "markdown";
  attachmentRefs: BrainAttachmentRef[];
  toolRefs: BrainToolRef[];
  provenance: BrainProvenance;
}
```

## 14. Authoritative Internal Service Interface

All RemcoChat integration paths **MUST** converge on a single internal service interface.

```ts
interface OpenBrainService {
  capture(
    ctx: OpenBrainCallerContext,
    intent: BrainCaptureIntent
  ): Promise<BrainCaptureReceipt>;

  search(
    ctx: OpenBrainCallerContext,
    intent: BrainSearchIntent
  ): Promise<BrainSearchResultSet>;

  requestWeeklyReview(
    ctx: OpenBrainCallerContext,
    intent: WeeklyReviewIntent
  ): Promise<BrainReviewHandle | BrainReview>;

  patchItem(
    ctx: OpenBrainCallerContext,
    intent: BrainPatchIntent
  ): Promise<BrainItemPatchResult>;

  deleteItem(
    ctx: OpenBrainCallerContext,
    intent: BrainDeleteIntent
  ): Promise<BrainDeleteReceipt>;
}
```

### 14.1 Internal service responsibilities

`OpenBrainService` is responsible for:

- validating temporary-chat write policy;
- resolving ownership and visibility;
- projecting RemcoChat source content into canonical form;
- deriving idempotency keys;
- mapping internal intents to server-to-server REST DTOs;
- mapping REST responses to typed UI/tool result contracts;
- normalizing upstream errors into stable client errors.

## 15. Runtime Construction Flow

### 15.1 Deterministic capture

```text
Browser click / menu action
  → RemcoChat server action or API route
  → auth + active profile resolution
  → message/source lookup
  → build BrainCaptureIntent
  → build BrainProjectedCapture
  → apply ownership/visibility policy
  → derive idempotency key
  → OpenBrainClient.createCapture(...)
  → map response to BrainCaptureReceipt
  → render receipt card / toast
```

### 15.2 Conversational search or review

```text
User asks in chat
  → tool or skill entrypoint
  → parse structured args
  → auth + profile resolution
  → build BrainSearchIntent or WeeklyReviewIntent
  → OpenBrainClient.search(...) / requestReview(...)
  → map to typed tool result DTO
  → render transcript card
  → optional assistant prose uses typed card data
```

## 16. Server-to-Server REST Contract Mapping

This section defines the recommended REST payloads that `OpenBrainClient` sends to Open Brain.

### 16.1 Create capture request

`POST /v1/captures`

```json
{
  "idempotency_key": "sha256:...",
  "actor_profile_id": "profile_actor_123",
  "owner_profile_id": "profile_owner_123",
  "visibility": "private",
  "allowed_profile_ids": [],
  "origin": {
    "system": "remcochat",
    "source_type": "assistant_message",
    "projection_type": "assistant_final_answer",
    "chat_id": "chat_123",
    "message_id": "msg_456",
    "role": "assistant",
    "origin_ephemeral": false
  },
  "payload": {
    "content_raw": "Final answer text...",
    "content_format": "markdown",
    "attachment_refs": [],
    "tool_refs": []
  },
  "kind_hint": "decision",
  "title_hint": null,
  "labels": ["architecture", "open-brain"]
}
```

Rules:

- `owner_profile_id` and `actor_profile_id` come from RemcoChat server context;
- `allowed_profile_ids` must be present for shared modes;
- `content_raw` must already be projected by RemcoChat;
- Open Brain should not need to fetch RemcoChat messages to understand the capture.

### 16.2 Create capture response

```json
{
  "receipt_id": "obr_123",
  "item_id": "obi_456",
  "status": "ready",
  "visibility": "private",
  "summary": "Saved to Open Brain as decision",
  "warnings": []
}
```

### 16.3 Search request

`POST /v1/search`

```json
{
  "viewer_profile_id": "profile_viewer_123",
  "query": "What did I already save about the Open Brain architecture?",
  "limit": 10,
  "include_shared": true,
  "filters": {
    "kinds": ["decision", "thought"],
    "labels": ["architecture"]
  },
  "result_mode": "ui"
}
```

### 16.4 Search response

```json
{
  "search_id": "obs_123",
  "results": [
    {
      "item_id": "obi_456",
      "score": 0.84,
      "title": null,
      "kind": "decision",
      "visibility": "private",
      "display_snippet": "Keep Open Brain as a separate service beside RemcoChat.",
      "model_context_text": "Decision: Open Brain is a separate service beside RemcoChat.",
      "provenance": {
        "system": "remcochat",
        "chat_id": "chat_123",
        "message_id": "msg_456"
      },
      "captured_at": "2026-03-08T12:00:00Z"
    }
  ]
}
```

### 16.5 Weekly review request

`POST /v1/reviews/weekly`

```json
{
  "viewer_profile_id": "profile_viewer_123",
  "period": {
    "start": "2026-03-02T00:00:00Z",
    "end": "2026-03-08T23:59:59Z",
    "timezone": "Europe/Amsterdam"
  },
  "include_shared": true,
  "force_recompute": false
}
```

### 16.6 Weekly review response

Preferred default:

- `202 Accepted` with handle for async progress.

```json
{
  "review_id": "obrw_123",
  "status": "queued"
}
```

Optional synchronous completion:

```json
{
  "review_id": "obrw_123",
  "status": "ready",
  "summary_markdown": "# Weekly Review\n...",
  "themes": ["architecture", "capture semantics"],
  "action_items": ["Define visibility contract"]
}
```

### 16.7 Patch request

`PATCH /v1/items/{id}`

Client patching is limited to mutable fields:

- title;
- labels;
- visibility;
- sharing metadata;
- user note.

The original captured content is immutable.

### 16.8 Delete request

`DELETE /v1/items/{id}`

Client delete is soft delete only in v1.

## 17. Idempotency

Idempotency is mandatory for capture.

### 17.1 Key derivation

The idempotency key **SHOULD** be derived from:

- owner profile ID;
- source type;
- chat ID;
- message ID or selected text hash;
- projection type;
- normalized content hash;
- requested visibility;
- sorted shared profile IDs.

Illustrative form:

```text
sha256(
  owner_profile_id |
  source.type |
  chat_id |
  message_id_or_selection_hash |
  projection.type |
  content_hash |
  visibility |
  sorted(shared_with_profile_ids)
)
```

### 17.2 Semantic effect

Repeated clicks on the same item with the same projection and visibility should return the same capture receipt or the already-created item.

Changing projection or visibility should produce a new idempotency key.

## 18. Typed Result Contracts for UI and Tools

Open Brain results must be typed for rendering.

### 18.1 Capture receipt

```ts
interface BrainCaptureReceipt {
  kind: "open_brain_capture_receipt";
  receiptId: string;
  itemId?: string;
  status: "accepted" | "processing" | "ready" | "partial" | "failed";
  visibility: BrainVisibility;
  summary: string;
  warnings: string[];
}
```

### 18.2 Search result set

```ts
interface BrainSearchResult {
  itemId: string;
  score: number;
  title: string | null;
  kind: string;
  visibility: BrainVisibility;
  displaySnippet: string;
  modelContextText: string;
  capturedAt: string;
  provenance: {
    system: "remcochat";
    chatId?: string;
    messageId?: string;
  };
}

interface BrainSearchResultSet {
  kind: "open_brain_search_results";
  searchId: string;
  query: string;
  results: BrainSearchResult[];
  summaryHint?: string;
  nextActions?: string[];
}
```

### 18.3 Weekly review handle and result

```ts
interface BrainReviewHandle {
  kind: "open_brain_review_handle";
  reviewId: string;
  status: "queued" | "running";
}

interface BrainReview {
  kind: "open_brain_weekly_review";
  reviewId: string;
  status: "ready" | "failed";
  summaryMarkdown?: string;
  themes?: string[];
  actionItems?: string[];
  warnings?: string[];
}
```

### 18.4 Patch result

```ts
interface BrainItemPatchResult {
  kind: "open_brain_patch_result";
  itemId: string;
  status: "ready";
}
```

### 18.5 Delete receipt

```ts
interface BrainDeleteReceipt {
  kind: "open_brain_delete_receipt";
  itemId: string;
  status: "deleted";
}
```

## 19. Rendering Rules

### 19.1 Deterministic capture rendering

Deterministic capture actions should render:

- a toast, or
- a small receipt card.

They should not require assistant-generated prose.

### 19.2 Search and review rendering

Search and weekly review should render dedicated transcript cards.

Assistant prose may accompany the card, but the card is the authoritative structured output.

### 19.3 Duplicate suppression

If a transcript card already contains the canonical structured result, RemcoChat should be able to suppress duplicate assistant prose.

This should be handled by explicit card kind checks, not by fragile text heuristics.

## 20. Prompt-Safe Retrieval Contract

Open Brain content may contain arbitrary user text, imported text, or previous model output.

Therefore:

- `displaySnippet` is for UI rendering;
- `modelContextText` is for model input;
- raw stored text should not automatically be injected into prompts;
- if richer evidence is needed, a separate safe evidence block should be produced server-side.

The browser should never decide what raw retrieved content is safe to inject into the model.

## 21. Status and Error Model

### 21.1 Capture statuses

- `accepted`
- `processing`
- `ready`
- `partial`
- `failed`

### 21.2 Review statuses

- `queued`
- `running`
- `ready`
- `failed`

### 21.3 Search states

Search is synchronous from the client perspective.

Result cardinality may be:

- non-empty;
- zero results;
- failed.

### 21.4 Stable client error codes

Client integrations should normalize upstream failures into stable codes such as:

- `policy_forbidden`
- `temporary_chat_write_unconfirmed`
- `projection_unsupported`
- `source_not_found`
- `visibility_invalid`
- `upstream_unavailable`
- `upstream_timeout`
- `upstream_validation_failed`

## 22. Mutability Rules

### 22.1 Immutable fields

The following are immutable once captured:

- original projected source content;
- source provenance;
- projection type;
- owner profile ID.

### 22.2 Mutable fields

The following may be edited later:

- title;
- labels;
- visibility;
- sharing allow-list;
- user note.

If the user needs to correct the substance of a capture, the preferred model is a new item or a future revision model, not silent mutation of original source text.

## 23. Coexistence with Current Memory

Open Brain is additive in phase 1.

Rules:

- current profile memory remains active;
- Open Brain writes do not automatically write to current profile memory;
- current profile memory actions should retain distinct naming;
- Open Brain search should not be mislabeled as ordinary memory lookup.

Recommended UI copy:

- `Save to Profile Memory`
- `Save to Open Brain`
- `Search Brain`

## 24. Recommended File/Module Layout in RemcoChat

```text
src/server/integrations/open-brain/
  client.ts
  dto-mappers.ts
  intents.ts
  projections.ts
  service.ts
  errors.ts
  cards.ts

src/ai/
  open-brain-tools.ts

src/server/skills/
  ... existing runtime uses OpenBrainService through tool layer or server adapter
```

Responsibilities:

- `intents.ts`: canonical internal types;
- `projections.ts`: source resolution and projection logic;
- `service.ts`: policy enforcement and orchestration;
- `client.ts`: thin outbound REST client;
- `dto-mappers.ts`: transport mapping only;
- `cards.ts`: typed card mapping and rendering helpers.

## 25. Rollout Plan

### Phase 1

Required:

- explicit capture from user message;
- explicit capture from assistant final answer;
- selection capture;
- search;
- weekly review;
- typed receipt and result cards;
- additive coexistence with current memory;
- private-by-default ownership and visibility;
- temporary chat explicit-write policy.

### Phase 2

Optional extensions:

- assistant summary capture;
- tool result summary capture;
- attachment reference capture;
- patch and delete UI;
- shared visibility UI;
- dedicated search dialog/panel.

### Phase 3

Optional later work:

- richer import workflows;
- revision model for corrected captures;
- internal MCP adapter as a thin compatibility layer above REST;
- broader multimodal capture.

## 26. Acceptance Criteria

The client integration is acceptable when all of the following are true:

1. A user can explicitly save a user message into Open Brain without going through the model loop.
2. A user can explicitly save an assistant answer into Open Brain with clear projection semantics.
3. Search uses typed result cards and respects owner/viewer visibility.
4. Temporary chats can read from Open Brain but cannot auto-write.
5. The browser never supplies trusted owner/viewer fields directly.
6. Skills and tools call `OpenBrainService`, not raw HTTP.
7. Open Brain and current profile memory coexist without silent dual-write.
8. Duplicate assistant prose can be suppressed when Open Brain cards are rendered.
9. Search results expose both display-safe and model-safe fields.
10. Capture retry is idempotent.

## 27. Recommended Initial Decisions

To avoid ambiguity, the following decisions should be locked immediately:

- Open Brain is separate and additive.
- Default visibility is `private`.
- `global` visibility is not supported in v1.
- Deterministic capture bypasses the model loop.
- The browser sends local action intents only; server builds final Open Brain requests.
- `assistant_final_answer` is the default assistant capture mode.
- Raw tool payload capture is out of scope for normal v1 usage.
- Temporary chats may read, but writes are explicit only.

## 28. Short Reference Summary

If an implementer remembers only one thing, it should be this:

> Every Open Brain action starts as a RemcoChat intent, is resolved into a canonical projection on the trusted server, and only then becomes a REST request.

That is the seam that keeps ownership, visibility, provenance, rendering, and future evolution coherent.
