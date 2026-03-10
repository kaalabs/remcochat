---
title: Obsidian Vaults Server-Side for RemcoChat — Research + Spec
tags:
  - remcochat
  - obsidian
  - spec
  - research
status: draft
updated: 2026-03-02
---

# Obsidian Vaults Server-Side for RemcoChat — Research + Spec

## 1) Executive summary

RemcoChat currently supports an `obsidian` tool that shells out to **Obsidian CLI** on the same host. This is inherently “local-desktop dependent” because Obsidian CLI **requires the Obsidian desktop app to be running** and is an early-access feature. It will fail or behave unexpectedly when RemcoChat runs in Docker, on a headless server, or on a different machine than the Obsidian desktop app.

This spec proposes a **server-side vault layer** where vaults are available as files on the server (Markdown + attachments). RemcoChat will expose a model-facing **vault tool family** (`vaultRead`, `vaultWrite`, `vaultSearch`, `vaultDailyRead`, …) that operates on those server-side vault folders safely.

Critically, Obsidian now also offers an official **Obsidian Headless + Headless Sync** (open beta) which can keep a server-side folder mirror synced via Obsidian Sync (including end-to-end encryption), without requiring the desktop app. That becomes the “official best practice” option for teams who already use Obsidian Sync.

## 2) Requirements

### 2.1 Functional

- Support 1..N vaults on the server, each mapped to a filesystem root.
- Support “profile → default vault” mapping (so each RemcoChat profile can write to its own vault).
- Provide safe operations:
  - read a note
  - write / append / create a note
  - list/search notes
  - daily note helpers (read/append)
- Work in headless/server/Docker deployments.

### 2.2 Safety

- Strong guardrails against:
  - path traversal (`../`)
  - symlink escapes out of the vault root
  - accidental writing into wrong folders (prefix allowlists)
- Access gating: vault write tools must be **admin-only** (at minimum: localhost or `REMCOCHAT_ADMIN_TOKEN`).
- Auditable logging for all writes.

### 2.3 Non-goals (initially)

- Running Obsidian desktop app on the server.
- Full “in-app plugin API compatibility” server-side (Dataview, Canvas rendering, etc.).
- Collaborative real-time editing inside RemcoChat (we will rely on file-level sync + existing conflict mechanisms).

## 3) Research (Obsidian capabilities relevant to server-side use)

### 3.1 Vaults are folders of files (good for a server-side mirror)

Obsidian “vault” == a folder on disk (subfolders + files). This is also the basis for most sync methods (first-party sync, local sync, git, etc.).

Primary references:
- Obsidian Developer Docs: Vault definition + file ops inside the app: https://docs.obsidian.md/Plugins/Vault

### 3.2 Obsidian CLI is not a headless/server integration primitive

Obsidian CLI:
- is an **early access** feature requiring Obsidian 1.12+ (early access) and a Catalyst license
- **requires the Obsidian app to be running** (the first command can launch it)

Primary reference:
- Obsidian CLI docs: https://help.obsidian.md/cli

### 3.3 Plugin APIs (e.g. `app.vault`) are “in-app”, not a remote API

Obsidian’s Vault API and related classes are designed for plugins that run **inside** the Obsidian app. They are not a server-side API surface for remote access.

Primary reference:
- Vault API docs (plugin context): https://docs.obsidian.md/Plugins/Vault

### 3.4 Obsidian Sync security: E2EE means the server cannot read the remote vault

Obsidian Sync supports:
- **end-to-end encryption (default)**: Obsidian team cannot read note contents; losing the password makes data unrecoverable
- **standard encryption**: encryption key managed by Obsidian; less private

Primary reference:
- Sync security and privacy: https://help.obsidian.md/sync/security

Implication:
- A generic server reading “remote vault data” from Obsidian’s servers is not feasible for plaintext access.
- We need a **local decrypted mirror** on the server (or a different sync backend).

