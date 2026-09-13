/**
 * The EIP-712 shape custody speaks.
 *
 * Declared structurally rather than imported so the signer port does not depend
 * on any one signer's package. It is field-for-field identical to Ledger's
 * `TypedData` (from `device-signer-kit-ethereum`) and to viem's
 * `TypedDataDefinition`, so a value can move between all three without a cast —
 * which is what lets `LedgerSignerAdapter`, `LocalKeySigner` and
 * `PrivyWalletSigner` satisfy one interface.
 */

/** EIP-712 domain. Mirrors Ledger's `TypedDataDomain`. */
export interface Eip712Domain {
  readonly name?: string;
  readonly version?: string;
  readonly chainId?: number;
  readonly verifyingContract?: string;
  readonly salt?: string;
}

/** One field inside a struct type. */
export interface Eip712Field {
  readonly name: string;
  readonly type: string;
}

/**
 * A complete EIP-712 payload, ready to sign.
 *
 * `types` must NOT contain `EIP712Domain` for viem; Safe's protocol-kit leaves
 * it in. `LocalKeySigner` strips it; the other signers tolerate it.
 */
export interface Eip712TypedData {
  readonly domain: Eip712Domain;
  readonly types: Record<string, Eip712Field[]>;
  readonly primaryType: string;
  readonly message: Record<string, unknown>;
}
