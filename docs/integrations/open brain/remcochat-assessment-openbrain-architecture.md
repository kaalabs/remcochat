# RemcoChat Assessment of Open Brain Architecture

Date: 2026-03-05
Related plan: [open-brain-architectuurplan-remcochat.md](/Users/rrk/Work/remcochat/docs/integrations/open%20brain/open-brain-architectuurplan-remcochat.md)

## Summary

The Open Brain plan is directionally correct.

The central decision to keep Open Brain as a separate service beside RemcoChat, instead of extending RemcoChat's internal SQLite memory, is the right boundary for this codebase. RemcoChat's existing memory is a lightweight profile-local text store, not a sustainable base for vector retrieval, chunking, enrichment jobs, imports, or review generation.

The plan also aligns well with how RemcoChat already integrates external capabilities: server-side tool factories, request gating, and outbound HTTP clients. That means Open Brain can be added as a first-class integration without distorting RemcoChat's current architecture.

## Why The Separate-Service Decision Is Correct

The plan states that Open Brain should be a separate service and not an extension of RemcoChat's SQLite storage. That is the correct choice for the current system.

Today, RemcoChat's memory is stored in SQLite in [`src/server/db.ts`](/Users/rrk/Work/remcochat/src/server/db.ts#L35) and exposed through simple CRUD logic in [`src/server/memory.ts`](/Users/rrk/Work/remcochat/src/server/memory.ts#L24). Chat then injects up to 50 memory lines directly into the model prompt in [`src/app/api/chat/route.ts`](/Users/rrk/Work/remcochat/src/app/api/chat/route.ts#L2485). This works for small persistent facts, but it does not provide:

- semantic retrieval;
- chunking;
- embedding versioning;
- async enrichment;
- imports;
- review synthesis;
- durable auditability.

Trying to evolve the current SQLite memory feature into Open Brain would couple a much larger knowledge-system concern into RemcoChat's local app database and chat route.

## Where The Plan Matches RemcoChat Well

### 1. Tool-based integration is already the house style

