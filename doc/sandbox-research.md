# Local Sandbox Research for ppeng-agent-core

> **Date**: 2025-07 | **Scope**: Local sandboxing for AI agent code/shell execution  
> **Constraint**: Node.js/TypeScript runtime, cross-platform (macOS + Windows), minimal dependencies

---

## Current Execution Model

The runtime currently has **no OS-level sandboxing**. Isolation is app-level only:

| Mechanism | What it does | Limitation |
|-----------|-------------|------------|
| `safePath()` | Prevents `../` traversal in file tools | Bypassable via symlinks or shell |
| `shell: true` spawn | Bash tool runs arbitrary commands | **Full host access** via cwd |
| Workspace isolation | Git worktrees or dir copies | Same user, same FS namespace |
| Approval policies | YAML-based tool gating | Advisory — agent can phrase around it |
| Timeouts | 120s bash, 600s external tools | Prevents hangs, not malice |

**Key risk**: The `bash` and `bg_run` tools call `spawn(command, { shell: true })` with the workspace as cwd. A malicious or confused agent can read `~/.ssh`, `~/.aws`, install packages globally, or exfiltrate data.

---

## 1. Container-based Isolation

### 1a. Docker + dockerode (npm)

| Attribute | Value |
|-----------|-------|
| **macOS** | ✅ Docker Desktop (Apple Silicon native) or OrbStack or Colima |
| **Windows** | ✅ Docker Desktop (WSL2 backend) |
| **Node.js integration** | ⭐ `dockerode` — native JS, Promise-based, ~2M downloads/week |
| **Startup** | ~1-3s create+start; `exec()` on warm container ~50ms |
| **Security** | Linux namespaces + cgroups + seccomp; configurable: `NetworkMode`, `ReadonlyRootfs`, `Memory`, `CpuQuota`, `no-new-privileges` |
| **Privilege needed** | Docker daemon runs as root (Desktop handles this); user must be in `docker` group |
| **License** | Docker Engine: Apache-2.0; Docker Desktop: **commercial license** (free for <250 employees or personal/education/OSS) |
| **Maturity** | ★★★★★ Battle-tested, 10+ years |

**Integration pattern**:
```typescript
import Docker from 'dockerode';
const docker = new Docker(); // connects to local socket

// Create sandbox once per session
const container = await docker.createContainer({
  Image: 'node:22-slim',
  Cmd: ['sleep', 'infinity'],
  WorkingDir: '/workspace',
  HostConfig: {
    Binds: [`${workspaceDir}:/workspace`],
    Memory: 512 * 1024 * 1024,
    CpuQuota: 50000,        // 50% of one core
    PidsLimit: 256,
    NetworkMode: 'bridge',   // or 'none' for no network
    ReadonlyRootfs: false,   // workspace needs writes
    SecurityOpt: ['no-new-privileges'],
  },
});
await container.start();

// Execute commands in sandbox
const exec = await container.exec({
  Cmd: ['bash', '-c', command],
  WorkingDir: '/workspace',
  AttachStdout: true,
  AttachStderr: true,
});
const stream = await exec.start({});
// stream stdout/stderr back to agent
```

**Pros**:
- Best cross-platform story
- Excellent Node.js SDK (dockerode)
- Fine-grained resource control
- Filesystem bind mounts work well
- Can pre-pull images, warm container pool for speed

**Cons**:
- Requires Docker daemon installed (user dependency)
- Docker Desktop license for commercial use
- ~100-200MB memory overhead per container
- Container image pull on first use

### 1b. Podman (rootless)

| Attribute | Value |
|-----------|-------|
| **macOS** | ✅ via `podman machine` (runs a Linux VM) |
| **Windows** | ✅ via `podman machine` (WSL2 or HyperV) |
| **Node.js** | `dockerode` works with Podman socket (drop-in compatible API) |
| **Startup** | Similar to Docker (~1-3s) |
| **Security** | Rootless by default — stronger than Docker's default root daemon |
| **Privilege** | No root needed (rootless containers) |
| **License** | Apache-2.0 (fully open source, no commercial restrictions) |
| **Maturity** | ★★★★ Production-ready, Red Hat backed |

**Key advantage**: No license concerns. Same Docker API. Rootless = no daemon running as root.  
**Key disadvantage**: `podman machine` on macOS/Windows adds a Linux VM layer; slightly more setup friction than Docker Desktop.

### 1c. Finch (AWS)

