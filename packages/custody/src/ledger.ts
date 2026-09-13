/**
 * The Ledger (DMK) surface — deliberately a **separate entry point**.
 *
 * `@ethonline2026/custody/ledger` exists because the Ledger DMK packages cannot be
 * loaded by plain Node: `@ledgerhq/device-management-kit`'s ESM build does a
 * directory import (`./lib/esm/src`), which Node's ESM resolver rejects with
 * `ERR_UNSUPPORTED_DIR_IMPORT`. Bundlers and `tsx` tolerate it, `node dist/…`
 * does not.
 *
 * Keeping it off the root barrel means a server that only needs the intent
 * envelope and a Privy/local-key signer does not crash on boot — and does not
 * carry a native HID dependency it will never use.
 */
export {
  LedgerSignerAdapter,
  LedgerDeviceError,
  awaitDeviceAction,
  encodeDeviceSignature,
  isDeviceRejection,
  classifyDeviceError,
  DEFAULT_DERIVATION_PATH,
  DEFAULT_SIGN_TIMEOUT_MS,
} from "./safe/LedgerSignerAdapter.js";
export type {
  DeviceActionHandle,
  DeviceSignature,
  LedgerSignerAdapterOptions,
} from "./safe/LedgerSignerAdapter.js";
export { createNodeDmk, connectFirstDevice } from "./safe/ledgerNode.js";

/** The EIP-712 payload the device decodes and displays. */
export type { TypedData } from "@ledgerhq/device-signer-kit-ethereum";
