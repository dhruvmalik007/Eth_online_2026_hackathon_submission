#!/usr/bin/env node
/**
 * production-pipeline — the live path, stage by stage, against the real HTTP API.
 *
 * This is the **production reference** for the inference service: one runnable script
 * that walks the five stages of a real turn and prints the artifact each one produces,
 * naming the endpoint or event that carries it. It is HTTP-only on purpose — it
 * exercises exactly what `apps/agentic-ems` exercises, so it doubles as the contract
 * documentation and as the thing to reach for when the desk misbehaves.
 *
 *   # against the deployed service (private; needs an identity token)
 *   INFERENCE_URL=https://inferrence-….run.app \
 *     pnpm --filter @ethonline2026/inferrence exec tsx scripts/production-pipeline.ts --gcloud
 *
 *   # against a local dev server
 *   pnpm --filter @ethonline2026/inferrence exec tsx scripts/production-pipeline.ts
 *
 * The five stages, and where each one's artifact comes from:
 *
 *   1. agent inference            POST /v1/sessions → POST /v1/sessions/:id/turns
 *   2. agent response             the turn's `message.delta` → `message.completed`
 *   3. response → intent          the turn's `approval.requested` envelope
 *   4. Web3 population            each leg resolved against the settlement registry
 *   5. approval payload           EIP-712 typed data + digest → POST …/approve
 *
 * Stages 1 and 2 share one HTTP call: the turn *is* the stream, so "the agent infers"
 * and "the agent answers" are not two requests. The stage banner still prints both,
 * because conflating them is what makes the pipeline hard to reason about when it
 * breaks halfway.
 *
 * Exits non-zero on the first failed stage, so it can gate a deploy.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  SETTLEMENT_CHAIN_ID,
  SETTLEMENT_CHAIN_LABEL,
  SETTLEMENT_TOKENS,
  SETTLEMENT_VENUES,
  type SettlementVenue,
} from "@ethonline2026/bridges";
import { verifySigningIntent, type SigningIntent } from "@ethonline2026/custody";

const execFileAsync = promisify(execFile);

// ── argument and env handling ─────────────────────────────────────────────────

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

const HAS = (name: string): boolean => process.argv.includes(`--${name}`);

const BASE_URL = flag("url", process.env["INFERENCE_URL"] ?? "http://localhost:8080").replace(
  /\/+$/,
  "",
);
const USER_ID = flag("user", process.env["INFERENCE_USER_ID"] ?? "production-pipeline");
const QUERY = flag("query", "rebalance my USDC into the best 30d yield");
const MODE = flag("mode", "v01");
const AS_JSON = HAS("json");
const WILL_APPROVE = !HAS("no-approve");

/**
 * Identity token for a private Cloud Run service.
 *
 * `--gcloud` mints one from the local CLI, which is what makes this script work
 * against the deployed revision without any setup. `INFERENCE_ID_TOKEN` is the
 * already-minted escape hatch; a service-account key is what a CI job would use,
 * via the same `google-auth-library` path `apps/agentic-ems` uses.
 */
async function identityToken(): Promise<string | undefined> {
  const supplied = process.env["INFERENCE_ID_TOKEN"]?.trim();
  if (supplied !== undefined && supplied.length > 0) return supplied;
  if (!HAS("gcloud")) return undefined;
  const { stdout } = await execFileAsync("gcloud", ["auth", "print-identity-token"]);
  const token = stdout.trim();
  return token.length > 0 ? token : undefined;
}

// ── terminal output ───────────────────────────────────────────────────────────

const RULE = "─".repeat(72);

function stage(number: number, name: string, endpoint: string): void {
  if (AS_JSON) return;
  process.stdout.write(`\n${RULE}\n`);
  process.stdout.write(`  ${number}. ${name.toUpperCase()}\n`);
  process.stdout.write(`     ${endpoint}\n`);
  process.stdout.write(`${RULE}\n`);
}

function line(label: string, value: string): void {
  if (AS_JSON) return;
  process.stdout.write(`  ${label.padEnd(18)} ${value}\n`);
}

/** Stage outcome, collected so `--json` can emit the whole run as one document. */
interface StageReport {
  readonly stage: number;
  readonly name: string;
  readonly endpoint: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly artifact: Record<string, unknown>;
}

const reports: StageReport[] = [];

function record(report: StageReport): void {
  reports.push(report);
}

class StageFailure extends Error {
  constructor(
    readonly stageNumber: number,
    message: string,
  ) {
    super(message);
  }
}

// ── the wire ──────────────────────────────────────────────────────────────────

