# RemcoChat — SPEC: Docker Sandbox Orchestrator (Vercel Sandbox Alternative) (Feature #8)

## 1) Problem Definition
RemcoChat currently uses `@vercel/sandbox` (Firecracker microVMs) as the execution backend for the bash tool (Feature #6). This works well but has constraints:
- Requires Vercel credentials and network access to Vercel.
- Couples “local-only” dev workflows to a third-party runtime.
- Is not portable to “any host” that can run Docker (e.g. offline environments, self-hosted setups).

Feature #8 defines a **drop-in alternative execution backend** that:
- runs sandboxes as **Docker containers** on any host with a Docker-compatible engine, and
- provides orchestration from a **host “orchestrator” container** that RemcoChat talks to over a local network.

**Key requirement:** to the bash tool implementation, sandbox access must be **transparent** (same behavior and surface area as the current Vercel-backed approach).

## 2) Goals
- Provide a sandbox backend that runs as Docker containers (one container == one sandbox).
- Provide a **host container** that orchestrates sandboxes for RemcoChat:
  - create / reconnect / stop sandboxes
  - enforce concurrency limits and idle TTL
  - perform command execution and file I/O
  - stream logs for long-running commands
- Provide a mechanism to access sandbox-hosted web servers from “outside”:
  - return a host-reachable URL for a sandbox port (used by the `sandboxUrl` tool)
  - support services that bind to `127.0.0.1` inside the sandbox (common for dev servers)
- Keep sandbox access **transparent** to the bash tool layer:
  - no behavioral differences visible to the `bash`, `readFile`, `writeFile` tools beyond documented limitations
  - preserve the expected workspace path semantics (`/vercel/sandbox/workspace`)
- Keep RemcoChat’s existing safety stance:
  - bash tools remain off by default and require explicit enablement gates
  - local-only by default unless explicitly configured otherwise

## 3) Non-goals
- Not a multi-tenant, internet-exposed sandbox platform.
- Not a general “remote shell” product; this exists only to power RemcoChat tools.
- No guarantee of “perfect security”; isolation is “best-effort” within Docker constraints.
- No new CI/release automation, no deployment automation (manual operations remain).
- This spec does not implement the feature; it only defines the target design.

## 4) Architecture Overview

### 4.1 Components
1) **RemcoChat Server** (existing)
   - Requests sandbox operations (create/exec/read/write/stop) from the orchestrator.

2) **Sandbox Orchestrator Container** (`remcochat-sandboxd`) (new)
   - Runs on the same host as the container runtime.
   - Has access to the container runtime via a socket mount (e.g. Docker Engine API).
   - Exposes a local HTTP API for RemcoChat.
   - Tracks sandbox lifecycle, enforces limits, and brokers operations.

3) **Sandbox Containers** (`remcochat-sandbox:<runtime>`) (new)
   - One sandbox per chat/session (same isolation model as current Vercel approach).
   - Contains runtime/toolchain (e.g. Node 22).
   - Provides a writable workspace mounted at `/vercel/sandbox/workspace`.

### 4.2 Data Flow
- RemcoChat requests a sandbox (by `sessionKey`).
- Orchestrator returns a `sandboxId`.
- RemcoChat runs commands and file I/O via orchestrator endpoints.
- For streaming output, RemcoChat subscribes to logs for a running command and emits partial updates to the UI.

## 5) Compatibility Contract (“Transparent to the Bash Tool”)

### 5.1 Required Sandbox Capabilities
The Docker backend must support the subset of behavior currently relied on by RemcoChat:
- Execute commands in a bash shell (`bash -lc ...`) with:
  - a working directory rooted at `/vercel/sandbox/workspace`
  - bounded execution timeouts
  - exit code + stdout/stderr collection
- Stream logs for a running command, categorized as `stdout` or `stderr`.
- Read a file as bytes/text from within the sandbox filesystem.
- Write multiple files (path + content) into the sandbox filesystem.
- Stop/terminate the sandbox on demand and on idle timeout.

### 5.2 Workspace Semantics
- The sandbox must expose a writable workspace directory at:
  - `/vercel/sandbox/workspace`
- RemcoChat may create additional directories under:
  - `/vercel/sandbox/workspace/.remcochat/*`
- The sandbox must not have write access outside the workspace (preferred; see Security).

### 5.3 Runtimes
At minimum, support:
- `node v24` runtime (for `npm`, `git`, and Next.js workflows inside the sandbox)
- `python v3.13` runtime
- `uv v0.9.26` An extremely fast Python package and project manager
- `bun v1.36` all-in-one JavaScript, TypeScript & JSX toolkit

