import { describe, expect, it } from "vitest";

import { ERROR_CODES, HttpError, type ErrorCode } from "../api/_lib/http.js";
import {
  classifyFailure,
  classifyOk,
  isUnavailable,
  readErrorEnvelope,
  remedyFor,
} from "../console/src/classify.js";

/**
 * The classification decides whether a reader configures something or retries, so the cases that
 * matter are the ones where those two differ — and the exhaustiveness case, which is what keeps a
 * code added to the contract tomorrow from falling through to a wrong sentence today.
 */

const UNAVAILABLE_CODES: readonly ErrorCode[] = [
  "VECTOR_UNAVAILABLE",
  "RISK_UNAVAILABLE",
  "DATABASE_UNAVAILABLE",
  "MODEL_UNAVAILABLE",
];

describe("classifying a failure", () => {
  it.each(UNAVAILABLE_CODES)("treats %s as a fact about the deployment, not a crash", (code) => {
    const status = new HttpError(code, "x").status;
    const result = classifyFailure(status, code, "the store is not configured");

    expect(result.event).toBe("settle-unavailable");
    // The remedy is the whole reason this is a separate state: retrying changes nothing.
    expect(result.remedy).toBeDefined();
    expect(remedyFor(code)).toBe(result.remedy);
  });

  it("keeps an upstream fault out of the unavailable state", () => {
    // The distinction that matters: an upstream fault is worth retrying, a missing dependency is not.
    const status = new HttpError("UPSTREAM_ERROR", "x").status;
    const result = classifyFailure(status, "UPSTREAM_ERROR", "agent failed");

    expect(result.event).toBe("settle-failed");
    expect(result.remedy).toBeUndefined();
    expect(isUnavailable("UPSTREAM_ERROR", status)).toBe(false);
  });

  it("treats a 503 with no code as unavailable", () => {
    // A gateway answering for a deployment that never woke sends no envelope at all. Reading that
    // as a hard failure would send the reader to retry something that will never answer.
    expect(classifyFailure(503, null, "").event).toBe("settle-unavailable");
  });

  it.each([
    [400, "BAD_REQUEST"],
    [401, "UNAUTHORIZED"],
    [404, "NOT_FOUND"],
  ] as const)("treats %i %s as the caller's problem", (status, code) => {
    const result = classifyFailure(status, code, "");
    expect(result.event).toBe("settle-refused");
    expect(result.remedy).toBeUndefined();
  });

  it("says a request never arrived rather than blaming the deployment", () => {
    const result = classifyFailure(0, null, "");
    expect(result.event).toBe("settle-failed");
    expect(result.summary).toContain("never reached");
  });

  it("classifies every code in the API's contract, so a new one cannot fall through", () => {
    // Derived from the contract rather than listed here: adding a code to `http.ts` without deciding
    // what it means to a reader fails this test instead of rendering as a generic error.
    for (const code of ERROR_CODES) {
      const status = new HttpError(code, "x").status;
      const result = classifyFailure(status, code, "x");
      expect(result.event, `${code} did not classify`).not.toBeNull();
      expect([
        "settle-unavailable",
        "settle-refused",
        "settle-failed",
      ]).toContain(result.event);
    }
  });
});

describe("classifying a success", () => {
  it("calls a plain payload complete", () => {
    expect(classifyOk({ pools: [], count: 0 }).event).toBe("settle-ok");
    expect(classifyOk({ service: "agentic-ems-indexer" }).event).toBe("settle-ok");
  });

  it("calls a payload that reports nothing a partial, not a success", () => {
    // The bug this exists to prevent: a 200 that says "nothing is stored here" rendering exactly
    // like a 200 that says "here is your data".
    const result = classifyOk({ empty: true, reading: "No pool metrics are stored." });
    expect(result.event).toBe("settle-partial");
    expect(result.summary).toContain("nothing");
  });

  it("calls a degraded payload partial and names what is degraded", () => {
    const result = classifyOk({ status: "degraded", degraded: ["risk", "timesfm3"] });
    expect(result.event).toBe("settle-partial");
    expect(result.summary).toContain("risk");
    expect(result.summary).toContain("timesfm3");
  });

  it("calls a cache with failures partial, and counts them", () => {
    const result = classifyOk({ cached: true, entries: [], failures: [{ key: "a" }, { key: "b" }] });
    expect(result.event).toBe("settle-partial");
    expect(result.summary).toContain("2 cached entries");
  });

  it("does not read a healthy payload as thin", () => {
    expect(classifyOk({ cached: true, entries: [], failures: [] }).event).toBe("settle-ok");
    expect(classifyOk({ degraded: [] }).event).toBe("settle-ok");
  });

  it("survives a payload that is not an object", () => {
    expect(classifyOk(null).event).toBe("settle-ok");
    expect(classifyOk("ok").event).toBe("settle-ok");
  });
});

describe("reading the error envelope", () => {
  it("reads a well-formed envelope", () => {
    expect(readErrorEnvelope({ error: { code: "RISK_UNAVAILABLE", message: "nope" } })).toEqual({
      code: "RISK_UNAVAILABLE",
      message: "nope",
    });
  });

  it("refuses a code it does not know", () => {
    // A proxy or a platform error page can answer with JSON that is not this envelope. Trusting the
    // shape would put a confident, wrong sentence in front of the reader.
    expect(readErrorEnvelope({ error: { code: "TEAPOT", message: "x" } }).code).toBeNull();
  });

  it("returns empty for anything that is not the envelope", () => {
    expect(readErrorEnvelope("<!doctype html>")).toEqual({ code: null, message: "" });
    expect(readErrorEnvelope({ message: "just a message" })).toEqual({ code: null, message: "" });
    expect(readErrorEnvelope(null)).toEqual({ code: null, message: "" });
  });
});