RemcoChat already composes external capabilities into `/api/chat` as tool bundles rather than pushing every new domain into the app database. The composition points are visible in [`src/app/api/chat/route.ts`](/Users/rrk/Work/remcochat/src/app/api/chat/route.ts#L2564) and the merged tool registry in [`src/app/api/chat/route.ts`](/Users/rrk/Work/remcochat/src/app/api/chat/route.ts#L3006).

That means the plan's proposed `openBrainGateway` is not speculative. It fits the existing architecture directly.

The clean implementation shape is:

- config parsing in [`src/server/config.ts`](/Users/rrk/Work/remcochat/src/server/config.ts#L117);
- request gating in [`src/server/request-auth.ts`](/Users/rrk/Work/remcochat/src/server/request-auth.ts#L11);
- tool factory in a new `src/ai/open-brain-tools.ts`;
- outbound HTTP client in a new `src/server/integrations/open-brain/client.ts`.

This is the same pattern already used for Hue and OV-NL.

### 2. Explicit capture fits the current UI

The plan chooses explicit capture rather than automatic mirroring of all chat transcripts. That fits RemcoChat's current interaction model well.

RemcoChat already has:

- per-message actions for user turns in [`src/app/home-client.tsx`](/Users/rrk/Work/remcochat/src/app/home-client.tsx#L5318);
- a memorize dialog in [`src/app/home-client.tsx`](/Users/rrk/Work/remcochat/src/app/home-client.tsx#L6688);
- inline tool-card rendering in [`src/app/home-client.tsx`](/Users/rrk/Work/remcochat/src/app/home-client.tsx#L4444).

So "Save to Brain" is a natural extension of existing patterns. It does not require a new UI paradigm.

### 3. Skills are the right workflow layer

The plan maps migration, capture templates, spark, and weekly review to skills and workflows. That matches how RemcoChat already treats reusable workflows.

The runtime for this already exists in [`src/server/skills/runtime.ts`](/Users/rrk/Work/remcochat/src/server/skills/runtime.ts#L10), and skills are exposed through tools in [`src/ai/skills-tools.ts`](/Users/rrk/Work/remcochat/src/ai/skills-tools.ts#L116).

That makes the proposed Open Brain workflow package structurally credible:

- `open-brain-memory-migration`
- `open-brain-second-brain-migration`
- `open-brain-spark`
- `open-brain-capture-templates`
- `open-brain-weekly-review`

These should sit above the transport layer and call `openBrainGateway`, rather than embedding raw HTTP logic in `SKILL.md`.

## Where The Plan Is Still Under-Specified

### 1. Ownership and visibility are not defined tightly enough

RemcoChat is profile-oriented. Profiles are a first-class domain concept in [`src/lib/types.ts`](/Users/rrk/Work/remcochat/src/lib/types.ts#L11), and several features already distinguish owned versus shared data.

The proposed Open Brain data model includes `source_ref` and `actor_ref`, but it does not clearly define:

- owner profile;
- viewer visibility;
- whether captures are private by default;
- whether Open Brain is global across all profiles;
- how shared chats relate to shared brain items.

This gap matters. Without an explicit ownership model, Open Brain risks becoming implicitly global while RemcoChat remains profile-scoped.

At minimum, v1 should define explicit ownership fields such as:

- `owner_profile_id`;
- `visibility` (`private`, `shared`, `global`);
- optional sharing metadata.

### 2. The plan does not separate deterministic UI actions from conversational flows enough

The plan correctly identifies capture, search, and review, but those should not all be implemented through the same path.

There are two distinct integration modes:

- deterministic user actions like "Save to Brain" from a message action;
- conversational agent flows like "search my brain for prior notes about X".

For deterministic capture, going through the full model/tool loop is unnecessary. A small server-side proxy or gateway call is cleaner and more reliable.

For search and weekly review, the tool/skills path is correct, because those benefit from conversational framing and structured tool results.

So the right split is:

- explicit button actions for deterministic capture;
- chat tools and skills for search and review;
- optional direct app routes only if a standalone UI panel needs to fetch without the model loop.

### 3. Capture semantics are more complex than the plan currently implies

The plan says "Save to Brain" and "Save answer to Brain", but current message capture in the UI only extracts text parts from a message in [`src/app/home-client.tsx`](/Users/rrk/Work/remcochat/src/app/home-client.tsx#L2863).

That is too narrow for Open Brain if you want to capture:

- assistant answers containing tool cards;
- structured outputs;
- attachments;
- summaries of tool results;
- future multimodal content.

Before implementation, the system needs a canonical capture policy:

- what exact content is saved from a user message;
- what exact content is saved from an assistant message;
- whether raw tool output is stored;
- whether attachments are referenced or inlined;
- how provenance is preserved.

Without this, "Save to Brain" will quickly become ambiguous and inconsistent.

### 4. Temporary-chat behavior is unresolved

Current memory explicitly blocks saves from temporary chats in [`src/ai/tools.ts`](/Users/rrk/Work/remcochat/src/ai/tools.ts#L141). Open Brain needs a deliberate policy here.

Possible choices:

- temporary chats may not create brain captures;
- temporary chats may create captures but with weaker provenance;
- temporary chats may create captures only after an explicit confirmation step.

This needs to be decided early because it affects UI affordances and user trust.

### 5. The current memory feature should not be replaced in phase 1

Open Brain should be additive first, not a direct replacement for profile memory.

Current memory behavior is wired into:

- confirmation handling in [`src/app/api/chat/route.ts`](/Users/rrk/Work/remcochat/src/app/api/chat/route.ts#L2074);
- direct memory-intent handling in [`src/app/api/chat/route.ts`](/Users/rrk/Work/remcochat/src/app/api/chat/route.ts#L2226);
- prompt construction in [`src/app/api/chat/route.ts`](/Users/rrk/Work/remcochat/src/app/api/chat/route.ts#L2784).

That logic is specific to the existing lightweight memory system. Replacing it immediately with Open Brain would expand the blast radius and make the first integration much riskier than necessary.

## Recommended Integration Shape

The best future integration for RemcoChat is additive and layered.

### Layer 1. RemcoChat keeps owning app-local state

RemcoChat should continue to own:

- chats;
- messages;
- profiles;
- folders;
- local UI state;
- current lightweight profile memory in the short term.

This avoids forcing Open Brain to absorb concerns that are not actually part of a shared knowledge system.

### Layer 2. Open Brain owns shared knowledge-system concerns

Open Brain should own:

- explicit captures;
- semantic search;
- enrichment jobs;
- imports;
- review generation;
- reindexing;
- audit-grade eventing around brain items.

That is consistent with the architecture plan and with the actual limitations of the current RemcoChat memory implementation.

### Layer 3. Integration happens through gateway + skills + UI cards

The cleanest RemcoChat integration model is:

1. `openBrainGateway` as a server-side tool bundle;
2. dedicated Open Brain client code for outbound REST calls;
3. skill-based workflows for migration/review/capture templates;
4. dedicated transcript cards for search and review output.

For tool-card behavior, RemcoChat already has a strong precedent in memory cards and other transcript cards in [`src/app/home-client.tsx`](/Users/rrk/Work/remcochat/src/app/home-client.tsx#L4444). If Open Brain cards should suppress duplicate assistant prose, they should also be added to the suppression logic in [`src/app/home-client.tsx`](/Users/rrk/Work/remcochat/src/app/home-client.tsx#L4294).

## Recommended UI Approach

The cleanest UI choices are:

- "Save to Brain" as a deterministic message action;
- "Save answer to Brain" as a new assistant-turn action strip or equivalent action menu;
- "Search Brain" as either:
  - a synthetic conversational action through `/api/chat`, or
  - a dedicated search dialog if structured filters are needed;
- "Weekly Review" as either:
  - a composer-level trigger that sends a structured chat instruction, or
  - a dedicated tool-card flow.

The current memory dialog and message action system are enough to support the initial UX. The only real constraint is that current message actions are attached only to user messages, so assistant-turn capture needs a small extension.

## Main Risks If Implemented Poorly

- Treating Open Brain as a direct replacement for profile memory too early.
- Making Open Brain implicitly global without a clear ownership and visibility model.
- Embedding raw HTTP logic into chat-route branches or skills instead of using a dedicated client.
- Using the model/tool loop for deterministic capture actions that should be direct and reliable.
- Defining "Save to Brain" too vaguely, especially for assistant/tool/attachment content.
- Allowing UI card rendering without handling duplicate assistant-text suppression.

## Conclusion

The plan is solid at the service-boundary level and compatible with RemcoChat's current architecture.

Its core decision is correct:

- RemcoChat should remain the primary client and workflow host.
- Open Brain should become the canonical memory and retrieval service.
- The integration should be REST-first and private-by-default.

The main work still needed is not a change in direction, but tightening the integration contract:

- define ownership and visibility;
- define exact capture semantics;
- keep the first rollout additive;
- separate deterministic capture UX from conversational retrieval/review flows.

If those points are handled carefully, Open Brain can fit into RemcoChat cleanly without compromising the current app structure.
