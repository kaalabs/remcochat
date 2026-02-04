# RemcoChat Skills System — Tasks (by Phase)

This document enumerates the **exact task sequence** to implement `skills-spec.md`, following `skill-plan.md` phase-by-phase.

Rule: **Do not start Phase N+1** until the **final validation task** of Phase N has completed successfully.

Conformance fixture: `.skills/skills-system-validation/`.

---

## Phase 0 — Baseline wiring (no behavior change)

0.1 Create the folder structure for skills server modules at `src/server/skills/` and add minimal exports/types for:
   - `SkillRecord`
   - `SkillRegistry` (interface shape only; no implementation yet)
   - common error types (invalid skill, collision, access denied)
0.2 Add a minimal index file that is unused by runtime (imported nowhere).
0.3 Validate DoD (Phase 0): run `npm run build` and confirm no runtime behavior changes with `app.skills` absent/disabled.

Gate: Phase 1 may start only after 0.3 passes.

---

## Phase 1 — Config schema + parsing

1.1 Extend `src/server/config.ts` schema to include `app.skills`:
   - `enabled: boolean`
   - `directories: string[]`
   - `max_skills: number`
   - `max_skill_md_bytes: number`
   - `max_resource_bytes: number`
1.2 Implement normalization:
   - `~` expansion
   - repo-relative resolution from repo base dir
   - defaults per `skills-spec.md`
1.3 Add unit tests:
   - `tests/config-skills.test.ts` (new)
   - include: defaults, path expansion, invalid values fail-fast
1.4 Validate DoD (Phase 1): run `npm run test:unit` and confirm `getConfig()` returns `skills: null | { ... }` as specified.

Gate: Phase 2 may start only after 1.4 passes.

---

## Phase 2 — Discovery + in-memory registry

2.1 Implement discovery in `src/server/skills/registry.ts`:
   - scan configured directories in order
   - find child directories that contain `SKILL.md`
   - parse YAML frontmatter only (metadata-only discovery)
   - validate `name`/`description` rules and directory-name match
   - detect collisions (first wins; record losers)
   - apply `max_skills` soft limit (stop adding; record warning)
2.2 Add a skills registry singleton lifecycle (boot-time semantics, restart-only):
   - a function like `getSkillsRegistry()` that returns the cached registry (or null if disabled)
2.3 Add admin-only endpoint `GET /api/skills`:
   - return: valid skills, invalid skills, collisions, scan roots, warnings
   - enforce localhost-only or admin-token gating consistent with existing server policy
2.4 Add unit tests:
   - `tests/skills-registry.test.ts` (new)
   - include: valid discovery of `.skills/skills-system-validation`, invalid skill exclusion, collision precedence
2.5 Validate DoD (Phase 2):
   - run `npm run test:unit`
   - start app with `app.skills.enabled=true` and confirm `GET /api/skills` lists `skills-system-validation` and surfaces invalid/collisions correctly.

Gate: Phase 3 may start only after 2.5 passes.

---

## Phase 3 — Prompt injection (`available_skills`)

3.1 Update `src/ai/system-prompt.ts`:
   - when skills enabled, inject a JSON `available_skills` block containing only `name` + `description`
   - add concise skills behavioral rules (activate via tool, progressive disclosure, `/skill-name` convention)
3.2 Add/extend unit tests:
   - update `tests/system-prompt.test.ts` to assert:
     - skills disabled → no `available_skills` text
     - skills enabled → includes `available_skills` JSON block and includes `skills-system-validation`
     - does not include filesystem paths
3.3 Validate DoD (Phase 3): run `npm run test:unit`.

Gate: Phase 4 may start only after 3.3 passes.

---

## Phase 4 — Explicit invocation parsing + tools-disabled fallback

4.1 Implement explicit invocation parsing in chat route assembly:
   - detect `/<skill-name>` prefix in latest user message
   - strip the prefix before sending to model
   - ignore unknown skill names (treat message as normal)
4.2 Implement tools-disabled fallback:
   - when explicit invocation is present but tools are disabled for the request, server loads the skill’s `SKILL.md` and injects it for that request only
4.3 Add unit tests:
   - `tests/skills-explicit-invocation.test.ts` (new)
   - include: whitespace vs end-of-line, unknown skill, multiline message behavior
4.4 Validate DoD (Phase 4):
   - run `npm run test:unit`
   - manual smoke: use a tools-disabled model/config and confirm `/skills-system-validation ...` still applies the skill instructions.

Gate: Phase 5 may start only after 4.4 passes.

---

