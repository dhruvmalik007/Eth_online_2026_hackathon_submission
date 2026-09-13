---
name: Privy
description: Use when building wallet infrastructure, authentication systems, or financial applications. Reach for Privy when you need to create embedded wallets, manage user authentication, control wallet access with policies, execute transactions across blockchains, or build treasury/agent/organization wallet systems.
metadata:
    mintlify-proj: privy
    version: "1.0"
---

# Privy Skill Reference

## Product summary

Privy is a programmable wallet infrastructure platform for building financial applications. It provides embedded wallets (non-custodial, user-controlled), authentication systems, transaction execution, and policy controls across 50+ blockchains including Ethereum, Solana, Bitcoin, and Tempo. Use Privy's client SDKs (React, React Native, Swift, Android, Flutter, Unity) for frontend wallet integration, or server SDKs (Node.js, Java, Go, Rust, Ruby, Python) and REST API for backend wallet management. Key files: `appId` and `appSecret` from the Privy Dashboard (Configuration > App settings > Basics tab). Primary docs: https://docs.privy.io

## When to use

Reach for Privy when:

- **Building consumer apps**: Embed wallets for users without requiring external wallet clients. Authenticate users via email, social, passkeys, or wallet-based login.
- **Creating trading or fintech apps**: Set up server-side wallet access with scoped permissions, policies, and automated transaction execution.
- **Managing treasuries or organizations**: Create wallets owned by organizations or authorization keys with multi-sig approval workflows and spending policies.
- **Building AI agents**: Provision agent wallets with strict policy controls and offline signing capabilities.
- **Implementing financial flows**: Enable deposits, payouts, swaps, yield integrations, and card spend through Privy's financial infrastructure.
- **Migrating from other wallet providers**: Port users and wallets from Alchemy or other systems while preserving addresses and assets.

Do not use Privy for: non-financial blockchain applications, pure authentication without wallet needs (use Auth0 or similar), or applications requiring hardware wallet-only custody.

## Quick reference

### SDK Installation

| Platform | Command | Notes |
|----------|---------|-------|
| React | `npm install @privy-io/react-auth` | Wrap app with `PrivyProvider` at root |
| React Native | `npm install @privy-io/expo` | Requires Expo development build |
| Node.js | `npm install @privy-io/node` | Server-side wallet management |
| Swift | SPM: `https://github.com/privy-io/swift-sdk.git` | iOS/macOS apps |
| Android | Gradle: `io.privy:privy-android:latest` | Android apps |
| Java | Maven/Gradle via `@privy-io/java` | JVM backend services |
| Go | `go get github.com/privy-io/go-sdk` | Go backend services |
| Python | `pip install privy-python` | Python backend services |

### Core Configuration

| Item | Location | Purpose |
|------|----------|---------|
| App ID | Dashboard > Configuration > App settings > Basics | Public identifier for your app |
| App Secret | Dashboard > Configuration > App settings > Basics | Secret for API authentication (server-only) |
| App Clients | Dashboard > Configuration > App settings > Clients | Platform-specific overrides (mobile, web) |
| Login Methods | Dashboard > Configuration > Authentication | Enable email, SMS, social, passkeys, wallet login |
| Webhooks | Dashboard > Configuration > Webhooks | Subscribe to user, wallet, transaction events |
| Allowed Domains | Dashboard > Configuration > App settings > Domains | Whitelist origins for web apps |

### Common SDK Initialization

**React:**
```tsx
<PrivyProvider appId="your-app-id" clientId="optional-client-id" config={{
  embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } }
}}>
  {children}
</PrivyProvider>
```

**Node.js:**
```ts
const privy = new PrivyClient({ appId: 'your-app-id', appSecret: 'your-app-secret' });
```

**REST API:**
```bash
curl -X POST https://api.privy.io/v1/wallets \
  -H "Authorization: Basic $(echo -n 'app-id:app-secret' | base64)" \
  -H "privy-app-id: app-id"
```

### Wallet Types

| Type | Owner | Use Case | Control |
|------|-------|----------|---------|
| User wallet | User | Consumer apps, self-custody | User controls keys via client SDK |
| Server wallet | Authorization key | Automation, trading bots | Server controls via API/SDK |
| Organization wallet | Organization/key quorum | Treasury, multi-sig | Org members approve via dashboard |
| Custodial wallet | Licensed custodian | Regulated accounts | Custodian approves all transactions |

