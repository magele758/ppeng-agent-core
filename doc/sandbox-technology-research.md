# Sandbox / Isolation Technologies for AI Agent Code Execution

**Research Date:** 2025-01  
**Purpose:** Evaluate technologies for safely running AI-generated code in isolated environments, with focus on cross-platform support (macOS + Windows), Node.js integration, and interactive agent use (fast startup).

---

## Executive Summary

| Technology | macOS | Windows | Startup | Security | Node.js Integration | License | Recommendation |
|---|---|---|---|---|---|---|---|
| **Docker Desktop** | ✅ Apple Silicon | ✅ (WSL2/Hyper-V) | ~1-2s (exec) | Medium-High | Excellent (dockerode) | Commercial* | ⭐ Best overall for cross-platform |
| **Podman** | ✅ (podman machine) | ✅ (WSL2) | ~1-2s (exec) | Medium-High (rootless) | Moderate (REST API) | Apache-2.0 | ⭐ Best OSS alternative |
| **Finch** | ✅ (Lima-based) | ✅ (WSL2) | ~1-2s (exec) | Medium-High | Low (CLI only) | Apache-2.0 | Niche; CLI wrapper |
| **Firecracker** | ❌ Linux-only | ❌ Linux-only | <125ms | Very High | Moderate (REST API) | Apache-2.0 | Best for Linux servers |
| **gVisor** | ❌ Linux-only | ❌ Linux-only | <100ms | High | Low (OCI runtime) | Apache-2.0 | Good Linux-only option |
| **QEMU** | ✅ (HVF accel) | ✅ (WHPX accel) | 2-10s | Very High | Low (QMP protocol) | GPL-2.0 | Heavy; foundation layer |
| **Lima** | ✅ Primary target | ⚠️ Experimental (WSL2) | 10-30s (boot) | High | Moderate (CLI/SSH) | Apache-2.0 | Great macOS dev tool |
| **WSL2** | ❌ | ✅ Windows-only | <1s (warm) | Medium | Good (wsl.exe IPC) | Proprietary | Best Windows-native option |
| **Apple Virtualization.framework** | ✅ macOS 12+ only | ❌ | 1-3s | Very High | Very Low (Swift FFI) | Proprietary | Foundation; use via Lima |

\* Docker Desktop is free for small businesses (<250 employees AND <$10M revenue), personal, education, and OSS use. Paid subscription required for larger commercial use.

---

## 1. Docker Desktop

### Platform Support
- **macOS:** Full support including Apple Silicon (M1/M2/M3/M4). Uses Apple Virtualization.framework or QEMU under the hood. Native ARM64 containers plus Rosetta 2 emulation for x86_64 images.
- **Windows:** Full support via WSL2 backend (recommended) or Hyper-V. Can toggle between Linux and Windows containers.
- **Linux:** Supported (though Docker Engine alone is often preferred on Linux).

### Node.js Integration (Complexity: LOW ⭐)
The **dockerode** npm package is the gold standard:
```js
const Docker = require('dockerode');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Run a command in a new container
const container = await docker.createContainer({
  Image: 'node:20-slim',
  Cmd: ['node', '-e', 'console.log("hello")'],
  HostConfig: {
    Binds: ['/host/workspace:/workspace:rw'],
    Memory: 256 * 1024 * 1024,    // 256MB
    NanoCpus: 1e9,                 // 1 CPU
    NetworkMode: 'none',           // no network
  },
  WorkingDir: '/workspace',
});
await container.start();
// Stream stdout/stderr
const stream = await container.logs({ follow: true, stdout: true, stderr: true });
container.modem.demuxStream(stream, process.stdout, process.stderr);
await container.wait();
await container.remove();
```
- **dockerode**: 14k+ GitHub stars, actively maintained, full Docker Engine API coverage.
- Supports promises and callbacks, stream demuxing for stdout/stderr.
- Connection: Unix socket (macOS/Linux) or named pipe (Windows).

