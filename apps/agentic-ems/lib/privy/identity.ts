import type { User } from "@privy-io/react-auth";

/**
 * The identity + account data the desk needs from a Privy session.
 *
 * Privy provisions all of this on first email login:
 *   - the user (DID)
 *   - an embedded EOA wallet (createOnLogin: 'users-without-wallets')
 *   - a Safe-type smart account, signer-controlled by that EOA
 */
export interface PrivyIdentity {
  /** Privy DID — stable per user, useful for provenance. */
  userId: string;
  /** The email the user signed in with. */
  email: string;
  /** The embedded EOA that signs for the smart account. */
  embeddedAddress?: string;
  /** The user's personal smart account address. */
  smartAccountAddress?: string;
  /** Smart wallet provider, e.g. "safe". */
  smartWalletType?: string;
}

/** Extract desk-relevant identity from a Privy user object. */
export function identityFromUser(user: User): PrivyIdentity {
  const smartWallet = user.smartWallet;
  return {
    userId: user.id,
    email: user.email?.address ?? "",
    embeddedAddress: user.wallet?.address,
    smartAccountAddress: smartWallet?.address,
    smartWalletType: smartWallet?.smartWalletType,
  };
}