### Authentication Methods

| Method | Configuration | Best for |
|--------|---------------|----------|
| Email/SMS | Dashboard > Authentication | Broad user base |
| Social (Google, Discord, Twitter) | Dashboard > Authentication | Familiar login |
| Passkeys | Dashboard > Authentication | Biometric/secure |
| Wallet (MetaMask, Phantom) | Dashboard > Authentication | Crypto-native users |
| Farcaster | Dashboard > Authentication | Farcaster mini apps |
| Custom JWT | Dashboard > Authentication > JWT-based | Existing auth systems |

## Decision guidance

### When to use embedded wallets vs external wallets

| Scenario | Embedded | External |
|----------|----------|----------|
| New users, no existing wallet | ✓ | ✗ |
| Users bring existing MetaMask/Phantom | ✗ | ✓ |
| Seamless onboarding priority | ✓ | ✗ |
| User already has assets elsewhere | ✗ | ✓ |
| Server-side automation needed | ✓ | ✗ |
| User controls keys directly | ✓ | ✓ |

### When to use client-side vs server-side signing

| Scenario | Client SDK | Server SDK |
|----------|-----------|-----------|
| User initiates transaction | ✓ | ✗ |
| Automated trading/limit orders | ✗ | ✓ |
| User approval required | ✓ | ✗ |
| Scoped permissions (signer) | ✓ | ✓ |
| Treasury operations | ✗ | ✓ |
| Agent wallets | ✗ | ✓ |

### When to use policies vs manual approvals

| Scenario | Policies | Manual Approvals |
|----------|----------|-----------------|
| Enforce spending limits | ✓ | ✗ |
| Restrict recipient addresses | ✓ | ✗ |
| Require human review | ✗ | ✓ |
| Time-based restrictions | ✓ | ✗ |
| Multi-party sign-off | ✗ | ✓ |
| Automated enforcement | ✓ | ✗ |

## Workflow

### 1. Set up your Privy app

