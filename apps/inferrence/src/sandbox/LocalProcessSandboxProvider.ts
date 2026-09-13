/**
 * LocalProcessSandboxProvider — the dev/test double.
 *
 * This is NOT a security boundary. It spawns `/bin/sh -lc <command>` in a
 * confined temp directory with a wall-clock timeout and an output cap, and it
 * deliberately has no network policy. It exists so the whole run pipeline —
 * orchestration, event emission, SSE — is exercisable offline and so the
 * `SandboxProvider` contract has a second implementation to test against.
 *
 * Production isolation comes from `CloudRunSandboxProvider` (gVisor).
 *
 * POSIX only (`/bin/sh`); the service targets Cloud Run.
 */
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  SandboxCapacityError,
  SandboxNotFoundError,
  SandboxPathError,
  type ExecOptions,
  type ExecResult,
  type SandboxEntry,
  type SandboxHandle,
  type SandboxProvider,
  type SandboxSpec,
} from "./SandboxProvider.js";

const MAX_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

interface LocalSandbox {
  readonly handle: SandboxHandle;
  readonly root: string;
  paused: boolean;
}

export interface LocalProcessSandboxOptions {
  readonly root?: string;
  readonly maxPerInstance?: number;
  readonly defaultTimeoutMs?: number;
}

export class LocalProcessSandboxProvider implements SandboxProvider {
  readonly name = "local";
  readonly #root: string;
  readonly #maxPerInstance: number;
  readonly #defaultTimeoutMs: number;
  readonly #sandboxes = new Map<string, LocalSandbox>();

  constructor(options: LocalProcessSandboxOptions = {}) {
    this.#root = options.root ?? path.join(tmpdir(), "inferrence-sandboxes");
    this.#maxPerInstance = options.maxPerInstance ?? 8;
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async create(spec: SandboxSpec = {}): Promise<SandboxHandle> {
    if (this.#sandboxes.size >= this.#maxPerInstance) {
      throw new SandboxCapacityError(this.#maxPerInstance);
    }
    const id = `sbx_${randomUUID()}`;
    const root = path.join(this.#root, id);
    await mkdir(root, { recursive: true });
    const handle: SandboxHandle = {
      id,
      provider: this.name,
      template: spec.template ?? null,
      createdAt: new Date().toISOString(),
    };
    this.#sandboxes.set(id, { handle, root, paused: false });
    return handle;
  }

  async exec(handle: SandboxHandle, command: string, options: ExecOptions = {}): Promise<ExecResult> {
    const sandbox = this.#require(handle);
    const cwd = options.cwd === undefined ? sandbox.root : this.#resolve(sandbox, options.cwd);
    const timeoutMs = options.timeoutMs ?? this.#defaultTimeoutMs;
    const startedAt = Date.now();

    return await new Promise<ExecResult>((resolve, reject) => {
      const child = spawn("/bin/sh", ["-lc", command], {
        cwd,
        env: { PATH: process.env["PATH"] ?? "", ...options.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let truncated = false;
      let settled = false;

      const collect = (chunk: Buffer, into: "out" | "err"): void => {
        const text = chunk.toString("utf8");
        if (into === "out") {
          options.onStdout?.(text);
          stdout += text;
          if (stdout.length > MAX_OUTPUT_BYTES) {
            stdout = stdout.slice(0, MAX_OUTPUT_BYTES);
            truncated = true;
          }
        } else {
          options.onStderr?.(text);
          stderr += text;
          if (stderr.length > MAX_OUTPUT_BYTES) {
            stderr = stderr.slice(0, MAX_OUTPUT_BYTES);
            truncated = true;
          }
        }
      };

      child.stdout.on("data", (chunk: Buffer) => collect(chunk, "out"));
      child.stderr.on("data", (chunk: Buffer) => collect(chunk, "err"));

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        resolve({
          exitCode: -1,
          stdout,
          stderr: `${stderr}\n[inferrence] command timed out after ${timeoutMs}ms`,
          durationMs: Date.now() - startedAt,
          truncated,
        });
      }, timeoutMs);

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode: code ?? -1,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          truncated,
        });
      });
    });
  }

  async read(handle: SandboxHandle, filePath: string): Promise<string> {
    const sandbox = this.#require(handle);
    return await readFile(this.#resolve(sandbox, filePath), "utf8");
  }

  async write(handle: SandboxHandle, filePath: string, data: string): Promise<void> {
    const sandbox = this.#require(handle);
    const target = this.#resolve(sandbox, filePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, "utf8");
  }

  async list(handle: SandboxHandle, dir = "."): Promise<SandboxEntry[]> {
    const sandbox = this.#require(handle);
    const target = this.#resolve(sandbox, dir);
    const dirents = await readdir(target, { withFileTypes: true });
    const entries: SandboxEntry[] = [];
    for (const dirent of dirents) {
      const info = await stat(path.join(target, dirent.name));
      entries.push({
        name: dirent.name,
        kind: dirent.isDirectory() ? "dir" : "file",
        size: info.size,
      });
    }
    return entries;
  }

  async pause(handle: SandboxHandle): Promise<void> {
    this.#require(handle).paused = true;
  }

  async resume(handle: SandboxHandle): Promise<SandboxHandle> {
    // Deliberately not `#require`: a paused sandbox is exactly what resume is for.
    const sandbox = this.#sandboxes.get(handle.id);
    if (sandbox === undefined) throw new SandboxNotFoundError(handle.id);
    sandbox.paused = false;
    return sandbox.handle;
  }

  async fork(handle: SandboxHandle, count: number): Promise<SandboxHandle[]> {
    // Fan-out needs a real checkpoint primitive; the local double has none, and
    // pretending with a copy would hide the cost of the production path.
    void handle;
    void count;
    throw new Error("fork() needs a checkpoint primitive — see ROADMAP T4.5.");
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    const sandbox = this.#sandboxes.get(handle.id);
    if (sandbox === undefined) return;
    this.#sandboxes.delete(handle.id);
    await rm(sandbox.root, { recursive: true, force: true });
  }

  async healthy(): Promise<boolean> {
    return existsSync("/bin/sh");
  }

  #require(handle: SandboxHandle): LocalSandbox {
    const sandbox = this.#sandboxes.get(handle.id);
    if (sandbox === undefined) throw new SandboxNotFoundError(handle.id);
    if (sandbox.paused) throw new Error(`Sandbox ${handle.id} is paused; resume it first.`);
    return sandbox;
  }

  #resolve(sandbox: LocalSandbox, relative: string): string {
    const absolute = path.resolve(sandbox.root, relative);
    if (absolute !== sandbox.root && !absolute.startsWith(sandbox.root + path.sep)) {
      throw new SandboxPathError(relative);
    }
    return absolute;
  }
}
