/**
 * RemoteSandboxProvider — sandboxed execution as a **separate service**.
 *
 * Cloud Run sandboxes require the second-generation execution environment, so a
 * gen1 service cannot host them inside its own container. The compromise that
 * keeps gen1's faster cold start for the control plane is a hop: untrusted work
 * runs in the gen2 `sandbox-runner`, and this client speaks to it over HTTP.
 *
 * ## The wire contract the runner must implement
 *
 * ```
 * GET    {base}/health                       → { ok: boolean }
 * POST   {base}/sandbox                      ← SandboxSpec        → SandboxHandle
 * POST   {base}/sandbox/{id}/exec            ← {command, cwd, env, timeoutMs} → ExecResult
 * GET    {base}/sandbox/{id}/file?path=      → { data: string }
 * PUT    {base}/sandbox/{id}/file            ← { path, data }
 * GET    {base}/sandbox/{id}/list?dir=       → { entries: SandboxEntry[] }
 * POST   {base}/sandbox/{id}/pause|resume|fork → { handle(s) }
 * DELETE {base}/sandbox/{id}
 * ```
 *
 * ## Two honest limitations
 *
 * 1. **Output is batched, not streamed.** `onStdout`/`onStderr` are invoked once
 *    with the full output after the call returns, rather than chunk-by-chunk.
 *    The incremental path needs the in-sandbox worker protocol (ROADMAP T4.4);
 *    pretending otherwise would silently break a caller's progress rendering.
 * 2. **The runner is a private Cloud Run service**, so calls need an OIDC
 *    identity token. A token provider is injected rather than hard-wired, so the
 *    token source (metadata server, workload identity, a test stub) is a
 *    deployment detail.
 */
import { HttpError } from "../http.js";
import {
  SandboxNotFoundError,
  type ExecOptions,
  type ExecResult,
  type SandboxEntry,
  type SandboxHandle,
  type SandboxProvider,
  type SandboxSpec,
} from "./SandboxProvider.js";

export interface RemoteSandboxOptions {
  readonly baseUrl: string;
  /** Returns an OIDC identity token for the runner, or undefined when unauthenticated (local dev). */
  readonly tokenProvider?: () => Promise<string | undefined>;
  /** Per-request ceiling; a run-level timeout still bounds the turn. */
  readonly requestTimeoutMs?: number;
}

export class RemoteSandboxProvider implements SandboxProvider {
  readonly name = "remote";
  readonly #base: string;
  readonly #tokenProvider: (() => Promise<string | undefined>) | undefined;
  readonly #timeoutMs: number;

  constructor(options: RemoteSandboxOptions) {
    this.#base = options.baseUrl.replace(/\/+$/, "");
    this.#tokenProvider = options.tokenProvider;
    this.#timeoutMs = options.requestTimeoutMs ?? 60_000;
  }

  async create(spec: SandboxSpec = {}): Promise<SandboxHandle> {
    return await this.#post<SandboxHandle>("/sandbox", spec);
  }

  async exec(handle: SandboxHandle, command: string, options: ExecOptions = {}): Promise<ExecResult> {
    const result = await this.#post<ExecResult>(`/sandbox/${handle.id}/exec`, {
      command,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
    // Batched, not incremental — see the class comment.
    if (result.stdout.length > 0) options.onStdout?.(result.stdout);
    if (result.stderr.length > 0) options.onStderr?.(result.stderr);
    return result;
  }

  async read(handle: SandboxHandle, path: string): Promise<string> {
    const body = await this.#get<{ data: string }>(
      `/sandbox/${handle.id}/file?path=${encodeURIComponent(path)}`,
    );
    return body.data;
  }

  async write(handle: SandboxHandle, path: string, data: string): Promise<void> {
    await this.#send<unknown>("PUT", `/sandbox/${handle.id}/file`, { path, data });
  }

  async list(handle: SandboxHandle, dir = "."): Promise<SandboxEntry[]> {
    const body = await this.#get<{ entries: SandboxEntry[] }>(
      `/sandbox/${handle.id}/list?dir=${encodeURIComponent(dir)}`,
    );
    return body.entries;
  }

  async pause(handle: SandboxHandle): Promise<void> {
    await this.#post<unknown>(`/sandbox/${handle.id}/pause`, {});
  }

  async resume(handle: SandboxHandle): Promise<SandboxHandle> {
    return await this.#post<SandboxHandle>(`/sandbox/${handle.id}/resume`, {});
  }

  async fork(handle: SandboxHandle, count: number): Promise<SandboxHandle[]> {
    const body = await this.#post<{ handles: SandboxHandle[] }>(`/sandbox/${handle.id}/fork`, {
      count,
    });
    return body.handles;
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    await this.#send<unknown>("DELETE", `/sandbox/${handle.id}`, undefined);
  }

  async healthy(): Promise<boolean> {
    try {
      const body = await this.#get<{ ok: boolean }>("/health");
      return body.ok;
    } catch {
      return false;
    }
  }

  async #headers(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = await this.#tokenProvider?.();
    if (token !== undefined) headers["authorization"] = `Bearer ${token}`;
    return headers;
  }

  async #get<T>(path: string): Promise<T> {
    return await this.#request<T>("GET", path, undefined);
  }

  async #post<T>(path: string, body: unknown): Promise<T> {
    return await this.#request<T>("POST", path, body);
  }

  async #send<T>(method: string, path: string, body: unknown): Promise<T> {
    return await this.#request<T>(method, path, body);
  }

  async #request<T>(method: string, path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.#base}${path}`, {
        method,
        headers: await this.#headers(),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      // A transport failure is a dependency failure, not a run failure — the
      // caller decides whether to degrade or abort.
      throw new HttpError(
        "SANDBOX_UNAVAILABLE",
        `The sandbox service is unreachable at ${this.#base}.`,
        { path, reason: error instanceof Error ? error.message : String(error) },
      );
    }

    if (response.status === 404) throw new SandboxNotFoundError(path.split("/")[2] ?? "unknown");
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new HttpError("SANDBOX_UNAVAILABLE", `Sandbox service returned ${response.status}.`, {
        path,
        body: text.slice(0, 300),
      });
    }
    return (await response.json()) as T;
  }
}
