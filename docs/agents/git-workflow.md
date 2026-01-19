# Git Workflow

- `main` is the production branch and source of truth.
- Use short-lived branches for any non-trivial change; name them `work/<short-topic>` or `feat/<topic>`, `fix/<topic>`, `chore/<topic>`.
- Branch off `main` and keep one change-set per branch when possible.
- Start work:
  - `git checkout main`
  - `git pull --ff-only`
  - `git checkout -b work/<topic>`
- Do not add new long-lived branches or introduce `develop`, `staging`, or `release/*` unless explicitly requested.
- Keep commits focused.
