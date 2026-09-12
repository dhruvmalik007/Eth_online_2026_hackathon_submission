/**
 * KeyRingClient — typed wrapper over `wallet-cli ring` (Ledger Key Ring / LKRP).
 *
 * The raw secret values NEVER pass through TypeScript: the wallet-cli reads the
 * ring password from `WALLET_PASS` in the environment (already provisioned in
 * the OS keychain by the user — see the wallet-cli skill "Non-TTY password
 * injection"), and encrypted blobs are written straight to files. This process
 * only names keys and moves ciphertext, never plaintext secrets.
 *
 * Commands requiring the device (`ring init`) are left to the human CLI flow on
 * purpose — an EMS middleware never provisions a hardware key ring unattended.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RingCliOptions {
  /** Path to the wallet-cli binary (default: `wallet-cli` on PATH). */
  binary?: string;
  /** Extra env vars to pass to the CLI (e.g. `WALLET_PASS` via keychain substitution). */
  env?: NodeJS.ProcessEnv;
  /** Bypass the OS sandbox that blocks keychain access (see skill — device-adjacent). */
  dangerouslyDisableSandbox?: boolean;
}

export interface RingKeyInfo {
  /** Key name (e.g. `agent-scoped-0`, `ems-prod`). */
  name: string;
  /** Epoch milliseconds of the last encrypt/decrypt use, if reported. */
  lastUsed?: number;
}

/** `wallet-cli ring keys --output json` shape. */
interface RingKeysJson {
  ok: boolean;
  data?: { keys?: Array<{ name?: string; lastUsed?: string | number }> };
  error?: { message?: string };
}

export class KeyRingClient {
  private readonly binary: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly dangerouslyDisableSandbox: boolean;

  constructor(options: RingCliOptions = {}) {
    this.binary = options.binary ?? "wallet-cli";
    this.env = { ...process.env, ...options.env };
    this.dangerouslyDisableSandbox = options.dangerouslyDisableSandbox ?? true;
  }

  private sandboxEnv(): NodeJS.ProcessEnv {
    return this.dangerouslyDisableSandbox ? { ...this.env, DANGEROUSLY_DISABLE_SANDBOX: "true" } : this.env;
  }

  private async run(args: string[]): Promise<string> {
    const { stdout, stderr } = await execFileAsync(this.binary, args, {
      env: this.sandboxEnv(),
      maxBuffer: 10 * 1024 * 1024,
    });
    if (stderr && !stdout) {
      // ring commands report errors on stdout as JSON even on failure; stderr is human detail
      throw new Error(`wallet-cli ${args.join(" ")} failed: ${stderr.trim()}`);
    }
    return stdout.trim();
  }

  /** List the key names this machine has used on the ring. */
  async listKeys(): Promise<RingKeyInfo[]> {
    const out = await this.run(["ring", "keys", "--output", "json"]);
    const parsed = JSON.parse(out) as RingKeysJson;
    if (!parsed.ok || !parsed.data?.keys) {
      throw new Error(`wallet-cli ring keys failed: ${parsed.error?.message ?? out}`);
    }
    return parsed.data.keys.map((k) => ({
      name: k.name ?? "",
      lastUsed: k.lastUsed !== undefined ? Number(k.lastUsed) : undefined,
    }));
  }

  /** Encrypt plaintext file -> ciphertext file under a ring key. Returns the key name. */
  async encryptFile(opts: { key: string; input: string; output: string }): Promise<string> {
    await this.run([
      "ring",
      "encrypt",
      "--key",
      opts.key,
      "-i",
      opts.input,
      "-o",
      opts.output,
    ]);
    return opts.key;
  }

  /** Decrypt ciphertext file -> plaintext file under a ring key. Returns the key name. */
  async decryptFile(opts: { key: string; input: string; output: string }): Promise<string> {
    await this.run([
      "ring",
      "decrypt",
      "--key",
      opts.key,
      "-i",
      opts.input,
      "-o",
      opts.output,
    ]);
    return opts.key;
  }

  /** True if a key name already exists on this machine's ring. */
  async hasKey(name: string): Promise<boolean> {
    const keys = await this.listKeys();
    return keys.some((k) => k.name === name);
  }
}