# ETHOnline 2026 — Prize Pools & Bounties

> **Total Prize Pool: $85,000** across 11 sponsors
> **Event**: ETHOnline 2026 (ETHGlobal)
> **Track Types**: Start Fresh (net-new projects) | Continuity (extending existing projects)

---

## Quick Summary

| # | Sponsor | Total Prize | # of Tracks | Category Focus |
|---|---------|-------------|-------------|----------------|
| 1 | The Graph | $15,000 | 3 | Blockchain Data / AI / Indexing |
| 2 | Hedera | $15,000 | 4 | Agentic Payments / Tokenization / Open Source |
| 3 | Arc (Circle) | $10,000 | 4 | DeFi / Agentic Economy / Stablecoins |
| 4 | World | $7,000 | 2 | Human Verification / AI Agents |
| 5 | 1inch | $7,000 | 2 | DeFi / SwapVM / Liquidity |
| 6 | ENS | $5,000 | 2 | Identity / Naming / ENSv2 |
| 7 | Uniswap Foundation | $5,000 | 2 | AMM / DeFi / Protocol Contributions |
| 8 | Ledger | $5,000 | 2 | AI Agents / Hardware Security |
| 9 | Privy | $5,000 | 2 | B2B Finance / Wallet Infrastructure |
| 10 | Chainlink | $3,000 | 3 | Confidential Workflows / Oracles |
| 11 | Bazantic | $3,000 | 3 | AI Tooling / API Recipes |

---

## 1. The Graph — $15,000

