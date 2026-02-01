# RemcoChat Docker Security Audit

Date: 2026-02-01  
Scope: RemcoChat Docker/compose setup + nginx reverse proxy + `sandboxd` (Docker sandbox orchestrator)

This document reviews the security posture of the production-like deployment described by:

- `docker-compose.yml`
- `docker-compose.proxy.yml`
- `Dockerfile` (RemcoChat)
- `sandboxd/Dockerfile` + `sandboxd/src/index.ts`
- `nginx/remcochat.conf`
- `scripts/start-remcochat.sh`

The goal is to identify the highest-impact risks and provide practical mitigations that fit RemcoChat’s “LAN/Tailnet, no auth” operating model.

## Executive Summary

The main security risk is the Docker-based bash/sandbox tooling:

- `sandboxd` is published on the network and has access to the host Docker socket (`/var/run/docker.sock`). A compromise of `sandboxd` (or leakage/weakness of its admin token) is effectively a host compromise.
- Published sandbox ports can be exposed broadly depending on configuration (`SANDBOXD_PUBLISH_HOST_IP`).

Secondarily, the nginx proxy mounts private key material (including the local CA private key) into the proxy container, which expands the blast radius of an nginx compromise.

## What’s Already Good

- RemcoChat container is bound only to localhost on the host (`127.0.0.1:3100:3000`), reducing direct LAN exposure. (`docker-compose.yml:8`)
- `.env` is excluded from the Docker build context (`.env*` in `.dockerignore`), reducing accidental secret inclusion in images. (`.dockerignore:1`)
- The *per-command sandbox containers* created by `sandboxd` are meaningfully hardened:
  - `ReadonlyRootfs: true`
  - `CapDrop: ["ALL"]`
  - `SecurityOpt: ["no-new-privileges:true"]`
  - CPU/memory/pid limits
  - `tmpfs` for `/tmp` with `noexec,nosuid`
  (`sandboxd/src/index.ts:423`)

## Threat Model (High-Level)

Assumptions:

- RemcoChat is reachable via `https://<host>/remcochat/` (nginx on 443).
- No authentication for the chat UI (by design).
- Bash tools are enabled (`app.bash_tools.enabled=true` and `REMCOCHAT_ENABLE_BASH_TOOL=1`) and controlled primarily by an “admin token”.
- Users/clients are within LAN/Tailnet boundaries, but “inside network” should still be considered hostile (malware on a client, stolen device, etc.).

High-value assets:

- Host integrity (Docker socket == root-equivalent control of host via container escapes/privileged mounts).
- Admin token (`REMCOCHAT_ADMIN_TOKEN`) and provider API keys.
- Local CA private key (`nginx/certs/ca.key`) used to mint TLS certs trusted by client devices.

## Findings

### Critical: `sandboxd` exposure + Docker socket access

**What:** `sandboxd` is published on host port `8080` (interface controlled by `SANDBOXD_HOST_BIND_IP`, default `127.0.0.1`) and mounts `/var/run/docker.sock`. (`docker-compose.yml`)

**Why it matters:** If an attacker can reach `sandboxd` and bypass/leak the token, they can create containers, mount the host filesystem, or otherwise take over the host through Docker. In practice, “network access to docker.sock” is a top-tier risk.

**Notes:**
- `sandboxd` requires a token when not bound to localhost (`SANDBOXD_BIND_HOST` is `0.0.0.0` and `SANDBOXD_REQUIRE_TOKEN` defaults effectively to true). (`sandboxd/src/index.ts:889`, `sandboxd/src/index.ts:897`)
- This is still fragile: token leakage, weak token, logging, or any auth/HTTP parsing bug is catastrophic.

**Mitigations:**
1. **Prefer: make `sandboxd` private to Docker only** (no host port publish); connect from `remcochat` to `sandboxd` via the internal compose network and set `orchestrator_url = "http://sandboxd:8080"` in `config.toml`.
2. If you must publish: bind to the Tailscale IP only and firewall the port.

### Critical: Sandbox port publishing can expose arbitrary services

**What:** With `SANDBOXD_PUBLISH_HOST_IP` set too broadly (e.g. `0.0.0.0`) and sandboxd’s port-publishing feature, services started inside sandboxes can be published on the host on random high ports.

**Why it matters:** A sandbox can run arbitrary network services; publishing those to `0.0.0.0` can unintentionally expose them to LAN (or beyond, depending on host firewall).