### Performance
- **Container startup:** ~300ms-1s for a pre-pulled minimal image (alpine/slim). First pull adds download time.
- **Exec into running container:** <100ms (reuse a warm container instead of create/destroy per command).
- **Memory overhead:** ~6-30MB per container (minimal image), plus the Docker Desktop VM (~2GB base).
- **Filesystem bind mounts:** Native-like on Linux. On macOS uses VirtioFS (macOS 12.5+) — near-native speed. On Windows via WSL2, good performance within WSL filesystem, slower across filesystem boundaries.

### Strategy for Interactive Agent Use
Use a **warm container pool** pattern:
1. Pre-create containers with workspace bind-mounted.
2. Use `container.exec()` to run commands (sub-100ms).
3. Capture stdout/stderr streams.
4. Recycle or destroy containers after session ends.

### Resource Limits
- CPU: `NanoCpus`, `CpuQuota`, `CpuPeriod`, `CpuShares`
- Memory: `Memory`, `MemorySwap`
- Network: `NetworkMode: 'none'` to fully isolate, or custom network policies.
- PID limit: `PidsLimit`
- Read-only root filesystem: `ReadonlyRootfs: true`
- Security: `SecurityOpt`, AppArmor/SELinux profiles, `--cap-drop ALL`

### Security Level: **MEDIUM-HIGH**
- Namespace isolation (PID, network, mount, user).
- Cgroup resource limits. Seccomp profiles.
- Shared kernel (host kernel) — container escapes theoretically possible but rare.
- Not as strong as VM-based isolation.

### License
- **Docker Engine:** Apache-2.0 (open source, always free).
- **Docker Desktop:** Requires paid subscription for commercial use in organizations ≥250 employees OR ≥$10M revenue. Free for personal, education, small business, and OSS.
- **dockerode:** Apache-2.0.

### Maturity: **VERY HIGH** — Industry standard. Massive ecosystem. Battle-tested at scale.

---

## 2. Podman

### Platform Support
- **macOS:** Supported via `podman machine` which creates a Linux VM. Default provider on macOS is **libkrun** (lightweight). Also supports `applehv` (Apple Virtualization.framework). Apple Silicon fully supported.
- **Windows:** Supported via `podman machine` using **WSL2** (default) or **Hyper-V** as backend.
- **Linux:** Native, rootless out-of-the-box (no daemon required).

### Key Difference from Docker
- **Daemonless:** No persistent background daemon — each `podman` command is a direct process fork.
- **Rootless by default:** Runs containers as non-root user using user namespaces.
- **Docker-compatible CLI:** Drop-in replacement for most Docker commands (`alias docker=podman`).
- **On macOS/Windows:** Still requires a VM (like Docker Desktop), but the VM is managed by `podman machine` and uses less resources.

### Node.js Integration (Complexity: MODERATE)
No widely-adopted "podmandode" npm package. Options:
1. **Podman REST API** (Docker-compatible): Podman exposes a Docker-compatible API. **dockerode can connect to Podman's API socket**.
   ```js
   // Podman's socket path (macOS with podman machine)
   const docker = new Docker({
     socketPath: `${process.env.HOME}/.local/share/containers/podman/machine/podman.sock`
   });
   // Use exactly like Docker!
   ```
2. **Child process:** Spawn `podman` CLI commands from Node.js.
3. **podman-node** (community): Small, less mature packages exist.

### Performance
- Similar to Docker for container operations (same OCI runtime underneath — typically `crun` or `runc`).
- `podman machine` VM startup: 10-30s on first boot, near-instant on warm start.
- Container exec: <100ms.

### Security Level: **MEDIUM-HIGH** (slightly better than Docker due to rootless-first design)
- User namespace mapping by default — compromised container only has unprivileged user access.
- No root daemon to attack.
- Same kernel-sharing limitation as Docker.

### License: **Apache-2.0** — Fully open source. No commercial license restrictions.

### Maturity: **HIGH** — Backed by Red Hat. Production-grade. Growing adoption.

---

## 3. Finch (AWS Open Source)

