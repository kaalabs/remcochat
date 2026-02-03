# RemcoChat Skills System — Research

Goal: add a **runtime-loadable “skills system”** to RemcoChat so the server can discover, load, and apply new capabilities without redeploys. RemcoChat should follow the **Agent Skills open standard** as the source of truth:

- https://agentskills.io/home
- https://agentskills.io/specification
- https://agentskills.io/integrate-skills
- https://agentskills.io/what-are-skills

This document captures (1) the standard, and (2) a RemcoChat-specific integration design to drive implementation work.

---

## 0) Decisions (current)

These reflect your answers plus the recommended defaults for the remaining “too technical” items.

1. **Skill scope:** Global (server-wide), not per-profile.
2. **Default scan locations (in precedence order):**
   - `<repo-base-dir>/.skills/`
   - `<repo-base-dir>/.agents/skills/` (searched up the tree)
   - `<home-dir>/.agents/skills/`
   - `<home-dir>/.remcochat/skills/`
3. **Reload model:** Restart-only (discover at server boot; no hot reload in v1).
4. **Activation default (best practice; based on Codex CLI + Claude Code):**
   - Provide skill **metadata** to the model for implicit matching.
   - Support **explicit invocation** (recommended in RemcoChat via `/skill-name` at the start of the user message).
   - Implement activation via **tool-driven progressive disclosure** (model calls `skills.activate` when it decides the skill is relevant, or when explicitly invoked).
5. **Prompt injection format:** Provide a JSON `available_skills` block in the system prompt (not XML).
6. **No `location` field** in prompt metadata (tool-based activation; the tool resolves by `name`).
7. **Persistence:** Store activated skill *names* per chat (not full SKILL.md bodies).
8. **Skill tool surface (v1):**
   - `skills.activate({ name })`
   - `skills.readResource({ name, path })`
9. **Resource access policy:** “Same as server policy” interpreted as:
   - tools only read files **inside discovered skill directories**
   - within a skill, allow reading any file under the skill root (including `scripts/`) but never outside
10. **Script execution:** Allowed only via existing sandboxed bash tooling + allowlisting (never on host).
11. **Limits:** Soft limits (warn/log + truncate) rather than hard-fail, but still enforce absolute safety caps.
12. **UI/visibility:** Show user-facing tool cards for skill activation and resource reads.

## 1) Agent Skills standard (source of truth)

### 1.1 What a “skill” is

A skill is a **folder** containing, at minimum, a required `SKILL.md` file. Skills may also bundle scripts, references, and assets.

Canonical structure:

```
my-skill/
├── SKILL.md          # Required: YAML frontmatter + Markdown instructions
├── scripts/          # Optional: executable code
├── references/       # Optional: documentation
└── assets/           # Optional: templates, resources
```

### 1.2 `SKILL.md` format

`SKILL.md` must start with **YAML frontmatter** and then a **Markdown body**.

Required frontmatter:

```yaml
---
name: skill-name
description: A description of what this skill does and when to use it.
---
```

Optional frontmatter fields:

- `license`: license name or reference to a bundled license file.
- `compatibility` (max 500 chars): environment requirements (product, system packages, network access, etc.).
- `metadata`: arbitrary key-value mapping.
- `allowed-tools` (experimental): space-delimited list of pre-approved tools the skill may use.

#### `name` constraints

- 1–64 characters
- lowercase letters, numbers, and hyphens only
- must not start/end with `-`
- must not contain `--` (consecutive hyphens)
- must match the **parent directory name**

#### `description` guidance

- 1–1024 characters
- should describe **what** the skill does and **when** to use it
- should include relevant keywords to help matching

### 1.3 Optional directories

- `scripts/`: executable code (language support is client/agent specific)
- `references/`: extra docs the agent can load on demand (recommended: keep files small and focused)
- `assets/`: templates/images/data

### 1.4 Progressive disclosure

The standard explicitly expects skills to be used with progressive disclosure:

1. **Metadata**: load only `name` + `description` for all skills at startup (small token cost).
2. **Instructions**: load the full `SKILL.md` body only when a skill is activated.
3. **Resources**: load referenced files (scripts/references/assets) only when needed.

