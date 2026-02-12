---
name: skills-system-validation
description: |
  Conformance skill fixture used to validate RemcoChat's Skills system:
  discovery, activation, resource reads, and optional sandboxed script execution.
license: MIT
allowed-tools: Read, Bash
metadata:
  author: remcochat
  version: "0.1.0"
---

# Skills System Validation

This skill is a conformance fixture for RemcoChat’s skills runtime and tools.

## What to validate

1) Skill discovery: this skill appears as `skills-system-validation`.
2) Activation: `/skills-system-validation ...` triggers a `skillsActivate` call.
3) Progressive disclosure: the assistant reads only needed resources.
4) Resource reads: `skillsReadResource` can read:
   - `references/REFERENCE.md` (must contain `REMCOCHAT_SKILLS_CONFORMANCE_REFERENCE_v1`)
   - `assets/fixture.json` (must contain `"fixture_id": "skills-system-validation"`)
5) Optional script execution: `scripts/echo.sh` prints `REMCOCHAT_SKILLS_SCRIPT_OK`.

## Quick manual flow

- Activate: `/skills-system-validation validate that skills.activate and skills.readResource work`
- Read a reference: `skillsReadResource(name="skills-system-validation", path="references/REFERENCE.md")`
- Read the fixture: `skillsReadResource(name="skills-system-validation", path="assets/fixture.json")`
- (If Bash is enabled) run: `bash ./.skills/skills-system-validation/scripts/echo.sh`