### 3.5 Obsidian Headless + Headless Sync (official server-side mirror mechanism)

Obsidian Headless is an official headless client (open beta) that can sync vaults without the desktop app, with the same encryption model as Obsidian Sync.

Obsidian’s own documentation explicitly calls out “agentic tools access to a vault without access to your full computer” and “sync a shared team vault to a server that feeds other tools” as intended use cases.

Headless Sync includes:
- `ob sync-list-remote`
- `ob sync-setup --vault ...`
- `ob sync --continuous`
- `ob sync-config` configuration options for excluded folders, file types to sync, config categories to sync, config folder name, device name, and conflict strategy
- `ob sync-status` to show status and configuration

It explicitly warns:
> Do not use both the desktop app Sync and Headless Sync on the same device, as it can cause data conflicts. Only use one sync method per device.

Primary references:
- Obsidian Headless: https://help.obsidian.md/headless
- Headless Sync: https://help.obsidian.md/sync/headless

Implication:
- RemcoChat can depend on **a server-side folder mirror** maintained by Headless Sync (recommended if you’re already on Obsidian Sync).
- This avoids “tying users to one computer” and avoids needing Obsidian desktop on the server.
- Operational note: Obsidian Headless requires Node.js 22+ and supports non-interactive authentication via `OBSIDIAN_AUTH_TOKEN`.

## 4) Proposed solution: RemcoChat Vault Service (server-side)

### 4.1 Concepts & terminology

- **Vault definition**: configured in `config.toml`, owned by the admin, identifies a vault id and how it is materialized on disk.
- **Vault root**: an absolute directory on the server containing the local plaintext mirror.
- **Vault mode**: `readonly` or `readwrite`.
- **Profile vault mapping**: a profile chooses which configured vault id is its default.

### 4.2 Configuration (`config.toml`)

Add `app.vaults` to define vaults.

```toml
[app.vaults]
enabled = true
access = "admin"                 # "admin" (default) | "lan_admin" (future) | "unsafe_lan" (never recommended)
default_vault_id = "personal"

# Optional: require vault roots to also be in app.local_access.allowed_directories
enforce_local_access_allowlist = true

[app.vaults.personal]
title = "Personal Vault"
provider = "filesystem"          # "filesystem" | "obsidian_headless_sync" (recommended if using Obsidian Sync) | "git_mirror" (future)
root_dir = "/data/vaults/personal"
mode = "readwrite"               # "readonly" | "readwrite"

# Optional allowlists within the vault root (posix-style, relative to root_dir)
allowed_read_prefixes = [""]     # empty string means “entire vault”
allowed_write_prefixes = ["Daily/", "Inbox/"]
blocked_prefixes = [".obsidian/", ".git/"]

# Optional: reduce blast radius of writes
allowed_write_extensions = [".md"]  # e.g. [".md", ".canvas", ".json"]

[app.vaults.personal.daily]
enabled = true
folder = "Daily/"
format = "YYYY-MM-DD"            # date format used for filename
extension = ".md"
template_path = "Templates/Daily.md"  # optional, vault-relative

[app.vaults.team]
title = "Team Vault"
provider = "obsidian_headless_sync"
root_dir = "/data/vaults/team"
mode = "readonly"
remote_vault = "Team Vault"      # name or id as accepted by `ob sync-setup`

# Headless Sync options (RemcoChat itself may not run sync; see provider notes below)
[app.vaults.team.headless]
config_dir = ".obsidian"         # matches `--config-dir`
excluded_folders = [".trash/", ".git/"]
conflict_strategy = "conflict"   # "merge" | "conflict"
```

Notes:
- `root_dir` is the only required “materialized location”; providers describe how it is kept up to date.
- `enforce_local_access_allowlist=true` is defense-in-depth: it prevents configuring a vault outside previously allowlisted directories when `app.local_access` is enabled.
- Prefix allowlists use vault-relative paths and are normalized (posix slashes, optional trailing slash).

