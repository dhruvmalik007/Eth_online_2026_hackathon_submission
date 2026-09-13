/**
 * Transaction encoders for the two bridges that have no prepared-transaction API
 * we can call from a script.
 *
 * ## Why these exist rather than the vendor's wrappers
 *
 * Circle ships `depositForBurn` in `@circle-fin/adapter-viem-v2`, but its
 * parameters are built for compile-time inference inside a typed client —
 * marker interfaces (`ActionParameters.__isActionParams`), capability generics,
 * recursive utility types. Calling it from a script means `as never` casts over
 * exactly the arguments that decide where funds land.
 *
 * The **deployed contract has a fixed public ABI**, so encoding against it
 * directly is both simpler and easier to verify: {@link probeCctpBurn} sends the
 * encoded calldata to the live contract and reads the revert. A contract-level
 * error proves the function and its argument types resolve; a missing-selector
 * revert proves they do not. That is a check against a real chain, not against
 * our own memory of a signature.
 *
 * ## Both are payable-aware
 *
 * A LayerZero `send` carries the quoted native fee as `msg.value`, and the
 * encoder returns it rather than leaving the caller to remember it — a message
 * sent with a fee of zero is accepted by the contract and never delivered, which
 * is the failure mode that has no error message.
 */
import { encodeFunctionData, parseAbi, toHex, type PublicClient } from "viem";
import { addressToBytes32 } from "@layerzerolabs/lz-v2-utilities";

/**
 * CCTP V2 `depositForBurn`.
 *
 * Seven arguments, not the four of V1 — `destinationCaller`, `maxFee` and
 * `minFinalityThreshold` are the V2 additions, and the last of those is what
 * selects the free slow path (`0`) over the paid fast path (`1000`+).
 */
const CCTP_BURN_ABI = parseAbi([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) returns (uint64)",
]);

/** LayerZero V2 `EndpointV2.send`, in its packed `MessagingParams` form. */
const LZ_SEND_ABI = parseAbi([
  "function send((uint32 dstEid, bytes32 receiver, bytes message, bytes options, bool payInLzToken) params, address refundAddress) payable",
]);

/** A transaction, ready to sign and send — and safe to print. */
export interface UnsignedBridgeTransaction {
  readonly chainId: number;
  readonly to: `0x${string}`;
  /** Wei to attach. Non-zero only for LayerZero, where it carries the fee. */
  readonly value: bigint;
  readonly data: `0x${string}`;
  /** What the calldata says, for a human reading the simulation. */
  readonly summary: string;
}

/** CCTP: burn USDC on the source chain so it can be minted on the destination. */
export interface CctpBurnParams {
  readonly chainId: number;
  /** The deployed `TokenMessengerV2` (or `TokenMessengerWithFees`) on the source chain. */
  readonly tokenMessenger: `0x${string}`;
  readonly amount: bigint;
  readonly destinationDomain: number;
  readonly mintRecipient: string;
  /** USDC on the **source** chain. Burning the wrong token is unrecoverable. */
  readonly burnToken: `0x${string}`;
  /** Restricts who may submit the mint. The zero hash leaves it open. */
  readonly destinationCaller?: `0x${string}`;
  /** CCTP's own fee ceiling, in USDC atomic units. */
  readonly maxFee?: bigint;
  /** `0` = free/slow (waits for finality); `1000`+ = paid/fast. */
  readonly minFinalityThreshold?: number;
}

/**
 * Encode a CCTP burn.
 *
 * `mintRecipient` is converted through `toHex(addressToBytes32(...))` rather than
 * taken as a string: CCTP wants **bytes32**, and an address passed straight
 * through produces a valid-looking calldata that mints to the wrong account.
 */