**Mitigations:**
- Set `SANDBOXD_PUBLISH_HOST_IP` to a constrained interface (e.g. the host’s Tailscale IP only) or to `127.0.0.1`.
- Consider setting `ports = []` for bash tools in `config.toml` unless you explicitly need it. (`config.toml:92`)

### High: nginx proxy mounts CA private key into container

**What:** If the proxy container can read the CA private key used to mint TLS certs, an nginx compromise can escalate into “mint your own trusted certs” for any client that installed/trusted that CA.

**Why it matters:** If nginx (or its container) is compromised, attackers can exfiltrate private keys. Exfiltration of `ca.key` is especially severe because any client that trusted this CA can be MITM’d using attacker-minted certificates.

**Mitigations:**
- Mount only what nginx needs at runtime: `tls.pem`, `tls.key`, and *public* CA artifacts (`ca.pem`, `ca.cer`, `remcochat-ca.mobileconfig`).
- Keep `ca.key` on the host only (used only when generating new certs).

### Medium: Production images run as root + include build tools/dev deps

**What:** Both `remcochat` and `sandboxd` images use `node:20-bookworm-slim` and run as root. (`Dockerfile:1`, `sandboxd/Dockerfile:1`)

RemcoChat image installs build tools and runs `npm ci --include=dev` in the runtime image. (`Dockerfile:7`, `Dockerfile:24`)

**Why it matters:** This increases CVE surface area and blast radius if application RCE happens.

**Mitigations (optional, higher effort):**
- Convert to a multi-stage build:
  - build stage with toolchain and dev deps
  - runtime stage with prod deps only
- Add a non-root user and run the Next.js server as that user.

### Medium: No compose-level container hardening for long-lived services

**What:** `docker-compose.yml` and `docker-compose.proxy.yml` do not specify hardening options (`cap_drop`, `security_opt`, `read_only`, `tmpfs`, resource limits) for long-running containers.

**Mitigations (low/medium effort):**
- Add `security_opt: ["no-new-privileges:true"]` and `cap_drop: ["ALL"]` where compatible (nginx typically needs minimal caps; Next.js usually needs none).
- Consider `read_only: true` with `tmpfs` mounts for `/tmp` where needed.
- Add memory/pid limits to reduce DoS blast radius.

### Medium: Port-proxy container uses `alpine/socat:latest` with no hardening

**What:** sandboxd pulls and runs `alpine/socat:latest` to publish ports. (`sandboxd/src/index.ts:602`)

**Why it matters:** “latest” tags are supply-chain fragile; the proxy container has no `CapDrop`/`no-new-privileges`/resource limits. It also binds to whatever `SANDBOXD_PUBLISH_HOST_IP` allows.

**Mitigations:**
- Pin the image tag/digest.
- Add basic hardening to the port-proxy container in `HostConfig`.
- Prefer binding to Tailscale/localhost only.

## Recommended Prioritized Fix Plan

### Priority 0 (same architecture, minimal diffs)

1. Bind `sandboxd` to a restricted interface (prefer Tailscale IP) and restrict `SANDBOXD_PUBLISH_HOST_IP` similarly.
2. Stop mounting `nginx/certs` wholesale; mount only needed cert files and keep `ca.key` host-only.
3. Ensure `REMCOCHAT_ADMIN_TOKEN` is long, random, and rotated if it may have leaked (it gates both LAN bash tools and sandboxd auth in this setup). (`scripts/start-remcochat.sh:117`, `docker-compose.yml:39`)

### Priority 1 (best practice for this app)

Make `sandboxd` private to the Docker network:

- Remove the host port publish for sandboxd (no `ports:` stanza).
- Set `app.bash_tools.docker.orchestrator_url = "http://sandboxd:8080"` in `config.toml`.
- This ensures only `remcochat` can call `sandboxd` (not every LAN/Tailnet client).

### Priority 2 (hardening + hygiene)

- Multi-stage builds, non-root runtime users, and reduced runtime dependencies.
- Pin “latest” images and add container `security_opt`/`cap_drop`.
- Add host firewall rules to explicitly allow only 80/443 (and optionally Tailnet-only 8080 if not made private).

## Operational Checks

Quick checks to confirm the intended exposure:

- Only these should be reachable from LAN/Tailnet clients:
  - `https://<host>/remcochat/` (nginx 443)
  - optionally `http://<host>/remcochat/` (nginx 80 -> redirect)
- `remcochat` should not be reachable directly (it’s bound to `127.0.0.1:3100`). (`docker-compose.yml:8`)
- If `sandboxd` remains published, verify it is not reachable from LAN (or at least is restricted to Tailnet IP) and requires token.
