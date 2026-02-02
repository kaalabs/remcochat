# Bash Tools Implementation (RemcoChat)

This document describes **how RemcoChat implements “bash tools”**: the architecture, dependencies, security posture, and configuration knobs.

The “bash tools” feature exposes a small tool surface area to the model:
- `bash`: run a shell command inside an isolated sandbox
- `readFile`: read a file inside the sandbox workspace
- `writeFile`: write a file inside the sandbox workspace
- `sandboxUrl`: get a URL for an exposed sandbox port (for previewing servers started in the sandbox)

The implementation is intentionally **defense-in-depth**:
- Tools are **disabled by default**.
- Enabling requires **multiple independent gates** (config + env + request policy).
- Execution is **never on the RemcoChat host**; it is routed to an isolated backend.

---

## 1) High-level architecture

### Components

1) **RemcoChat API route** (`src/app/api/chat/route.ts`)
- Decides whether tools should be available for the current request.
- Creates the tool set (chat tools + web tools + bash tools + skills tools) and passes it into the model tool loop (`ai.streamText`).
- Emits response headers indicating whether bash tools were enabled for this request.

2) **Bash tools integration layer** (`src/ai/bash-tools.ts`)
- Applies enablement gates (config + kill-switch + request access policy).
- Builds a sandbox adapter implementing the `bash-tool` `Sandbox` interface.
- Maintains a per-session sandbox cache (LRU + idle TTL).
- Provides both:
  - the standard `bash-tool` toolkit (bash/readFile/writeFile), and
  - a custom **streaming** `bash` tool that yields incremental output for the UI.

3) **Execution backend (one of two providers)**
- **Vercel Sandbox provider**: `@vercel/sandbox` microVMs.
- **Docker sandboxd provider**: local orchestrator + per-session Docker containers.

4) **UI tool rendering** (`src/components/bash-tool-card.tsx`, used from `src/app/home-client.tsx`)
- Renders the `tool-bash`, `tool-readFile`, and `tool-writeFile` parts as “tool cards”.
- Supports “running” state for the streaming bash tool (exitCode `-1` sentinel).

### Data flow

1) Browser sends `POST /api/chat` to RemcoChat.
2) `route.ts` resolves the model/provider and decides which toolsets are allowed.
3) `createBashTools({ request, sessionKey })` builds the bash tools for this request:
   - `sessionKey` is `tmp:<temporarySessionId>` for temporary chats, or `chat:<chatId>` for persisted chats.
4) Model calls a tool:
   - `bash/readFile/writeFile/sandboxUrl` tool execution runs on the server.
   - The server routes the request to a sandbox (Vercel or docker sandboxd).
5) Tool outputs are streamed back to the client as UI message parts (`tool-*`), and rendered as tool cards.

---

## 2) Tooling surface (what the model sees)

### `bash`, `readFile`, `writeFile` (from `bash-tool`)

We use the external package `bash-tool` to produce AI SDK tool definitions. The library expects a `Sandbox` adapter with:
- `executeCommand(command: string) -> { stdout, stderr, exitCode }`
- `readFile(path: string) -> string`
- `writeFiles([{ path, content }]) -> void`

In RemcoChat, we always pass a sandbox adapter and set:
- `destination = "/vercel/sandbox/workspace"` (workspace root for both providers)
- `maxOutputLength = max(max_stdout_chars, max_stderr_chars)`
- `onAfterBashCall`: truncates `stdout` and `stderr` independently to the configured caps.

Code: `src/ai/bash-tools.ts` (see `createBashTools`).

### `bash` (streaming override)

The upstream `bash-tool` tool returns output only after completion. RemcoChat replaces `tools.bash` with a custom tool implemented as an async generator (`createStreamingBashTool` in `src/ai/bash-tools.ts`) so the UI can display incremental output for long-running commands.

Streaming behavior:
- The tool yields multiple outputs while the command runs.
- While running, it yields `exitCode: -1` (UI “Running…” state).
- It maintains a **tail buffer** for `stdout`/`stderr` (`max_stdout_chars` / `max_stderr_chars`) and tracks dropped character counts (`stdoutTruncatedChars` / `stderrTruncatedChars`).
- It emits updates on an interval (~150ms) or when output changes by a threshold (~512 chars), whichever happens first.