interface WireEvent {
  readonly seq: number;
  readonly type: string;
  readonly [key: string]: unknown;
}

async function postJson<T>(
  path: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new StageFailure(0, `${path} returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
  }
  return { status: response.status, body: parsed as T };
}

/**
 * Read the turn's SSE stream to completion.
 *
 * Progress is echoed live so this behaves like the CLI smoke client when a human is
 * watching, and reduced in place so the caller gets the events either way.
 */
async function consumeTurn(
  response: Response,
  options: { readonly echo: boolean },
): Promise<WireEvent[]> {
  if (response.body === null) throw new StageFailure(1, "the turn opened an empty stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: WireEvent[] = [];
  let buffer = "";

  const handleFrame = (frame: string): void => {
    const data = frame
      .split("\n")
      .filter((row) => row.startsWith("data:"))
      .map((row) => row.slice(5).trimStart())
      .join("\n");
    if (data.length === 0) return;

    let event: WireEvent;
    try {
      event = JSON.parse(data) as WireEvent;
    } catch {
      // One malformed frame must not discard a turn's worth of good ones.
      return;
    }
    events.push(event);

    if (!options.echo || AS_JSON) return;
    const step = event["step"] as { agent?: string; call?: string } | undefined;
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
          `  · ${String(event.type === "step.start" ? "▶" : "✓")} ${(step?.agent ?? "?").padEnd(12)} ${step?.call ?? "?"}\n`,
        );
        break;
      case "widget":
        process.stdout.write(
          `  · widget ${String((event["widget"] as { kind?: string } | undefined)?.kind ?? "?")}\n`,
        );
        break;
      default:
        break;
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      handleFrame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
  return events;
}

// ── stage 4: the Web3 detail a leg needs ──────────────────────────────────────

/**
 * Reverse index: every address a venue owns, and the role it plays there.
 *
 * Indexing only `target` was wrong, and the pipeline run that exposed it is the
 * argument for this shape: an **approve** leg targets the *token*, not the venue, and
 * a Uniswap v4 liquidity leg targets the *PositionManager*, not the PoolManager. Both
 * are registered venue addresses playing a supporting role, and both looked unmapped.
 */
const VENUE_BY_ADDRESS = new Map<string, { venue: SettlementVenue; role: string }>();
for (const venue of Object.values(SETTLEMENT_VENUES)) {
  VENUE_BY_ADDRESS.set(venue.target.address.toLowerCase(), { venue, role: "target" });
  if (venue.token !== undefined) {
    VENUE_BY_ADDRESS.set(venue.token.address.toLowerCase(), { venue, role: "token" });
  }
  if (venue.spender !== undefined) {
    VENUE_BY_ADDRESS.set(venue.spender.address.toLowerCase(), { venue, role: "spender" });
  }
  for (const [name, auxiliary] of Object.entries(venue.auxiliary ?? {})) {
    VENUE_BY_ADDRESS.set(auxiliary.address.toLowerCase(), { venue, role: name });
  }
}

/** `approve(address,uint256)` — an allowance leg, which targets a token. */
const APPROVE_SELECTOR = "0x095ea7b3";

/** Where to check a leg against the chain it claims to settle on. */
const SETTLEMENT_RPC_URL =
  process.env["SETTLEMENT_RPC_URL"] ?? "https://ethereum-sepolia-rpc.publicnode.com";

/**
 * Does this address hold a contract **on the settlement chain**?
 *
 * This is the check that turns "unmapped" into a diagnosis. An unmapped target has
 * two very different causes, and they need different fixes:
 *
 *   - no code on the settlement chain — the leg can never execute here. The usual
 *     reason is an agent emitting *mainnet* addresses for a testnet settlement, which
 *     a digest check cannot catch because the intent is internally consistent while
 *     addressing the wrong chain.
 *   - code present, but not a registered venue — the registry needs the venue added.
 *
 * @returns `true`/`false`, or `null` when the chain could not be reached (so the
 *   caller reports "unknown" rather than inventing a verdict).
 */
async function codeOnSettlementChain(address: string): Promise<boolean | null> {
  try {
    const response = await fetch(SETTLEMENT_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getCode",
        params: [address, "latest"],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json()) as { result?: string };
    const code = body.result ?? "";
    return typeof code === "string" && code.length > 2;
  } catch {
    return null;
  }
}

interface PopulatedLeg {
  readonly to: string;
  readonly value: string;
  readonly selector: string;
  readonly operation: number;
  readonly venue: string | null;
  /** How this address relates to the venue: `target`, `token`, `spender`, or an auxiliary name. */
  readonly role: string | null;
  readonly requiresAllowanceFrom: string | null;
  readonly token: { symbol: string; address: string } | null;
  readonly executable: "live" | "simulation" | "unknown";
  readonly note: string | null;
}

/**
 * Attach the Web3 data a leg needs to actually execute.
 *
 * A leg carries only `to` and `data`, so the token address and the allowance spender
 * have to be resolved from the venue. A leg whose target belongs to no venue is
 * reported as `unknown` rather than guessed at — an unmapped target is a gap to
 * close, not something to paper over.
 */
function populateLegs(intent: SigningIntent): PopulatedLeg[] {
  const symbolFor = (address: string): string =>
    Object.entries(SETTLEMENT_TOKENS).find(
      ([, token]) => token.address.toLowerCase() === address.toLowerCase(),
    )?.[0] ?? "?";

  return intent.authorized.legs.map((leg) => {
    const selector = leg.data.slice(0, 10);
    const match = VENUE_BY_ADDRESS.get(leg.to.toLowerCase()) ?? null;
    const venue = match?.venue ?? null;

    /*
     * An allowance leg names its spender in the calldata, which is what says which
     * venue the approval serves. The fixture carries only a selector rather than full
     * calldata, so when the argument is absent the role already tells us the answer:
     * `token` means this is an approve, and `requiresAllowanceFrom` names the spender
     * the venue expects.
     */
    const spenderFromCalldata =
      selector.toLowerCase() === APPROVE_SELECTOR && leg.data.length >= 74
        ? `0x${leg.data.slice(34, 74)}`
        : null;
    const spenderMatch =
      spenderFromCalldata === null
        ? null
        : (VENUE_BY_ADDRESS.get(spenderFromCalldata.toLowerCase()) ?? null);

    const token = venue?.token ?? null;
    return {
      to: leg.to,
      value: leg.value,
      selector,
      operation: leg.operation ?? 0,
      venue: venue?.protocol ?? null,
      role: match?.role ?? null,
      requiresAllowanceFrom:
        spenderFromCalldata ?? spenderMatch?.venue.spender?.address ?? venue?.spender?.address ?? null,
      token:
        token === null || token === undefined
          ? null
          : { symbol: symbolFor(token.address), address: token.address },
      executable: venue === null ? "unknown" : venue.mode,
      note: venue?.modeReason ?? null,
    };
  });
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const token = await identityToken();
  const headers: Record<string, string> = {
    "x-user-id": USER_ID,
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
  };

  if (!AS_JSON) {
    process.stdout.write(`inference   ${BASE_URL}\n`);
    process.stdout.write(`identity    ${USER_ID}${token === undefined ? " (no token)" : " + bearer token"}\n`);
    process.stdout.write(`query       ${QUERY}\n`);
    if (token === undefined && !BASE_URL.includes("localhost")) {
      process.stdout.write(
        "\n  note: no identity token. A private Cloud Run service will answer 403.\n" +
          "        Pass --gcloud, or set INFERENCE_ID_TOKEN.\n",
      );
    }
  }

  // ── 1. agent inference ──────────────────────────────────────────────────────
  stage(1, "agent inference", "POST /v1/sessions  →  POST /v1/sessions/:id/turns");

  const session = await postJson<{ session?: { sessionId?: string } }>(
    "/v1/sessions",
    { agent: MODE },
    headers,
  );
  const sessionId = session.body.session?.sessionId;
  if (session.status >= 300 || sessionId === undefined) {
    throw new StageFailure(1, `could not open a session (${session.status})`);
  }
  line("session", sessionId);
  record({
    stage: 1,
    name: "agent inference",
    endpoint: "POST /v1/sessions",
    ok: true,
    detail: `session ${sessionId}`,
    artifact: { sessionId },
  });

  const turnResponse = await fetch(`${BASE_URL}/v1/sessions/${sessionId}/turns`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY, mode: MODE, dry: true }),
  });
  if (!turnResponse.ok) {
    throw new StageFailure(
      1,
      `the turn was refused (${turnResponse.status}): ${(await turnResponse.text()).slice(0, 300)}`,
    );
  }
  const runId = turnResponse.headers.get("x-inference-run-id");
  line("run", runId ?? "(none)");
  process.stdout.write("\n");

  const events = await consumeTurn(turnResponse, { echo: true });

  const failed = events.find((event) => event.type === "error");
  if (failed !== undefined) {
    throw new StageFailure(
      2,
      `the agent failed: ${String(failed["code"])} — ${String(failed["message"])}`,
    );
  }

  // ── 2. agent response ───────────────────────────────────────────────────────
  stage(2, "agent response", "the turn's message.delta → message.completed");

  const completed = events.find((event) => event.type === "message.completed");
  const report = typeof completed?.["text"] === "string" ? completed["text"] : "";
  const steps = events.filter(
    (event) => event.type === "step.start" || event.type === "step.completed",
  );
  const runCompleted = events.find((event) => event.type === "run.completed");

  line("steps", String(steps.length));
  line("report", `${report.length} chars`);
  line("run state", String(runCompleted?.["state"] ?? "(still running)"));

  record({
    stage: 2,
    name: "agent response",
    endpoint: "turn stream: message.completed",
    ok: report.length > 0,
    detail: `${steps.length} steps, ${report.length} chars, state ${String(runCompleted?.["state"])}`,
    artifact: {
      report,
      steps: steps.length,
      state: runCompleted?.["state"] ?? null,
      summary: runCompleted?.["summary"] ?? null,
    },
  });

  if (report.length === 0) throw new StageFailure(2, "the agent produced no response text");

  // ── 3. response → intent ────────────────────────────────────────────────────
  stage(3, "response → intent", "the turn's approval.requested envelope");

  const requested = events.find((event) => event.type === "approval.requested");
  if (requested === undefined) {
    // Not a failure: HOLD is a legitimate outcome, and saying so beats a stack trace.
    line("intent", "(none — the agent decided to hold)");
    record({
      stage: 3,
      name: "response → intent",
      endpoint: "turn stream: approval.requested",
      ok: true,
      detail: "the agent produced no intent (HOLD)",
      artifact: { intent: null },
    });
    finish();
    return;
  }

  const intent = requested["intent"] as SigningIntent;
  line("intent", intent.intentId);
  line("request", intent.requestId);
  line("chain", `${intent.chain} (chainId ${String(intent.chainId)})`);
  line("kind", intent.kind);
  line("account", intent.account);
  line("legs", String(intent.authorized.legs.length));
  line("digest", intent.digest);
  line("sentence", intent.display.sentence);

  const digestValid = verifySigningIntent(intent);
  line("digest check", digestValid ? "OK — matches its own body" : "MISMATCH");
  if (!digestValid) {
    throw new StageFailure(3, "the intent's digest does not match its own body — do not sign it");
  }

  record({
    stage: 3,
    name: "response → intent",
    endpoint: "turn stream: approval.requested",
    ok: true,
    detail: `${intent.intentId}, ${intent.authorized.legs.length} legs, digest verified`,
    artifact: {
      intentId: intent.intentId,
      requestId: intent.requestId,
      chain: intent.chain,
      kind: intent.kind,
      digest: intent.digest,
      display: intent.display,
      digestVerified: true,
    },
  });

  // ── 4. Web3 population ──────────────────────────────────────────────────────
  stage(4, "intent ← Web3 data", "legs resolved against the settlement registry");

  const legs = populateLegs(intent);
  for (const [index, leg] of legs.entries()) {
    process.stdout.write(`  leg ${index + 1}\n`);
    line("    to", leg.to);
    line("    selector", `${leg.selector}${leg.operation === 1 ? "  (DELEGATECALL)" : ""}`);
    line("    value", `${leg.value} wei`);
    line("    venue", leg.venue ?? "UNMAPPED — no venue owns this target");
    if (leg.role !== null) line("    role", leg.role);
    if (leg.token !== null) line("    token", `${leg.token.symbol}  ${leg.token.address}`);
    if (leg.requiresAllowanceFrom !== null) {
      line("    allowance", `owner → ${leg.requiresAllowanceFrom}`);
    }
    if (leg.note !== null) line("    caution", leg.note);
  }

  const unmappedLegs = legs.filter((leg) => leg.venue === null);
  const simulated = legs.filter((leg) => leg.executable === "simulation").length;

  // Diagnose each unmapped target against the settlement chain, because the two
  // causes need different fixes and only one of them is a registry gap.
  const diagnoses = await Promise.all(
    unmappedLegs.map(async (leg) => ({ leg, hasCode: await codeOnSettlementChain(leg.to) })),
  );
  const wrongChain = diagnoses.filter((entry) => entry.hasCode === false);
  const missingVenue = diagnoses.filter((entry) => entry.hasCode === true);

  if (!AS_JSON) {
    for (const { leg, hasCode } of diagnoses) {
      const verdict =
        hasCode === false
          ? `NO CONTRACT on ${SETTLEMENT_CHAIN_LABEL} — this leg can never execute here`
          : hasCode === true
            ? `contract exists on ${SETTLEMENT_CHAIN_LABEL}, but it is not a registered venue`
            : "could not reach the settlement chain to check";
      process.stdout.write(`  ! ${leg.to}\n      ${verdict}\n`);
    }
    process.stdout.write(
      `\n  ${legs.length} legs · ${unmappedLegs.length} unmapped · ${simulated} simulation-only\n`,
    );
    if (wrongChain.length > 0) {
      process.stdout.write(
        "\n  A target with no contract on the settlement chain usually means the agent is\n" +
          "  emitting MAINNET addresses for a testnet settlement. The intent stays internally\n" +
          "  consistent, so the digest check passes — but its legs address the wrong chain.\n",
      );
    }
    if (missingVenue.length > 0) {
      process.stdout.write("\n  Add these venues to the settlement registry.\n");
    }
  }

  record({
    stage: 4,
    name: "intent ← Web3 data",
    endpoint: "local: @ethonline2026/bridges settlement registry",
    ok: unmappedLegs.length === 0,
    detail:
      `${legs.length} legs, ${wrongChain.length} wrong-chain, ` +
      `${missingVenue.length} missing venue, ${simulated} simulation-only`,
    artifact: {
      chainId: SETTLEMENT_CHAIN_ID,
      legs,
      diagnoses: diagnoses.map((entry) => ({ to: entry.leg.to, hasCode: entry.hasCode })),
    },
  });

  if (wrongChain.length > 0) {
    throw new StageFailure(
      4,
      `${wrongChain.length} leg(s) address contracts that do not exist on ${SETTLEMENT_CHAIN_LABEL}: ` +
        `${wrongChain.map((entry) => entry.leg.to).join(", ")}. The agent is emitting another chain's addresses.`,
    );
  }
  if (unmappedLegs.length > 0) {
    throw new StageFailure(
      4,
      `${unmappedLegs.length} leg(s) target a contract with no registered venue`,
    );
  }

  // ── 5. approval payload ─────────────────────────────────────────────────────
  stage(5, "approval payload", `POST /v1/sessions/${sessionId}/intents/${intent.intentId}/approve`);

  const scheme = intent.signing.scheme;
  line("scheme", scheme);
  if (scheme === "safe-typed-data") {
    line("safeTxHash", intent.signing.safeTxHash);
    const domain = intent.signing.typedData.domain as Record<string, unknown>;
    const message = intent.signing.typedData.message as Record<string, unknown>;
    line("domain", JSON.stringify(domain));
    line("primary type", intent.signing.typedData.primaryType);
    line("message", JSON.stringify(message).slice(0, 200));
  }
  line("calldata", intent.authorized.calldata === null ? "(none)" : `${intent.authorized.calldata.slice(0, 34)}…`);

  if (!WILL_APPROVE) {
    line("approval", "skipped (--no-approve)");
    record({
      stage: 5,
      name: "approval payload",
      endpoint: "POST …/approve (skipped)",
      ok: true,
      detail: "not submitted",
      artifact: { approved: false },
    });
    finish();
    return;
  }

  // The custodian signs server-side, so no signature is sent from here. That is the
  // real deployment shape: the client authorises, the server signs with a key the
  // client never holds.
  const approval = await postJson<Record<string, unknown>>(
    `/v1/sessions/${sessionId}/intents/${intent.intentId}/approve`,
    { outcome: "approved" },
    headers,
  );
  if (approval.status >= 300) {
    throw new StageFailure(
      5,
      `the approval was refused (${approval.status}): ${JSON.stringify(approval.body).slice(0, 300)}`,
    );
  }

  line("response", JSON.stringify(approval.body).slice(0, 300));
  record({
    stage: 5,
    name: "approval payload",
    endpoint: "POST …/approve",
    ok: true,
    detail: `HTTP ${approval.status}`,
    artifact: { status: approval.status, response: approval.body },
  });

  finish();
}

function finish(): void {
  if (AS_JSON) {
    process.stdout.write(`${JSON.stringify({ ok: reports.every((r) => r.ok), stages: reports }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`\n${RULE}\n`);
  for (const report of reports) {
    process.stdout.write(`  ${report.ok ? "✓" : "✗"} ${report.stage}. ${report.name.padEnd(20)} ${report.detail}\n`);
  }
  process.stdout.write(`${RULE}\n`);
  process.stdout.write("  All five stages completed.\n\n");
}

main().catch((error: unknown) => {
  const message = error instanceof StageFailure ? `stage ${error.stageNumber}: ${error.message}` : String(error);
  process.stderr.write(`\nPRODUCTION PIPELINE FAILED — ${message}\n`);
  process.exitCode = 1;
});
