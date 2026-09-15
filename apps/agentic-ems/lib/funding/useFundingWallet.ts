"use client";

/**
 * Funding from the user's own wallet, through the connector the app already has.
 *
 * Privy's external-wallet connectors are used rather than adding WalletConnect directly. Privy
 * already ships the WalletConnect/Reown stack — it is why @reown/appkit is in the tree — so the same
 * browser, mobile and hardware wallets are reachable without a second copy of the relay.
 *
 * That is not a preference. Adding `@walletconnect/ethereum-provider` was tried first and it broke
 * the production build: `next build` compiled, then failed prerendering /500 with
 * "Cannot read properties of null (reading 'useContext')". Removing it and nothing else restored a
 * green build, so the second relay is a real cost and this path avoids paying it.
 *
 * Nothing here sees a key. The transfer is proposed to the user's wallet, and the wallet — or the
 * device behind it — decides.
 */
import * as React from "react";
import { useConnectWallet, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import type { ChainKey } from "@/lib/execution/types";
import { transferData } from "./transfer";

export interface FundingTransferRequest {
  readonly token: { readonly address: Address; readonly decimals: number; readonly chain: ChainKey };
  readonly to: Address;
  readonly base: bigint;
}

export interface FundingWallet {
  /** The connected external wallet, or undefined until one is connected. */
  readonly address: Address | undefined;
  readonly error: string | null;
  connect(): void;
  send(request: FundingTransferRequest): Promise<`0x${string}`>;
}

export function useFundingWallet(): FundingWallet {
  const { connectWallet } = useConnectWallet();
  const { wallets } = useWallets();
  const [error, setError] = React.useState<string | null>(null);

  // The embedded wallet is excluded deliberately: it is the desk's own account, and "fund the desk
  // from the desk" is not a funding flow.
  const external = wallets.find((wallet) => wallet.walletClientType !== "privy");

  const connect = React.useCallback((): void => {
    setError(null);
    try {
      connectWallet();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The wallet could not be connected.");
    }
  }, [connectWallet]);

  const send = React.useCallback(
    async (request: FundingTransferRequest): Promise<`0x${string}`> => {
      setError(null);
      if (external === undefined) throw new Error("Connect a wallet first.");
      try {
        const provider = await external.getEthereumProvider();
        const hash = await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: external.address,
              // For an ERC-20 the transaction goes to the *token contract* and the recipient lives
              // in the calldata. Getting that backwards sends the tokens nowhere.
              to: request.token.address,
              data: transferData(request.to, request.base),
              value: "0x0",
            },
          ],
        });
        if (typeof hash !== "string") throw new Error("The wallet did not return a transaction hash.");
        return hash as `0x${string}`;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "The transfer was not sent.";
        setError(message);
        throw cause;
      }
    },
    [external],
  );

  return {
    address: external?.address as Address | undefined,
    error,
    connect,
    send,
  };
}