Practical guidance:

- keep `SKILL.md` under ~500 lines
- move detailed material into `references/`

### 1.5 File references

When a skill references other files, use **relative paths from the skill root**.

Guidance:

- keep references “one level deep” from `SKILL.md`
- avoid deep reference chains

### 1.6 Integration approaches (standard guidance)

The standard calls out two integration styles:

- **Filesystem-based agents**: models can access a shell environment and can `cat /path/to/skill/SKILL.md`, run scripts, etc.
- **Tool-based agents**: no general filesystem; instead the developer provides tools for discovering, activating, and accessing skill resources.

Common integration steps:

1. Discover skills from configured directories
2. Parse `SKILL.md` frontmatter at startup (metadata)
3. Match tasks to relevant skills
4. Activate skills (load full instructions)
5. Execute scripts / access resources as needed

### 1.7 Reference tooling

The maintainers publish a reference SDK + CLI:

- `skills-ref validate path/to/skill` (validate naming + frontmatter)
- `skills-ref read-properties path/to/skill` (extract metadata, JSON)
- `skills-ref to-prompt ...` (generate a recommended `<available_skills>` XML block)

Note: `skills-ref` is explicitly “for demonstration only” and not intended for production use.

---

## 2) RemcoChat context (where skills plug in)

RemcoChat is a **tool-based agent server**:

- It assembles a system prompt in `src/ai/system-prompt.ts`.
- It exposes tool calling via Vercel AI SDK tool definitions (see `src/ai/tools.ts` and feature-gated toolsets like `src/ai/web-tools.ts` and `src/ai/bash-tools.ts`).
- It already has a “cheap LLM gate” pattern (`src/server/intent-router.ts`) used to route certain intents before the main model responds.

Implication: to follow the Agent Skills standard, RemcoChat should implement:

- skill **discovery** (filesystem scan)
- skill **metadata injection** into the system prompt
- skill **activation** via progressive disclosure
- optional access to **references/assets/scripts** through explicit tools with strict sandboxing

---

## 3) Proposed RemcoChat skills architecture

### 3.1 Goals (v1)

- Adopt Agent Skills directory + `SKILL.md` format unchanged.
- Discover skills from **configurable directories** and load their metadata.
- Add skill metadata to the system prompt in a predictable block (so the model can decide when to activate a skill).
- Implement progressive disclosure:
  - metadata always available
  - instructions loaded only for activated skills
  - resources loaded only when required
- Keep the system safe under RemcoChat constraints (LAN + no auth).

### 3.2 Non-goals (v1)

- A full marketplace / registry / downloads.
- Editing skills via the web UI.
- Running skill scripts on the RemcoChat host machine.

### 3.3 Configuration proposal (server-side)

Add a config section aligned with existing patterns in `src/server/config.ts`:

```toml
[app.skills]
enabled = false

# Absolute or repo-relative directories to scan (discovered in order; name collisions: earlier wins).
directories = [
  "./.skills",
  "./.agents/skills",
  "~/.agents/skills",
  "~/.remcochat/skills",
]

# Optional guardrails
max_skills = 200
max_skill_md_bytes = 200000   # size limit for SKILL.md reads
max_resource_bytes = 2000000  # size limit per resource read

# Activation strategy (v1 default: tool-driven progressive disclosure)
activation = "tool"           # "tool" | "router" | "hybrid"
```

Notes:

- `directories` should support repo-relative paths and absolute paths.
- Keep `enabled=false` by default.
- Reuse “local-only” style gating patterns used by bash tools/admin features when introducing any write/exec features.

### 3.4 Discovery + caching

Implement a server module, conceptually:

- `src/server/skills/registry.ts`
  - `discoverSkills(dirs): SkillIndex`
  - `SkillIndex` contains validated metadata + absolute `skillDir` path + `skillMdPath`
  - strict validation per spec (`name` constraints + parent directory name match)

Caching strategy (v1):

- Discover on server start, then cache in memory.
- Provide a manual reload endpoint (admin-only / localhost-only) if needed.
- Later: optionally add `fs.watch` or periodic re-scan if runtime edits are common.