export function encodeCctpBurn(params: CctpBurnParams): UnsignedBridgeTransaction {
  const data = encodeFunctionData({
    abi: CCTP_BURN_ABI,
    functionName: "depositForBurn",
    args: [
      params.amount,
      params.destinationDomain,
      toHex(addressToBytes32(params.mintRecipient)),
      params.burnToken,
      toHex(addressToBytes32(params.destinationCaller ?? "0x0000000000000000000000000000000000000000")),
      params.maxFee ?? 0n,
      params.minFinalityThreshold ?? 0,
    ],
  });

  const fast = (params.minFinalityThreshold ?? 0) > 0;
  return {
    chainId: params.chainId,
    to: params.tokenMessenger,
    value: 0n,
    data,
    summary: `CCTP burn ${params.amount} of ${params.burnToken} → domain ${params.destinationDomain} (${fast ? "fast, paid" : "slow, free"})`,
  };
}

/** LayerZero: send a message, paying the DVN and executor fee in native gas. */
export interface LayerZeroSendParams {
  readonly chainId: number;
  /** `EndpointV2`, identical on every supported chain. */
  readonly endpoint: `0x${string}`;
  readonly dstEid: number;
  readonly receiver: string;
  /** The payload. Empty is valid — a bare notification. */
  readonly message?: `0x${string}`;
  /** Encoded execution options, from `Options.newOptions()`. */
  readonly options?: `0x${string}`;
  /** The fee a preceding `quote` returned. Attached as `msg.value`. */
  readonly nativeFee?: bigint;
  readonly payInLzToken?: boolean;
  /** Refunded if the message costs less than quoted. */
  readonly refundAddress: `0x${string}`;
}

export function encodeLayerZeroSend(params: LayerZeroSendParams): UnsignedBridgeTransaction {
  const data = encodeFunctionData({
    abi: LZ_SEND_ABI,
    functionName: "send",
    args: [
      {
        dstEid: params.dstEid,
        receiver: toHex(addressToBytes32(params.receiver)),
        message: params.message ?? "0x",
        options: params.options ?? "0x",
        payInLzToken: params.payInLzToken ?? false,
      },
      params.refundAddress,
    ],
  });

  return {
    chainId: params.chainId,
    to: params.endpoint,
    // Carried here rather than left to the caller: a `send` with no fee attached
    // is accepted by the contract and never delivered, with no error to read.
    value: params.nativeFee ?? 0n,
    data,
    summary: `LayerZero send → eid ${params.dstEid}, fee ${(params.nativeFee ?? 0n).toString()} wei`,
  };
}

/** What a live probe found. */
export interface ProbeResult {
  /** `true` when the contract recognised the function and its argument types. */
  readonly resolved: boolean;
  readonly reason: string;
}

/**
 * Send encoded calldata to the live contract and read the revert.
 *
 * This is how the ABI above gets verified rather than recalled. A **contract-level**
 * revert (`ERC20: insufficient allowance`, say) proves the function and its
 * argument types resolved — the signature is right and the call got as far as
 * executing. A missing-selector revert proves they did not.
 *
 * That distinction is the whole point: a wrong ABI and an unfunded wallet both
 * produce a revert, and only the message tells them apart.
 *
 * Never sends anything — `eth_call` is a read, so no gas is spent and no state
 * changes. Safe to run against mainnet.
 */
export async function probeCall(
  client: PublicClient,
  transaction: UnsignedBridgeTransaction,
): Promise<ProbeResult> {
  const selector = transaction.data.slice(0, 10);
  try {
    await client.call({ to: transaction.to, data: transaction.data });
    // The call succeeded outright — the ABI resolved *and* nothing reverted.
    return { resolved: true, reason: "call succeeded with no revert" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unrecognised =
      /function selector was not recognized|returned no data|execution reverted \(no data\)/i.test(
        message,
      );
    return {
      resolved: !unrecognised,
      reason: unrecognised
        ? `contract did not recognise ${selector} — the ABI is wrong`
        : `reverted at the contract, so the ABI resolved: ${message.slice(0, 140)}`,
    };
  }
}
