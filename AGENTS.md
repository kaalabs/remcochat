# AGENTS.md

This repository is operated by a single developer with a deliberate preference for the lightest possible Git workflow and minimal automation. The agent must adhere to the operational procedures below without introducing additional branching models, CI/CD complexity, or “helpful” automations unless explicitly instructed.

## Project Plan

The current implementation plan and product scope for RemcoChat lives in `PLAN.md`. Keep `PLAN.md` up-to-date as decisions change during development.

Progress / audit trail lives in `PROGRESS.toml`. Treat it as append-only and historical: after completing a canonical task from `PLAN.md`, append a record describing what was completed, the challenges/decisions, and what tests were run.

## 1. Objectives and constraints

1. Maintain strict separation of environments:
   - Dev: 100% local only

2. Preserve full manual control of promotions:
   - The developer runs tests manually

3. Keep Git and automation lightweight:
   - No Gitflow (no `develop`, no long-lived release branches by default).
   - No required CI gates unless explicitly requested later.
   - No additional deployment scripts or release automation without explicit instruction.

## 2. Branching strategy

### 2.1 Long-lived branch
- `main`: the Production branch and source of truth.

### 2.2 Short-lived work branches
Use short-lived branches for any non-trivial change:
- Naming: `work/<short-topic>`, or `feat/<topic>`, `fix/<topic>`, `chore/<topic>`.
- Branch off from `main`.
- One change-set per branch when possible.

### 2.3 No additional permanent branches
Do not introduce `develop`, `staging`, or `release/*` branches unless explicitly requested by the developer.

## 3. Git ignore and secrets handling

- Secrets must never be committed.
- Ensure secrets files are ignored via `.gitignore` and/or `.git/info/exclude`.
- Common local secrets file patterns:
  - `.env.local`, `.env.*` (except `.env.example`), `secrets/`, `*.key`, `*.pem`, etc.

Agent rule: if you add new configuration examples, use templates such as `.env.example` and never include real keys.

## 4. Operational procedures (manual promotion)

### 4.1 Start work
1. Update local `main`:
   - `git checkout main`
   - `git pull --ff-only`
2. Create a work branch:
   - `git checkout -b work/<topic>`

### 4.2 Local development (Dev)
2. Run local test scripts manually (whatever is defined in the repo, e.g. `npm test`, `bun test`, `pnpm test`, `pytest`, etc.).
3. Commit as needed. Keep commits focused.

Agent rule: always write scripted unit tests and end2end smoke test with full coverage where possible. Writing mock is not allowed; these are absolutely useless and do not add quality. test scripts will be run manually and at your command to test the changes you made without exception. do not add mandatory test gates that are enforced through (Git) CI without explicit instruction.

## 5. Minimal automation stance

Allowed (minimal, optional):
- `.gitignore` rules
- manual test commands
- Optional local-only hooks (pre-commit)

Not allowed unless explicitly requested:
- Mandatory CI pipelines as merge gates
- Complex branching models (Gitflow)
- Automated semantic releases / versioning bots

## 6. Agent behavior requirements

When proposing changes or generating code:
1. Keep the workflow and repository operations lightweight.
2. Do not add new long-lived branches.
3. Do not add CI/CD complexity.
4. Ensure secrets are never committed and templates are used for configuration.
5. Assume the developer will run tests manually and will manually promote by push/merge.
6. If a recommendation would increase automation or process overhead, present it as optional and do not implement it unless explicitly instructed.
