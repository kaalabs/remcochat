# RemcoChat Skills System — Implementation Spec

This document specifies the RemcoChat “skills system”: runtime discovery and activation of **Agent Skills standard** skills (folders containing `SKILL.md` plus optional `scripts/`, `references/`, `assets/`).

Source of truth for the standard:

- https://agentskills.io/specification
- https://agentskills.io/integrate-skills

This spec is written to be directly implementable in RemcoChat and to be validated using the canonical conformance skill at `.skills/skills-system-validation/`.

---

## 1) Scope

### 1.1 Goals (v1)

- Discover skills at server start (restart required to pick up changes).
- Validate and index skill metadata (`name`, `description`, and supported optional fields).
- Inject skill metadata into the **system prompt** as a JSON `available_skills` block.
- Support:
  - **implicit** invocation (model chooses a skill when relevant)
  - **explicit** invocation via `/skill-name ...` at start of user message
- Implement progressive disclosure:
  - Level 1: metadata always available
  - Level 2: `SKILL.md` body loaded only when activated
  - Level 3: additional resources loaded only on demand
- Provide skills tools:
  - `skills.activate({ name })`
  - `skills.readResource({ name, path })`
- Persist **activated skill names** per chat (not full bodies).
- Render skill tool calls as user-visible tool cards.

### 1.2 Non-goals (v1)

- Marketplace, downloads, skill editing UI.
- Hot reload / file watching.
- Executing scripts on the RemcoChat host.

---

## 2) Definitions

- **Skill**: a directory containing `SKILL.md` (required) and optional `scripts/`, `references/`, `assets/`.
- **Skill name**: `name` in `SKILL.md` frontmatter; must equal the skill directory name.
- **Discovery**: scanning configured directories for skill folders and parsing frontmatter.
- **Activation**: loading the full `SKILL.md` contents for a selected skill.
- **Resource**: any file under a skill directory (commonly under `references/`, `assets/`, `scripts/`).
- **Conformance skill**: `.skills/skills-system-validation/` fixture used to validate implementation.

---

## 3) Configuration

### 3.1 `config.toml` schema

Add an optional `app.skills` section:

```toml
[app.skills]
enabled = false

# Directories are scanned in order. When skill names collide, earlier directories win.
# Paths may be absolute, repo-relative, or ~-home relative.
directories = [
  "./.skills",
  "./.agents/skills",
  "~/.agents/skills",
  "~/.remcochat/skills",
]

# Soft limits: exceed → warn/log + truncate where applicable.
max_skills = 200
max_skill_md_bytes = 200000
max_resource_bytes = 2000000
```

### 3.2 Precedence and collisions

- Directories are scanned in declared order.
- If two skills have the same `name`, the first discovered (highest-precedence directory) **wins**.
- Collisions should be recorded for observability (server logs and admin listing).

### 3.3 Enablement defaults

- Skills are **off by default** (`enabled=false`).
- If disabled, no discovery occurs, no metadata is injected, and no skills tools are exposed.

---

## 4) Discovery

### 4.1 Scan algorithm

At server boot (or first request, but with boot-time semantics):

1. Resolve configured directories:
   - Expand `~` to user home.
   - Resolve relative paths from repo base dir (RemcoChat project root).
2. For each directory:
   - If directory does not exist: skip (warn once).
   - Enumerate immediate children; each child directory is a potential `skillDir`.
   - A `skillDir` is a valid candidate iff it contains a file named exactly `SKILL.md`.

### 4.2 Frontmatter parsing

`SKILL.md` MUST start with YAML frontmatter delimited by `---` markers, followed by Markdown body.

The implementation must parse frontmatter without loading the entire file into prompt context. Discovery only needs frontmatter.

Supported frontmatter fields (per Agent Skills spec):

- Required:
  - `name` (string)
  - `description` (string)
- Optional:
  - `license` (string)
  - `compatibility` (string)
  - `metadata` (mapping)
  - `allowed-tools` (string)

Unknown keys:

- v1: ignore unknown keys but record a warning (do not fail discovery).

### 4.3 Validation rules

Validate per Agent Skills specification:

- `name` constraints:
  - 1–64 chars
  - `[a-z0-9-]` only
  - no leading/trailing `-`
  - no consecutive `--`
  - must match the skill directory name exactly
- `description` constraints:
  - 1–1024 chars (non-empty)

Validation outcome policy:

- Invalid skill:
  - exclude from registry
  - record a validation error in logs/admin listing
- Valid skill:
  - include in registry

### 4.4 In-memory registry

Maintain an in-memory registry:

```ts
type SkillRecord = {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;
  skillDir: string;   // absolute path
  skillMdPath: string; // absolute path
  sourceDir: string;  // which scan root produced it
};
```

Caching:

- Registry is immutable for process lifetime in v1 (restart to refresh).

---

## 5) Prompt integration

### 5.1 Metadata block format

When skills are enabled, inject a JSON block into the system prompt:

```json
{
  "available_skills": [
    { "name": "skills-system-validation", "description": "..." }
  ]
}
```

Rules:

- Include only `name` and `description` in the prompt (keep it small and stable).
- Do not include filesystem paths (`location` is omitted by decision).

### 5.2 System prompt behavioral rules (skills)

Add a concise instruction block to `src/ai/system-prompt.ts` when skills are enabled:

- Skills are available; use them when relevant.
- **Progressive disclosure**:
  - Do not request skill bodies unless needed.
  - Activate a skill by calling `skills.activate` before using its instructions.
  - Load additional files only via `skills.readResource` when explicitly needed by the instructions.
