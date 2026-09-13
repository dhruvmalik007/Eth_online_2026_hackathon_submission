## Agentic EMS (submission for the Online hackathon 2026  ):


## TODO: initial commit is indeed lacking the detailed context, will be trimmed to generate more precise 
The aim of this project is to create a trading execution management system for the traders of the future of DeFi and capital markets.

My main vision is how we can use long-term context-learning agents with game theory in order to make this a perfect collaboration between traditional traders (that use Greeks and other fundamental equations like Marton's law and the Black-Scholes equation) and the intelligence that fuses data from across on-chain instruments and off-chain instruments like ETFs. In order to create large-scale multi-asset portfolios with the emphasis on stability and reducing reliance on traditional charts or trading patterns, my idea is to really democratize the use of quantitative analysis for fixed-income traders in the crypto industry. 


## disclaimer:

I am indeed using:
1. GLM 5.3 from Command Code AI, which is a very reliable agent harness tool to help me structure my plan for each product release much faster and much more coherently and also learns from my vibe engineering styles.
2. Wispr Flow for better structuring the description, both for the README as well as the coding commands, much more clearly.
3. Double word - AI, which is also a very reliable inference solution that reduces the costs significantly by using their asynchronous or batch operations with discounts of up to 50% to 90%.









## packages:

1. [rector-video](./packages/reactor-video): Is the package that integrates the various system prompts as well as adds context for me to generate the initial video for presenting my idea in clearer parts. It helps anyone with his or her own video visual language models.
What it does is:
1. It analyzes the given video that you want to emulate by timestamping it correctly.
2. It creates a persona in order to tell the Reactor video inference solution to generate a video that precisely reflects the functionality or pitch of our product.


## services (apps/):

1. [apps/inferrence](./apps/inferrence): The production inference + agent-orchestration microservice. Streams real agent runs (packages/langchain), TimesFM-3 forecasts and DMK-signable Web3 intents to the app over SSE, with each agent session running in a sandbox (E2B-inspired). See the [product design roadmap](./apps/inferrence/ROADMAP.md).
2. [apps/indexer](./apps/indexer): Serverless API exposing the v0.1 LangGraph cycle, the TimesFM-3 forecast ledger, SQL performance evaluation and temporal-vector retrieval over HTTP.
3. [apps/execution](./apps/execution): Per-user strategy execution service (sessions, strategies, runs, read models).

