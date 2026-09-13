import { describe, expect, it } from "vitest";
import { redactRpcUrl, resolveAllRpcs, resolveRpc, type RpcResolution } from "../src/index.js";

/** Narrow to the success arm, failing loudly rather than silently reading `undefined`. */
function ok(resolution: RpcResolution): Extract<RpcResolution, { ok: true }> {
  if (!resolution.ok) throw new Error(`expected a resolution, got: ${resolution.reason}`);
  return resolution;
}

describe("resolveRpc", () => {
  it("prefers the chain's own variable over the shared key", () => {
    // The most specific statement of intent wins, so a deployment that wants a dedicated provider
    // is not silently routed through a shared one.
    const resolution = ok(
      resolveRpc("polygon", {
        POLYGON_RPC_URL: "https://dedicated.example/polygon",
        ALCHEMY_API_KEY: "shared-key",
      }),
    );

    expect(resolution.source).toBe("explicit");
    expect(resolution.url).toBe("https://dedicated.example/polygon");
  });

  it("falls back to the Alchemy key, per chain", () => {
    const optimism = ok(resolveRpc("optimism", { ALCHEMY_API_KEY: "k" }));
    const polygon = ok(resolveRpc("polygon", { ALCHEMY_API_KEY: "k" }));

    // The slugs differ per chain; getting one wrong resolves to the wrong network, which is worse
    // than failing outright.
    expect(optimism.url).toBe("https://opt-mainnet.g.alchemy.com/v2/k");
    expect(polygon.url).toBe("https://polygon-mainnet.g.alchemy.com/v2/k");
    expect(optimism.source).toBe("alchemy");
  });

  it("names both variables when neither is set", () => {
    // "No RPC" is not actionable; "neither X nor Y is set" is.
    const resolution = resolveRpc("optimism", {});

    expect(resolution.ok).toBe(false);
    if (resolution.ok) throw new Error("unreachable");
    expect(resolution.reason).toContain("OPTIMISM_RPC_URL");
    expect(resolution.reason).toContain("ALCHEMY_API_KEY");
  });

  it("reports a malformed explicit URL by name rather than passing it on", () => {
    // Handing an unparseable string to viem produces a transport error with no mention of which
    // setting caused it.
    const resolution = resolveRpc("optimism", { OPTIMISM_RPC_URL: "rpc.example.com" });

    expect(resolution.ok).toBe(false);
    if (resolution.ok) throw new Error("unreachable");
    expect(resolution.reason).toContain("OPTIMISM_RPC_URL");
    expect(resolution.reason).toContain("not an http(s) URL");
  });

  it("treats an empty variable as unset", () => {
    // An `.env` line left as `POLYGON_RPC_URL=` is the normal state of an unconfigured variable, and
    // it must not shadow the fallback.
    const resolution = ok(resolveRpc("polygon", { POLYGON_RPC_URL: "", ALCHEMY_API_KEY: "k" }));

    expect(resolution.source).toBe("alchemy");
  });

  it("separates the host from the URL, so callers have something safe to persist", () => {
    // The resolution *does* carry the URL — a caller needs it to connect. The point of `host` is
    // that it is the field anything durable reads, because an Alchemy key lives in the URL's path.
    const resolution = ok(resolveRpc("polygon", { ALCHEMY_API_KEY: "super-secret" }));

    expect(resolution.host).toBe("polygon-mainnet.g.alchemy.com");
    expect(resolution.host).not.toContain("super-secret");
    expect(resolution.url).toContain("super-secret");
  });

  it("refuses a chain outside the matrix", () => {
    expect(() => resolveRpc("ethereum" as unknown as "optimism", {})).toThrow();
  });
});

describe("redactRpcUrl", () => {
  it("drops the path, which is where an Alchemy key lives", () => {
    expect(redactRpcUrl("https://opt-mainnet.g.alchemy.com/v2/abcd1234")).toBe(
      "opt-mainnet.g.alchemy.com",
    );
  });

  it("never throws on the error path", () => {
    // A redaction helper that can itself throw is one that leaks the URL it was handed.
    expect(redactRpcUrl("not a url")).toBe("invalid-url");
    expect(redactRpcUrl("")).toBe("invalid-url");
  });
});

describe("resolveAllRpcs", () => {
  it("covers every chain in the matrix", () => {
    const all = resolveAllRpcs({ ALCHEMY_API_KEY: "k" });

    expect(all.map((entry) => entry.chain)).toEqual(["optimism", "polygon"]);
    expect(all.every((entry) => entry.resolution.ok)).toBe(true);
  });

  it("reports per chain when nothing is configured", () => {
    const all = resolveAllRpcs({});

    expect(all).toHaveLength(2);
    expect(all.every((entry) => entry.resolution.ok === false)).toBe(true);
  });
});
