/**
 * The sandbox port — our analogue of E2B's `SandboxService`.
 *
 * E2B's orchestrator exposes `Create / Update / List / Delete / Pause / Checkpoint`
 * over gRPC, and an in-VM agent (`envd`) serves the process + filesystem RPC the
 * sandbox actually runs. This port is the same contract flattened into one
 * TypeScript interface, so the control plane never learns which substrate is
 * underneath it:
 *
 *   - `CloudRunSandboxProvider` — Cloud Run sandboxes (gVisor), the production
 *     substrate. Egress is deny-by-default; the rootfs is ephemeral.
 *   - `LocalProcessSandboxProvider` — a dev/test double with no network and a
 *     confined working directory. This is the default in `dry` mode.
 *
 * A sandbox is where untrusted work goes (tool execution, code, parsing). Model
 * calls and policy stay in the control plane.
 */

export interface SandboxHandle {
  readonly id: string;
  readonly provider: string;
  readonly template: string | null;
  readonly createdAt: string;
}

export interface SandboxEntry {
  readonly name: string;
  readonly kind: "file" | "dir";
  readonly size: number;
}

export interface ExecOptions {
  /** Relative to the sandbox root; escapes are rejected. */
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly timeoutMs?: number;
  /** Chunks arrive in order, as produced. */
  readonly onStdout?: (chunk: string) => void;
  readonly onStderr?: (chunk: string) => void;
}

export interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  /** True when output hit the provider's cap and was cut short. */
  readonly truncated: boolean;
}

export interface SandboxSpec {
  /** Pre-baked image/template name. Mirrors E2B's template tags. */
  readonly template?: string;
  readonly ttlMs?: number;
  readonly env?: Record<string, string>;
  /** Hosts the sandbox may reach. Empty (the default) denies all egress. */
  readonly egressAllowlist?: readonly string[];
}

export interface SandboxProvider {
  readonly name: string;

  create(spec?: SandboxSpec): Promise<SandboxHandle>;
  exec(handle: SandboxHandle, command: string, options?: ExecOptions): Promise<ExecResult>;
  read(handle: SandboxHandle, path: string): Promise<string>;
  write(handle: SandboxHandle, path: string, data: string): Promise<void>;
  list(handle: SandboxHandle, dir?: string): Promise<SandboxEntry[]>;
  /** Suspend without destroying state (E2B pause/resume). */
  pause(handle: SandboxHandle): Promise<void>;
  resume(handle: SandboxHandle): Promise<SandboxHandle>;
  /** One-to-many checkpoint, for fanning out parallel specialists. */
  fork(handle: SandboxHandle, count: number): Promise<SandboxHandle[]>;
  destroy(handle: SandboxHandle): Promise<void>;
  /** Reachability probe for `/health`. */
  healthy(): Promise<boolean>;
}

export class SandboxNotFoundError extends Error {
  constructor(id: string) {
    super(`Unknown sandbox ${id} — it was destroyed or never created in this instance.`);
    this.name = "SandboxNotFoundError";
  }
}

export class SandboxCapacityError extends Error {
  constructor(max: number) {
    super(`Sandbox capacity reached (max ${max} per instance). The run is queued, not overcommitted.`);
    this.name = "SandboxCapacityError";
  }
}

export class SandboxPathError extends Error {
  constructor(path: string) {
    super(`Path escapes the sandbox root: ${path}`);
    this.name = "SandboxPathError";
  }
}