## Phase 5 — Skills tools: `skills.activate` + `skills.readResource`

5.1 Implement tools (recommended: `src/ai/skills-tools.ts` + minimal integration into existing `src/ai/tools.ts` / `/api/chat`):
   - `skills.activate({ name }) -> { name, frontmatter, body }`
   - `skills.readResource({ name, path }) -> { name, path, content }`
5.2 Implement soft truncation + notices using config limits:
   - `max_skill_md_bytes` for activation
   - `max_resource_bytes` for resource reads
5.3 Implement path security for `skills.readResource`:
   - reject absolute paths
   - reject traversal after normalization
   - prevent symlink escape (realpath guard)
   - enforce “must remain under skill root”
5.4 Wire tools into `/api/chat` only when `app.skills.enabled=true` and tools are enabled for the model.
5.5 Add unit tests:
   - `tests/skills-tools.test.ts` (new)
   - include: truncation notice, traversal rejection, absolute path rejection, symlink escape prevention
5.6 Validate DoD (Phase 5):
   - run `npm run test:unit`
   - manual conformance: follow `.skills/skills-system-validation/SKILL.md` Steps 2–4 using the tools and confirm expected markers and blocked paths.

Gate: Phase 6 may start only after 5.6 passes.

---

## Phase 6 — Persistence of activated skill names

6.1 Add DB/schema support for `activated_skill_names` on chats (names only).
6.2 Update server logic to record activated names when:
   - explicit invocation is used
   - `skills.activate` succeeds
6.3 Update prompt/context assembly to include activated skill names as lightweight context (names only).
6.4 Add unit tests:
   - `tests/skills-persistence.test.ts` (new)
   - include: persisted names survive reload, no bodies persisted, migration behavior (if schema changes)
6.5 Validate DoD (Phase 6):
   - run `npm run test:unit`
   - manual smoke: activate a skill, reload page, confirm activated names persist and behavior remains correct.

Gate: Phase 7 may start only after 6.5 passes.

---

## Phase 7 — UI tool cards for skills tools

7.1 Add UI rendering for skills tools in the chat transcript:
   - `skills.activate` card
   - `skills.readResource` card
   - collapsible content + copy actions + truncation notice visibility
7.2 Add Playwright E2E test:
   - new spec: `e2e/skills-tools.spec.ts`
   - scenario: send `/skills-system-validation validate that skills.activate and skills.readResource work`
   - assert: tool cards appear (activate + at least one readResource for `references/REFERENCE.md`)
7.3 Validate DoD (Phase 7):
   - If explicitly requested: run `npm run test:e2e -- -g \"skills\"`
   - If explicitly requested: run `npm run test:agent-browser`

Gate: Phase 8 may start only after 7.3 passes.

---

## Phase 8 — Optional: sandboxed script execution integration

Only start Phase 8 if you are implementing optional script execution support in v1; otherwise skip to Phase 9.

8.1 Add integration that allows executing skill scripts only when:
   - bash tools are enabled and sandboxed (existing gates)
   - the skill’s `allowed-tools` permits Bash (enforce or enforce-after-log per implementation choice)
8.2 Add deterministic E2E coverage behind an env flag:
   - execute `.skills/skills-system-validation/scripts/echo.sh`
   - assert stdout marker `REMCOCHAT_SKILLS_SCRIPT_OK`
8.3 Validate DoD (Phase 8):
   - If explicitly requested: run `npm run test:e2e -- -g \"skills\"` with required env flags for sandbox bash tooling
   - run `.skills/skills-system-validation/SKILL.md` Step 5 and confirm output marker.

Gate: Phase 9 may start only after 8.3 passes (if Phase 8 is executed).

---

## Phase 9 — Hardening + observability

9.1 Improve `/api/skills` output:
   - include scan roots, collisions, invalid skills, warnings
   - redact sensitive filesystem details for non-admin callers
9.2 Improve tool errors:
   - safe error messages (no path leaks)
   - consistent error shapes
9.3 Add structured logs:
   - discovery summary at boot
   - activations
   - blocked reads (policy rejections)
9.4 Validate DoD (Phase 9):
   - run `npm run test:unit`
   - If explicitly requested: run `npm run test:e2e -- -g \"skills\"`
   - manual check: `/api/skills` + logs are sufficient to diagnose missing/invalid skills without code changes.

---

## Completion criterion

The skills system implementation is considered delivered when Phases 0–7 are complete (and Phase 8 only if chosen), and Phase 9 hardening is complete, with every phase’s final validation task passing in order.