Optional (later):
- additional images for common tooling (e.g. `ffmpeg`, `pandoc`)

## 6) Orchestrator API (HTTP)
The orchestrator provides a local-only HTTP API. JSON is UTF-8. Binary file contents are base64 where needed.

### 6.1 Authentication / Access
- Default bind: `127.0.0.1` only.
- If bound to LAN, require an admin token on every request:
  - `Authorization: Bearer <token>` or `x-remcochat-admin-token: <token>`

This mirrors RemcoChat’s existing LAN/no-auth posture for privileged tooling.

### 6.2 Endpoints

#### `POST /v1/sandboxes`
Create or reconnect a sandbox for a `sessionKey`.

Request:
```json
{
  "sessionKey": "string",
  "runtime": "node24",
  "idleTtlMs": 900000,
  "resources": { "vcpus": 2, "memoryMb": 2048 },
  "network": { "mode": "default" }
}
```

Response:
```json
{ "sandboxId": "string", "created": true }
```

Notes:
- If a sandbox already exists for `sessionKey` and is healthy, return it with `"created": false`.
- The orchestrator is the source of truth for mapping `sessionKey -> sandboxId`.

#### `POST /v1/sandboxes/{sandboxId}/commands`
Start a command.

Request:
```json
{
  "cmd": "bash",
  "args": ["-lc", "cd \"/vercel/sandbox/workspace\" && echo hi"],
  "timeoutMs": 30000,
  "detached": true
}
```

Response:
```json
{ "commandId": "string" }
```

#### `GET /v1/sandboxes/{sandboxId}/commands/{commandId}/wait`
Wait for completion.

Response:
```json
{ "exitCode": 0 }
```

#### `GET /v1/sandboxes/{sandboxId}/commands/{commandId}/logs`
Stream logs as NDJSON (one JSON object per line), suitable for incremental consumption.

Response (stream):
```json
{"stream":"stdout","data":"partial..."}
{"stream":"stderr","data":"warn..."}
```

Notes:
- The orchestrator must preserve ordering per stream as observed from the container runtime.
- Logs endpoint must end when the command is finished (or when the client disconnects).

#### `POST /v1/sandboxes/{sandboxId}/files:write`
Write multiple files.

Request:
```json
{
  "files": [
    { "path": "/vercel/sandbox/workspace/a.txt", "contentBase64": "aGVsbG8=" }
  ]
}
```

Response:
```json
{ "ok": true }
```

#### `GET /v1/sandboxes/{sandboxId}/files:read?path=...`
Read a file.

Response:
```json
{ "found": true, "contentBase64": "aGVsbG8=" }
```

If not found:
```json
{ "found": false }
```

#### `POST /v1/sandboxes/{sandboxId}:stop`
Stop and delete the sandbox.

Response:
```json
{ "ok": true }
```

#### `GET /v1/health`
Health check.

Response:
```json
{ "ok": true, "engine": "docker", "version": "string" }
```

#### `GET /v1/sandboxes/{sandboxId}/ports/{port}`
Return a host-reachable URL for a TCP port inside the sandbox.

Response:
```json
{ "found": true, "hostPort": 55003, "url": "http://127.0.0.1:55003" }
```

If the port is not configured for exposure:
```json
{ "found": false }
```

Notes:
- The orchestrator only exposes ports from an allowlist configured by RemcoChat (e.g. `sandbox.ports = [3000]`).
- The returned `url` must be reachable from the caller’s network perspective:
  - Local dev: typically `http://127.0.0.1:<hostPort>`
  - LAN: `http://<host-ip>:<hostPort>` (requires orchestrator bind + publishing host IP configured for LAN)

## 7) Container Runtime / Orchestration Details

### 7.1 Host Requirements
- A Docker-compatible engine available on the host:
  - Docker Engine (Linux)
  - Docker Desktop (macOS/Windows)

### 7.2 Orchestrator Deployment Model
Run `remcochat-sandboxd` as a container that has access to the engine API:
- Docker Engine: mount `/var/run/docker.sock` into the orchestrator container.

The orchestrator is responsible for:
- creating sandbox containers with resource limits
- attaching volumes for persistent per-session workspace (optional)
- tracking TTL and cleaning up
- enforcing max concurrent sandboxes

### 7.3 Sandbox Container Configuration (recommended defaults)
- User: non-root inside the container (preferred).
- Root filesystem: read-only (preferred), with writable mounts:
  - `/vercel/sandbox/workspace` (volume)
  - `/tmp` (tmpfs)
