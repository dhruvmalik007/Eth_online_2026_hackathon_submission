import { describe, expect, it } from "vitest";
import { failure, json, readJson, requireMethod } from "../api/_lib/handler.js";

describe("requireMethod", () => {
  it("allows a listed method", () => {
    expect(requireMethod(new Request("https://x/", { method: "GET" }), ["GET"])).toBeNull();
  });

  it("names the allowed methods on a rejection", () => {
    const response = requireMethod(new Request("https://x/", { method: "DELETE" }), ["POST"]);
    expect(response?.status).toBe(405);
    expect(response?.headers.get("allow")).toBe("POST");
  });
});

describe("json / failure", () => {
  it("marks responses uncacheable", async () => {
    const response = json({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("shapes an error with an optional detail", async () => {
    expect(await failure("bad", 400).json()).toEqual({ error: "bad" });
    expect(await failure("bad", 502, "rpc down").json()).toEqual({ error: "bad", detail: "rpc down" });
  });
});

describe("readJson", () => {
  it("rejects a malformed body", async () => {
    const request = new Request("https://x/", { method: "POST", body: "not json" });
    const result = await readJson(request, () => ({ ok: true }));
    expect(result.ok).toBe(false);
  });

  it("returns the parser's message when it rejects", async () => {
    const request = new Request("https://x/", { method: "POST", body: JSON.stringify({ chain: 5 }) });
    const result = await readJson<{ chain: string }>(request, (value) => {
      const record = value as { chain?: unknown };
      return typeof record.chain === "string" ? { chain: record.chain } : "chain must be a string";
    });
    if (result.ok) throw new Error("expected rejection");
    expect(result.response.status).toBe(400);
  });
});