| Attribute | Value |
|-----------|-------|
| **macOS** | ✅ (Lima + containerd + nerdctl) |
| **Windows** | ✅ (WSL2-based) |
| **Node.js** | No native SDK; CLI-based (`finch run ...`) |
| **License** | Apache-2.0 |
| **Maturity** | ★★★ (newer, AWS-backed) |

Less suitable — no programmatic Node.js API, CLI-only.

---

## 2. VM-based Isolation

### 2a. Firecracker

| Attribute | Value |
|-----------|-------|
| **macOS** | ❌ Linux-only (requires KVM) |
| **Windows** | ❌ Linux-only |
| **Security** | ★★★★★ Full VM isolation, minimal attack surface |
| **Startup** | <125ms |
| **License** | Apache-2.0 |

**Verdict**: Strongest isolation but Linux-only. Used by E2B's cloud product. Not viable for cross-platform local dev.

### 2b. gVisor (runsc)

| Attribute | Value |
|-----------|-------|
| **macOS** | ❌ Linux-only |
| **Windows** | ❌ Linux-only |
| **Security** | ★★★★★ Application kernel in userspace; intercepts all syscalls |
| **Integration** | Plug into Docker as `--runtime=runsc` |
| **License** | Apache-2.0 |

**Verdict**: Excellent on Linux servers, not for cross-platform desktop.

### 2c. Lima (macOS)

| Attribute | Value |
|-----------|-------|
| **macOS** | ✅ (QEMU or Apple Virtualization.framework) |
| **Windows** | ⚠️ Experimental WSL2 support |
| **Node.js** | SSH-based; spawn `limactl shell` or SSH client |
| **Startup** | 3-10s (boot a Linux VM) |
| **Security** | Full VM isolation |
| **License** | Apache-2.0 |

**Verdict**: Good for Mac-only dev; too slow for interactive agent use. Better as Docker Desktop alternative (Colima = Lima + Docker).

### 2d. WSL2 (Windows)

| Attribute | Value |
|-----------|-------|
| **Windows** | ✅ Windows 10 2004+ |
| **macOS** | ❌ |
| **Node.js** | `spawn('wsl', ['--', 'bash', '-c', command])` |
| **Startup** | <1s (if distro already running) |
| **Security** | Lightweight VM via Hyper-V; separate Linux kernel |

**Verdict**: Windows-only. Could be used as fallback on Windows when Docker isn't available.

### 2e. Apple Virtualization Framework

| Attribute | Value |
|-----------|-------|
| **macOS** | ✅ macOS 12+ (Apple Silicon native, Intel partial) |
| **Windows** | ❌ |
| **Node.js** | No direct bindings; use via Swift/ObjC bridge or Lima |
| **License** | Proprietary Apple framework |

**Verdict**: Use indirectly via Lima/Colima, not directly from Node.js.

---

## 3. OS-level Sandboxing

### 3a. macOS sandbox-exec (Seatbelt)

| Attribute | Value |
|-----------|-------|
| **macOS** | ✅ All versions (but **deprecated** since macOS 10.15) |
| **Windows** | ❌ |
| **Node.js** | `spawn('sandbox-exec', ['-f', profilePath, '--', 'bash', '-c', cmd])` |
| **Startup** | <10ms (just a process wrapper) |
| **Security** | Configurable: deny file-read/write outside paths, deny network, deny process-exec |
| **Privilege** | No special privileges needed |
| **License** | macOS system utility |

**Example profile** (.sb file):
```scheme
(version 1)
(deny default)
(allow file-read* (subpath "/workspace"))
(allow file-write* (subpath "/workspace"))
(allow file-read* (subpath "/usr"))
(allow file-read* (subpath "/bin"))
(allow file-read* (subpath "/System"))
(allow process-exec)
(allow network-outbound)
(deny file-read* (subpath (param "HOME")))
```

**Pros**: Zero overhead, surgical control, no installation needed.  
**Cons**: **Deprecated** — Apple could remove it. Undocumented profile language. macOS-only.

### 3b. Linux: bubblewrap (bwrap)

| Attribute | Value |
|-----------|-------|
| **Linux** | ✅ All modern Linux (uses namespaces) |
| **macOS** | ❌ |
| **Windows** | ❌ |
| **Node.js** | `spawn('bwrap', ['--ro-bind', '/usr', '/usr', '--bind', workspace, '/workspace', ...])` |
| **Startup** | <10ms |
| **Security** | User namespaces, mount namespaces, PID namespace, seccomp |
| **Privilege** | Unprivileged (user namespaces) |
| **License** | LGPL-2.0+ |