### Platform Support
- **macOS:** Intel + Apple Silicon. Uses **Lima** (which uses QEMU or Apple Virtualization.framework) to run a Linux VM with containerd + nerdctl + BuildKit.
- **Windows:** Supported (AMD64 only, requires WSL2). Uses WSL2 backend.
- **Linux:** Supported (Amazon Linux primarily; generic Linux experimental).

### Architecture
Finch is a **CLI wrapper** that bundles: Lima → containerd → nerdctl → BuildKit. It's an opinionated distribution, not a new runtime.

### Node.js Integration (Complexity: HIGH)
- No API socket or library — Finch is CLI-only.
- Must spawn `finch` CLI as child process.
- No Docker-compatible API (uses nerdctl syntax, which is Docker-like CLI but not API-compatible).
- Workaround: Access the underlying containerd socket in the Lima VM, but this is fragile.

### Performance
- Same as Lima + containerd underneath.
- VM init: ~60s first time, ~10-20s subsequent boots.
- Container operations: Similar to Docker/Podman once VM is running.

### Security Level: **MEDIUM-HIGH** — Same as containers running in a Lima VM.

### License: **Apache-2.0**

### Maturity: **MEDIUM** — Relatively new (launched 2022). Backed by AWS. Active development but smaller community than Docker/Podman.

### Verdict for Agent Use
**Not recommended as primary choice.** CLI-only integration is too limiting. Use Docker or Podman instead, which Finch is built on top of anyway.

---

## 4. Firecracker

### Platform Support
- **macOS:** ❌ **NOT SUPPORTED.** Firecracker requires Linux KVM. macOS does not have KVM.
- **Windows:** ❌ **NOT SUPPORTED.** Same reason — requires Linux KVM.
- **Linux:** ✅ Full support. x86_64 and aarch64. Requires bare-metal or `.metal` cloud instances (no nested virtualization).

### Architecture
Lightweight VMM (Virtual Machine Monitor) that creates **microVMs** using KVM. Each microVM has its own kernel, providing true VM-level isolation with container-like performance.

### Performance (on Linux)
- **Startup time:** <125ms to boot a full microVM.
- **Memory overhead:** <5 MiB per microVM.
- **Density:** Thousands of microVMs on a single host.
- Near-native CPU and I/O performance (hardware virtualization, no emulation).

### Node.js Integration (Complexity: MODERATE)
Firecracker exposes a **RESTful API** via Unix socket:
```js
// Configure and start a microVM via HTTP
const res = await fetch('http://localhost/actions', {
  method: 'PUT',
  body: JSON.stringify({ action_type: 'InstanceStart' }),
  // via Unix socket adapter
});
```
- Mount workspace: Via virtio-block device or shared filesystem.
- Command execution: SSH into the microVM or use virtio-vsock.
- Rate limiters: Built-in for network and storage (API-configurable).

### Resource Limits
- vCPUs: Configurable per microVM.
- Memory: Configurable per microVM (minimum ~8MB).
- Network rate limiting: Built-in.
- Storage rate limiting: Built-in.

### Security Level: **VERY HIGH**
- Full hardware VM isolation (KVM). Separate kernel per sandbox.
- Minimal attack surface (only 5 emulated devices).
- Jailer companion for additional userspace isolation (seccomp, cgroups, chroot).
- Used by AWS Lambda and AWS Fargate in production.

### License: **Apache-2.0**

### Maturity: **VERY HIGH** — Battle-tested at massive scale (AWS Lambda). Active development.

### Verdict for Agent Use
**Excellent for Linux server deployments** (e.g., cloud-hosted agent runtime). Not viable for developer desktop use on macOS/Windows.

---

## 5. gVisor

### Platform Support
- **macOS:** ❌ **NOT SUPPORTED.** Requires Linux kernel.
- **Windows:** ❌ **NOT SUPPORTED.** Requires Linux kernel.
- **Linux:** ✅ Full support. Platforms: `systrap` (default, runs anywhere), `kvm` (requires KVM access for better performance).

