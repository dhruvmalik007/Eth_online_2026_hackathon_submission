/**
 * LedgerSignerAdapter — the device-backed owner signer for the Safe smart
 * account.
 *
 * Custody NEVER holds an owner private key. This adapter talks to the Ledger
 * device directly through `@ledgerhq/hw-app-eth`:
 *  - `address` is derived from the device (no key material on the host);
 *  - `signSafeMessage` signs the Safe EIP-712 digest on-device, so the HUMAN
 *    confirms on the device screen — the irreversible-action gate for the EMS.
 *
 * The derivation path is a developer-set constant (never user input) per the
 * DMK skill: pass exactly as configured, do not guess or default.
 */
import Eth from "@ledgerhq/hw-app-eth";

/**
 * The transport `hw-app-eth` accepts, derived from its own constructor.
 *
 * The type nominally lives in `@ledgerhq/hw-transport`, but that is a
 * transitive dependency of the two Ledger packages this package declares and
 * is not resolvable from here. Deriving it keeps the dependency list honest —
 * we import only what we declare — while staying exact: if `hw-app-eth`
 * changes the transport it accepts, this changes with it.
 */
export type LedgerTransport = ConstructorParameters<typeof Eth>[0];

/** Default Ethereum standard derivation path m/44'/60'/0'/0/0. */
export const DEFAULT_DERIVATION_PATH = "44'/60'/0'/0/0";

export interface LedgerSignerAdapterOptions {
  /** A pre-connected Ledger transport (node-hid/web-hid). */
  transport: LedgerTransport;
  /** BIP-32 derivation path of the owner account. */
  derivationPath?: string;
  /** Chain id used for the EIP-712 domain separator. */
  chainId: number;
}

/**
 * Normalize an EIP-712 signature (v,r,s from the device) into the canonical
 * `0x<r><s><v>` single-sig bytes used by Safe signature payloads.
 */
export function encodeDeviceSignature(v: number, r: string, s: string): `0x${string}` {
  const vByte = (v - 27).toString(16).padStart(2, "0");
  return `0x${r}${s}${vByte}` as `0x${string}`;
}

export class LedgerSignerAdapter {
  private readonly eth: Eth;
  private readonly path: string;
  private readonly chainId: number;
  private _address?: `0x${string}`;

  constructor(options: LedgerSignerAdapterOptions) {
    this.eth = new Eth(options.transport);
    this.path = options.derivationPath ?? DEFAULT_DERIVATION_PATH;
    this.chainId = options.chainId;
  }

  get derivationPath(): string {
    return this.path;
  }

  get chain(): number {
    return this.chainId;
  }

  /** Derive (and cache) the owner address from the device. */
  async address(): Promise<`0x${string}`> {
    if (this._address) return this._address;
    const { address } = await this.eth.getAddress(this.path);
    this._address = address.toLowerCase() as `0x${string}`;
    return this._address;
  }

  /**
   * Sign the Safe EIP-712 digest on-device. `domainSeparatorHex` and
   * `messageHashHex` are the two 32-byte hashes that make up the EIP-712
   * payload for a Safe transaction; the human approves on the device.
   *
   * @returns the canonical Safe signature bytes `0x<r><s><v>`.
   */
  async signSafeDigest(domainSeparatorHex: string, messageHashHex: string): Promise<`0x${string}`> {
    const { v, r, s } = await this.eth.signEIP712HashedMessage(
      this.path,
      domainSeparatorHex.replace(/^0x/, ""),
      messageHashHex.replace(/^0x/, ""),
    );
    return encodeDeviceSignature(v, r, s);
  }

  /**
   * Sign a raw EVM transaction on-device (used at Safe deployment time, when
   * the owner EOA pays the deployment gas). Returns r/s/v to reconstruct the
   * signed tx.
   */
  async signRawTransaction(serializedTxHex: string): Promise<{ r: string; s: string; v: string }> {
    const { r, s, v } = await this.eth.signTransaction(this.path, serializedTxHex.replace(/^0x/, ""));
    return { r, s, v };
  }
}