1. Create an app in the Privy Dashboard (https://dashboard.privy.io)
2. Copy your **App ID** and **App Secret** from Configuration > App settings > Basics
3. Configure login methods in Configuration > Authentication (email, social, passkeys, etc.)
4. Add allowed domains in Configuration > App settings > Domains (for web apps)
5. Create app clients in Configuration > App settings > Clients (for mobile/non-web platforms)

### 2. Integrate authentication

**For React apps:**
1. Install `@privy-io/react-auth`
2. Wrap your app with `PrivyProvider` at the root, passing your `appId`
3. Use `usePrivy()` hook to access `login`, `logout`, and `user` state
4. Wait for `ready === true` before consuming Privy state
5. Call `login()` to trigger authentication flow

**For server-side:**
1. Install `@privy-io/node` (or language-specific SDK)
2. Initialize `PrivyClient` with `appId` and `appSecret`
3. Use `privy.users().create()` to create users programmatically
4. Use `privy.users().get()` to fetch user objects

### 3. Create and manage wallets

**Automatic creation (React):**
1. Set `createOnLogin: 'users-without-wallets'` in `PrivyProvider` config
2. Wallets are created automatically during login for users without wallets

**Manual creation (React):**
1. Use `useCreateWallet()` hook after user is authenticated
2. Call `createWallet()` to create Ethereum or Solana wallet
3. Access wallet via `useWallets()` hook

**Server-side creation:**
1. Call `privy.wallets().create({ chain_type: 'ethereum', owner: { user_id: 'user-id' } })`
2. Store returned wallet ID for future operations
3. For organization wallets, set `entity: { id: 'org-id', type: 'organization' }`

### 4. Execute transactions

**Client-side (React):**
1. Get wallet via `useWallets()` hook
2. For Ethereum: use `useSendTransaction()` or `useSignTransaction()` hooks
3. For Solana: use `useSendTransaction()` or `useSignTransaction()` from Solana hooks
4. Pass transaction parameters (to, amount, data, etc.)
5. User signs in secure enclave; transaction broadcasts to chain

**Server-side:**
1. Call `privy.wallets().ethereum().sendTransaction()` with wallet ID and transaction params
2. Include authorization context (app key or user JWT) for signing
3. Transaction is signed server-side and broadcast
4. Poll transaction status via webhooks or `privy.transactions().get()`

### 5. Set up policies and controls

1. Create a policy via REST API or dashboard: `POST /v1/policies` with conditions (amount limits, recipient whitelist, etc.)
2. Attach policy to wallet at creation: `policy_ids: ['policy-id']`
3. For signers, create authorization keys: `POST /v1/authorization-keys`
4. Add signers to wallet: `additional_signers: [{ signer_id: 'key-quorum-id' }]`
5. Assign signer-specific policies to scope permissions

### 6. Monitor with webhooks

1. Configure webhook endpoint in Dashboard > Configuration > Webhooks
2. Subscribe to event types: `user.created`, `wallet.funds_deposited`, `transaction.confirmed`, `wallet_action.swap.succeeded`, etc.
3. Verify webhook signatures using Privy's public key
4. Handle events in your backend (update database, trigger workflows, etc.)
5. Implement retry logic; Privy retries failed deliveries

## Common gotchas

- **HTTPS required for embedded wallets**: Embedded wallets use WebCrypto API, which only works in secure contexts (https://). Localhost is treated as secure by browsers. If wallets don't create in production, verify your deployment uses https://.

- **App Secret exposure**: Never expose your App Secret in client-side code. Use it only on your backend. If exposed, regenerate it immediately in the Dashboard.

- **Missing `ready` check**: Don't consume Privy state before `ready === true` in React. This causes stale data and race conditions. Always check `const {ready} = usePrivy()` before using hooks.

- **Policy evaluation timing**: Policies are evaluated at request time in secure enclaves. They cannot be changed retroactively. Plan policy structure before wallet creation.

- **Rate limits on API calls**: Privy rate limits REST API endpoints. Implement exponential backoff and batch requests where possible. See `/recipes/dashboard/optimizing` for best practices.

- **Wallet creation on login**: If `createOnLogin: 'users-without-wallets'` is set, wallets are created automatically. To prevent this (e.g., during migration), set `createOnLogin: 'off'` and create wallets manually.

- **Authorization context required for server signing**: Server-side wallet operations require an authorization context (app key or user JWT). Requests without proper authorization will fail with 401/403 errors.

- **Idempotency keys for critical operations**: Use idempotency keys when creating wallets or executing transactions to prevent duplicates if requests are retried. Pass `idempotency_key` header with a unique UUID.

- **Webhook signature verification**: Always verify webhook signatures using Privy's public key before processing events. Unverified webhooks can be spoofed.

- **External wallet connection**: External wallets (MetaMask, Phantom) require explicit user action to connect. They are not automatically created and must be linked to Privy users via `linkAccount()`.

## Verification checklist

Before submitting work with Privy:

- [ ] App ID and App Secret are correctly configured (Secret not exposed in client code)
- [ ] `PrivyProvider` wraps the app at the root level (React)
- [ ] `ready` state is checked before consuming Privy hooks
- [ ] Wallet creation strategy is clear (automatic vs manual)
- [ ] Authentication methods are enabled in Dashboard
- [ ] Allowed domains are configured for web apps
- [ ] Policies are attached to wallets if needed (spending limits, recipient restrictions)
- [ ] Authorization context is set up for server-side operations
- [ ] Webhook endpoint is configured and signatures are verified
- [ ] Error handling covers common cases (network errors, policy violations, rate limits)
- [ ] Transactions are tested on testnet before production
- [ ] HTTPS is enforced for production deployments
- [ ] Rate limit handling is implemented (exponential backoff, batching)

## Resources

- **Comprehensive navigation**: https://docs.privy.io/llms.txt (page-by-page listing of all documentation)
- **Getting started**: https://docs.privy.io/basics/get-started/about
- **Wallet infrastructure**: https://docs.privy.io/wallets/overview
- **API reference**: https://docs.privy.io/api-reference/introduction
- **Authentication**: https://docs.privy.io/authentication/overview
- **Controls and policies**: https://docs.privy.io/controls/overview
- **Recipes and examples**: https://docs.privy.io/recipes/overview
- **Troubleshooting**: https://docs.privy.io/basics/troubleshooting/error-handling/client-errors

---

> For additional documentation and navigation, see: https://docs.privy.io/llms.txt