- Linux capabilities: drop all, add none (preferred).
- `no-new-privileges`: true (preferred).
- Limit pids, CPU, memory.
- No host mounts other than the per-sandbox volume.

### 7.4 Images
Provide at least one image:
- `remcochat-sandbox:node24`
  - includes: `bash`, coreuitls
  - creates `/vercel/sandbox/workspace`

Multi-arch images (amd64/arm64) are strongly preferred to support “any host”.

### 7.5 Port Publishing Notes (Docker)
Problem:
- Many dev servers bind to `127.0.0.1` inside the sandbox. If the host tries to publish the sandbox port directly, external clients can fail to reach it because the service isn’t listening on `0.0.0.0` in the container.

Requirement:
- `GET /v1/sandboxes/{id}/ports/{port}` must work regardless of whether the service binds to `127.0.0.1` or `0.0.0.0` inside the sandbox.

Recommended approach:
- Run an in-sandbox loopback proxy (e.g. via `socat`) that binds to `0.0.0.0:<proxyPort>` and forwards to `127.0.0.1:<port>`.
- Publish `<proxyPort>` via the orchestrator so it is reachable from outside the sandbox.
- The orchestrator may implement publishing either via Docker port mappings on the sandbox container itself, or via a small helper proxy container on a shared Docker network (whichever is more portable across engines).

## 8) Seeding & Persistence
Two seeding modes mirror current Vercel behavior:

1) **Git seed (recommended)**
   - Orchestrator (or sandbox init) runs:
     - `git clone <url> /vercel/sandbox/workspace`
     - optional checkout to a revision
   - Pros: reproducible and avoids uploading untracked local files.

2) **Upload seed**
   - RemcoChat uploads a sanitized subset of `project_root` to the sandbox via `files:write`.
   - Pros: works offline; no git hosting required.
   - Cons: higher risk of accidentally copying sensitive files unless strictly filtered.

Persistence:
- Prefer one workspace volume per sandbox/session to preserve state across turns.
- On sandbox reset, delete the volume.

## 9) RemcoChat Integration (Provider Selection)
RemcoChat must be able to choose sandbox provider at runtime:
- `provider = "vercel" | "docker"`

The selection must not change the bash tool API exposed to the model (`bash`, `readFile`, `writeFile`), only the underlying execution backend.

## 10) Security Model & Risk Notes
Threat model remains constrained by RemcoChat being LAN-only and (by default) unauthenticated.

Mitigations:
- Keep privileged tooling off by default (existing kill switch + config gates).
- Localhost-only by default for both RemcoChat tool exposure and orchestrator API.
- require an admin token for LAN access.
- Constrain sandbox containers:
  - minimal capabilities
  - read-only root
  - no host mounts
  - resource limits + TTL cleanup

Open security decision:
- Network egress defaults:
  - Declined: **Option A (safer):** `network.mode="none"` by default; allow opt-in egress.
  - Approved: **Option B (more useful):** allow egress by default (to support `npm install`, etc ...) and document the risk.

## 11) Observability & Debugging
Orchestrator should log:
- sandbox lifecycle events (create/reuse/stop/ttl)
- command start/exit code/duration
- basic resource configuration

RemcoChat should continue to surface tool activity in the UI (existing tool cards).

## 12) Testing Strategy (No Mocks)
Testing expectations follow repository standards (unit + e2e, no mocks):
- Unit: provider selection logic and API client parsing.
- E2E: run a real orchestrator + sandbox container locally and:
  - execute a trivial command (`echo`)
  - write then read a file
  - run a longer command and stream logs
  - run a dev server that binds to `127.0.0.1` in the sandbox and verify `ports/{port}` returns a URL that serves HTTP from outside the sandbox
  - verify TTL cleanup (time-bounded test)

## 13) Open Decisions
1) Provider API shape: NDJSON vs SSE vs WebSocket for logs streaming.
2) Network policy default (none vs egress allowed). Decision: 'egress allowed'
3) Workspace persistence: per-sandbox volume vs ephemeral filesystem only.
4) Image contents policy: minimal vs “developer-friendly” toolchain set. Decision: 'developer-friendly toolchain set'
5) Whether to support Podman as a first-class engine target. Decision: 'no Podman support'

## 14) Rollout Plan (Manual)
1) Add orchestrator container + sandbox image(s).
2) Add provider selection + docker provider client in RemcoChat.
3) Default provider remains `vercel` until docker backend is proven.
4) Document local setup (compose snippet) and ops guidance.