### Architecture
Application kernel written in Go. Intercepts syscalls in userspace — acts as a "guest kernel" without hardware virtualization. Provides OCI-compatible runtime `runsc`.

### Performance
- **Startup:** <100ms (no VM boot — it's a process, not a VM).
- **Memory overhead:** Low (thread/memory-mapping based, not fixed resources).
- **Syscall overhead:** 10-50% overhead on syscall-heavy workloads. Negligible for compute-heavy work.
- **Caveat:** Some syscalls not fully implemented; ~380/~450 Linux syscalls supported.

### Node.js Integration (Complexity: MODERATE)
- Works as a Docker runtime — install `runsc`, configure Docker to use it.
- From Node.js: Use **dockerode** with Docker configured to use `runsc` runtime:
  ```js
  const container = await docker.createContainer({
    Image: 'node:20-slim',
    HostConfig: { Runtime: 'runsc' }
  });
  ```
- Alternatively use directly via OCI runtime commands.

### Security Level: **HIGH**
- Syscall interception in userspace — host kernel surface greatly reduced.
- Defense-in-depth with seccomp on the sentry process itself.
- Not full VM isolation but significantly stronger than plain containers.

### License: **Apache-2.0** (Google-maintained)

### Maturity: **HIGH** — Used in Google Cloud Run, GKE Sandbox. Production-proven.

### Verdict for Agent Use
**Great for Linux deployments** as a Docker runtime upgrade (trivial to add on top of dockerode). Not usable on macOS/Windows.

---

## 6. QEMU Micro-VMs

### Platform Support
- **macOS:** ✅ Supported. Uses **HVF** (Hypervisor.framework) for hardware acceleration on Apple Silicon and Intel. Available via Homebrew (`brew install qemu`).
- **Windows:** ✅ Supported. Uses **WHPX** (Windows Hypervisor Platform) for acceleration. Also available as MSYS2 package.
- **Linux:** ✅ Full support with KVM acceleration.

### Architecture
Full machine emulator/virtualizer. The `microvm` machine type is a lightweight QEMU machine designed for fast boot with minimal devices (inspired by Firecracker). Available since QEMU 4.0+.

### Performance
- **Startup (microvm machine type):** ~2-5s with KVM on Linux. ~3-10s on macOS with HVF.
- **Memory overhead:** Configurable; minimum ~32-64MB for a functional Linux guest.
- **Full emulation mode:** Much slower (no hardware accel) — avoid for production.

### Node.js Integration (Complexity: HIGH)
- No dedicated npm package.
- Integration via:
  1. **Child process:** Spawn `qemu-system-*` with arguments.
  2. **QMP (QEMU Machine Protocol):** JSON-over-socket protocol for controlling VMs.
  3. **SSH/serial:** Execute commands inside the VM.
- Workspace mounting: 9p virtfs, or create a virtual disk image.
- Stdout/stderr: Via serial console or SSH.

### Resource Limits
- vCPUs: `-smp N`
- Memory: `-m SIZE`
- Network: User-mode (SLIRP), TAP devices, or no networking.
- Disk: Backing file with size limits.

### Security Level: **VERY HIGH** — Full hardware VM isolation.

### License: **GPL-2.0** (important — GPL may affect distribution of derived works)

### Maturity: **VERY HIGH** — The most mature open-source virtualizer. Decades of development.

### Verdict for Agent Use
**Too heavy for interactive agent use.** Startup and complexity overhead is significant. Better used indirectly through Lima or Podman which wrap QEMU with user-friendly APIs.

---

## 7. Lima

### Platform Support
- **macOS:** ✅ **Primary target.** Uses Apple Virtualization.framework (`vz` vmType, default on Lima ≥1.0 on macOS ≥13.5) or QEMU. Full Apple Silicon support.
- **Windows:** ⚠️ **Experimental** via WSL2 backend (Lima ≥0.18). Not production-ready on Windows.
- **Linux:** ✅ Supported via QEMU with KVM.
- **Other:** NetBSD also supported.

### Architecture
Lima = "Linux Machines". Creates Linux VMs with automatic:
- File sharing (host → guest): virtiofs (VZ), 9p (QEMU), reverse-sshfs
- Port forwarding (guest → host)
- Comes with containerd + nerdctl by default

### Mount Types (Host Filesystem Access)
| Mount Type | Backend | Performance | Requirements |
|---|---|---|---|
| **virtiofs** | Apple VZ framework | ⭐ Near-native | macOS 13+, `vmType: vz` |
| **9p** | QEMU virtio-9p | Good | QEMU, Lima ≥0.10 |
| **reverse-sshfs** | SFTP over SSH | Moderate | Any |
| **wsl2** | WSL2 native sharing | Good | Windows |

### Performance
- **VM boot time:** ~10-30s (first boot); ~3-10s (subsequent, depending on vmType).
- **VZ vmType on macOS:** Faster boot (~3-5s) compared to QEMU.
- **Command execution:** Via `lima <command>` (SSH-based), adds ~100-200ms latency per command.
- **File I/O:** virtiofs is near-native. 9p and sshfs are slower.

### Node.js Integration (Complexity: MODERATE)
```js
const { execFile } = require('child_process');

// Run command in Lima VM
execFile('limactl', ['shell', 'default', '--', 'node', '-e', 'console.log("hi")'],
  (err, stdout, stderr) => {
    console.log(stdout); // "hi"
  }
);
```
- Alternative: SSH directly into the Lima VM (port is discoverable).
- Alternative: Install Docker in Lima and use dockerode against the Docker socket inside.
- Alternative: Use nerdctl inside Lima and forward the containerd socket.

### Security Level: **HIGH** — Full VM isolation (separate Linux kernel).

### License: **Apache-2.0** — CNCF Incubating project.

### Maturity: **HIGH** — Widely adopted. Powers Colima, Finch, Rancher Desktop, Podman Desktop.

### Verdict for Agent Use
**Good for macOS development** as a foundation layer. For agent sandboxing, run Docker/Podman inside Lima and use dockerode. The extra VM layer adds security but also latency and complexity.

---

## 8. WSL2 (Windows Subsystem for Linux 2)

### Platform Support
- **macOS:** ❌ Not available.
- **Windows:** ✅ Windows 10 (Build 19041+), Windows 11. Ships with Windows.
- **Linux:** ❌ Not applicable.

### Architecture
Lightweight utility VM running a real Linux kernel. Managed by Windows. Distros run as isolated containers within the WSL2 VM. Shares networking, CPU, memory with host.

### Performance
- **Distro startup:** <1s (warm), ~2-5s (cold).
- **Command execution:** `wsl.exe <command>` — very fast IPC.
- **File I/O:** Linux filesystem (ext4) is fast. Cross-filesystem access (`/mnt/c/`) uses 9P protocol — significantly slower.

### Node.js Integration (Complexity: LOW-MODERATE)
```js
const { execFile } = require('child_process');

// Run command inside WSL
execFile('wsl.exe', ['-d', 'Ubuntu', '--', 'node', '-e', 'console.log("hi")'],
  (err, stdout, stderr) => {
    console.log(stdout); // "hi"
  }
);
```
- Can install Docker inside WSL2 and use dockerode from Windows Node.js against the WSL2 Docker socket.
- File sharing: Windows files accessible at `/mnt/c/`. WSL files accessible at `\\wsl$\` from Windows.

### Resource Limits
- Memory: Configurable via `.wslconfig` (`memory=4GB`).
- CPU: Configurable via `.wslconfig` (`processors=2`).
- Swap: Configurable.
- Network: Shares host network by default (NAT mode); mirrored networking available in Windows 11 23H2+.
- Per-distro limits: Limited (all distros share the same WSL2 VM kernel).

### Security Level: **MEDIUM**
- VM-level isolation from Windows host.
- But all WSL2 distros share the same kernel and VM.
- File system boundary is somewhat porous (cross-OS file access).
- Not designed as a security sandbox — designed for developer convenience.

### License: **Proprietary** (Windows component). WSL itself is open source on GitHub but requires Windows.

### Maturity: **VERY HIGH** — Shipped by Microsoft. Millions of users.

### Verdict for Agent Use
**Excellent as a Windows building block.** Run Docker inside WSL2 and use dockerode for the sandboxing layer. Don't rely on WSL2 alone for security isolation.

---

## 9. Apple Virtualization Framework

### Platform Support
- **macOS:** ✅ macOS 12+ (Monterey). Full Apple Silicon support with native performance. Intel Mac support with hardware virtualization.
- **Windows/Linux:** ❌ Apple-only.

### Architecture
Apple's native hypervisor API for creating VMs. Supports:
- Linux VMs (VZLinuxBootLoader)
- macOS VMs (macOS 13+ only)
- VirtIO devices (network, storage, filesystem sharing via virtiofs, etc.)
- Rosetta 2 translation for running x86_64 Linux binaries on ARM

### Performance
- **VM boot:** 1-3s for a minimal Linux kernel.
- **I/O:** VirtioFS for near-native file sharing performance.
- **CPU:** Near-native (hardware virtualization).
- **Memory:** Configurable, balloon driver support.

### Node.js Integration (Complexity: VERY HIGH ❌)
- **No direct Node.js access.** The framework is a **Swift/Objective-C API**.
- To use from Node.js, you would need:
  1. Write a Swift wrapper binary → communicate via IPC (stdin/stdout, Unix socket, or gRPC).
  2. Use a native Node.js addon (N-API) that calls into the framework via Objective-C bridge.
  3. **Recommended:** Use **Lima** (which wraps Virtualization.framework with `vmType: vz`) and interact via CLI/SSH from Node.js.

### Resource Limits
- vCPUs: Configurable via API.
- Memory: Configurable via API (with balloon device).
- Network: VirtIO network device, NAT or bridged.
- Disk: VirtIO block device.

### Security Level: **VERY HIGH** — Full hardware VM isolation. Apple-managed hypervisor.

### License: **Proprietary** (Apple framework, part of macOS SDK). Free to use on macOS.

### Maturity: **HIGH** — Production-ready. Used by Lima, Docker Desktop, UTM, Parallels.

### Verdict for Agent Use
**Don't use directly.** Use via Lima (`vmType: vz`) which provides a much better developer experience and CLI/SSH integration.

---

## Recommended Architecture for Cross-Platform Agent Sandbox

### Tier 1: Primary Recommendation — Docker + dockerode

```
┌─────────────────────────────────────┐
│         Node.js Agent Runtime       │
│         (dockerode npm package)     │
└──────────────┬──────────────────────┘
               │ Docker Engine API
               │ (Unix socket / named pipe)
┌──────────────▼──────────────────────┐
│         Docker Engine               │
│  ┌─────────────────────────────┐    │
│  │  Sandbox Container (warm)   │    │
│  │  • Node.js + tools          │    │
│  │  • /workspace bind mount    │    │
│  │  • NetworkMode: none        │    │
│  │  • Memory: 256MB cap        │    │
│  │  • CPU: 1 core cap          │    │
│  │  • ReadonlyRootfs: true     │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

**Why Docker:**
1. **Cross-platform:** macOS (Docker Desktop / Colima), Windows (Docker Desktop / WSL2), Linux (Docker Engine).
2. **dockerode:** Best-in-class Node.js SDK. 14k+ stars, actively maintained, full API coverage.
3. **Warm container pattern:** Pre-create containers, use `exec` for <100ms command execution.
4. **Resource limits:** Fine-grained CPU, memory, network, PID limits.
5. **Ecosystem:** Largest container image ecosystem. Pre-built images for any language/tool.
6. **Maturity:** Most battle-tested container platform.

**License concern mitigation:**
- For commercial use in large orgs: Use **Colima** (free, Apache-2.0) or **Podman** instead of Docker Desktop. dockerode works with Podman's Docker-compatible API.
- Docker Engine itself is Apache-2.0 — only Docker Desktop has commercial licensing.

### Tier 2: Enhanced Security (Linux servers)

For cloud-hosted agent runtime where security is paramount:
- **Docker + gVisor (`runsc`):** Drop-in runtime upgrade. Just add `Runtime: 'runsc'` in dockerode container config.
- **Firecracker:** If you need VM-level isolation with <125ms startup. Requires more integration work.

### Tier 3: License-Free Alternative — Podman

If Docker Desktop license is a concern:
- Use **Podman** with `podman machine` on macOS/Windows.
- Connect dockerode to Podman's Docker-compatible API socket.
- Same container workflow, no license fees, rootless-first security.

---

## Quick Reference: Integration Code Patterns

### Docker: Run sandboxed command and capture output
```js
const Docker = require('dockerode');
const docker = new Docker();

async function runSandboxed(image, cmd, workspaceDir) {
  const container = await docker.createContainer({
    Image: image,
    Cmd: cmd,
    WorkingDir: '/workspace',
    HostConfig: {
      Binds: [`${workspaceDir}:/workspace:rw`],
      Memory: 256 * 1024 * 1024,
      NanoCpus: 1e9,
      NetworkMode: 'none',
      ReadonlyRootfs: false,
      PidsLimit: 100,
      SecurityOpt: ['no-new-privileges'],
    },
    Tty: false,
  });

  await container.start();

  // Collect output
  const logs = await container.logs({ follow: true, stdout: true, stderr: true });
  let stdout = '', stderr = '';
  container.modem.demuxStream(logs, 
    { write: (d) => stdout += d.toString() },
    { write: (d) => stderr += d.toString() }
  );

  const { StatusCode } = await container.wait();
  await container.remove();
  return { exitCode: StatusCode, stdout, stderr };
}
```

### Docker: Warm container with exec (fastest)
```js
async function execInContainer(container, cmd) {
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start();
  let stdout = '', stderr = '';
  container.modem.demuxStream(stream,
    { write: (d) => stdout += d.toString() },
    { write: (d) => stderr += d.toString() }
  );
  return new Promise((resolve) => {
    stream.on('end', async () => {
      const { ExitCode } = await exec.inspect();
      resolve({ exitCode: ExitCode, stdout, stderr });
    });
  });
}
```

### WSL2 (Windows): Run command
```js
const { execFile } = require('child_process');
function runInWSL(distro, cmd) {
  return new Promise((resolve, reject) => {
    execFile('wsl.exe', ['-d', distro, '--', ...cmd],
      { timeout: 30000 },
      (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      }
    );
  });
}
```

---

## Decision Matrix: Choosing by Constraint

| Constraint | Best Choice |
|---|---|
| Must work on macOS + Windows | Docker (dockerode) or Podman |
| No commercial license fees | Podman or Docker Engine + Colima |
| Maximum security (Linux server) | Firecracker or Docker + gVisor |
| Fastest startup (interactive) | Docker exec (~50ms) or gVisor (~100ms) |
| Minimum memory per sandbox | Firecracker (<5MB) or gVisor |
| Simplest Node.js integration | Docker (dockerode) |
| Windows-only deployment | WSL2 + Docker inside WSL |
| macOS-only deployment | Lima (vz) + Docker inside, or Docker Desktop |

---

## Appendix: Version & Link Reference

| Technology | Latest Version (2024-25) | Primary Link |
|---|---|---|
| Docker Desktop | 4.37+ | https://docs.docker.com/desktop/ |
| dockerode | 4.x | https://github.com/apocas/dockerode |
| Podman | 5.x | https://podman.io/ |
| Finch | 1.5+ | https://github.com/runfinch/finch |
| Firecracker | 1.10+ | https://firecracker-microvm.github.io/ |
| gVisor | 2024+ (rolling) | https://gvisor.dev/ |
| QEMU | 9.x | https://www.qemu.org/ |
| Lima | 1.0+ | https://lima-vm.io/ |
| WSL2 | 2.x | https://learn.microsoft.com/windows/wsl/ |
| Apple Virtualization | macOS 12+ SDK | https://developer.apple.com/documentation/virtualization |