**Website**: [thegraph.com](https://thegraph.com) | **Handle**: @graphprotocol

### About
The Graph is blockchain data infrastructure spanning 50+ networks, serving developers, analysts, AI agents, and enterprises with structured, real-time data. Products include Subgraphs, Firehose, Substreams, and Amp. As of 2026: 1.27T+ queries served to 75,000+ projects via independent Indexers.

---

### Track 1.1: Best Use of Composable or Standardized Graph Products — $5,000

| Placement | Prize |
|-----------|-------|
| 1st Place | $2,500 |
| 2nd Place | $1,500 |
| 3rd Place | $1,000 |

**Task**: Build on The Graph's composable and standardized data products. Use Standardized Subgraphs (one shared schema across every protocol of a type) to run a single query across many protocols, compose reusable Substreams packages into new pipelines, or layer the Subgraph MCP on top for cross-protocol analysis. Contributing a new composable Substreams module for an emerging standard, such as ERC-4626 tokenized-vault flows, also counts.

**What Judges Want**: The best submissions show the leverage of standards: one query pattern spanning many protocols, or one pipeline reused across chains.

**Qualification Requirements**:
- Either compose two or more of The Graph's products, or build meaningfully on a standardized schema (e.g., Messari Standardized Subgraphs)
- Consume live data from a Graph provider (Subgraph Studio for Subgraphs, The Graph Market for Substreams). Mocked/local-only/static datasets do NOT qualify
- Simply querying one Subgraph with no composition or standardization does NOT qualify
- Authoring or extending a Standardized Subgraph, or contributing a reusable composable Substreams module, is in scope
- Make the standards leverage clear: show what became easier because a shared schema or composed product was used
- Submit a public repository and a short demo video (2-4 minutes)

**Resources**:
- [Messari Standardized Subgraph](https://thegraph.com/docs/en/subgraphs/existing-subgraphs/standard-subgraphs/)
- [Agent0/ERC-8004 Subgraphs](https://thegraph.com/docs/en/subgraphs/existing-subgraphs/agent0/)
- [Standardized Substreams](https://github.com/streamingfast/substreams-chain-modules)
- [Pinax Primitives for EVM Substreams](https://github.com/pinax-network/substreams-evm)

---

### Track 1.2: Best AI Tooling or AI Use Case (From Scratch) — $5,000

| Placement | Prize |
|-----------|-------|
| 1st Place | $2,500 |
| 2nd Place | $1,500 |
| 3rd Place | $1,000 |

**Pool**: Start Fresh (net-new projects begun during hackathon)

**Task**: One AI track, two ways to build. Rewards both:
1. **Tooling** that makes The Graph easier to use from AI environments (Claude, Cursor, ChatGPT) — new/extended MCP servers, agent SKILLs, x402 payment tooling, A2A integrations, framework plugins, or client configs
2. **AI agents or apps** that use The Graph as their live source of blockchain data — research assistants, trading/execution agents, portfolio copilots, risk monitors

**Featured Challenge**: Use the Substreams SKILLs to go from a single natural-language prompt to a working, deployed Substreams pipeline.

**Qualification Requirements**:
- Use The Graph as a load-bearing part: either AI tooling targets The Graph's products/AI Suite, or the agent/app uses The Graph (Subgraphs, Subgraph MCP, or Substreams) as its source of blockchain data
- Consume live data from a Graph provider. Mocked/local-only/static datasets do NOT qualify
- Do meaningful work with the data: reasoning, decisions, automation, or a natural-language interface, not just printing raw query results
- Tooling submissions must be reusable infrastructure, not a single end-user app
- Open-source the code with a clear README or SKILL.md so judges can run it
- Submit a public repository + short demo video (2-4 minutes)
- Select the pool that matches how you built: Start Fresh for net-new

**Resources**:
- [Subgraph MCP](https://thegraph.com/docs/en/subgraphs/tooling/subgraph-mcp/introduction/)
- [Subgraph SKILLs](https://github.com/graphprotocol/subgraphs-skills)
- [Substreams SKILLs](https://github.com/streamingfast/substreams-skills)

---

### Track 1.3: Best AI Tooling or AI Use Case (Continuity) — $5,000

| Placement | Prize |
|-----------|-------|
| 1st Place | $2,500 |
| 2nd Place | $1,500 |
| 3rd Place | $1,000 |

**Pool**: Continuity (extending existing open-source repo or shipping a new feature on an existing product)

**Task**: Same as Track 1.2 but for projects that extend an existing open-source repo or ship a new feature on an existing product. Document the pre-existing work; only work done during the event is judged. Extending The Graph's own AI Suite (improving an existing MCP server or SKILL) fits this pool.

**Qualification Requirements**: Same as Track 1.2, plus:
- Document any pre-existing work
- Extending The Graph's own AI Suite fits the Continuity pool

**Resources**: Same as Track 1.2

---

## 2. Hedera — $15,000

**Website**: [hedera.com](https://hedera.com) | **Handle**: @hedera

### About
Hedera is a leading EVM blockchain with distinctive developer experience, enabling developers to leverage familiar tools like Solidity or JavaScript SDK. Features: 10,000+ TPS, 3s finality, low fees priced in USD, and aBFT-grade security. Governed by a diverse council of the world's leading institutions.

---

### Track 2.1: AI & Agentic Payments on Hedera — $6,000

| Placement | Prize |
|-----------|-------|
| Up to 3 teams | $2,000 each |

**Task**: Stand up a real x402-gated service on Hedera and build the platform that consumes it. Wrap an API, sell inference by the call, meter data or compute, then show an agent discovering it and paying for it without an API key or subscription.

**Ideas**:
- Pay-per-call inference endpoint — host a model behind x402 and build an agent that budgets across providers
- Metered data feed — price by query, settle per request, no seats or subscriptions
- Agent marketplace — services register, agents discover and pay, all in HBAR or HTS tokens
- Micropayment streaming — settle every few seconds for compute or bandwidth in use

**Qualification Requirements**:
- Host a live x402-gated service on Hedera testnet or mainnet, settled through the Blocky402 facilitator
- Build a platform or agent that consumes that service and completes at least one real paid request end to end
- Public GitHub repo with README covering setup, architecture, and payment flow
- Demo video of 5 minutes or less showing the paid request executing

**Extra Points For**:
- Pay-per-call inference, data, or compute metering (rather than flat per-request)
- Multi-agent negotiation and settlement via A2A or ACP
- On-chain agent identity using ERC-8004 or HCS-14
- Agent discovery via UCP or a directory
- HTS tokens or custom fee schedules in settlement path
- Verifiable payment audit trails on HCS
- Recurring or streamed payments using Scheduled Transactions

**Resources**:
- [Hedera Code Snippets](https://github.com/hedera-dev/hedera-code-snippets)
- [Hedera and x402 Payment Standard](https://hedera.com/blog/hedera-and-the-x402-payment-standard/)
- [Blocky402 Facilitator](https://blocky402.com/)
- [x402 Pay-per-Request Inference PoC](https://github.com/hedera-dev/x402-inference-pay-per-request-poc)
- [Hedera Agent Kit](https://github.com/hashgraph/hedera-agent-kit-js)
- [Hedera Developer Docs](https://docs.hedera.com/)
- [Starter Template](https://github.com/hedera-dev/scaffold-hbar)
- [x402 Protocol](https://github.com/x402-foundation/x402)

---

### Track 2.2: Open Source — Improve the Hedera Harness — $2,000

| Placement | Prize |
|-----------|-------|
| Up to 2 teams | $1,000 each |

**Task**: Make the Hedera Harness better, or build a new one on its foundations. Contribution over greenfield.

**Ideas**:
- Extend service coverage into areas the harness handles thinly today
- Port the harness to another language or runtime
- Fix rough edges you personally hit in your first hour with Hedera
- Add a testing or local-development mode that removes testnet round trips

**Qualification Requirements**:
- Either submit a meaningful contribution to the Hedera Harness (open PR, not merged is fine) or build a new harness that extends or takes direct inspiration from it
- Public GitHub repo or PR link, with README or PR description explaining the problem solved
- Demo video of 5 minutes or less showing the improvement working

**Extra Points For**:
- New service coverage, better ergonomics, or fewer lines of code needed
- Tests, documentation, or examples alongside the code
- A harness targeting a language or framework the current one does not cover
- Clear before and after evidence of the developer experience gain

**Resources**:
- [Hedera Harness](https://github.com/hedera-dev/hedera-harness)
- [Hedera Skills](https://github.com/hedera-dev/hedera-skills)
- [Getting Started with Hedera SDKs](https://docs.hedera.com/hedera/getting-started-sdk-developers)
- [Hedera Developer Tooling Overview](https://hedera.com/developer-tooling/)

---

### Track 2.3: Tokenization of Anything — $6,000

| Placement | Prize |
|-----------|-------|
| Up to 3 teams | $2,000 each |

**Task**: Build an enterprise finance application on Hedera using the Asset Tokenization Studio (ATS). Use the SDK, adapt it, extend the web application, or improve it. ATS supports ERC-3643 alongside ERC-1400, with compliance controls, corporate actions, and coupon handling.

**Ideas**:
- Tokenised collateral for repo — post tokenised treasuries as collateral with programmatic proof and release
- Bonds with a lifecycle — issuance, coupon payments, and redemption at maturity, all on-chain
- Secondary market for ATS assets — order book or auction with compliance enforced at transfer
- Tokenised equities — KYC-gated register with automated corporate actions
- Cashflow tokenisation — invoices, receivables, or royalty streams sold at a discount and settled on maturity

**Qualification Requirements**:
- Use the Asset Tokenization Studio (SDK, contracts, web application, or combination) to issue or manage a tokenised asset
- Deploy and demonstrate on Hedera testnet
- Public GitHub repo, with contracts verified on HashScan where applicable
- Demo video of 5 minutes or less showing issuance, configuration, and at least one lifecycle operation (transfer, compliance check, or distribution)

**Extra Points For**:
- A secondary market for ATS-issued assets
- Compliance controls in use: KYC grants, freezes, transfer restrictions, pauses
- Custom fee schedules, coupon or dividend distributions, royalty flows
- Oracle integration for asset pricing or NAV
- Scheduled Transactions for vesting, coupon payments, or maturity settlement
- Contributions back upstream to ATS

**Resources**:
- [Asset Tokenization Studio Monorepo](https://github.com/hashgraph/asset-tokenization-studio)
- [ATS SDK on npm](https://www.npmjs.com/package/@hashgraph/asset-tokenization-sdk)
- [Starter Templates: scaffold-hbar](https://github.com/hedera-dev/scaffold-hbar)
- [ATS Product Overview and Tutorials](https://hedera.com/product/asset-tokenization-studio/)
- [ATS Documentation](https://docs.hedera.com/hedera/open-source-solutions/asset-tokenization-studio-ats)

---

### Track 2.4: Continuity — $1,000

**Pool**: Continuity Track participants only

**Task**: Bringing back a project you have already built on Hedera? This track is for you. We want to see it move forward, not resubmitted.

**Qualification Requirements**:
- The project must have been built for a previous hackathon or already exist in some form on Hedera
- Demonstrate substantive new work completed during this event: new features, new Hedera services integrated, or a significant architectural change. Polish and bug fixes alone will not qualify
- Public GitHub repo with README that clearly separates what existed before from what is new
- Demo video of 5 minutes or less focused on the new work

**Extra Points For**:
- Evidence of real users, traction, or deployment beyond the demo
- Newly integrated Hedera services that were not in the original build
- A clear roadmap for what comes after the hackathon

**Resources**:
- [Start Building on Hedera](https://hedera.com/start-building/)
- [Hedera Developer Docs](https://docs.hedera.com/)
- [Hedera Developer Tooling](https://hedera.com/developer-tooling/)

---

## 3. Arc (Circle) — $10,000

**Website**: [arc.network](https://arc.network) | **Handle**: @arc

### About
Arc is the purpose-built L1 blockchain from Circle, EVM-compatible, serving as the Economic OS for the internet — powering the programmable trust layer and transaction engine where capital, humans, and machines coordinate. Enables builders to power onchain lending, capital markets, FX, and payments.

**Core Products**: Arc, USDC, App Kits, Circle Wallets, Circle Contracts, CCTP, Gateway, StableFX, Agent Stack, Nanopayments, Paymaster

---

### Track 3.1: Best DeFi/Onchain Finance Application — $1,667

**Task**: Build stablecoin-native DeFi on Arc. Build lending, borrowing, swaps, liquidity, FX, yield, payments, treasury or fintech infrastructure using Arc and USDC.

**What Judges Want**:
- Meaningful use of Arc and USDC
- Advanced programmable money flows (conditional payments, onchain automation, multi-step settlement)
- Payment, liquidity or treasury workflows using App Kits where relevant
- Applications that show why stablecoin-native infrastructure changes what is possible

**Qualification Requirements**:
- Functional MVP and architecture diagram (working frontend + backend)
- Video demonstration + presentation outlining core functions and effective use of Circle's Developer tools
- Link to GitHub/Replit repo

---

### Track 3.2: Best Agentic Economy Application with Circle Agent Stack — $1,667

**Task**: Build autonomous agents that transact on Arc. Build AI agents that hold wallets, make payments, manage risk, settle jobs or transact with other agents using USDC.

**What Judges Want**:
- Agents with clear decision logic tied to real signals
- Autonomous spending, payments or settlement flows using USDC
- Use of Agent Stack to connect agents to wallets, USDC payments and onchain actions
- Use of Nanopayments, Paymaster or App Kits where relevant for agent-to-agent or service payments

**Qualification Requirements**:
- Functional MVP and architecture diagram (working frontend + backend)
- Video demonstration + presentation outlining core functions and effective use of Circle's Developer tools
- Link to GitHub/Replit repo

---

### Track 3.3: Best DeFi or Agentic Application (Continuity) — $1,666

**Pool**: Continuity Track participants only

**Task**: Same scope as Tracks 3.1 and 3.2 combined — build stablecoin-native DeFi OR agentic economy application on Arc, but for existing projects being extended.

**Qualification Requirements**:
- Functional MVP and architecture diagram
- Video demonstration + presentation
- Link to GitHub/Replit repo
- Must be registered as a Continuity Project

---

### Track 3.4: Launch on Arc Testnet & Push to Mainnet — $3,500

| Placement | Prize |
|-----------|-------|
| 1st Place | $2,500 |
| 2nd Place | $1,000 |

**Task**: Add a working Arc integration. The goal isn't just to prototype: we want to see projects that are ready to ship to mainnet!

**What Judges Want**:
- USDC or EURC payment flows on Arc added to a commerce, fintech, or wallet product
- Crosschain transfers or unified balance integrated into a production project, with Arc as core settlement layer
- Agentic payments shipped into an AI agent or API monetization tool
- Stablecoin settlement or escrow logic on Arc added to a DeFi protocol or marketplace
- Arc-powered treasury or FX features built into a multi-chain product

**Qualification Requirements**:
- Functional MVP and architecture diagram
- Video demonstration + presentation
- Link to GitHub/Replit repo
- **Projects must be deployed or deployment-ready on Arc mainnet by September 30**

---

### Track 3.5: Launch on Arc Testnet & Push to Mainnet (Continuity) — $1,500

**Pool**: Continuity Track participants only

**Task**: Take a project you own — an existing MVP, open source repo, or live product — and add a working Arc integration. Ready to ship to mainnet.

**Qualification Requirements**: Same as Track 3.4, plus must be registered as Continuity Project

**Resources**:
- [Arc Docs](https://docs.arc.io/)
- [App Kits](https://docs.arc.io/app-kit)
- [Circle Dev Docs](https://developers.circle.com/)
- [Agent Stack Starter Kit](https://github.com/circlefin/agent-stack-starter-kits)

---

## 4. World — $7,000

**Website**: [world.org](https://world.org) | **Handle**: @worldnetwork

### About
World's developer stack helps builders create products for verified humans and AI-assisted interactions. World ID enables apps to confirm someone is a unique human without revealing their identity. AgentKit helps identify when agents are backed by real humans rather than bots. Selfie Check offers low-friction, selfie-based credential that confirms a real, live person is behind the screen.

---

### Track 4.1: AgentKit Continuity — $3,500

| Placement | Prize |
|-----------|-------|
| Up to 3 teams | $1,166 each |

**Pool**: Continuity Track participants only

**Task**: Extend an existing project with AgentKit to distinguish a bot from an agent acting on behalf of a real, unique human. Explore durable human-backed agent authorization for access, commerce, rate limits, trust, and continuity across services.

**Qualification Requirements**:
- Uses AgentKit in a meaningful way
- Shows a working app
- Registers or resolves agents through AgentBook where relevant
- Uses the World ID Sandbox App to test the project remotely
- Includes feedback document on:
  - AgentKit docs and integration flow
  - Developer Portal navigation, search, product discovery, and debugging guidance
  - Sandbox App states, proof flows, test users, errors, and edge cases
  - What was confusing, missing, broken, or hard to test

**Resources**:
- [AgentKit](https://docs.world.org/agents/agent-kit/integrate)
- [AgentKit Repo](https://github.com/worldcoin/agentkit)

---

### Track 4.2: Selfie Check — $3,500

| Placement | Prize |
|-----------|-------|
| Up to 3 teams | $1,166 each |

**Task**: Build and demo a realistic Selfie Check flow that validates where a low-friction, low-assurance biometric credential is useful for risk, eligibility, fairness, continuity, or abuse prevention.

**Qualification Requirements**:
- Uses Selfie Check or a Selfie Check-compatible World ID credential flow in a meaningful way
- Treats Selfie Check as a risk, eligibility, fairness, continuity, or abuse-prevention signal
- Includes feedback document on SelfieCheck docs, Developer Portal, Sandbox App, and what was confusing/missing/broken
- Shows a working app

**Resources**:
- [Selfie Check](https://docs.world.org/world-id/credentials/11)
- [Selfie Check Sandbox Testing](https://docs.world.org/world-id/sandbox/testing-selfie-check)
- [World Developer Portal](https://developer.world.org)
- [World Docs](https://docs.world.org/)
- [Sandbox Access](https://forms.gle/mqbaiwMvX5MzmKdY8)

---

## 5. 1inch — $7,000

**Website**: [1inch.com](https://1inch.com) | **Handle**: @1inch

### About
1inch is a network of decentralized protocols focusing on unifying DeFi liquidity. Known for the DEX aggregator launched in 2019. Recent release: Aqua — reimagines DEX design by introducing self-custodial liquidity provisioning, allowing users to earn yield without depositing into another contract.

---

### Track 5.1: Build an Aqua App — $5,000

| Placement | Prize |
|-----------|-------|
| 1st Place | $2,500 |
| 2nd Place | $1,500 |
| 3rd Place | $1,000 |

**Task**: Create a custom Aqua app that implements a sophisticated DeFi position. If you use SwapVM, you may modify SwapVM opcodes and define your own instructions. The final positions must be demonstrated through test scripts or a UI.

**Note**: Projects that utilize SwapVM will be scored higher during final judging.

**Qualification Requirements**:
- Official Aqua/SwapVM contracts must be used (redeployments of modified SwapVM contract allowed)
- Onchain execution of token transfers should be presented during final demo (local forks ok)
- Proper Git commit history (no single-commit entries on the final day)

**Resources**:
- [SwapVM Smart Contracts](https://github.com/1inch/swap-vm/tree/main)
- [Aqua Smart Contracts](https://github.com/1inch/aqua)
- [Aqua SDK](https://github.com/1inch/sdks/tree/master/typescript/aqua)

---

### Track 5.2: Build an Aqua App (Continuity) — $2,000

| Placement | Prize |
|-----------|-------|
| 1st Place | $1,500 |
| 2nd Place | $500 |

**Pool**: Continuity Track participants only

**Task**: Same as Track 5.1 — create a custom Aqua app implementing a sophisticated DeFi position, for existing projects being extended.

**Qualification Requirements**: Same as Track 5.1

**Resources**:
- [SwapVM Contracts](https://github.com/1inch/swap-vm/tree/main)
- [Aqua Smart Contracts](https://github.com/1inch/aqua)
- [Aqua SDK](https://github.com/1inch/sdks/tree/master/typescript/aqua)
- [SwapVM Whitepaper](https://github.com/1inch/swap-vm/blob/release/1.1/docs/whitepaper-swap-vm-1.0.pdf)
- [Aqua Whitepaper](https://github.com/1inch/aqua/blob/main/docs/whitepaper-aqua-1.0.pdf)

---

## 6. ENS — $5,000

**Website**: [ens.domains](https://ens.domains) | **Handle**: @ensdomains

### About
ENS is the universal pointer for anything on the internet. Turns wallet addresses into human-readable names like yourname.eth — a portable, onchain profile that works across every app, chain, and wallet. As AI agents become first-class onchain actors, ENS is how you give them a name, a reputation, and a place to be found.

---

### Track 6.1: Best Use of ENSv2 — $4,500

| Placement | Prize |
|-----------|-------|
| 1st Place | $1,500 |
| 2nd Place | $1,500 |
| 3rd Place | $1,000 |
| Runner-Up | $500 |

**Task**: ENSv2 beta is now live on Sepolia — be among the first to build on it. Explore the new hierarchical registry structure: resolve subnames straight off a parent's resolver with wildcard resolution, or deploy your own subname registry to tokenize and manage subnames under your own rules. Use Enhanced Access Control to delegate specific rights. Give subnames their own Permissioned Resolver, mix in record aliasing or namespace aliasing, and combine it all to build subname setups — expiring, revocable, non-transferable vs. transferable, even forever names with no parent control.

**Bonus**: Bring AI agents into the mix — think agents as namespaces, each with their own identity and permissions.

**Qualification Requirements**:
- Project must be built on ENSv2 (Sepolia)
- ENSv2 features should be central to the product, not a cosmetic add-on
- Demo must be functional, not just hard-coded values
- Video recording or link to live demo (ideally both)
- Code must be open source and accessible on GitHub or similar

**Resources**:
- [Permissioned Registry docs](https://docs.ens.domains/ensv2/permissioned-registry)
- [Permissioned Resolver docs](https://docs.ens.domains/ensv2/permissioned-resolver)
- [Enhanced Access Control docs](https://docs.ens.domains/ensv2/enhanced-access-control)
- [Guide for Contract Developers](https://docs.ens.domains/ensv2/tutorial-contract-developers)

---

### Track 6.2: Best Integration of ENSv2 into an Existing Project — $500

**Pool**: Continuity Track participants only

**Task**: Explore how ENSv2's feature set — new registry hierarchy, Enhanced Access Control, Permissioned Resolvers, record and namespace aliasing — can plug into an existing protocol or project to improve UX or unlock new use cases. Take a project you already know and integrate it against ENSv2 on its testnet deployment.

**Qualification Requirements**:
- Integration must use ENSv2 on Sepolia and target an existing project's testnet deployment
- Clear how ENSv2 improves the project, not just a cosmetic add-on
- Demo must be functional
- Video recording or link to live demo
- Code must be open source

**Resources**:
- [Guide for App Developers](https://docs.ens.domains/ensv2/tutorial-app-developers)
- [ENSv2 Docs](https://docs.ens.domains/ensv2/overview)
- [Building with AI](https://docs.ens.domains/building-with-ai/)
- [Agent-native CLI](https://github.com/ensdomains/ens-cli)
- [AI Agent Registry ENS Name Verification](https://docs.ens.domains/ensip/25/)
- [Agent Text Records](https://docs.ens.domains/ensip/26/)

---

## 7. Uniswap Foundation — $5,000

**Website**: [uniswapfoundation.org](https://uniswapfoundation.org) | **Handle**: @uniswapfnd

### About
The Uniswap Foundation works to advance DeFi by providing critical support for protocol innovation, developer success, and governance empowerment. Foundation initiatives have driven the growth of Unichain, Uniswap v4, and the work of more than 100 grantees.

---

### Track 7.1: Best Uniswap Stack Contribution — $3,000

| Placement | Prize |
|-----------|-------|
| Up to 3 teams | $1,000 each |

**Task**: Build on or integrate any part of the Uniswap stack, including the Uniswap API, the Uniswap AMM (v2, v3, or v4), CCA, or any other Uniswap protocol. This also includes new v4 hooks, extensions or improvements to official Uniswap repositories, and tooling or solutions built for the broader ecosystem.

**Qualification Requirements**:
- Public GitHub repository with open-source code
- A FEEDBACK.md file
- Completed submission to the [Uniswap Developer Feedback Form](https://developers.uniswap.org/hackathon-feedback) including the link to your FEEDBACK.md
- README must clearly point to relevant contracts and lines of code for verification

---

### Track 7.2: Best Uniswap Stack Contribution (Continuity) — $2,000

| Placement | Prize |
|-----------|-------|
| 1st Place | $1,000 |
| 2nd Place | $1,000 |

**Pool**: Continuity Track participants only

**Task**: Same as Track 7.1 — build on or integrate any part of the Uniswap stack, but for existing projects being extended.

**Qualification Requirements**: Same as Track 7.1

**Resources**:
- [Uniswap Docs](https://developers.uniswap.org/docs)
- [Uniswap Developer Platform](https://developers.uniswap.org/dashboard)
- [Uniswap Developer Support](https://developers.uniswap.org/docs?form=help)
- [Uniswap Hackathon Feedback](https://developers.uniswap.org/hackathon-feedback)
- [Uniswap AI](https://github.com/Uniswap/uniswap-ai)

---

## 8. Ledger — $5,000

**Website**: [ledger.com](https://ledger.com) | **Handle**: @ledger

### About
Build AI agents and AI-powered products that use Ledger as the trust layer. Start something new or extend a project you already have.

---

### Track 8.1: AI Agents x Ledger — $3,500

| Placement | Prize |
|-----------|-------|
| 1st Place | $2,000 |
| 2nd Place | $1,000 |
| 3rd Place | $500 |

**Task**: Start something new during the event. We are looking for projects where device-backed security is central to the product: agents that hold secrets they cannot leak, agents that pay for what they use, systems that ask for a human before anything irreversible, and products that make autonomous behavior safer instead of bypassing user intent.

**What Judges Want**:
- Agents that use secrets they cannot leak: a broker hands out scoped capabilities, never the API key
- Bring the Key Ring to hosts with no USB port: enroll a VPS, a CI runner, or a hosted agent
- Both must be built on the Ledger Agent Stack, and in particular on the Ledger Key Ring CLI (wallet-cli ring)
- Agents that pay for APIs, tools, or services with Ledger-secured payment flows, including x402-style patterns
- Human-in-the-loop agents where Ledger approves high-risk actions before funds move or permissions escalate

**Resources**:
- [Track details](https://developers.ledger.com/ethonline)

---

### Track 8.2: Continuity — $1,500

| Placement | Prize |
|-----------|-------|
| 1st Place | $1,000 |
| 2nd Place | $500 |

**Pool**: Continuity Track participants only

**Task**: For teams extending a project they already had before the event. Show us what the Ledger Agent Stack adds to something real: give an existing app a hardware signer, move its secrets onto the Key Ring, or put a device confirmation in front of an action that previously had none.

**Example Directions**:
- Add a Ledger signer to an app you have already shipped, using the DMK skills
- Make wallet-cli ring the key backend for the .env, sops, or age files your repo already has
- Put a device confirmation in front of an action your product already performs
- Pick up an open issue on a Ledger repository and land it as a real fix

**Resources**:
- [Track details](https://developers.ledger.com/ethonline)

---

## 9. Privy — $5,000

**Website**: [privy.io](https://privy.io) | **Handle**: @privy_io

### About
Privy helps developers build secure, seamless onchain experiences. Use Privy's SDKs and APIs to add flexible authentication, create embedded self-custodial wallets, and power wallet interactions across web and mobile, without requiring users to manage seed phrases.

---

### Track 9.1: Best B2B Financial Product — $2,500

**Task**: Build a product that helps businesses manage digital assets and financial operations with Privy. Projects might include treasury platforms, business accounts, payroll systems, spend management tools, payment operations, or shared organization wallets.

**Strong Submissions Will**:
- Use Privy to create secure business workflows with features such as organization wallets, policies, team permissions, quorum approvals, intents, automated transactions, or event-driven operations

**Qualification Requirements**:
- Integrate Privy as a core part of the product
- Create or use at least one Privy wallet
- Demonstrate a business or organization use case
- Implement at least one functional B2B workflow (payment, approval, treasury operation, or wallet administration flow)
- Use at least one Privy control (policies, signers, key quorums, or intents)
- Provide a working demo and access to the project's source code
- Clearly explain how Privy enables the product

---

### Track 9.2: Best Financial Flow — $2,500

**Task**: Build a seamless experience for funding, moving, trading, growing, or spending digital assets with Privy. Projects might include payments, remittances, cross-chain transfers, stablecoin conversions, swaps, savings experiences, payouts, or card-like spending products.

**Strong Submissions Will**:
- Use Privy wallet actions or funding tools to simplify a real financial flow and hide unnecessary onchain complexity from the user

**Qualification Requirements**:
- Integrate Privy as a core part of the product
- Create or use at least one Privy wallet
- Complete at least one functional financial flow using a generally available Privy feature
- Eligible flows: transfers, bridging, stablecoin conversions, swaps, self-service Earn vaults, onramps, or other supported wallet actions
- Provide a working demo and access to the project's source code
- Clearly explain how Privy improves the user experience
- Note: Privy Cards currently requires guided onboarding — mocked card experience allowed but requires another live Privy flow for eligibility

**Resources**:
- [Privy documentation](https://docs.privy.io/)
- [Privy quickstart](https://docs.privy.io/basics/get-started/quickstart)
- [Privy GitHub](https://github.com/privy-io)

---

## 10. Chainlink — $3,000

**Website**: [chain.link](https://chain.link) | **Handle**: @chainlink

### About
The industry standard oracle network for powering trust-minimized applications across Web2 and Web3.

---

### Track 10.1: Best Confidential Workflow — $2,000

| Placement | Prize |
|-----------|-------|
| Up to 2 teams | $1,000 each |

**Task**: Build a privacy-preserving Web3 application with Chainlink Runtime Environment (CRE) Confidential Workflows. With Confidential Workflows, developers can designate sensitive parts of a CRE Workflow to execute inside a hardware-isolated Trusted Execution Environment (TEE). Secrets can be fetched directly inside the enclave, while sensitive inputs, API responses, and intermediate computation remain protected during execution.

**Example Use Cases**:
- AI-powered smart contract audit firewalls that protect API credentials, evaluation criteria, and model responses
- Automated liquidation protection using private risk thresholds and execution strategies
- Confidential portfolio rebalancing using private target allocations and trade-sizing decisions
- Automated trading powered by proprietary strategy data
- Privacy-preserving risk assessment and policy enforcement
- Confidential computation over financial, identity, healthcare, compliance, or other sensitive data
- Secure LLM or AI-agent workflows that process private inputs
- Automated payment orchestration with protected account details and routing parameters
- Privacy-preserving access to authenticated Web2 APIs

**Qualification Requirements**:
- Build a CRE Workflow that uses Confidential Workflows to execute a meaningful part of the application
- The workflow must register and use a confidential TEE handler (handlerInTee in TypeScript or cre.HandlerInTee in Go)
- The confidential portion must process at least one sensitive input, secret, confidential API response, private parameter, or intermediate value inside the enclave
- The Confidential Workflow must be meaningfully integrated into the project's core functionality
- Demonstrate successful execution through either a CRE CLI simulation or live deployment on CRE network
- Provide evidence (demo video, terminal output, execution logs, or deployment details)

**Resources**:
- [AI Smart Contract Audit Firewall Template](https://docs.chain.link/cre-templates/ai-audit-firewall)
- [Automated Liquidation Protection Template](https://docs.chain.link/cre-templates/automated-liquidation-protection)
- [Hello Confidential Workflow](https://docs.chain.link/cre-templates/hello-confidential-workflows)
- [CRE Docs](https://docs.chain.link/cre)
- [Confidential Workflows Starter Templates](https://github.com/smartcontractkit/cre-templates/tree/main/starter-templates/confidential-workflows)
- [Confidential Workflows Bootcamp](https://www.youtube.com/watch?v=ArHoB1JDSlE)

---

### Track 10.2: Best Chainlink-Powered Upgrade — $500

**Pool**: Continuity Track participants only

**Task**: Build a meaningful upgrade to an existing project using Chainlink technology. Enhance an existing application, protocol, or infrastructure by integrating Chainlink services to unlock new functionality, improve security, or create a better user experience.

**Eligible Chainlink Technologies**:
- Chainlink Runtime Environment (CRE) — including Confidential Workflows
- Price Feeds
- Data Streams
- Proof of Reserve (PoR)
- VRF (Verifiable Random Function)

**Important**: Use CRE instead of Chainlink Functions or Automation (being deprecated).

**Qualification Requirements**:
- Integrate at least one Chainlink service directly within smart contract logic or onchain workflows
- The Chainlink integration must contribute to a state change on a blockchain (simply displaying data in frontend is not sufficient)
- The submission must clearly demonstrate how the Chainlink-powered upgrade improves the existing project

---

### Track 10.3: Automated Liquidation Protection Challenge — $500

**Task**: Build a Confidential Workflow that protects a virtual ETH-collateral/USDC-debt position during simulated market movements.

**The Workflow Must**:
- Avoid liquidation
- Preserve the benefit of keeping the loan open
- Use emergency capital efficiently
- Keep sensitive protection rules and credentials private

**Qualification Requirements**:
- Until the hackathon submission deadline, update your workflow to join the official challenge using the smart contract address on Ethereum Sepolia: `0x59d5B29FbA5ca865a171076BE94EbEeC5BCA1E04`
- Use the function `join()` to join the challenge, from Sept 8 to hackathon submission deadline
- After the deadline, Chainlink team will run scenarios during the next 24h and discover the winner
- You cannot update your workflow after the hackathon submission deadline

**Resources**:
- [Challenge Smart Contract](https://sepolia.etherscan.io/address/0x59d5B29FbA5ca865a171076BE94EbEeC5BCA1E04)
- [virtual ETH token](https://sepolia.etherscan.io/address/0x89F0DF6D4629D494D599E03505C323537C24667a)
- [virtual USD token](https://sepolia.etherscan.io/address/0xC96c007023Ae2a23D097D5D95d4b91D6a501Da0b)
- [Challenge Repo](https://github.com/solangegueiros/cf-liquidation-protection-challenge)

---

## 11. Bazantic — $3,000

**Website**: [bazantic.com](https://bazantic.com) | **Handle**: @bazantic

### About
Bazantic simplifies AI development, so developers build around outcomes, not integrations. With one integration, API providers turn their APIs into services agents can understand, use, and pay for. Developers pre-wire services into reusable building blocks to accelerate AI product development.

**Key Features**:
- Deploy an x402/MPP Gateway for an API
- Deploy an MCP Server for an API
- Create custom domains for the payments gateway and MCP server
- Create custom tool calls called "Recipes" that explain when, why, and how to use your service

---

### Track 11.1: Help an Agent Use Your Hackathon Project — $1,000

| Placement | Prize |
|-----------|-------|
| Up to 2 teams | $500 each |

**Pool**: Continuity Track participants only

**Task**: Can an agent use your project without you there to explain it? Show us it can be done using Bazantic built MCP server and recipe.

Give an agent clear, reusable guidance about when an API service you have built is useful, what it needs, and how to use the result. Then prove the guidance works. Give the same task to the same model twice: first with only the raw API information, then with your Recipe generated at bazantic.com. Show a meaningful and repeatable improvement by using the Recipe.

**Qualification Requirements**:
- Create an account on bazantic.com
- Create an x402/MPP Gateway in Bazantic for your project
- Create a Recipe that explains when, why, and how to use your service
- Use the same prompt, model, settings, and API access in both tests
- Make the Recipe the only material difference between the tests
- Show both results and identify the improvement
- Record a video walking through the difference in outcomes
- Provide the bazantic account username (email or GitHub handle)

---

### Track 11.2: Best Recipe Using EthGlobal Hackathon Sponsor APIs — $1,000

| Placement | Prize |
|-----------|-------|
| 1st Place | $500 |
| 2nd Place | $300 |
| 3rd Place | $200 |

**Task**: Create a set of recipes that use multiple APIs that your project utilizes. Create a repeatable workflow that moves from one service to the next and completes a task neither could solve alone. Show why each service matters, how information moves between them, and what the complete workflow accomplishes.

**Example**: Integrate the Uniswap API and the 1Inch Trace API into Bazantic — then use together a recipe where the Uniswap API requests a GET /swap and then the transactions returned are fed into the 1Inch Trace API to get the logs for those transactions.

**Qualification Requirements**:
- Create an account on bazantic.com
- Create an x402/MPP Gateway in Bazantic for your project
- Use at least one other service already available through Bazantic OR available from a sponsor of the EthGlobal Online Hackathon
- Create a recipe that uses both services in one working flow
- Make the final result depend meaningfully on both services
- Demonstrate the completed task from start to finish in a screen recording
- Provide the bazantic account username

---

### Track 11.3: Agentify a New API — $1,000

| Placement | Prize |
|-----------|-------|
| 1st Place | $500 |
| 2nd Place | $300 |
| 3rd Place | $200 |

**Task**: Add a new API into Bazantic and create a recipe. Bring a useful new API service into Bazantic, connect it with your hackathon project, and demonstrate something agents could not do before. The strongest submissions will add a new API service to Bazantic and bring it into a recipe that other builders can reuse.

**Qualification Requirements**:
- Create an account on bazantic.com
- Create an x402/MPP Gateway in Bazantic for your project
- Add a service that was not available through Bazantic AND is not an API available via other sponsors when the event began
- Create a working Gateway for that service on Bazantic
- Create a recipe that uses both services in one working flow within your hackathon project
- Explain how other builders and agents could use the new service by demonstrating what the recipe does in a screen recording
- Provide the bazantic account username

---

## Track Type Reference

### Start Fresh (Net-New)
- Projects begun and built during the hackathon
- Open-source starter kits are fine
- Project-specific prior code is NOT allowed

### Continuity (Extend Open Source / Ship a Feature)
- Projects that extend an existing open-source repo or ship a new feature on an existing product
- Document the pre-existing work; only work done during the event is judged
- Extending a sponsor's own tools (improving an existing MCP server or SKILL) fits this pool

---

## Key Dates & Deadlines

| Milestone | Date |
|-----------|------|
| Hackathon Event | ETHOnline 2026 |
| Chainlink Challenge Join Period | Sept 8 — Submission deadline |
| Arc Mainnet Deployment Deadline | September 30 |

---

## Submission Checklist (General)

For most tracks, you will need:
- [ ] Public GitHub repository with open-source code
- [ ] README with setup instructions and architecture
- [ ] Demo video (2-5 minutes depending on track)
- [ ] Working MVP (frontend + backend for some tracks)
- [ ] Architecture diagram (for Arc tracks)
- [ ] FEEDBACK.md (for Uniswap tracks)
- [ ] Completed sponsor-specific forms (Uniswap, Chainlink)

---

*Document restructured for ETHOnline 2026 hackathon reference. All prize amounts, requirements, and resources verified from official ETHGlobal prize listings.*
