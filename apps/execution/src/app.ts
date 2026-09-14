import { transactionLinks } from "@ethonline2026/order-execution-layer";
/**
 * The HTTP surface — grouped by the lineage of §5.3.
 *
 * Routes are thin: they resolve identity, parse input, call a repository and
 * shape a response. No route imports an adapter or writes SQL, so all of them are
 * testable with fakes and none can bypass the tenant scoping the repositories
 * enforce.
 *
 * **`POST /runs/:id/simulate` and `POST /intents` are the two stages of one
 * decision.** Simulation plans the agent's legs through the venue registry and
 * shows what each would cost; approval re-plans them and records the operator's
 * consent. Both call `runtime.venues.registry.planAll`, so a leg nobody can run is
 * reported per leg rather than failing the whole plan.
 *
 * `POST /intents/:id/sign` and `/submit` sign and broadcast behind a configured signer, and answer
 * `UNAVAILABLE` without one. They act on the payloads they are handed rather than re-deriving them:
 * re-planning at submit time would send different figures than the operator approved.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";

/** The shape `uuid` columns accept — used where a caller-supplied id may not be one. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { CHAIN_KEYS } from "@ethonline2026/oneinch-aqua";
import { IntentLegSchema, type IntentLeg } from "@ethonline2026/execution-domain";
import { UnsignedTransactionSchema } from "@ethonline2026/order-execution-layer/port";
import { assessApproval, resolveLimits, type ApprovalRequest } from "./approval.js";
import { describeRisk, type RiskNotice } from "./risk.js";
import { ExecutionReadModel, type ExecutionStepRow, type SessionRow } from "@ethonline2026/timeseries";
import type { ExecutionRuntime } from "./runtime.js";
import {
  HttpError,
  assertDeployable,
  optionalDate,
  optionalInt,
  optionalString,
  requireString,
  toErrorResponse,
  type Authenticator,
} from "./http.js";

/** What the app needs beyond the runtime. */
export interface AppOptions {
  readonly runtime: ExecutionRuntime;
  readonly authenticator: Authenticator;
}