### 3.5 Prompt injection (metadata)

Provide skills metadata to the model as a JSON block, e.g.:

```json
{
  "available_skills": [
    {
      "name": "pdf-processing",
      "description": "Extracts text and tables from PDFs..."
    }
  ]
}
```

Key points:

- Always include `name` + `description`.
- For RemcoChat (tool-based), omit `location` and require activation via tools (see 3.6).

### 3.6 Activation (loading instructions)

RemcoChat should support at least one of these activation strategies:

#### Strategy A — Tool-driven (recommended default for tool-capable models)

Expose a tool set:

- `skills.activate({ name }) -> { skillName, skillMd }`
  - returns the full `SKILL.md` contents (or just body + selected metadata)
  - allows the model to “pull” instructions only when needed

Optional companion tools (later / as needed):

- `skills.readResource({ name, path })` restricted to `references/` and `assets/`
- `skills.listResources({ name, dir })` for discoverability

Advantages:

- clean progressive disclosure
- works even when the model can’t read the server filesystem

Tradeoffs:

- requires tool calling support
- tool output may need to be hidden from user-facing UI (like internal web tool results)

#### Strategy B — Router-driven (works for non-tool models)

Use a cheap router model (similar to `src/server/intent-router.ts`) to pick relevant skills and inject their `SKILL.md` bodies into the system prompt for the main model.

Advantages:

- works with any model (no tool calling required)

Tradeoffs:

- adds an extra LLM call
- must be careful with token bloat (cap number of activated skills and/or truncate)

#### Strategy C — Hybrid (best long-term)

- Use a lightweight heuristic (keywords from descriptions) to shortlist skills.
- Let the model activate one via tool, or ask the router model only when uncertain.

### 3.7 Resource access rules (references/assets)

To follow the spec’s “resources on demand” principle in a tool-based agent:

- implement **strict path allowlists**:
  - only paths within a discovered skill directory
  - allow reading any file under the skill root (including `scripts/`) but never outside
  - disallow `..` traversal, symlinks escaping the skill root, and absolute paths in `path`
- enforce size limits per config
- treat all loaded resource text as untrusted input (same policy as attachments/web)

### 3.8 Scripts and tool allowlisting

The spec allows `scripts/`, but **RemcoChat has no auth** and already treats command execution as high-risk.

Proposed RemcoChat policy:

- v1: support scripts *as documentation only* (the model may read them as text, but execution is not automatic).
- v2: allow script execution only when:
  - bash tools are enabled (already strongly gated)
  - the skill is allowlisted and/or its `allowed-tools` includes the required tool(s)
  - execution happens only in an isolated sandbox (never on the host)

### 3.9 UI/UX (observability, not a feature UI)

Minimal additions:

- Admin-only endpoint to list discovered skills (name/description/path).
- Optional: show an “Activated skills” debug section in a dev/admin panel.

Avoid adding “skills UI” (marketplace/install/edit) until the core system is stable.

---

## 4) Security checklist (RemcoChat-specific)

Because RemcoChat is LAN-only and unauthenticated:

- Default `app.skills.enabled = false`.
- Any endpoint that reloads skills or reveals filesystem locations should be:
  - localhost-only, or
  - gated behind the same admin token scheme used by bash tools when `access="lan"`.
- Never allow arbitrary file reads; always scope reads to configured skill directories.
- Never run scripts on the host.
- Keep logs of skill activation + script execution (if/when added) for auditing.

---

## 5) Implementation milestones (suggested)

### Milestone 1 — Read-only skill registry

- Config schema + parsing
- Discovery + validation
- In-memory registry + `GET /api/skills` (admin/localhost only)

### Milestone 2 — Prompt integration

- Add JSON `available_skills` injection to `src/ai/system-prompt.ts`
- Add minimal prompting rules (“skills are available; activate when relevant”)

### Milestone 3 — Activation flow

- Implement `skills.activate` tool (tool-based progressive disclosure)
- Persist activated skill names per chat (not full bodies) and render skill tool calls as user-visible tool cards

