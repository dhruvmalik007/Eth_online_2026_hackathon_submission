import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalProcessSandboxProvider } from "../src/sandbox/LocalProcessSandboxProvider.js";
import {
  SandboxCapacityError,
  SandboxNotFoundError,
  SandboxPathError,
} from "../src/sandbox/SandboxProvider.js";

async function provider(maxPerInstance = 4): Promise<LocalProcessSandboxProvider> {
  const root = await mkdtemp(path.join(tmpdir(), "inferrence-test-"));
  return new LocalProcessSandboxProvider({ root, maxPerInstance });
}

describe("LocalProcessSandboxProvider", () => {
  it("runs a command in the sandbox and streams its output", async () => {
    const sandbox = await provider();
    const handle = await sandbox.create();
    const chunks: string[] = [];

    const result = await sandbox.exec(handle, "echo hello-sandbox", {
      timeoutMs: 5_000,
      onStdout: (chunk) => chunks.push(chunk),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello-sandbox");
    expect(chunks.join("")).toContain("hello-sandbox");
    await sandbox.destroy(handle);
  });

  it("shares a filesystem between write, read, exec and list", async () => {
    const sandbox = await provider();
    const handle = await sandbox.create();

    await sandbox.write(handle, "nested/series.csv", "ts,apy\n0,4.1\n1,4.2\n");
    expect(await sandbox.read(handle, "nested/series.csv")).toContain("4.2");

    const wc = await sandbox.exec(handle, "wc -l < nested/series.csv", { timeoutMs: 5_000 });
    expect(wc.stdout.trim()).toBe("3");

    const root = await sandbox.list(handle);
    expect(root.map((entry) => entry.name)).toContain("nested");
    expect(root.find((entry) => entry.name === "nested")?.kind).toBe("dir");

    await sandbox.destroy(handle);
  });

  it("kills a command that exceeds its wall clock", async () => {
    const sandbox = await provider();
    const handle = await sandbox.create();
    const result = await sandbox.exec(handle, "sleep 5", { timeoutMs: 150 });
    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toContain("timed out");
    await sandbox.destroy(handle);
  });

  it("rejects a path that escapes the sandbox root", async () => {
    const sandbox = await provider();
    const handle = await sandbox.create();
    await expect(sandbox.read(handle, "../escape.txt")).rejects.toBeInstanceOf(SandboxPathError);
    await expect(sandbox.write(handle, "../../escape.txt", "x")).rejects.toBeInstanceOf(
      SandboxPathError,
    );
    await sandbox.destroy(handle);
  });

  it("refuses to overcommit past its capacity", async () => {
    const sandbox = await provider(1);
    await sandbox.create();
    await expect(sandbox.create()).rejects.toBeInstanceOf(SandboxCapacityError);
  });

  it("throws for an unknown handle", async () => {
    const sandbox = await provider();
    await expect(
      sandbox.exec({ id: "sbx_missing", provider: "local", template: null, createdAt: "" }, "true"),
    ).rejects.toBeInstanceOf(SandboxNotFoundError);
  });

  it("pauses and resumes without losing state", async () => {
    const sandbox = await provider();
    const handle = await sandbox.create();
    await sandbox.write(handle, "keep.txt", "state");

    await sandbox.pause(handle);
    await expect(sandbox.exec(handle, "true")).rejects.toThrow(/paused/);

    const resumed = await sandbox.resume(handle);
    expect(await sandbox.read(resumed, "keep.txt")).toBe("state");
    await sandbox.destroy(handle);
  });
});
