/**
 * LedgerSignerAdapter — the device-backed owner signer, on Ledger's **Device
 * Management Kit** (DMK).
 *
 * Custody NEVER holds an owner private key. This adapter talks to the device
 * through `@ledgerhq/device-signer-kit-ethereum`:
 *  - `address()` is derived from the device (no key material on the host);
 *  - `signSafeTypedData()` sends the *complete* EIP-712 payload, so the device
 *    can decode and display what is being authorised rather than an opaque
 *    hash. That is the irreversible-action gate for the EMS.
 *
 * ## Why DMK rather than `hw-app-eth`
 *
 * The legacy SDK could only sign a Safe digest as two opaque hashes
 * (`signEIP712HashedMessage`), which is blind by construction — the device
 * screen shows nothing meaningful. DMK signs the full typed data instead, and
 * one Ethereum signer kit covers **every EVM chain**, because the chain id is
 * part of the payload rather than a per-chain app.
 *
 * On-device **Clear Signing** additionally requires an `originToken` from
 * Ledger: without it the device falls back to showing raw hex. That token is a
 * Ledger-side registration, not something this package can provision.
 *
 * The derivation path is a developer-set constant — never user input.
 */
import {
  DeviceActionStatus,
  DeviceStatus,
  type DeviceManagementKit,
  type DeviceSessionId,
} from "@ledgerhq/device-management-kit";
import { SignerEthBuilder } from "@ledgerhq/device-signer-kit-ethereum";
import { firstValueFrom, type Observable } from "rxjs";
import type { Eip712TypedData } from "../eip712.js";
import { encodeSignature } from "./signature.js";
import type { SafeTypedDataSigner } from "./SafeTypedDataSigner.js";

/** Default Ethereum standard derivation path m/44'/60'/0'/0/0. */
export const DEFAULT_DERIVATION_PATH = "44'/60'/0'/0/0";

/** Seconds to wait for the user to approve an operation on the device. */
export const DEFAULT_SIGN_TIMEOUT_MS = 60_000;

/**
 * The shape every DMK device action returns: a stream of states plus a cancel
 * handle.
 *
 * Declared structurally (rather than with DMK's three generic parameters) so a
 * caller can pass any signer kit's action without the type parameters having to
 * line up. States are discriminated at runtime on `status`.
 */
export interface DeviceActionHandle<Output> {
  readonly observable: Observable<{
    readonly status: DeviceActionStatus;
    readonly output?: Output;
    readonly error?: unknown;
  }>;
  cancel(): void;
}

/**
 * A device or transport failure, carrying both the message a human should see
 * and the raw detail an engineer needs. Never render `debug` to a user.
 */
export class LedgerDeviceError extends Error {
  readonly debug: string;

  constructor(userMessage: string, debug: string) {
    super(userMessage);
    this.name = "LedgerDeviceError";
    this.debug = debug;
  }
}

/**
 * Normalize an EIP-712 signature from the device into the canonical
 * `0x<r><s><v>` single-signature bytes Safe expects.
 *
 * Thin wrapper over the shared encoder in `./signature.js` — the normalisation
 * is the same for every signer (Privy and viem return the 27/28 form too), so it
 * lives in one place rather than once per signer.
 *
 * @throws {RangeError} if `v` does not yield a 0/1 recovery id.
 */
export function encodeDeviceSignature(v: number, r: string, s: string): `0x${string}` {
  return encodeSignature(v, r, s);
}

/**
 * Whether a DMK error is the user declining on the device.
 *
 * User rejection is **not** an error — it is a normal outcome that should be
 * surfaced neutrally, not as a failure. Detection must check both the top-level
 * and the nested error code, because DMK buries the code inside
 * `originalError` when it does not recognise it.
 */
export function isDeviceRejection(error: unknown): boolean {
  const record = error as {
    _tag?: string;
    errorCode?: string;
    originalError?: { errorCode?: string };
  } | null;
  const tag = record?._tag ?? "";
  const code = record?.errorCode ?? record?.originalError?.errorCode ?? "";
  return (
    tag === "RefusedByUserDAError" ||
    code === "5501" || // global ActionRefusedError
    code === "6985" || // conditions of use not satisfied (generic rejection)
    code === "6982" // Solana-style "cancelled by user"
  );
}

/**
 * Map a DMK error to a message a human can act on.
 *
 * Do not call this for user rejections — check {@link isDeviceRejection} first
 * and handle them as a distinct outcome.
 */
