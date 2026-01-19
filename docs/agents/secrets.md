# Secrets Handling

- Secrets must never be committed.
- Ensure secrets are ignored via `.gitignore` and/or `.git/info/exclude`.
- Common local secrets patterns: `.env.local`, `.env.*` (except `.env.example`), `secrets/`, `*.key`, `*.pem`.
- If adding configuration examples, use templates such as `.env.example` and never include real keys.