UI handling: `src/app/home-client.tsx` renders `tool-bash` with `exitCode === -1` as running.

### `sandboxUrl`

The `sandboxUrl` tool is implemented in RemcoChat (not provided by `bash-tool`):
- For **Vercel**, it returns `entry.sandbox.domain(port)` but only if the port is in `app.bash_tools.sandbox.ports`.
- For **Docker**, it asks sandboxd for a published port URL (`GET /v1/sandboxes/:id/ports/:port`).

Code: `createSandboxUrlTool` in `src/ai/bash-tools.ts`.

---

## 3) Sandbox lifecycle and caching

RemcoChat keeps a process-local cache of sandboxes keyed by `sessionKey`:
- `sandboxesByKey: Map<string, SandboxEntry>` stores the live sandbox reference (Vercel) or sandbox id + client (Docker).
- `createLocks: Map<string, Promise<SandboxEntry>>` prevents concurrent creation races for the same session.

Lifecycle policy (`src/ai/bash-tools.ts`):
- **Idle TTL**: each sandbox entry has a timer; inactivity beyond `idle_ttl_ms` triggers eviction + stop.
- **Concurrency cap**: when creating a new sandbox, `evictIfNeeded()` enforces `max_concurrent_sandboxes` by evicting the least-recently used entry.
- **Prewarm**: `prewarmSandboxEntry()` is called at tool-init time to reduce first-command latency.

Important: sandbox persistence is per RemcoChat server process. A server restart drops the in-memory cache.

---

## 4) Provider backends

### 4.1 Vercel Sandbox provider (`@vercel/sandbox`)

Creation (`src/ai/bash-tools.ts`):
- `Sandbox.create(...)` is called with:
  - `runtime` (from `app.bash_tools.sandbox.runtime`, default `node22` for Vercel)
  - `resources.vcpus`
  - `timeout` (from `app.bash_tools.sandbox.timeout_ms`)
  - optional `ports` allowlist (max 4)
  - optional `source: { type: "git", url, revision }` when `seed.mode="git"`
- For `seed.mode="upload"`, RemcoChat uploads files into `/vercel/sandbox/workspace` using `sandbox.writeFiles(...)`.

Execution adapter (`makeSandboxAdapter`):
- Commands run as `bash -lc <script>` via `sandbox.runCommand`.
- A per-command `AbortController` enforces `app.bash_tools.timeout_ms` even if the sandbox’s own timeout is higher.
- Every command is wrapped with a small prelude (`wrapSandboxCommand`) that:
  - prepends `/vercel/sandbox/workspace/.remcochat/bin` to `PATH`, and
  - creates a `python -> python3` shim inside the workspace when `python` is missing.
- `readFile` uses `sandbox.readFile({ path })` and streams it to a string.
- `writeFiles` maps to `sandbox.writeFiles` (binary-safe).

### 4.2 Docker sandboxd provider (local Docker containers)

This provider is split into:

1) **Client** (`src/ai/docker-sandbox-client.ts`)
- Talks to sandboxd over HTTP.
- Optionally attaches `x-remcochat-admin-token` for sandboxd auth; the token value is loaded from an env var name (`app.bash_tools.docker.admin_token_env`).
- Implements:
  - create/reconnect sandbox
  - start/wait/kill command
  - stream logs via NDJSON
  - read/write files (base64)
  - stop sandbox
  - get a published port URL

2) **Orchestrator** (`sandboxd/src/index.ts`)
- A small HTTP server that manages per-session sandbox containers.
- Connects to the Docker engine via the socket (default `/var/run/docker.sock`).

Sandbox container hardening (in `sandboxd/src/index.ts`):
- Read-only root filesystem (`ReadonlyRootfs: true`)
- Drop all Linux capabilities (`CapDrop: ["ALL"]`)
- `no-new-privileges:true`
- PID limit (`PidsLimit: 512`)
- CPU + memory limits (`NanoCpus`, `Memory`)
- Writable workspace is a per-sandbox Docker volume mounted at `/vercel/sandbox/workspace`.
- `/tmp` is a tmpfs with `noexec,nosuid`.