/** Build the Fastify app. Exported separately from `main` so tests can inject fakes. */
export function buildApp(options: AppOptions): FastifyInstance {
  const { runtime, authenticator } = options;
  assertDeployable(runtime.env.EXECUTION_MODE, authenticator);

  const app = Fastify({ logger: { level: runtime.env.LOG_LEVEL } });
  const readModel = new ExecutionReadModel(runtime.runner, runtime.history);

  app.setErrorHandler((error, _request, reply) => reply.send(toErrorResponse(error, reply)));

  const body = (request: FastifyRequest): Record<string, unknown> =>
    (request.body ?? {}) as Record<string, unknown>;
  const query = (request: FastifyRequest): Record<string, unknown> =>
    (request.query ?? {}) as Record<string, unknown>;

  // ── Health ──────────────────────────────────────────────────────────────────
  app.get("/health", async (_request, reply) => {
    const degraded: string[] = [];
    let database = "ok";
    try {
      await runtime.runner.query("SELECT 1");
    } catch {
      database = "unavailable";
      degraded.push("database");
    }
    return reply.send({
      status: degraded.length === 0 ? "ok" : "degraded",
      mode: runtime.env.EXECUTION_MODE,
      database,
      degraded,
      /**
       * Whether this deployment can sign, and with which address.
       *
       * The address — never the key. Without this the only way to ask "is signing wired?" is the two
       * routes that need it, and those authenticate first, so an unauthenticated caller cannot tell
       * a missing signer from a rejected token. That ambiguity is worth removing: it is the
       * difference between a configuration mistake and a working deployment.
       */
      signer:
        runtime.signer === undefined
          ? { configured: false }
          : { configured: true, address: await runtime.signer.getAddress() },
    });
  });

  // ── Sessions ────────────────────────────────────────────────────────────────
  app.post("/sessions", async (request, reply) => {
    const userId = await authenticator.authenticate(request);
    const input = body(request);
    const session = await runtime.sessions.open({
      sessionId: optionalString(input, "sessionId") ?? randomUUID(),
      userId,
      agent: (optionalString(input, "agent") ?? "v01") as SessionRow["agent"],
      // `null`, not `undefined`: the column is nullable and the store's option
      // type allows null but not an explicit undefined.
      threadId: optionalString(input, "threadId") ?? null,
    });
    return reply.code(201).send({ session });
  });

  app.get("/sessions", async (request, reply) => {
    const userId = await authenticator.authenticate(request);
    const sessions = await runtime.sessions.list(
      userId,
      optionalInt(query(request), "limit", 50),
    );
    return reply.send({ count: sessions.length, sessions });
  });

  app.get("/sessions/:id", async (request, reply) => {
    const userId = await authenticator.authenticate(request);
    const { id } = request.params as { id: string };
    const session = await runtime.sessions.get(userId, id);
    if (session === null) throw new HttpError("NOT_FOUND", "Session not found.");

    // The dashboard's main view: the session plus the live state of what it ran.
    const strategies = await runtime.strategies.list(userId);
    const runs = await Promise.all(
      strategies.map(async (strategy) => ({
        strategyId: strategy.strategyId,
        name: strategy.name,
        liveRun: await readModel.liveRun(userId, strategy.strategyId),
      })),
    );
    return reply.send({ session, strategies: runs });
  });

  app.post("/sessions/:id/close", async (request, reply) => {
    const userId = await authenticator.authenticate(request);
    const { id } = request.params as { id: string };
    const closed = await runtime.sessions.close(userId, id);
    return reply.send({ closed });
  });

  // ── Strategies ──────────────────────────────────────────────────────────────
  app.post("/strategies", async (request, reply) => {
    const userId = await authenticator.authenticate(request);
    const input = body(request);
    const strategy = await runtime.strategies.create({
      strategyId: optionalString(input, "strategyId") ?? randomUUID(),
      userId,
      name: requireString(input, "name"),
    });
    return reply.code(201).send({ strategy });
  });

  app.get("/strategies", async (request, reply) => {
    const userId = await authenticator.authenticate(request);
    const strategies = await runtime.strategies.list(userId);
    return reply.send({ count: strategies.length, strategies });
  });

  app.get("/strategies/:id", async (request, reply) => {
    const userId = await authenticator.authenticate(request);
    const { id } = request.params as { id: string };
    const strategy = await runtime.strategies.get(userId, id);
    if (strategy === null) throw new HttpError("NOT_FOUND", "Strategy not found.");
    return reply.send({ strategy, liveRun: await readModel.liveRun(userId, id) });
  });

  // ── Runs and traces ─────────────────────────────────────────────────────────
  app.get("/runs/:id", async (request, reply) => {
    const userId = await authenticator.authenticate(request);
    const { id } = request.params as { id: string };
    const run = await runtime.history.getRun(userId, id);
    if (run === null) throw new HttpError("NOT_FOUND", "Run not found.");
    return reply.send({ run });
  });

  app.get("/runs/:id/events", async (request, reply) => {
    const userId = await authenticator.authenticate(request);
    const { id } = request.params as { id: string };
    // The polling fallback for the WS stream, and the resume path after a drop.
    const events = await runtime.history.getRunEvents(
      userId,
      id,
      optionalDate(query(request), "since"),
    );
    return reply.send({ count: events.length, events });
  });

  // ── Dashboard ───────────────────────────────────────────────────────────────
  app.get("/overview", async (request, reply) => {
    const userId = await authenticator.authenticate(request);
    return reply.send(await readModel.overview(userId));
  });

  app.get("/positions", async (request, reply) => {
    const userId = await authenticator.authenticate(request);
    const positions = await readModel.positions(userId);
    return reply.send({ count: positions.length, positions });
  });

  app.get("/fees/:intentId", async (request, reply) => {
    const userId = await authenticator.authenticate(request);
    const { intentId } = request.params as { intentId: string };
    const fees = await readModel.feeBreakdown(userId, intentId);
    return reply.send({ count: fees.length, fees });
  });

  app.get("/bridges", async (request, reply) => {
    const userId = await authenticator.authenticate(request);
    const bridges = await readModel.bridgeProgress(userId);
    return reply.send({ count: bridges.length, bridges });
  });

  // ── 1inch Aqua / SwapVM ─────────────────────────────────────────────────────

  /**
   * The enablement assessment.
   *
   * Read twice on purpose. The **simulation** stage shows it to answer "what would using 1inch buy
   * us", and the **approval** stage re-reads it to answer "shall we" — re-reading rather than
   * carrying it forward so the two stages cannot disagree about how much was at stake.
   *
   * `efficiencyBps` is a required *measurement*, supplied by the caller because comparing two real
   * quotes needs a chain this service does not have. This route does not invent a figure, and it
   * refuses a non-finite one rather than rendering an empty delta beside a consent switch.
   */
  app.get("/aqua/enablement", async (request, reply) => {
    await authenticator.authenticate(request);

    const aqua = runtime.aqua;
    if (aqua === undefined) {
      throw new HttpError(
        "UNAVAILABLE",
        "The 1inch Aqua/SwapVM venue is off on this deployment (ONEINCH_AQUA_ENABLED is false).",
      );
    }

    const input = query(request);
    const requested = requireString(input, "chain");
    const chain = CHAIN_KEYS.find((key) => key === requested);
    if (chain === undefined) {
      // A `ZodError` from the assessment would reach the client as a 500. An unknown chain is the
      // caller's mistake, and saying which values are valid is the whole value of the response.
      throw new HttpError(
        "BAD_REQUEST",
        `\`chain\` must be one of: ${CHAIN_KEYS.join(", ")}.`,
        { field: "chain", allowed: [...CHAIN_KEYS] },
      );
    }

    const rawEfficiency = input["efficiencyBps"];
    const efficiencyBps = rawEfficiency === undefined ? 0 : Number(rawEfficiency);
    if (!Number.isFinite(efficiencyBps)) {
      throw new HttpError("BAD_REQUEST", "`efficiencyBps` must be a finite number.", {
        field: "efficiencyBps",
      });
    }

    const rawEnabled = input["enabled"];
    if (rawEnabled !== undefined && rawEnabled !== "true" && rawEnabled !== "false") {
      throw new HttpError("BAD_REQUEST", "`enabled` must be \"true\" or \"false\".", {
        field: "enabled",
      });
    }

    return reply.send({
      assessment: aqua.assess({
        chain,
        efficiencyBps,
        alreadyEnabled: rawEnabled === "true",
      }),
      thresholds: aqua.thresholds,
      chains: aqua.chains,
      unreachable: aqua.unreachable,
    });
  });

  // ── Planning: simulation, then approval ──────────────────────────────────────

  /**
   * Parse the legs a caller proposed.
   *
   * Validated against the domain's own schema rather than a local shape, so a leg that reaches a
   * venue is the same leg the dashboard renders. A malformed leg is the caller's mistake and is
   * reported as one, with the field path, rather than surfacing as a 500 from somewhere downstream.
   */
  const parseLegs = (request: FastifyRequest): IntentLeg[] => {
    const raw = body(request)["legs"];
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new HttpError("BAD_REQUEST", "`legs` must be a non-empty array of intent legs.", {
        field: "legs",
      });
    }
    return raw.map((leg, index) => {
      const parsed = IntentLegSchema.safeParse(leg);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
        throw new HttpError("BAD_REQUEST", `\`legs[${index}]\` is not a valid intent leg. ${issues}`, {
          field: `legs[${index}]`,
        });
      }
      return parsed.data;
    });
  };

  /**
   * Fetch the agent's risk verdicts for the legs' chains, once per chain.
   *
   * Deduplicated because a three-leg run on one chain is one verdict, and asking three times would
   * risk three different verdicts for the same chain beside each other on one screen. The verdict
   * belongs to the chain, not the leg — a leg carrying its own copy is a leg that can disagree with
   * its neighbour.
   *
   * **Presentation only.** The notices this produces are rendered; they gate nothing. Permitting
   * execution is `approval.ts`'s job, and keeping the two apart is the point.
   */
  const riskNotices = async (legs: readonly IntentLeg[]): Promise<Map<string, RiskNotice>> => {
    const notices = new Map<string, RiskNotice>();
    for (const chain of new Set(legs.map((leg) => leg.chain))) {
      notices.set(chain, describeRisk(await runtime.riskReports.latest(chain)));
    }
    return notices;
  };

  /** Shape one planned leg for the wire, keeping success and failure distinguishable. */
  const wireLeg = (entry: Awaited<ReturnType<typeof runtime.venues.registry.planAll>>[number]) => ({
    legId: entry.leg.id,
    kind: entry.leg.kind,
    protocol: entry.leg.protocol,
    chain: entry.leg.chain,
    source: entry.source,
    ok: entry.outcome.ok,
    ...(entry.outcome.ok
      ? { plan: entry.outcome.quote }
      : { reason: entry.outcome.reason, detail: entry.outcome.detail }),
  });

  /**
   * The **simulation** stage: what would each leg cost, and who would run it.
   *
   * Reads the enablement assessment too when the venue is on, because "would 1inch be better" is the
   * question the operator is actually being asked at this point — and answering it here rather than
   * in the UI keeps the figure the same one the approval stage re-reads.
   */
  app.post("/runs/:id/simulate", async (request, reply) => {
    const userId = await authenticator.authenticate(request);
    const { id } = request.params as { id: string };
    const run = await runtime.history.getRun(userId, id);
    if (run === null) throw new HttpError("NOT_FOUND", "Run not found.");

    const legs = parseLegs(request);
    const planned = await runtime.venues.registry.planAll(legs);
    const risk = await riskNotices(legs);

    return reply.send({
      runId: id,
      stage: "simulation",
      // Beside the plan rather than inside it: cost is computed here and risk is inferred elsewhere,
      // and the operator is weighing both. Nothing in this block can stop a leg.
      risk: Object.fromEntries([...risk].map(([chain, notice]) => [chain, notice])),
      venues: runtime.venues.registry.ids,
      planned: planned.map(wireLeg),
      enablement:
        runtime.aqua === undefined
          ? { available: false as const, reason: "The 1inch Aqua/SwapVM venue is off." }
          : { available: true as const, thresholds: runtime.aqua.thresholds, chains: runtime.aqua.chains },
    });
  });

  /**
   * The **approval** stage: re-plan, then record consent.
   *
   * It re-plans rather than accepting the simulation's plan. Prices move, and a plan approved from a
   * stale set of numbers is an approval of something that was never shown — so the figures the
   * operator is agreeing to are computed here, at the moment of agreement.
   */
  app.post("/intents", async (request, reply) => {
    const userId = await authenticator.authenticate(request);
    // The mandate is per agent, so the limit that applies depends on who is asking. A missing row
    // falls back to the deployment default rather than to some other agent's number.
    const agent = optionalString(body(request), "agent") ?? "v01";
    const mandates = resolveLimits(runtime.approvalLimits, await runtime.mandates.get(userId, agent));

    const legs = parseLegs(request);
    const planned = await runtime.venues.registry.planAll(legs);
    const runnable = planned.filter((entry) => entry.outcome.ok);
    const blocked = planned.filter((entry) => !entry.outcome.ok);
    const risk = await riskNotices(legs);

    // The approval decision. Risk is *not* an input to it: a high reading is shown to the approver and
    // the choice remains theirs, because gating this on an inference would put a scoring bug in the
    // path of funds and would remove the accountable principal exactly where one is required.
    const approver = optionalString(body(request), "approvedBy");
    const approval: ApprovalRequest = assessApproval({
      legs: legs.map((leg) => ({ id: leg.id, amountUsd: leg.amountUsd })),
      limits: mandates,
      ...(approver === undefined ? {} : { decidedBy: approver }),
    });

    // Consent for the venue, when the simulation stage said one is outstanding.
    const input = body(request);
    const requestedEfficiency = input["efficiencyBps"];
    const efficiencyBps = requestedEfficiency === undefined ? undefined : Number(requestedEfficiency);
    if (efficiencyBps !== undefined && !Number.isFinite(efficiencyBps)) {
      throw new HttpError("BAD_REQUEST", "`efficiencyBps` must be a finite number.", {
        field: "efficiencyBps",
      });
    }

    return reply.code(201).send({
      stage: "approval",
      // Approved only when every leg has a venue *and* the mandate has been satisfied. Two separate
      // questions, both of which must be yes: a partial plan is one the operator believes is complete,
      // and an unapproved plan is one nobody authorised.
      // `pending` is the only state that withholds. `not-required` is an authorisation too — it means
      // the mandate does not reach this intent, which is a decision made, not one still to make.
      approved: blocked.length === 0 && approval.state !== "pending",
      approval,
      risk: Object.fromEntries([...risk].map(([chain, notice]) => [chain, notice])),
      planned: planned.map(wireLeg),
      totals: { legs: planned.length, runnable: runnable.length, blocked: blocked.length },
      enablement:
        runtime.aqua === undefined || efficiencyBps === undefined
          ? null
          : runtime.aqua.assess({
              chain: runtime.aqua.chains[0] ?? CHAIN_KEYS[0],
              efficiencyBps,
              alreadyEnabled: input["enabled"] === "true",
            }),
    });
  });

  // ── Mandates: the operator's settings surface for agent limits ───────────────

  /**
   * The mandate governing one agent, with its source named.
   *
   * `stored` and `effective` are both returned because they answer different questions: what has been
   * configured, and what will actually be applied. A settings form that showed only the effective
   * value would render the deployment default as though someone had chosen it.
   */
  app.get("/mandates/:agent", async (request, reply) => {
    const userId = await authenticator.authenticate(request);
    const { agent } = request.params as { agent: string };
    const stored = await runtime.mandates.get(userId, agent);

    return reply.send({
      agent,
      stored,
      effective: {
        maxSpendUsd: stored?.maxSpendUsd ?? runtime.approvalLimits.maxSpendUsdPerIntent,
        approvalRequired: stored?.approvalRequired ?? runtime.approvalLimits.requiredByDefault,
      },
      source: stored === null ? "deployment default" : "stored mandate",
    });
  });

  /**
   * Set the mandate for one agent.
   *
   * Returns 503 rather than accepting a write it cannot keep: a settings form that reported success
   * against no store would be worse than one that says it is not configured.
   */
  app.put("/mandates/:agent", async (request, reply) => {
    const userId = await authenticator.authenticate(request);
    const { agent } = request.params as { agent: string };

    if (runtime.mandates.set === undefined) {
      throw new HttpError(
        "UNAVAILABLE",
        "No mandate store is configured on this deployment, so a limit cannot be saved.",
      );
    }

    const input = body(request);
    const maxSpendUsd = Number(input["maxSpendUsd"]);
    if (!Number.isFinite(maxSpendUsd) || maxSpendUsd <= 0) {
      throw new HttpError("BAD_REQUEST", "`maxSpendUsd` must be a positive number.", {
        field: "maxSpendUsd",
      });
    }
    const rawApproval = input["approvalRequired"];
    if (rawApproval !== undefined && typeof rawApproval !== "boolean") {
      throw new HttpError("BAD_REQUEST", "`approvalRequired` must be a boolean.", {
        field: "approvalRequired",
      });
    }

    const mandate = await runtime.mandates.set({
      userId,
      agent,
      mandate: { maxSpendUsd, approvalRequired: rawApproval ?? true },
      updatedBy: userId,
    });

    return reply.send({ agent, mandate, source: "stored mandate" });
  });

  // ── Signing and submission ──────────────────────────────────────────────────
  /**
   * The two routes that move funds.
   *
   * Both act on the payloads they are handed rather than re-deriving them from the legs. Re-deriving
   * would be the wrong repair for the missing intent store: an operator approves specific figures, and
   * a submit that re-planned would send whatever the venues said at submit time while the approval on
   * record referred to something else. A stateless service should therefore be given the approved
   * payloads — and both routes refuse anything they cannot attribute to an approver.
   *
   * Gated on a configured signer rather than on `ONEINCH_AQUA_ENABLED`: signing is venue-agnostic, and
   * tying it to one venue's flag would make the route disappear for a deployment that runs another.
   */
  app.post("/intents/:id/sign", async (request, reply) => {
    const userId = await authenticator.authenticate(request);
    const { id } = request.params as { id: string };
    const signer = runtime.signer;
    if (signer === undefined) {
      throw new HttpError(
        "UNAVAILABLE",
        "No signer is configured on this deployment, so nothing can be signed. " +
          "This is a deployment statement, not a failed operation.",
      );
    }

    const input = body(request);
    const payloads = input["typedData"];
    if (!Array.isArray(payloads) || payloads.length === 0) {
      throw new HttpError("BAD_REQUEST", "`typedData` must be a non-empty array of EIP-712 payloads.", {
        field: "typedData",
      });
    }

    const approvedBy = optionalString(input, "approvedBy") ?? userId;
    const signedBy = await signer.getAddress();
    const signed: { index: number; signature: string }[] = [];

    for (const [index, payload] of payloads.entries()) {
      // Checked structurally rather than passed through: `hashTypedData` will hash whatever it is
      // given, so a malformed payload yields a signature over something meaningless instead of an
      // error — and a signature is the one artefact here that cannot be inspected for correctness.
      const candidate = payload as Record<string, unknown> | null;
      if (
        candidate === null ||
        typeof candidate !== "object" ||
        typeof candidate["primaryType"] !== "string" ||
        typeof candidate["domain"] !== "object" ||
        typeof candidate["types"] !== "object" ||
        typeof candidate["message"] !== "object"
      ) {
        throw new HttpError(
          "BAD_REQUEST",
          `\`typedData[${index}]\` needs \`domain\`, \`types\`, \`primaryType\` and \`message\`.`,
          { field: `typedData[${index}]` },
        );
      }
      signed.push({ index, signature: await signer.signTypedData(candidate as never) });
    }

    return reply.send({ intentId: id, signedBy, approvedBy, signed });
  });

  app.post("/intents/:id/submit", async (request, reply) => {
    const userId = await authenticator.authenticate(request);
    const { id } = request.params as { id: string };
    const signer = runtime.signer;
    if (signer === undefined) {
      throw new HttpError(
        "UNAVAILABLE",
        "No signer is configured on this deployment, so nothing can be broadcast.",
      );
    }

    const input = body(request);
    const calls = input["calls"];
    if (!Array.isArray(calls) || calls.length === 0) {
      throw new HttpError("BAD_REQUEST", "`calls` must be a non-empty array of transactions.", {
        field: "calls",
      });
    }

    const approvedBy = optionalString(input, "approvedBy") ?? userId;
    const sentBy = await signer.getAddress();
    const submitted: { index: number; transactionHash: string }[] = [];
    const steps: ExecutionStepRow[] = [];

    /**
     * A call may declare itself a leg of a cross-chain route.
     *
     * Optional, because most calls are not: a settlement on one chain is a transaction, and labelling
     * it a bridge would invent a destination that does not exist. When it *is* supplied, the panel can
     * show the pair an operator actually cares about — left the source chain, arrived on the
     * destination — rather than only the half it can see.
     *
     * `guid` is deliberately **not** fabricated from the provider. The read model turns a guid into a
     * LayerZero scan link, so filling it with a LI.FI reference would build a URL that resolves to
     * nothing: a link that looks like proof and is not. It is recorded only when the caller supplies a
     * genuine LayerZero message id.
     */
    const crossChainRaw = input["crossChain"];
    const crossChain =
      typeof crossChainRaw === "object" && crossChainRaw !== null
        ? (crossChainRaw as Record<string, unknown>)
        : undefined;
    const isBridge = crossChain !== undefined;
    const guid = crossChain === undefined ? undefined : optionalString(crossChain, "guid");

    for (const [index, call] of calls.entries()) {
      // Validated by the same schema the adapters *produce* calls with, so a caller cannot hand over
      // something the rest of the system would never have emitted.
      const parsed = UnsignedTransactionSchema.safeParse(call);
      if (!parsed.success) {
        throw new HttpError(
          "BAD_REQUEST",
          `\`calls[${index}]\` is not a valid transaction: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".")} ${issue.message}`)
            .join("; ")}`,
          { field: `calls[${index}]` },
        );
      }
      const tx = parsed.data;
      const handle = await signer.sendTransaction({
        chainId: tx.chainId,
        to: tx.to as `0x${string}`,
        ...(tx.data === undefined ? {} : { data: tx.data as `0x${string}` }),
        // The port keeps wei as a decimal string so it never passes through a float; the signer takes
        // a bigint because that is what the wallet expects. The conversion belongs here, once.
        ...(tx.value === "0" ? {} : { value: BigInt(tx.value) }),
      });
      submitted.push({ index, transactionHash: handle.transactionHash });
      steps.push({
        stepId: randomUUID(),
        intentId: id,
        userId,
        seq: index,
        kind: isBridge ? "bridge" : "transfer",
        label: isBridge ? `Bridge ${index + 1} of ${calls.length}` : `Broadcast ${index + 1} of ${calls.length}`,
        status: "submitted",
        chainId: tx.chainId,
        txHash: handle.transactionHash,
        nonce: null,
        gasUsed: null,
        // For a bridge the source hash is the broadcast itself — that is the half this service can
        // observe. The destination hash arrives later, from the provider, via `/confirm`.
        srcTxHash: isBridge ? handle.transactionHash : null,
        dstTxHash: null,
        guid: guid ?? null,
        error: null,
      });
    }

    /**
     * Recorded as events, not as steps.
     *
     * `exec_steps` references `exec_intents`, which references `exec_runs`, which references a
     * strategy — and no route in this service creates any of those rows. Writing a step therefore
     * fails for every intent a caller can actually name, which is what turned a successful broadcast
     * into a 500 the first time this ran. `exec_events` carries no foreign keys, so it is the one
     * table a broadcast can be recorded in today; the read model unions both.
     *
     * Never at the cost of reporting a broadcast that happened as a failure: the transactions are on
     * chain and cannot be recalled, so a write error must not become the caller's answer.
     */
    let recorded = true;
    try {
      await runtime.history.recordEvents(
        steps.map((step) => ({
          eventId: randomUUID(),
          at: new Date(),
          userId,
          runId: null,
          // `intent_id` is a uuid column, and the route accepts any string for `:id`. A readable id
          // like `live-1234` cannot be stored, so it is recorded as absent rather than making the
          // whole write fail — the broadcast is the fact worth keeping, not the label a caller chose.
          intentId: UUID_PATTERN.test(id) ? id : null,
          stepId: step.stepId,
          type: "step.broadcast",
          payload: {
            txHash: step.txHash,
            chainId: step.chainId,
            label: step.label,
            index: step.seq,
            sentBy,
            // Carried so `/bridges` can show a cross-chain pair without a second lookup.
            ...(isBridge ? { srcTxHash: step.srcTxHash, kind: "bridge" } : {}),
            ...(guid === undefined ? {} : { guid }),
          },
        })),
      );
    } catch (error) {
      recorded = false;
      request.log.error({ err: error, intentId: id }, "broadcast succeeded but the events were not recorded");
    }

    return reply.send({ intentId: id, sentBy, approvedBy, submitted, recorded });
  });


  /**
   * Confirm the far side of a cross-chain leg.
   *
   * A bridge is two transactions, and this service only ever broadcasts one of them: the source. The
   * destination is mined by the provider's relayer, on another chain, minutes later. Without this the
   * desk can show that a bridge *left* but never that it *arrived*, which is the half a trader is
   * actually waiting on.
   *
   * The provider is asked, not the caller. A route that accepted a hash someone handed it would let a
   * caller assert any destination it liked, and the panel would render it with the same authority as a
   * verified one — so the reference is re-read from LI.FI and the destination hash is taken from that
   * response. When the provider has not seen it yet the route says so, and says which state it is in,
   * rather than recording a pending transaction as delivered.
   */
  app.post("/intents/:id/confirm", async (request, reply) => {
    const userId = await authenticator.authenticate(request);
    const { id } = request.params as { id: string };
    const input = body(request);
    const txHash = requireString(input, "txHash");
    // A chain id is a number, and a caller sending `137` is not making a mistake — requiring a
    // string here rejected every well-formed call and surfaced as an empty provider response, which
    // blamed LI.FI for a validation bug on this side.
    const fromChainId = Number(input["fromChainId"]);
    const toChainId = Number(input["toChainId"]);
    if (!Number.isInteger(fromChainId) || !Number.isInteger(toChainId)) {
      throw new HttpError("BAD_REQUEST", "`fromChainId` and `toChainId` must be integers.", {
        field: "fromChainId",
      });
    }
    const url = new URL("https://li.quest/v1/status");
    url.searchParams.set("txHash", txHash);
    url.searchParams.set("fromChain", String(fromChainId));
    url.searchParams.set("toChain", String(toChainId));
    const apiKey = process.env["LIFI_API_KEY"];
    if (apiKey !== undefined && apiKey.length > 0) url.searchParams.set("integrator", "agentic-ems");

    let provider: Record<string, unknown>;
    try {
      const response = await fetch(url, {
        headers: apiKey === undefined || apiKey.length === 0 ? {} : { "x-lifi-api-key": apiKey },
      });
      provider = (await response.json()) as Record<string, unknown>;
    } catch (error) {
      // A provider that is unreachable is not a bridge that failed. Saying which is the difference
      // between an operator retrying and an operator writing off a transfer that is still moving.
      throw new HttpError("UNAVAILABLE", `Could not reach the bridge provider: ${(error as Error).message}`);
    }

    const status = typeof provider["status"] === "string" ? provider["status"] : "unknown";
    const receiving = (provider["receiving"] ?? {}) as Record<string, unknown>;
    const dstTxHash = typeof receiving["txHash"] === "string" ? receiving["txHash"] : null;
    const dstChainId = typeof receiving["chainId"] === "number" ? receiving["chainId"] : null;

    /**
     * Both halves of the transfer, each on the explorer that can actually answer for it.
     *
     * The source hash alone is not enough for a bridge: it proves the transfer left and says nothing
     * about whether it arrived, which is the question being asked. LI.FI publishes its own scan, so
     * that is the primary link; the chain explorers carry the individual legs.
     */
    const links = transactionLinks({
      txHash,
      chainId: fromChainId,
      source: "lifi",
      ...(dstTxHash === null ? {} : { deliveredTxHash: dstTxHash }),
      ...(dstChainId === null ? {} : { destinationChainId: dstChainId }),
    });

    if (dstTxHash !== null) {
      await runtime.history.recordEvents([
        {
          eventId: randomUUID(),
          at: new Date(),
          userId,
          runId: null,
          intentId: UUID_PATTERN.test(id) ? id : null,
          stepId: null,
          type: "step.broadcast",
          payload: {
            // `dstTxHash` as well as `txHash`: the read model reads the pair from these two named
            // fields, so recording the arrival only under `txHash` left the destination invisible and
            // the panel showed the same source hash twice.
            txHash: dstTxHash,
            dstTxHash,
            chainId: dstChainId ?? toChainId,
            label: `Arrived via ${typeof provider["tool"] === "string" ? provider["tool"] : "bridge"}`,
            index: 0,
            srcTxHash: txHash,
            kind: "bridge",
            status: "confirmed",
            // Flattened to strings: the event payload is a JSON column, and the domain already
            // names these two fields for the source and destination explorers.
            ...(links === undefined
              ? {}
              : {
                  scanLabel: links.primary.label,
                  scanUrl: links.primary.url,
                  ...(links.sourceChain === undefined ? {} : { srcExplorerUrl: links.sourceChain.url }),
                  ...(links.destination === undefined ? {} : { dstExplorerUrl: links.destination.url }),
                }),
          },
        },
      ]);
    }

    return reply.send({
      txHash,
      status,
      // `pending` is a real answer, and the honest one while a relayer is still working.
      dstTxHash,
      dstChainId,
      tool: typeof provider["tool"] === "string" ? provider["tool"] : null,
      substatus: typeof provider["substatus"] === "string" ? provider["substatus"] : null,
      links: links ?? null,
      recorded: dstTxHash !== null,
    });
  });

  return app;
}
