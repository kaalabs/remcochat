# RemcoChat Skills System — Implementation Plan (Sequenced Phases)

This plan implements `skills-spec.md` in incremental, testable phases. Each phase has an explicit **Definition of Done** (DoD). Phases should be completed in order.

Conformance fixture (used throughout): `.skills/skills-system-validation/`.

---

## Phase 0 — Baseline wiring (no behavior change)

**Scope**
- Add a new server module namespace `src/server/skills/*` (no runtime usage yet).
- Add placeholders/types for the Skills Registry, SkillRecord, and tool outputs.
- Add doc links and code pointers (minimal, no extra automation).

**Definition of Done**
- Code compiles (`npm run build`) with new modules present but unused.
- No changes to runtime behavior when `app.skills.enabled` is unset/false.

---

## Phase 1 — Config schema + parsing

**Scope**
- Extend `src/server/config.ts` with `app.skills`:
  - `enabled`
  - `directories`
  - `max_skills`
  - `max_skill_md_bytes`
  - `max_resource_bytes`
- Resolve directory paths:
  - `~` expansion
  - repo-relative paths resolved from repo base dir

**Definition of Done**
- `getConfig()` returns `skills: null | { ... }` with correct defaults.
- Invalid config fails fast with clear errors.
- Unit tests cover config parsing (no mocks).

---

## Phase 2 — Discovery + in-memory registry

**Scope**
- Implement discovery at server boot (or first access with boot semantics) in `src/server/skills/registry.ts`:
  - scan directories in precedence order
  - detect skill directories containing `SKILL.md`
  - parse YAML frontmatter only (metadata-only discovery)
  - validate per Agent Skills spec (`name`, `description`, directory name match, hyphen rules)
  - handle collisions (first wins, later recorded)
  - apply `max_skills` (soft limit: warn/log + stop adding more)
- Expose an admin-only listing endpoint:
  - `GET /api/skills` (localhost-only or admin-token gated consistent with existing patterns)
  - returns: valid skills + invalid skills + collisions + scan roots

**Definition of Done**
- With `app.skills.enabled=true` and `.skills/` present:
  - registry includes `skills-system-validation` with correct `name` + `description`
  - invalid skills are excluded and surfaced as errors in `/api/skills`
  - collisions are visible in `/api/skills`
- Unit tests:
  - validate `name`/`description` rules
  - validate directory-name match rule
  - validate collision precedence

---

## Phase 3 — Prompt injection (`available_skills`)

**Scope**
- Update `src/ai/system-prompt.ts` to inject a JSON `available_skills` metadata block when skills are enabled.
- Add minimal system rules for skills:
  - progressive disclosure expectation
  - tool usage (`skills.activate`, `skills.readResource`)
  - explicit invocation rule (`/skill-name ...`)
- Keep the prompt injection size stable:
  - only include `name` + `description` per skill

**Definition of Done**
- When skills enabled, the system prompt contains a JSON `available_skills` block with at least `skills-system-validation`.
- When disabled, the system prompt does not mention skills and does not include `available_skills`.
- Unit tests verify prompt injection toggling and that it includes only the intended fields.

---

## Phase 4 — Explicit invocation parsing + tools-disabled fallback

**Scope**
- Implement parsing for explicit invocation:
  - detect `/<skill-name>` at start of latest user message
  - strip prefix before sending to model
  - ignore unknown skill names (treat as normal text)
- Implement tools-disabled fallback:
  - if tools cannot be called, server injects the selected skill `SKILL.md` into the system prompt for that request only

**Definition of Done**
- Explicit invocation works end-to-end (server side) and does not break normal chat input.
- For non-tool models / tools disabled:
  - `/skills-system-validation ...` results in the server loading that skill’s `SKILL.md` and including it for the request.
- Unit tests cover parsing edge cases (missing whitespace, unknown skill, multi-line).

---

## Phase 5 — Skills tools: `skills.activate` + `skills.readResource`

**Scope**
- Add tool definitions (likely in `src/ai/tools.ts` or a dedicated `src/ai/skills-tools.ts`):
  - `skills.activate({ name }) -> { name, frontmatter, body }`
  - `skills.readResource({ name, path }) -> { name, path, content }`
- Enforce size limits (soft truncation + notices) using `max_skill_md_bytes` and `max_resource_bytes`.
- Enforce path safety for `readResource`:
  - disallow absolute paths
  - disallow `..` traversal after normalization
  - prevent symlink escape via realpath checks
  - ensure resolved path is within skill root
- Wire tools into `/api/chat` only when `app.skills.enabled=true`.

**Definition of Done**
- In a tool-capable model chat:
  - model can call `skills.activate` for `skills-system-validation` and receives the full body (or truncated with notice)
  - model can call `skills.readResource` for:
    - `references/REFERENCE.md`
    - `assets/fixture.json`
    - `scripts/echo.sh`
  - path traversal attempts are blocked as specified in `.skills/skills-system-validation/SKILL.md`
- Unit tests cover:
  - truncation notice logic
  - traversal and absolute-path rejection
  - symlink escape prevention (create a temp fixture directory; no mocks)

---

## Phase 6 — Persistence of activated skill names

**Scope**
- Extend chat persistence to store `activated_skill_names` (names only).
- Update server request assembly so activated skill names are available to the model as lightweight context (names only).
- Update logic so activated names are recorded when:
  - explicit invocation is used, or
  - `skills.activate` succeeds

**Definition of Done**
- Activated skill names persist across page reloads / future messages in the same chat.
- No `SKILL.md` bodies are stored in DB.
- Unit tests validate persistence and migration behavior (if schema changes are required).

---

## Phase 7 — UI tool cards for skills tools

**Scope**
- Add tool rendering in the chat UI for:
  - `skills.activate`
  - `skills.readResource`
- Ensure:
  - name/path visible
  - content collapsible
  - truncation notice visible when present
  - copy buttons for content

**Definition of Done**
- Manual run: invoking `/skills-system-validation ...` yields visible tool cards when the model activates/reads resources.
- E2E smoke test (Playwright):
  - sends `/skills-system-validation validate that skills.activate and skills.readResource work`
  - asserts that at least one skills tool card is shown (activate + readResource for `references/REFERENCE.md`)

---

## Phase 8 — Optional: sandboxed script execution integration

**Scope**
- Reuse existing bash tools system (`src/ai/bash-tools.ts`) and add an allowlisted path for skill scripts:
  - execution only if bash tools enabled + sandboxed
  - execution only if skill’s `allowed-tools` includes `Bash` (enforced in v2 of allow-tools; v1 can start with log-only then enforce)
- Add an E2E flag to run the script step deterministically.

**Definition of Done**
- With bash tooling enabled and sandboxed:
  - `scripts/echo.sh` runs and outputs `REMCOCHAT_SKILLS_SCRIPT_OK`
- Without bash tooling enabled:
  - scripts are never executed
  - the skill system remains fully functional for read-only operations

---

## Phase 9 — Hardening + observability

**Scope**
- Add `/api/skills` admin view enhancements (collisions, invalid skills, scan roots).
- Improve error messages returned by skills tools (safe, non-leaky, actionable).
- Add structured logs for:
  - discovery summary
  - activations
  - blocked reads (policy rejections)

**Definition of Done**
- Debugging skill issues requires no code changes: `/api/skills` + logs clearly explain why a skill wasn’t available/valid.
- No sensitive filesystem info is leaked to non-admin clients.