**Verdict**: Best lightweight sandbox on Linux. Used by Flatpak. Not cross-platform.

### 3c. Windows AppContainer

| Attribute | Value |
|-----------|-------|
| **Windows** | ✅ Windows 8+ |
| **macOS** | ❌ |
| **Node.js** | Requires Win32 API calls (FFI or native addon) |
| **Security** | Low-privilege process isolation, deny file/registry/network by default |
| **Privilege** | No admin needed |

**Verdict**: Technically possible but requires C++/FFI bridge from Node.js. Complex integration.

### 3d. Windows Job Objects

| Attribute | Value |
|-----------|-------|
| **Windows** | ✅ All versions |
| **Node.js** | Win32 API via FFI or native addon |
| **Security** | Resource limits only (CPU, memory, process count). No filesystem isolation. |

**Verdict**: Resource limiting only, not true sandboxing.

### 3e. Linux Landlock

| Attribute | Value |
|-----------|-------|
| **Linux** | ✅ Kernel 5.13+ (filesystem), 6.7+ (network) |
| **Others** | ❌ |
| **Node.js** | Syscall via FFI; no mature npm package |
| **Security** | Fine-grained FS path restrictions; unprivileged; stackable |
| **License** | GPL (kernel) |

**Verdict**: Promising on Linux, but too new and Linux-only.

---

## 4. Process-level / Language-level

### 4a. Node.js `--experimental-permission`

| Attribute | Value |
|-----------|-------|
| **Platforms** | ✅ macOS, Windows, Linux (Node 20+, improved in 22+) |
| **Integration** | `spawn('node', ['--experimental-permission', '--allow-fs-read=/workspace', script])` |
| **What it restricts** | `--allow-fs-read`, `--allow-fs-write`, `--allow-child-process`, `--allow-worker` |
| **Security** | Medium — restricts Node.js API calls, not syscalls |
| **Escape risk** | Native addons, WASI, or FFI can bypass |
| **Status** | Experimental (Node 20-22); may change |

**Pros**: Zero dependency, cross-platform, easy to add.  
**Cons**: Only restricts Node.js code, not shell commands spawned from it. Experimental API. Cannot sandbox `bash -c "..."`.

### 4b. isolated-vm (V8 Isolates)

| Attribute | Value |
|-----------|-------|
| **Platforms** | ✅ macOS, Windows, Linux |
| **npm** | `isolated-vm` (~170k downloads/week) |
| **What it does** | Separate V8 heap, memory limits, CPU time limits |
| **Shell exec** | ❌ No — pure JS only, no `child_process`, no `fs`, no `net` |
| **Security** | ★★★★ Strong JS isolation; but OOM can crash host process |
| **License** | ISC |

**Verdict**: Good for evaluating JS expressions safely (e.g., agent-generated data transforms). Cannot replace shell/file sandboxing.

### 4c. Node.js `vm` module

| Attribute | Value |
|-----------|-------|
| **Security** | ❌ **Trivially escapable** — Node.js docs explicitly say "not a security mechanism" |

```javascript
// Escape from vm sandbox:
const ctx = vm.createContext({});
vm.runInContext(`this.constructor.constructor('return process')().exit()`, ctx);
```

**Verdict**: Never use for security. Only for non-adversarial code evaluation.

### 4d. WebAssembly (WASI) Sandboxing

| Attribute | Value |
|-----------|-------|
| **Platforms** | ✅ macOS, Windows, Linux |
| **Runtimes** | Wasmer, Wasmtime, wazero |
| **Node.js** | `@aspect-build/aspect-wasm`, native Node WASI (experimental) |
| **Shell exec** | ❌ No shell; WASI provides limited FS/stdin/stdout |
| **Security** | ★★★★★ Capability-based; only what you explicitly grant |
| **Limitation** | Cannot run arbitrary Node.js or shell commands. Must compile to WASM. |

**Verdict**: Strongest theoretical isolation but cannot run bash commands or Node.js code. Would require compiling tools to WASM — impractical for general agent sandboxing.

---

## 5. Existing AI Agent Sandbox Solutions

### 5a. E2B (e2b.dev)

| Attribute | Value |
|-----------|-------|
| **Type** | Cloud-hosted Firecracker microVMs |
| **Local** | ❌ Cloud-only (self-hosted requires GCP/AWS bare-metal with KVM) |
| **Node.js SDK** | ✅ `@e2b/code-interpreter` (TypeScript) |
| **Shell/FS/Net** | ✅ / ✅ / ✅ |
| **Startup** | ~500ms (warm pool) |
| **Pricing** | Pay-per-use ($0.000225/s = ~$0.81/hr) |
| **License** | Apache-2.0 (SDK + infra repo) |