### 4.3 Providers

#### 4.3.1 `filesystem` (Phase 1; ship first)

Assumption: vault is already present as a folder on the server.

How the folder gets there is out-of-band:
- Obsidian Headless Sync (recommended for Obsidian Sync users)
- Syncthing
- git working tree mirror
- NAS mount

RemcoChat responsibility:
- safe read/write/search inside `root_dir`
- not responsible for syncing

#### 4.3.2 `obsidian_headless_sync` (recommended deployment recipe)

Assumption: an external process keeps `root_dir` synced using Obsidian Headless.

Options:
- Run `ob sync --continuous` under systemd/supervisord/docker sidecar.
- Configure auth via `OBSIDIAN_AUTH_TOKEN` (CI/server best practice).
- Consider using `ob sync-config` to reduce scope:
  - set `--conflict-strategy conflict` (safer than implicit merges for automated workflows)
  - set `--excluded-folders` (e.g. `.trash/,.git/`)
  - set `--file-types` to the attachment types you actually need on the server
  - disable config syncing (empty `--configs`) unless you explicitly want `.obsidian` state on the server

Why this is recommended:
- Official, supports end-to-end encryption, no desktop app required.

RemcoChat responsibility:
- treat `root_dir` as an ordinary filesystem vault
- optionally expose “status” surfaces if we can read `ob sync-status` output (future)

#### 4.3.3 `git_mirror` (future)

Assumption: `root_dir` is a git working tree.

RemcoChat could optionally:
- run scheduled `git pull` (admin-only feature) and expose “sync now”
- avoid auto-push from server unless explicitly desired (safer default)

## 5) Profile → vault mapping (per-profile vaults)

### 5.1 Database changes

Add a nullable column to `profiles`:

- `vault_id TEXT`

Resolution rules:
1) Tool calls may pass `vaultId` explicitly (validated against config).
2) Otherwise use `profiles.vault_id` if set.
3) Otherwise fall back to `app.vaults.default_vault_id`.

> [!warning]
> RemcoChat currently has no authentication model. Profile selection is a UI choice, so profile→vault mapping is **not** a security boundary unless RemcoChat adds auth/ACLs later. Treat it as UX segmentation.

### 5.2 UI/API changes

- Profile settings UI: add “Default vault” selector listing configured vault ids (show title + mode).
- Profile API: add `vaultId` field on profile DTO; add endpoint to update it.

### 5.3 Optional (future): managed per-profile filesystem vaults

If we want “every profile automatically gets its own vault” without pre-defining many vault entries in `config.toml`, introduce an optional managed pool:

```toml
[app.vaults.profile_vaults]
enabled = false
base_dir = "/data/vaults/profiles"
mode = "readwrite"
```

Behavior:
- If enabled and a profile has no explicit `vault_id`, its default vault becomes `profile:<profile_id>`.
- The vault root becomes `${base_dir}/${profile_id}` (created on first write if allowed).

This is a convenience feature for “one vault per profile”; it still does not provide strong security without auth.

## 6) Model-facing tool surface (server-side vault tools)

Expose a dedicated “vault tools” family (not bash tools; not Obsidian CLI):

- `vaultList`: list configured vaults (id, title, mode, daily settings)
- `vaultRead`: read a vault-relative path
- `vaultWrite`: atomic overwrite (creates parent dirs if allowed)
- `vaultAppend`: append (optionally ensure newline)
- `vaultSearch`: text search within allowed read prefixes (returns paths + snippets)
- `vaultDailyRead`: compute today’s daily note path and read (per vault daily config)
- `vaultDailyAppend`: append content to today’s daily note (create if missing; optional template)

Tool contract conventions:
- Always prefer vault-relative paths (`"Daily/2026-03-02.md"`) rather than absolute paths.
- Return structured metadata:
  - `vaultId`, `path`, `operation`, `bytesRead/bytesWritten`, `sha256` (optional), `updatedAt`, `created`, `truncated`
