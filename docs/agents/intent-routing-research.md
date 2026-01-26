# Intent Routing Research (Avoiding Brittle Heuristics)

## Why This Document Exists
We noticed that adding more programmatic "hints" (regex/keyword gates like matching "coming week") makes RemcoChat:
- Less flexible (misses paraphrases and new phrasings).
- Less maintainable (hint list grows forever).
- Less "intelligent" (behavior becomes rule-driven instead of intent-driven).

This document captures best-practice patterns for intent/tool routing in agentic systems and proposes practical alternatives for RemcoChat.

## The Current Failure Mode (Observed)
When we gate the intent-router behind heuristic detection, messages that *should* be routed (e.g. "show my agenda for the coming week") may not reach the intent engine.
Then the general chat model responds on its own (often asking clarifying questions like timezone), instead of invoking the agenda tool.

The root issue is not "timezone handling" but "routing didn't happen".

## Research Findings (Industry Patterns / Best Practices)

### 1) Semantic Routing Over Keyword/Regex Rules
Modern systems prefer routing by *meaning* (semantic similarity) instead of exact phrase/keyword matching.
This is typically done with embeddings:
- Encode the incoming message into a vector.
- Compare it to route vectors / example utterance vectors.
- Pick the best route if similarity exceeds a threshold; otherwise pick "none".

Why it helps:
- Handles paraphrases and synonyms naturally.
- Eliminates the need to maintain a growing list of brittle string checks.

### 2) Use Confidence Thresholds + "none" as the Main Guardrail
Best practice is not "route always", but "route when confident":
- If the router confidence/score is below threshold, return `intent=none` and let normal chat handle it.
- Thresholds may differ per route (agenda vs memory vs weather).

This is a common tuning strategy in semantic routers and intent classifiers.

### 3) Separate Routing From Execution (Router Layer / Router Agent)
A recurring architecture recommendation:
- A dedicated routing step (cheap/fast) decides which tool / pipeline should handle the message.
- The execution step then runs the chosen tool(s).

Benefits:
- Less coupling between "intent detection" and "tool execution".
- Easier to debug: you can log router decisions and confidence.
- Easier to tune thresholds without changing business logic.

### 4) Hybrid Routing (Dense + Sparse Signals) for Robustness
Some routers combine:
- Dense embeddings (semantic similarity)
- Sparse signals (keywords/BM25-style matching)

This is not the same as "hardcoded regex gates". It's a blended scoring model that still routes based on overall confidence.

Hybrid strategies help when:
- Some intents depend on domain-specific vocabulary.
- You want robustness across both paraphrases and exact terms.

### 5) Tool Selection Can Also Be Semantically Filtered
When many tools exist, a common pattern is:
- Select top-K relevant tools via semantic similarity first.
- Only pass those tools to the LLM/tool-calling stage.

This reduces tool overload and improves tool-call accuracy.

## Alternatives for RemcoChat (Recommended Options)

### Option A (Simplest): Always Run the LLM Intent Router; Remove Heuristic Gates
Change:
- Remove the `shouldRouteIntent()` keyword/regex gate.
- Always call `routeIntent()` for each user message.
- Decide based on returned `confidence` vs configured `minConfidence`.

Pros:
- Maximum flexibility; no brittle hints.
- Minimal new infrastructure.
- Matches the "router layer + threshold" best practice.

Cons:
- Adds a router model call to every message (latency/cost).
  Mitigation: choose a small/fast router model and keep `maxInputChars` low.

### Option B (Fast + Cheap at Runtime): Embedding-Based Semantic Router (No LLM Router Call)
Change:
- Maintain a small set of labeled example utterances per intent (agenda/weather/memory/none).
- Embed those once (or periodically).
- Embed user message at runtime and do nearest-neighbor + threshold.

Pros:
- Extremely fast and cheap at runtime.
- Robust to paraphrases; avoids growing rule lists.

Cons:
- Needs an embeddings provider and storage/indexing.
- Requires some initial curation of examples and threshold tuning.

### Option C (Best of Both): Hybrid Two-Stage Router (Embeddings First, LLM Router on Borderline)
Change:
- Stage 1: embedding router handles high-confidence matches.
- Stage 2: if similarity is borderline/ambiguous, fall back to the LLM router.

Pros:
- Reduces LLM router calls for easy cases.
- Keeps robustness for ambiguous cases.

Cons:
- More complexity than A or B.

## What We Should Avoid
- Growing lists of special-case regex/keyword checks for routing.
- Phrase-specific "if it contains X then route to Y" gates.

Those patterns scale poorly and are exactly what semantic routing is designed to replace.

## Suggested Direction for RemcoChat
If we want maximum flexibility quickly: Option A.
If we want to optimize latency/cost and scale tool count later: Option C (or B if we want to avoid an LLM router entirely).

## References (for Later)
- Aurelio AI Semantic Router docs (routing by semantic similarity + thresholds):
  - https://docs.aurelio.ai/semantic-router/user-guide/concepts/overview
  - https://docs.aurelio.ai/semantic-router/user-guide/components/routers
  - https://docs.aurelio.ai/semantic-router/user-guide/concepts/architecture
- vLLM Semantic Router docs/blog (thresholds, semantic tool selection):
  - https://vllm-semantic-router.com/docs/cookbook/classifier-tuning
  - https://vllm-semantic-router.com/docs/installation/configuration
  - https://vllm-semantic-router.com/docs/tutorials/intelligent-route/embedding-routing
  - https://vllm-semantic-router.com/blog/semantic-tool-selection
- Intent recognition + routing notes (router agent / semantic routing discussion):
  - https://gist.github.com/mkbctrl/a35764e99fe0c8e8c00b2358f55cd7fa