**Verdict**: Excellent product but cloud-dependent. No practical local option.

### 5b. OpenHands (formerly OpenDevin)

| Attribute | Value |
|-----------|-------|
| **Type** | Docker-based local sandbox for AI coding agents |
| **Local** | ✅ Fully local via Docker |
| **macOS/Windows** | ✅ / ✅ (WSL) |
| **Node.js** | ❌ Python; has REST API you could call |
| **Shell/FS/Net** | ✅ / ✅ / ✅ |
| **License** | MIT |
| **Stars** | 42k+ (most popular OSS AI agent platform) |

**Architecture to study**: Agent ↔ REST API ↔ Docker container. Container has shell, file browser, and even a browser. Clean separation of agent logic and execution environment.

### 5c. SWE-ReX (SWE-agent)

| Attribute | Value |
|-----------|-------|
| **Type** | Pluggable execution backend: local Docker, remote, or plain process |
| **Local** | ✅ |
| **Node.js** | ❌ Python |
| **License** | MIT |

**Architecture to study**: Abstracts execution backend behind a common interface. Agent code doesn't know if it's running in Docker, a remote VM, or locally.

### 5d. Codapi

| Attribute | Value |
|-----------|-------|
| **Type** | Self-hosted code execution server (Go + Docker) |
| **Local** | ✅ Single binary + Docker |
| **Platforms** | ✅ macOS, Windows, Linux |
| **Node.js** | HTTP API (easy to call) |
| **Shell** | ✅ Via shell sandbox |
| **FS** | ⚠️ Per-execution only, no persistence |
| **Network** | ❌ Disabled by default |
| **License** | Source-available (custom) |

**Verdict**: Good for one-shot code execution, not for persistent agent workspaces.

### 5e. Clawker (Claude Code sandbox)

| Attribute | Value |
|-----------|-------|
| **Type** | Docker + Envoy firewall for AI coding agents |
| **Local** | ✅ |
| **Platforms** | macOS, Linux (no Windows) |
| **Node.js** | ❌ Go CLI |
| **Security** | Docker + DNS-level network firewall (deny-by-default with domain allowlist) |
| **License** | MIT |

**Architecture to study**: Network firewall approach — Envoy proxy + CoreDNS for domain-level allow/deny. Better than Docker's all-or-nothing NetworkMode.

### 5f. Code-on-Incus (COI)

| Attribute | Value |
|-----------|-------|
| **Type** | Incus system containers with real-time threat detection |
| **Local** | ✅ |
| **Security** | ★★★★★ Active IDS: reverse shell detection, credential scanning, data exfiltration monitoring |
| **Node.js** | ❌ Go CLI |
| **License** | MIT |

**Architecture to study**: Security monitoring patterns — what threats to detect at runtime.

---

## Recommendation Matrix

### For ppeng-agent-core specifically:

| Criterion | Weight | Docker+dockerode | Podman+dockerode | Node --permission | sandbox-exec (Mac) |
|-----------|--------|-----------------|------------------|-------------------|---------------------|
| macOS support | High | ✅ | ✅ | ✅ | ✅ macOS only |
| Windows support | High | ✅ | ✅ | ✅ | ❌ |
| Shell command sandbox | Critical | ✅ | ✅ | ❌ (Node only) | ✅ |
| File I/O in workspace | Critical | ✅ bind mount | ✅ bind mount | ✅ `--allow-fs-*` | ✅ `file-read*/write*` |
| Network control | Medium | ✅ NetworkMode | ✅ | ❌ | ✅ `network-*` |
| Startup latency | High | ~50ms exec on warm | ~50ms exec on warm | <10ms | <10ms |
| Dependency weight | High | +1 npm pkg | +1 npm pkg | 0 (built-in) | 0 (OS utility) |
| No daemon needed | Medium | ❌ Docker daemon | ❌ Podman machine | ✅ | ✅ |
| Security depth | High | ★★★★ | ★★★★ | ★★ | ★★★ |
| License concerns | Medium | ⚠️ Desktop license | ✅ Apache-2.0 | ✅ MIT | ✅ (deprecated) |
| Maturity | High | ★★★★★ | ★★★★ | ★★ experimental | ★★★ deprecated |