export function classifyDeviceError(error: unknown): string {
  const record = error as {
    _tag?: string;
    errorCode?: string;
    message?: string;
  } | null;
  const tag = record?._tag ?? "";
  const code = record?.errorCode ?? "";

  if (tag === "DeviceLockedError" || code === "5515") {
    return "The Ledger is locked. Enter your PIN on the device to continue.";
  }
  if (code === "6807") {
    return "The required app is not installed on the Ledger. Install it, then try again.";
  }
  if (code === "6a80") {
    return "Blind signing is disabled on the device. Enable it in the app settings.";
  }
  if (code === "6e00") {
    return "The wrong app is open on the Ledger. It will be opened automatically on retry.";
  }
  if (tag === "DeviceDisconnectedWhileSendingError") {
    return "Lost connection to the Ledger. Reconnect the device and try again.";
  }
  if (tag === "SendApduTimeoutError") {
    return "Communication with the Ledger timed out. Check the connection and retry.";
  }
  if (tag === "NoAccessibleDeviceError") {
    return "No Ledger was found, or access was denied.";
  }
  if (tag === "OpeningConnectionError") {
    return "Could not open a connection to the Ledger. Retry.";
  }
  return "An unexpected error occurred. Disconnect and reconnect the Ledger, then start a new operation.";
}

/** Turn a device-action error into a typed one, keeping rejection distinct. */
function toDeviceError(error: unknown): Error {
  if (isDeviceRejection(error)) {
    return new LedgerDeviceError("Action cancelled on the device.", `rejected: ${String(error)}`);
  }
  return new LedgerDeviceError(classifyDeviceError(error), String(error));
}

/**
 * Resolve a DMK device action to its output, or `undefined` when it completes
 * without one — some actions only need the user to confirm.
 *
 * Exported rather than kept private because this is the most bug-prone part of
 * the integration and the hardest to reach in the field: a device action emits
 * **many** states, so `firstValueFrom` — the obvious choice — would resolve on
 * `NotStarted` and report success before the user had approved anything. Free
 * of device dependencies, so the behaviour is directly testable.
 *
 * @param handle the `{ observable, cancel }` a signer method returns.
 * @param timeoutMs how long to wait for on-device approval.
 * @throws {LedgerDeviceError} on timeout, rejection, or device failure.
 */
