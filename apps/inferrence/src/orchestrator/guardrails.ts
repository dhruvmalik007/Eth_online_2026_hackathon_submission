/**
 * Run guardrails: a concurrency limiter, a hard wall-clock timeout, and secret
 * redaction for anything that reaches `AgentStep.raw`.
 *
 * The timeout matters on Cloud Run specifically: the platform request timeout is
 * far longer than a user will wait, so the service must bound a run itself and
 * emit a typed failure rather than hold the instance.
 */
export { redactSecrets } from "../observability/redact.js";

/** Bounds concurrent runs per instance so sandbox/CPU admission stays honest. */
export class RunLimiter {
  #active = 0;

  constructor(private readonly max: number) {}

  acquire(): boolean {
    if (this.#active >= this.max) return false;
    this.#active += 1;
    return true;
  }

  release(): void {
    if (this.#active > 0) this.#active -= 1;
  }

  get active(): number {
    return this.#active;
  }

  get capacity(): number {
    return this.max;
  }
}

export class RunTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Run exceeded its ${timeoutMs}ms budget.`);
    this.name = "RunTimeoutError";
  }
}

/**
 * Race a promise against a wall clock. On timeout the caller's `onTimeout` value
 * is returned; the losing promise is expected to observe `signal`.
 */
export async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new RunTimeoutError(timeoutMs));
        }, timeoutMs);
        signal.addEventListener("abort", () => reject(new RunTimeoutError(timeoutMs)), {
          once: true,
        });
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
