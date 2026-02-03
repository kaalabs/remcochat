---
name: skills-system-validation
description: |
  Conformance fixture for RemcoChat's skills system (discovery + activation + resource reads).
license: MIT
compatibility: |
  Intended for local development and testing. Works without network access.
allowed-tools: Read Bash
metadata:
  author: remcochat
  version: "0.1.0"
---

# Skills System Validation

This is a small fixture skill used by RemcoChat tests and docs to validate that:

- Skill discovery finds `SKILL.md` files and parses frontmatter correctly.
- The `skills.activate` tool can load this `SKILL.md`.
- The `skills.readResource` tool can read files under `references/` and `assets/`.

## Fixture files

- `references/REFERENCE.md`
- `assets/fixture.json`
- `scripts/echo.sh` (prints `REMCOCHAT_SKILLS_SCRIPT_OK`)