- Enforce vault `mode`:
  - `readonly` blocks write/append/create

## 7) Implementation details (RemcoChat)

### 7.1 Path safety & symlink escape prevention

For each configured vault:
- compute `rootReal = realpath(root_dir)` at load time

For each operation on `relPath`:
1) reject absolute paths
2) reject `..` segments
3) normalize to posix slashes
4) map to `abs = join(rootReal, relPath)`
5) compute `absReal` using “best effort realpath”:
   - resolve realpath of nearest existing ancestor to handle non-existent target paths
6) require `absReal` starts with `rootReal + path.sep`
7) enforce prefix allowlists:
   - read must match `allowed_read_prefixes`
   - write must match `allowed_write_prefixes`
8) enforce `blocked_prefixes` (applies to read + write)
9) enforce `allowed_write_extensions` (write + append)

Encoding conventions:
- Treat note content as UTF-8 text.
- For `.md`, normalize to a trailing newline on write/append (configurable).

### 7.2 Atomic writes

Use an atomic write strategy:
- write to temp file in same directory
- fsync (best effort)
- rename to final path

### 7.3 Concurrency & conflict behavior

- Use a per-vault per-path mutex for writes to avoid interleaving appends.
- Reads are concurrent.
- If the vault is synced externally, there will be occasional conflicts:
  - we do not implement merges; we rely on upstream sync conflict behavior and/or versioning
  - add a “write precondition” option later: `ifSha256` to avoid overwriting unexpected changes

### 7.4 Search strategy

Phase 1:
- Use `rg` (ripgrep) if present on the server for fast scanning.
- Fallback: streaming file scan with hard caps (file count, bytes, time budget).

Phase 2 (optional):
- Build an index (SQLite FTS) with a file watcher.

## 8) Access control and admin gating

Vault read/write tools are a privileged capability.

Default policy:
- Enable vault tools only when:
  - `app.vaults.enabled=true`
  - request passes admin policy (`localhost` OR valid `REMCOCHAT_ADMIN_TOKEN`)

Rationale:
- Without auth, allowing LAN clients to write arbitrary files inside a server-managed vault is too risky.

## 9) Deployment recipes (server as the always-on hub)

### 9.1 Recommended: Obsidian Sync + Headless Sync on server

High-level setup:
1) Provision a server directory: `/data/vaults/<id>`
2) Install Node.js 22+ on the server host/sidecar
3) Install Obsidian Headless (`npm i -g obsidian-headless`)
4) Authenticate (`ob login` or `OBSIDIAN_AUTH_TOKEN`)
5) `cd /data/vaults/<id>` and `ob sync-setup --vault "My Vault"`
6) Run `ob sync --continuous` as a service

This yields a local plaintext mirror at `/data/vaults/<id>` for RemcoChat to use.

Primary references:
- https://help.obsidian.md/headless
- https://help.obsidian.md/sync/headless

### 9.2 Syncthing hub

Run Syncthing on the server and sync the vault folder to/from clients. RemcoChat points at the server’s synced folder.

### 9.3 Git hub

Host a bare repo on the server and have clients push/pull via a vault git workflow. RemcoChat points at a checked-out working tree.

## 10) Acceptance criteria

- Vault tools exist and are only enabled when admin-gated.
- Profile settings can select a default vault id.
- `vaultDailyRead` enables “summarize my daily note” without any local Obsidian CLI dependency.
- All path traversal + symlink escape attempts are blocked.
- Writes are atomic; concurrent appends don’t interleave.

## 11) Primary sources

- Obsidian CLI: https://help.obsidian.md/cli
- Obsidian Headless: https://help.obsidian.md/headless
- Headless Sync: https://help.obsidian.md/sync/headless
- Obsidian Sync security: https://help.obsidian.md/sync/security
- Obsidian Vault API (plugin context): https://docs.obsidian.md/Plugins/Vault