File I/O restrictions:
- sandboxd rejects read/write paths not under `/vercel/sandbox/workspace` and blocks path traversal (`..`).

Port publishing:
- Only allowed for ports listed on sandbox creation (`ports` allowlist; max 4).
- To support services bound to `127.0.0.1` inside the sandbox, sandboxd:
  1) starts a loopback proxy inside the sandbox (via `socat`) on a stable, derived high port, and then
  2) runs a dedicated `alpine/socat` proxy container to publish the port to the host on a random high port.
- The `sandboxUrl` tool returns a host-reachable URL for that published port.

Sandbox rehydration:
- On startup, sandboxd scans running containers with `remcochat.*` labels and rebuilds in-memory state (`rehydrateFromEngine`).

Runtime image:
- sandboxd expects a sandbox image tag `remcochat-sandbox:node24` (built from `sandbox-images/node24/Dockerfile`).

---

## 5) Seeding the workspace (git vs upload)

The bash tool assumes a “project workspace” exists under `/vercel/sandbox/workspace`. RemcoChat supports two seeding modes:

### 5.1 `seed.mode = "git"`

- **Vercel**: uses `Sandbox.create({ source: { type: "git", url, revision } })`.
- **Docker**: sandboxd always starts with an empty volume; RemcoChat runs `git clone` inside the sandbox once, guarded by a marker file:
  - marker: `/vercel/sandbox/workspace/.remcochat/seeded_git`

### 5.2 `seed.mode = "upload"`

RemcoChat copies a local directory into the sandbox workspace.

Upload safety filters (`src/ai/bash-tools.ts`):
- Ignores directories: `.git`, `node_modules`, `.next`, `data`, `test-results`
- Ignores files:
  - any `.env*` except `.env.example`
  - `*.pem`, `*.key`
  - anything under `secrets/`
- Caps upload size to `maxFiles = 2000` and suggests narrowing with `seed.upload_include` if exceeded.

Note: `seed.upload_include` is treated as a simple extension filter for patterns like `**/*.ts` or `**/*.{ts,json}`; other patterns behave like “include everything” and rely on the ignore list above.

---

## 6) Security model

### 6.1 Enablement gates (defense-in-depth)

Bash tools are only enabled if ALL of the following pass:

1) **Config gate**: `app.bash_tools.enabled = true` (in `config.toml`)
2) **Runtime kill-switch**: `REMCOCHAT_ENABLE_BASH_TOOL=1` (env var)
3) **Per-request access policy** (`app.bash_tools.access`)
   - `localhost`: only enable for localhost-origin requests (based on `Host`, `X-Forwarded-For`, `X-Real-IP`)
   - `lan`: require a matching admin token on every request (`x-remcochat-admin-token` or `Authorization: Bearer ...`)

Code: `src/ai/bash-tools.ts` (`bashToolsKillSwitchEnabled`, `isRequestAllowedByAccessPolicy`).

### 6.2 Token handling

- The server checks the provided token against `REMCOCHAT_ADMIN_TOKEN`.
- The browser UI stores the token **locally** (sessionStorage or localStorage) and sends it on every `/api/chat` request when `access="lan"`.
- Response headers include `x-remcochat-bash-tools-enabled: 1|0` to make it easy to verify whether the request was authorized.

UI: `src/app/home-client.tsx` (LAN admin token dialog + request headers).

### 6.3 Isolation boundaries

- RemcoChat **never executes user/model shell commands on the host**.
- Vercel backend provides microVM isolation.
- Docker backend provides container isolation plus hardening (readonly rootfs, caps drop, no-new-privileges, resource limits).

Important limitation: the Docker backend requires sandboxd to have access to the Docker socket, which is a powerful host capability. Treat sandboxd as highly privileged infrastructure:
- keep it bound to localhost or a restricted interface (e.g. tailnet-only),
- require a strong admin token when bound to anything non-local,
- do not expose it to the public internet.