---

## Recommended Architecture: Tiered Sandboxing

Given the project's constraints (minimal deps, cross-platform, shell+file+network), a **tiered approach** is recommended:

```
┌─────────────────────────────────────────────────────┐
│                   Agent Runtime                     │
│                                                     │
│  Tool Call ──► SandboxManager.execute(cmd, opts)    │
│                        │                            │
│                   ┌────▼─────┐                      │
│                   │ Strategy │                      │
│                   │ Selector │                      │
│                   └────┬─────┘                      │
│          ┌─────────────┼──────────────┐             │
│          ▼             ▼              ▼             │
│   ┌────────────┐ ┌──────────┐ ┌─────────────┐      │
│   │  Tier 0    │ │ Tier 1   │ │  Tier 2     │      │
│   │  Direct    │ │ OS-level │ │  Container  │      │
│   │  (current) │ │ sandbox  │ │  (Docker)   │      │
│   │            │ │          │ │             │      │
│   │ spawn()    │ │ Mac:     │ │ dockerode   │      │
│   │ + safePath │ │ sandbox- │ │ container   │      │
│   │            │ │ exec     │ │ .exec()     │      │
│   │ No extra   │ │          │ │             │      │
│   │ deps       │ │ Linux:   │ │ Workspace   │      │
│   │            │ │ bwrap    │ │ bind mount  │      │
│   │            │ │          │ │             │      │
│   │            │ │ Win:     │ │ Resource    │      │
│   │            │ │ (none*)  │ │ limits      │      │
│   └────────────┘ └──────────┘ └─────────────┘      │
│                                                     │
│  * Windows falls back to Tier 0 or Tier 2           │
└─────────────────────────────────────────────────────┘
```

### Implementation Plan

**Phase 1 — Tier 0 hardening (0 dependencies)**
- Add `safePath()` checks to `shellOutput()` cwd
- Restrict PATH in spawned processes (remove user's PATH dirs)
- Strip sensitive env vars (AWS_*, SSH_*, GITHUB_TOKEN, etc.)
- Add `--experimental-permission` for any Node.js sub-processes
- Effort: ~1-2 days

**Phase 2 — Tier 1: OS-level sandbox (0 dependencies)**
- macOS: wrap `spawn()` with `sandbox-exec -f profile.sb` 
- Linux: wrap with `bwrap --ro-bind / / --bind workspace /workspace --unshare-all`
- Windows: fallback to Tier 0 (no good zero-dep option)
- Abstract behind `SandboxProvider` interface
- Effort: ~3-5 days

**Phase 3 — Tier 2: Container sandbox (1 dependency: `dockerode`)**
- Add optional `dockerode` dependency
- Build sandbox Docker image (Node.js + common tools)
- Warm container pool (create on session start, reuse for commands)
- Bind-mount workspace directory
- Configurable: network on/off, resource limits
- Graceful fallback: if Docker not available, use Tier 1 or Tier 0
- Effort: ~5-8 days

### Configuration (`.env`):
```bash
# Sandbox tier: 'auto' | 'direct' | 'os' | 'container'
RAW_AGENT_SANDBOX_MODE=auto

# Container settings (Tier 2)
RAW_AGENT_SANDBOX_IMAGE=ppeng-sandbox:latest
RAW_AGENT_SANDBOX_MEMORY=512m
RAW_AGENT_SANDBOX_CPU=0.5
RAW_AGENT_SANDBOX_NETWORK=bridge  # 'none' | 'bridge' | 'host'

# Auto mode: prefer highest available tier
# auto → tries container → os-level → direct
```

---

## Key Design Decisions

1. **Warm container pattern**: Create container at session start, keep it running, use `exec()` for each command. Avoids 1-3s startup per command.

2. **Bind mount, not copy**: Mount workspace directory into container. Changes are immediately visible to both host and container.

3. **Network policy**: Default to `bridge` (allow network for `web_fetch`). Offer `none` mode for maximum isolation.

4. **Graceful degradation**: Always work without Docker. The sandbox is a safety enhancement, not a hard requirement.

5. **SandboxProvider interface**: Abstract the execution backend so new providers (Podman, remote VMs, etc.) can be added later.

```typescript
interface SandboxProvider {
  name: string;
  available(): Promise<boolean>;
  createSandbox(opts: SandboxOptions): Promise<Sandbox>;
}

interface Sandbox {
  exec(command: string, opts?: ExecOptions): Promise<ExecResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  destroy(): Promise<void>;
}
```
