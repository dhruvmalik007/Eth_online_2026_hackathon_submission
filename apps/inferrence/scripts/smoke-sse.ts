/**
 * CLI smoke client — the secondary consumer, for testing without the browser.
 *
 * The primary consumer is `apps/agentic-ems` (it proxies the same SSE stream).
 * This exists so the streaming contract can be exercised from a terminal:
 *
 *   pnpm --filter @ethonline2026/inferrence smoke -- --query "rebalance into the best 30d yield"
 *   INFERENCE_URL=https://inferrence-…run.app pnpm --filter @ethonline2026/inferrence smoke
 *
 * `--follow` keeps the connection open past the turn so `approval.resolved` is
 * printed too; without it the stream closes on `run.completed`.
 */

const DEFAULT_URL = process.env["INFERENCE_URL"] ?? "http://localhost:8080";

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

interface WireEvent {
  readonly seq: number;
  readonly type: string;
  readonly [key: string]: unknown;
}

function render(frame: string): void {
  if (frame.startsWith(":")) {
    process.stdout.write("· heartbeat\n");
    return;
  }
  const data = frame.split("\n").find((line) => line.startsWith("data: "));
  if (data === undefined) return;
  const event = JSON.parse(data.slice("data: ".length)) as WireEvent;
  const step = event["step"] as { id?: string; agent?: string; call?: string; state?: string } | undefined;

  switch (event.type) {
    case "message.delta":
      process.stdout.write(String(event["text"] ?? ""));
      break;
    case "message.completed":
      process.stdout.write("\n");
      break;
    case "step.start":
    case "step.completed":
      process.stdout.write(
        `  [${String(event.seq).padStart(3)}] ${event.type.padEnd(15)} ${step?.agent ?? "?"} · ${step?.call ?? "?"} → ${step?.state ?? "?"}\n`,
      );
      break;
    case "widget":
      process.stdout.write(`  [${String(event.seq).padStart(3)}] widget          ${String((event["widget"] as { kind?: string })?.kind ?? "?")}\n`);
      break;
    case "approval.requested": {
      const intent = event["intent"] as { intentId?: string; display?: { sentence?: string } } | undefined;
      process.stdout.write(
        `  [${String(event.seq).padStart(3)}] APPROVAL        ${intent?.intentId ?? "?"}\n      ${intent?.display?.sentence ?? ""}\n`,
      );
      break;
    }
    case "approval.resolved":
      process.stdout.write(`  [${String(event.seq).padStart(3)}] approval        ${String(event["outcome"])}\n`);
      break;
    case "error":
      process.stdout.write(`  [${String(event.seq).padStart(3)}] ERROR           ${String(event["code"])}: ${String(event["message"])}\n`);
      break;
    case "run.completed":
      process.stdout.write(`  [${String(event.seq).padStart(3)}] run.completed   state=${String(event["state"])} — ${String(event["summary"])}\n`);
      break;
    default:
      process.stdout.write(`  [${String(event.seq).padStart(3)}] ${event.type}\n`);
  }
}

async function main(): Promise<void> {
  const baseUrl = flag("url", DEFAULT_URL).replace(/\/+$/, "");
  const userId = flag("user", "cli-smoke-user");
  const mode = flag("mode", "v01");
  const query = flag("query", "rebalance my USDC into the best 30d yield");
  const follow = process.argv.includes("--follow");
  const headers = { "content-type": "application/json", "x-user-id": userId };

  const sessionResponse = await fetch(`${baseUrl}/v1/sessions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ agent: mode }),
  });
  if (!sessionResponse.ok) {
    throw new Error(`create session → ${sessionResponse.status} ${await sessionResponse.text()}`);
  }
  const { session } = (await sessionResponse.json()) as { session: { sessionId: string } };
  process.stdout.write(`session ${session.sessionId}\n`);

  const turnResponse = await fetch(`${baseUrl}/v1/sessions/${session.sessionId}/turns`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, mode, follow, dry: true }),
  });
  if (!turnResponse.ok || turnResponse.body === null) {
    throw new Error(`turn → ${turnResponse.status} ${await turnResponse.text()}`);
  }
  process.stdout.write(`run     ${turnResponse.headers.get("x-inference-run-id") ?? "(unknown)"}\n\n`);

  const reader = turnResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      render(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
