# REMCOCHAT_SKILLS_CONFORMANCE_REFERENCE_v1

This file is a **stable reference payload** used by the `skills-system-validation` skill to test:

- Reading a `references/` file via a skills resource tool
- Returning deterministic content
- Keeping file references one level deep from `SKILL.md`

## Expected reads

An Agent Skills-compatible client should be able to read this file on demand when the skill instructs it to.

## Expected marker strings

If you can read this file, you should see:

- `REMCOCHAT_SKILLS_CONFORMANCE_REFERENCE_v1` (top line)

## Notes for implementers

- This content is intentionally simple and “boring”.
- Do not add dynamic values (timestamps, hostnames) that would make regression checks flaky.