### 6.4 Filesystem boundaries (Docker provider)

sandboxd enforces:
- absolute paths must stay under `/vercel/sandbox/workspace`
- traversal (`..`) is rejected

This prevents `readFile`/`writeFile` from touching container FS outside the workspace, and prevents accidental access to the orchestrator container filesystem via file APIs.

### 6.5 Output limits and UI safety

To prevent runaway output from overwhelming the UI and to reduce the chance of accidentally echoing secrets:
- Non-streaming outputs are truncated with an explicit notice.
- Streaming keeps only a tail buffer and reports how much was dropped.

Additionally, the system prompt explicitly tells the model to treat command output as untrusted data.

---

## 7) Configuration reference

### 7.1 `config.toml` (primary)

See `config.toml.example` and `config.docker.toml.example`. The relevant section:

```toml
[app.bash_tools]
enabled = false
provider = "vercel"  # "vercel" | "docker"
access = "localhost" # "localhost" | "lan"
project_root = ""    # required if seed.mode="upload"
max_stdout_chars = 12000
max_stderr_chars = 12000
timeout_ms = 30000
max_concurrent_sandboxes = 2
idle_ttl_ms = 900000

[app.bash_tools.sandbox]
runtime = "node22"   # vercel: "node22" | "python3.13"; docker: "node24" | "python3.13"
ports = [3000]       # allowlist, max 4
vcpus = 2
timeout_ms = 900000

[app.bash_tools.docker]
orchestrator_url = "http://127.0.0.1:8080"
admin_token_env = "REMCOCHAT_ADMIN_TOKEN"
network_mode = "default" # "default" | "none"
memory_mb = 2048

[app.bash_tools.seed]
mode = "git"         # "git" | "upload"
git_url = ""
git_revision = ""
upload_include = "**/*"
```

Normalization and validation happens in `src/server/config.ts`. Additional preflight checks run in `scripts/check-env.mjs`.

### 7.2 Environment variables

Required enablement / auth:
- `REMCOCHAT_ENABLE_BASH_TOOL=1` (hard kill-switch)
- `REMCOCHAT_ADMIN_TOKEN=...` (required for `access="lan"`; also used for sandboxd auth in the Docker compose stack)

Vercel Sandbox credentials (when provider is `vercel`):
- Preferred in local dev (checked by scripts): `VERCEL_OIDC_TOKEN=...`
- Alternative credentials passed directly by RemcoChat when present:
  - `VERCEL_TOKEN` (or `VERCEL_API_KEY`)
  - `VERCEL_TEAM_ID` (or `VERCEL_ORG_ID`)
  - `VERCEL_PROJECT_ID`

Docker sandboxd hardening / URLs (see `.env.example`):
- `SANDBOXD_HOST_BIND_IP` (dev-only override to publish sandboxd to host)
- `SANDBOXD_PUBLISH_HOST_IP` (interface for published sandbox ports)
- `SANDBOXD_PUBLIC_HOST`, `SANDBOXD_PUBLIC_PROTO` (override the hostname/scheme returned by `sandboxUrl`)

### 7.3 Docker compose defaults

In `docker-compose.yml`:
- `remcochat` service depends on `sandboxd`.
- `sandboxd` is on the compose network and is not host-exposed by default.
- `SANDBOXD_ADMIN_TOKEN` is set from `REMCOCHAT_ADMIN_TOKEN`.

To publish sandboxd for debugging, use `docker-compose.dev.yml` (binds `:8080` to localhost unless overridden).

---

## 8) Operational notes / debugging

- Verify bash tools are enabled for a request by checking the `/api/chat` response header:
  - `x-remcochat-bash-tools-enabled: 1`
- When `access="lan"`, make sure the browser is sending `x-remcochat-admin-token`.
  - The UI has a built-in “Bash tools (LAN admin token)” dialog and shows the last header it saw.
- For Docker provider:
  - build the sandbox image: `docker build -t remcochat-sandbox:node24 -f sandbox-images/node24/Dockerfile .`
  - check sandboxd health: `GET /v1/health`
  - keep sandboxd bound to a restricted interface and use a strong token.