export function awaitDeviceAction<Output>(
  handle: DeviceActionHandle<Output>,
  timeoutMs: number = DEFAULT_SIGN_TIMEOUT_MS,
): Promise<Output | undefined> {
  return new Promise<Output | undefined>((resolve, reject) => {
    const timer = setTimeout(() => {
      handle.cancel();
      reject(
        new LedgerDeviceError(
          "Timed out waiting for approval on the Ledger.",
          `device action exceeded ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    // Assigned after `subscribe`, which may run synchronously for a
    // replaying/behaviour-style source — so `settle` must tolerate the gap
    // rather than assume the handle exists.
    let subscription: { unsubscribe(): void } | undefined;
    const settle = (): void => {
      clearTimeout(timer);
      subscription?.unsubscribe();
    };

    subscription = handle.observable.subscribe({
      next: (state) => {
        if (state.status === DeviceActionStatus.Completed) {
          settle();
          resolve(state.output);
          return;
        }
        if (state.status === DeviceActionStatus.Error) {
          settle();
          reject(toDeviceError(state.error));
          return;
        }
        if (state.status === DeviceActionStatus.Stopped) {
          settle();
          reject(
            new LedgerDeviceError(
              "The operation was cancelled on the device.",
              "device action stopped",
            ),
          );
        }
        // NotStarted and Pending: keep waiting for the user.
      },
      error: (transportError: unknown) => {
        settle();
        reject(
          transportError instanceof Error
            ? transportError
            : new LedgerDeviceError("The Ledger connection failed.", String(transportError)),
        );
      },
    });
  });
}

/** A signature produced on-device, in its raw `r` / `s` / `v` form. */
export interface DeviceSignature {
  readonly r: string;
  readonly s: string;
  readonly v: number;
}

export interface LedgerSignerAdapterOptions {
  /** The DMK instance. One per process — see `createNodeDmk()`. */
  dmk: DeviceManagementKit;
  /** A connected device session, from `dmk.connect()`. */
  sessionId: DeviceSessionId;
  /** BIP-32 derivation path of the owner account. */
  derivationPath?: string;
  /**
   * Ledger Clear Signing token. Without it the device displays raw hex instead
   * of the decoded intent.
   */
  originToken?: string;
  /** How long to wait for on-device approval. Defaults to 60s. */
  signTimeoutMs?: number;
}

export class LedgerSignerAdapter implements SafeTypedDataSigner {
  readonly kind = "ledger" as const;

  private readonly dmk: DeviceManagementKit;
  private readonly sessionId: DeviceSessionId;
  private readonly path: string;
  private readonly signTimeoutMs: number;
  private readonly originToken?: string;
  private cachedAddress?: `0x${string}`;

  constructor(options: LedgerSignerAdapterOptions) {
    this.dmk = options.dmk;
    this.sessionId = options.sessionId;
    this.path = options.derivationPath ?? DEFAULT_DERIVATION_PATH;
    this.signTimeoutMs = options.signTimeoutMs ?? DEFAULT_SIGN_TIMEOUT_MS;
    this.originToken = options.originToken;
  }

  get derivationPath(): string {
    return this.path;
  }

  /**
   * Whether Clear Signing is configured. When false, the device shows raw hex —
   * callers may want to warn the user before they approve anything.
   */
  get clearSigningEnabled(): boolean {
    return this.originToken !== undefined && this.originToken.length > 0;
  }

  /** Derive (and cache) the owner address from the device. */
  async address(): Promise<`0x${string}`> {
    if (this.cachedAddress !== undefined) return this.cachedAddress;
    await this.#ensureReady();
    const output = await this.#awaitValue(
      this.#signer().getAddress(this.path, { checkOnDevice: false }),
    );
    this.cachedAddress = output.address.toLowerCase() as `0x${string}`;
    return this.cachedAddress;
  }

  /**
   * Sign a Safe EIP-712 payload on-device.
   *
   * The **complete** typed data is sent, so the device can decode the intent —
   * this is what makes the human approval meaningful.
   */
  async signTypedData(typedData: Eip712TypedData): Promise<`0x${string}`> {
    await this.#ensureReady();
    const signature = await this.#awaitValue(
      this.#signer().signTypedData(this.path, typedData),
    );
    return encodeSignature(signature.v, signature.r, signature.s);
  }

  /**
   * Alias for {@link signTypedData}, kept because it names the Safe context and
   * callers already use it.
   */
  async signSafeTypedData(typedData: Eip712TypedData): Promise<`0x${string}`> {
    return await this.signTypedData(typedData);
  }

  /**
   * Ask the device to display and verify a Safe address.
   *
   * Resolves once the user confirms on the device; the device screen is the
   * only trusted display, so this is the check that the address is the expected
   * one before funds are sent to it.
   *
   * @param chainId - the chain the Safe lives on; the device needs it to resolve
   *   the address's context.
   * @throws {LedgerDeviceError} if the user rejects, or the device errors.
   */
  async verifySafeAddress(safeAddress: string, chainId: number): Promise<void> {
    await this.#ensureReady();
    await this.#awaitDone(this.#signer().verifySafeAddress(safeAddress, { chainId }));
  }

  /**
   * Sign a raw EVM transaction on-device, used at Safe deployment time when the
   * owner EOA pays the gas.
   */
  async signRawTransaction(serializedTx: Uint8Array): Promise<DeviceSignature> {
    await this.#ensureReady();
    const signature = await this.#awaitValue(
      this.#signer().signTransaction(this.path, serializedTx),
    );
    return { r: signature.r, s: signature.s, v: signature.v };
  }

  /** Build a signer bound to this session. */
  #signer(): ReturnType<SignerEthBuilder["build"]> {
    const builder = new SignerEthBuilder({
      dmk: this.dmk,
      sessionId: this.sessionId,
      ...(this.originToken !== undefined ? { originToken: this.originToken } : {}),
    });
    return builder.build();
  }

  /**
   * Pre-flight gate: the device must be reachable and unlocked before any
   * hardware operation. Silently retrying past a locked device would bypass the
   * human gate, so this fails loudly instead.
   *
   * @throws {LedgerDeviceError} if the device is locked, busy or disconnected.
   */
  async #ensureReady(): Promise<void> {
    const state = await firstValueFrom(
      this.dmk.getDeviceSessionState({ sessionId: this.sessionId }),
    );
    switch (state.deviceStatus) {
      case DeviceStatus.LOCKED:
        throw new LedgerDeviceError(
          "The Ledger is locked. Enter your PIN on the device to continue.",
          "deviceStatus=LOCKED",
        );
      case DeviceStatus.BUSY:
        throw new LedgerDeviceError(
          "The Ledger is busy. Close any pending prompt on the device and retry.",
          "deviceStatus=BUSY",
        );
      case DeviceStatus.CONNECTED:
        return;
      default:
        throw new LedgerDeviceError(
          "The Ledger is not connected. Reconnect the device and retry.",
          `deviceStatus=${String(state.deviceStatus)}`,
        );
    }
  }

  /** Await an action that must return a value. */
  async #awaitValue<Output>(handle: DeviceActionHandle<Output>): Promise<Output> {
    const output = await awaitDeviceAction(handle, this.signTimeoutMs);
    if (output === undefined) {
      throw new LedgerDeviceError(
        "The Ledger did not return a result.",
        "device action completed without an output",
      );
    }
    return output;
  }

  /** Await an action that only needed the user to confirm — no value comes back. */
  async #awaitDone<Output>(handle: DeviceActionHandle<Output>): Promise<void> {
    await awaitDeviceAction(handle, this.signTimeoutMs);
  }
}