### Milestone 4 — Resource access + guardrails

- `skills.readResource` tool with path + size constraints
- Add “untrusted input” prompt policy (like attachments/web)

### Milestone 5 — (Optional) Scripts in sandbox

- Integrate with `src/ai/bash-tools.ts` sandbox execution and `allowed-tools` allowlisting

---

## 6) Validation strategy (implementation)

RemcoChat will validate its skills system implementation using a **single canonical conformance skill** checked into the repo. This skill is intentionally designed to exercise every core ability we need to support:

- discovery (metadata-only)
- activation (load full `SKILL.md` on demand)
- progressive disclosure resources (`references/`, `assets/`, `scripts/`)
- negative tests for path safety (no traversal/escape)
- optional script execution via the existing **sandboxed** bash tooling (never on host)

### 6.1 Canonical conformance skill

Skill location (repo-scoped; highest precedence in our chosen scan order):

- `.skills/skills-system-validation/SKILL.md`

Bundled fixtures:

- `.skills/skills-system-validation/references/REFERENCE.md`
- `.skills/skills-system-validation/assets/fixture.json`
- `.skills/skills-system-validation/scripts/echo.sh`

### 6.2 Manual validation flow (developer checklist)

Use this exact procedure during implementation and regression checks:

1. **Discovery**
   - Start RemcoChat with skills enabled and confirm the skills index contains:
     - `name = skills-system-validation`
     - `description` (string, non-empty)
   - Confirm this happens without loading the full `SKILL.md` body for every skill.
2. **Activation**
   - Activate the skill (via explicit invocation `/skills-system-validation ...` or by implicit matching).
   - Confirm the server returns the full `SKILL.md` content only on activation.
3. **Resource loading**
   - Read these resources via the skills system (relative paths from the skill root):
     - `references/REFERENCE.md` (must contain `REMCOCHAT_SKILLS_CONFORMANCE_REFERENCE_v1`)
     - `assets/fixture.json` (must include `"fixture_id": "skills-system-validation"`)
     - `scripts/echo.sh` (must include `REMCOCHAT_SKILLS_SCRIPT_OK`)
4. **Path safety (negative tests)**
   - Attempt to read:
     - `../SKILL.md`
     - `/etc/passwd`
     - `references/../../../../etc/passwd`
   - Confirm the skills system blocks these with a safe error.
5. **Optional: sandboxed script execution**
   - Only when bash tools are enabled and sandboxed:
     - execute `scripts/echo.sh`
     - verify stdout is exactly `REMCOCHAT_SKILLS_SCRIPT_OK`

### 6.3 Automated validation (tests)

Implement tests using the conformance skill as the fixture; no mocks.

- **Unit tests**
  - Parse/validate the conformance skill frontmatter (name/description constraints, directory name match).
  - Validate path normalization + escape prevention (including symlink escape if supported).
  - Validate size limits/truncation behavior (soft limits).
- **E2E smoke test**
  - Start the app with `app.skills.enabled=true` and point `app.skills.directories` at `.skills`.
  - In the chat UI, send: `/skills-system-validation validate that skills.activate and skills.readResource work`
  - Assert tool cards are rendered for:
    - `skills.activate`
    - `skills.readResource` (at least for `references/REFERENCE.md`)
  - If `REMCOCHAT_ENABLE_BASH_TOOL=1` and bash tools are enabled/configured, run the optional script step.

Notes:

- Treat tool outputs as internal/diagnostic but still user-visible per decision #12.
- Keep assertions deterministic by checking for marker strings rather than full-text matching.

---

## 7) Open questions

1. v2+: Do we add manual reload or file watching, or keep restart-only?
2. Do we want per-skill enable/disable controls (like Codex/Claude), and where should that live (config vs DB vs UI)?
3. How do we resolve name collisions across scan directories (current: earlier directories override later) and do we want to surface overrides in admin/debug views?
4. Should `skills.readResource` allow reading arbitrary file types (binary/images) and how should those be represented in tool output?
5. Should we enforce the Agent Skills “one level deep” guidance as a hard rule, or keep it as authoring guidance only?