- If a user message starts with `/skill-name`, treat it as explicit skill invocation.
  - If tools are enabled: call `skills.activate` for that skill before responding.
  - If tools are disabled: the server will inject the skill content (fallback behavior; see 6.3).

---

## 6) Activation

### 6.1 Implicit activation

Implicit activation is model-driven:

- Model sees `available_skills` metadata.
- When relevant, it calls `skills.activate({ name })`.
- The model then follows the activated `SKILL.md` instructions.

### 6.2 Explicit invocation parsing

If the latest user message begins with:

```
/<skill-name>[ whitespace or end-of-line ]
```

Then:

- Extract `<skill-name>` token (up to first whitespace).
- Strip the prefix (`/<skill-name>`) from the user message text before sending to the model.
- Mark this turn as explicitly invoking that skill name.

If `<skill-name>` is not in the registry, treat it as normal text (do not error).

### 6.3 Explicit invocation fallback (tools disabled)

If the selected model cannot call tools (or tools are disabled):

- The server MUST load the target skill’s `SKILL.md` itself and inject it into the system prompt for that single request only.
- This preserves the UX of explicit invocation even without tool calling.

This fallback does not change the default activation strategy (tool-driven), and should be used only when tool calling is unavailable.

---

## 7) Tools

Tools are exposed only when:

- `app.skills.enabled=true`, and
- model/tool calling is enabled for the request (RemcoChat’s existing gating)

### 7.1 Tool: `skills.activate`

Name: `skills.activate`

Input:

- `name` (string): skill name

Behavior:

- Look up `name` in registry; if not found, return a clear error.
- Read `.skills/<name>/SKILL.md` contents.
- Enforce limits:
  - if file exceeds `max_skill_md_bytes`: read + return truncated content with a truncation notice.
- Return:
  - `name`
  - `frontmatter` (parsed object)
  - `body` (Markdown body as string)

Tool result should be suitable for the model to follow the instructions without further parsing ambiguity.

### 7.2 Tool: `skills.readResource`

Name: `skills.readResource`

Input:

- `name` (string): skill name
- `path` (string): relative path from skill root

Path security:

- Reject if `path` is absolute.
- Reject if `path` contains `..` segments after normalization.
- Resolve against the skill root and ensure the resolved path stays within the skill root:
  - reject symlink escape (use `realpath` checks).

Behavior:

- Read file as UTF-8 text.
- If file looks binary (e.g. contains NUL bytes) or cannot be decoded safely: return a “binary not supported” error (v1).
- Enforce `max_resource_bytes` with truncate + notice (soft limit).
- Return:
  - `name`
  - `path`
  - `content` (string)

---

## 8) Persistence

Persist per chat:

- `activated_skill_names`: string array

Rules:

- Store names only (never store full SKILL.md bodies).
- Update list when:
  - server processes explicit invocation, or
  - model calls `skills.activate` successfully
- Activated skills should be included in the system prompt as a small list (names only) so the model remembers what is active without re-reading bodies unnecessarily.

---

## 9) UI

Skill tools must be rendered as user-visible tool cards (decision #12):

- `skills.activate` card:
  - shows skill name + whether it was truncated
  - should not dump full body by default; allow expand/copy
- `skills.readResource` card:
  - shows `path` + whether truncated
  - show content in collapsible section (default collapsed when large)

---

## 10) Security

RemcoChat is LAN-only and unauthenticated; therefore:

- Skills are disabled by default.
- Only read files inside configured skill directories.
- Never execute scripts on host.
- Script execution (optional) is only via existing sandboxed bash tooling and must additionally respect:
  - bash tools enablement gates
  - `allowed-tools` allowlisting (if implemented; see 11.3)

---

## 11) Limits and logging

### 11.1 Soft limits

When soft limits are exceeded, the system:

- truncates returned content
- appends a clear truncation notice
- logs a warning (once per skill/path per process)

### 11.2 Absolute safety caps

Even with soft limits, implementations must enforce hard caps to avoid memory abuse (exact values may be internal constants).

### 11.3 `allowed-tools`

v1 behavior:

- Parse and store `allowed-tools` but do not enforce it yet (log-only).

v2 behavior (planned):

- Enforce that skill-driven script execution is only permitted when the required tool is present in `allowed-tools`.

---

## 12) Validation

### 12.1 Canonical conformance fixture

The repository includes:

- `.skills/skills-system-validation/SKILL.md`
- `.skills/skills-system-validation/references/REFERENCE.md`
- `.skills/skills-system-validation/assets/fixture.json`
- `.skills/skills-system-validation/scripts/echo.sh`

This fixture must be used to validate:

- discovery + frontmatter parsing
- progressive disclosure activation
- resource reads + markers
- path traversal rejection
- optional sandboxed script execution

### 12.2 Required manual flow

Follow the step-by-step procedure in `.skills/skills-system-validation/SKILL.md`.

### 12.3 Required tests (no mocks)

- Unit tests:
  - frontmatter validation rules
  - path normalization + symlink escape prevention
  - truncation notice behavior
- E2E smoke test:
  - exercise explicit invocation with `/skills-system-validation ...`
  - assert tool cards for `skills.activate` and `skills.readResource` (tool-capable model)

---

## 13) Open items (v2+)

- Hot reload vs restart-only.
- Per-skill enable/disable controls.
- Binary resource representation (images/assets) in tool output.
- Enforcing “one level deep” reference guidance vs guidance-only.
