/**
 * CloudRunSandboxProvider — the production substrate (Cloud Run sandboxes).
 *
 * Cloud Run sandboxes are gVisor-backed, run inside the service instance, share
 * its CPU/memory, use an ephemeral tmpfs rootfs, and deny egress by default.
 * They are a good fit for "cheap on Cloud Run + isolated agent sessions" and a
 * close structural match to E2B's per-sandbox microVM model.
 *
 * They are also **Public Preview**, so the whole preview surface is pinned to
 * this one file behind the {@link SandboxProvider} port. When the API/CLI
 * changes, one adapter changes; every caller and every test is untouched.
 *
 * Intentionally unimplemented in the scaffold pass: it cannot be verified
 * offline, and a fake would be worse than an explicit failure. Each method names
 * the roadmap task that fills it in.
 */
import { NotImplementedError } from "../http.js";
import type {
  ExecOptions,
  ExecResult,
  SandboxEntry,
  SandboxHandle,
  SandboxProvider,
  SandboxSpec,
} from "./SandboxProvider.js";

export interface CloudRunSandboxOptions {
  readonly egressAllowlist: readonly string[];
  readonly maxPerInstance: number;
  readonly defaultTtlMs: number;
  /** Sandbox template/image the sessions boot from. */
  readonly template?: string;
}

export class CloudRunSandboxProvider implements SandboxProvider {
  readonly name = "cloudrun";
  readonly #options: CloudRunSandboxOptions;

  constructor(options: CloudRunSandboxOptions) {
    this.#options = options;
  }

  get egressAllowlist(): readonly string[] {
    return this.#options.egressAllowlist;
  }

  async create(_spec?: SandboxSpec): Promise<SandboxHandle> {
    throw new NotImplementedError("Cloud Run sandbox create", "T4.2");
  }

  async exec(_handle: SandboxHandle, _command: string, _options?: ExecOptions): Promise<ExecResult> {
    throw new NotImplementedError("Cloud Run sandbox exec", "T4.2");
  }

  async read(_handle: SandboxHandle, _path: string): Promise<string> {
    throw new NotImplementedError("Cloud Run sandbox read", "T4.2");
  }

  async write(_handle: SandboxHandle, _path: string, _data: string): Promise<void> {
    throw new NotImplementedError("Cloud Run sandbox write", "T4.2");
  }

  async list(_handle: SandboxHandle, _dir?: string): Promise<SandboxEntry[]> {
    throw new NotImplementedError("Cloud Run sandbox list", "T4.2");
  }

  async pause(_handle: SandboxHandle): Promise<void> {
    throw new NotImplementedError("Cloud Run sandbox pause", "T4.5");
  }

  async resume(_handle: SandboxHandle): Promise<SandboxHandle> {
    throw new NotImplementedError("Cloud Run sandbox resume", "T4.5");
  }

  async fork(_handle: SandboxHandle, _count: number): Promise<SandboxHandle[]> {
    throw new NotImplementedError("Cloud Run sandbox fork", "T4.5");
  }

  async destroy(_handle: SandboxHandle): Promise<void> {
    throw new NotImplementedError("Cloud Run sandbox destroy", "T4.2");
  }

  async healthy(): Promise<boolean> {
    // Reporting `true` would make `/health` lie about a substrate that is not wired.
    return false;
  }
}
