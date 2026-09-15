/**
 * i18n dictionaries — en / hi / fr.
 * Technical identifiers (package names, contract ids, formulas, GraphQL fields,
 * market-data labels on the ticker) intentionally remain in English; all prose
 * is translated. `Dict` is derived from the English source so a missing key in
 * hi/fr is a compile error, not a runtime blank.
 *
 * Server-only in practice: these dictionaries are read on the server and passed
 * to Server Components as props. Locale *metadata* for Client Components lives in
 * `lib/i18n-meta.ts` so the translations never ship to the browser.
 */

import type { Lang } from "./i18n-meta";

export type { Lang };

const en = {
  nav: {
    thesis: "Thesis",
    architecture: "Architecture",
    live: "Live Data",
    prizes: "Prize Tracks",
    v4: "v4 Strategies",
    stack: "Stack",
    demo: "Demo",
    productDemo: "Product Demo",
    productDemoHint: "FastH3 video studio",
    theme: "Toggle dark / light",
    lang: "Language",
  },
  hero: {
    badgeEvent: "ETHOnline 2026",
    badgeGraph: "The Graph · 2 tracks",
    badgeOneinch: "1inch · Aqua",
    badgeUniswap: "Uniswap v4",
    h1a: "Fixed income,",
    h1b: "executed by agents.",
    leadA: "Bloomberg built the terminal that runs traditional fixed income. ",
    leadB: "Nobody built the one that runs on-chain fixed income.",
    leadC:
      " The Agentic EMS reads standardized subgraph data across chains, reasons over yield, duration and vega with quant math tools, and routes capital through Uniswap v4 and 1inch — with risk gates in the loop.",
    ctaArchitecture: "See the architecture",
    ctaPrizes: "Prize-track mapping",
    stat1k: "Subgraphs live",
    stat2k: "Chains (lending)",
    stat3k: "Deployments",
    termTitle: "agentic-ems · boot log",
    metricsNote:
      "counted from the messari registry and its live endpoint probe · packages/the-graph",
  },
  thesis: {
    kicker: "01 — Thesis",
    h2a: "Fixed income runs on terminals.",
    h2b: " DeFi is running on vibes.",
    lead:
      "Traditional fixed income has forty years of execution infrastructure: risk models, pre-trade gates, smart order routing, audit trails. On-chain fixed income has APY screenshots. The pieces all exist — standardized data, real quant math, programmable execution — but nothing connects them. That connection is the Agentic EMS.",
    trad: "Trad",
    ours: "Ours",
    foot:
      "Same discipline as the traditional desks — different data plumbing, and the analyst is an agent with a math function table.",
    desks: [
      {
        desk: "Credit desk",
        trad: "Merton structural default — asset value vs. debt barrier",
        ours:
          "Protocol TVL vs. borrowed capital, per reserve, per chain — live from standardized reserves entities",
        track: "aave-v3 × 3 chains",
      },
      {
        desk: "Rates desk",
        trad: "DV01 / duration — sensitivity of a book to a basis-point move",
        ours:
          "Lending APY term structure per asset and per chain, with utilization curves from reserve snapshots",
        track: "supply/borrow APY, RAY→%",
      },
      {
        desk: "Volatility desk",
        trad: "Vega — P&L sensitivity to implied vol",
        ours:
          "LVR rebalancing cost for LP books: L²σ²/8, and LP vega: k − L²σ/4, computed from hourly closes",
        track: "uniswap v4 hour data",
      },
      {
        desk: "Liquidity desk",
        trad: "LQA — liquidity-adjusted valuation before execution",
        ours:
          "Volume-to-TVL ratios, fee APYs, depth and dynamic-fee hooks — scored before capital moves",
        track: "volume-ranked venues",
      },
    ],
  },
  arch: {
    kicker: "02 — Architecture",
    h2a: "Data → agent → risk → execution.",
    h2b: " Nothing skipped.",
    lead:
      "Every box left of the agent is already running in this repo — five healthy subgraph endpoints, a protocol registry that maps any protocol×network to its standardized schema, and a typed transport with health gates and cursor pagination. The agent layer wraps it; the math table keeps the LLM away from arithmetic; the execution edge is where 1inch and Uniswap v4 come in.",
    hint:
      "drag / zoom the canvas — every node names a real module in packages/the-graph and packages/langchain.",
  },
  live: {
    kicker: "03 — Live data",
    h2a: "Not a mock.",
    h2b: " These endpoints answered today.",
    lead:
      "Every endpoint in the registry is probed, and only the ones that answered are queried — the dead share is excluded, not hidden. The cards below are that probe's output, including the block each endpoint reported.",
    healthy: "healthy",
    answering: "answering",
    pipeline: [
      {
        title: "One query pattern, many protocols",
        body: "ProtocolRegistry resolves protocol×network → standardized schema. The same reserves query runs on Aave V3 Ethereum, Arbitrum and Optimism without a single changed field.",
      },
      {
        title: "The LLM never does arithmetic",
        body: "Seven golden-tested math tools (calc_realized_vol, calc_lvr, calc_vega, calc_net_apy, calc_efficiency_ratio, calc_allocation…) form a function table. The model supplies arguments; TypeScript computes.",
      },
      {
        title: "Agents that show their work",
        body: "deepagents + LangGraph wrap the tools with a system contract: every number in the report must trace to a tool result. LangSmith (EU) records the full call tree.",
      },
      {
        title: "Risk gates before execution",
        body: "vega budget, efficiency ratio η = netAPY/LVR, concentration caps and σ×1.5 stress runs gate every allocation before an order is expressed.",
      },
    ],
  },
  prizes: {
    kicker: "04 — Prize tracks",
    h2a: "We are not entering everything.",
    h2b: " We are entering where the build already points.",
    lead:
      "Two Graph tracks cover what shipped this week — standardized subgraph composition and an AI agent doing real work over live data. The 1inch Aqua and Uniswap v4 tracks cover the execution edge, where the agent's allocations become positions. Requirements below are quoted from the official track listings and mapped to what exists.",
    statusShipped: "shipped",
    statusPlanned: "in progress",
    foot:
      "Honesty policy: green = shipped and verifiable in this repo today. Dashed = planned work scoped for the remaining build window. Judges can re-run every claim: probe scripts print the same numbers shown here.",
    tracks: [
      {
        sponsor: "The Graph",
        track: "Track 1.1",
        title: "Best Use of Composable or Standardized Graph Products",
        pool: "1st $2,500 · 2nd $1,500 · 3rd $1,000",
        mapping: [
          {
            req: "Build on a standardized schema (Messari) or compose 2+ Graph products",
            proof:
              "One ProtocolRegistry maps aave-v3 × {eth, arb, opt} to the same reserves query; Subgraph MCP composes discovery on top",
          },
          {
            req: "Consume live data from a Graph provider — no mocked datasets",
            proof:
              "Every registry endpoint probed by packages/the-graph/scripts/messari-probe.ts; the probe output is committed and drives the numbers on this page",
          },
          {
            req: "Make the standards leverage clear",
            proof:
              "Adding Optimism took one config line, zero query changes — the leverage demo is literal",
          },
          {
            req: "Public repository + 2–4 minute demo video",
            proof: "This open-source repo; demo section below",
          },
        ],
      },
      {
        sponsor: "The Graph",
        track: "Track 1.2",
        title: "Best AI Tooling or AI Use Case (Start Fresh)",
        pool: "1st $2,500 · 2nd $1,500 · 3rd $1,000",
        mapping: [
          {
            req: "AI agent uses The Graph as its load-bearing data source",
            proof:
              "DeepGraphAgent (deepagents + LangGraph) — every risk verdict is computed over live subgraph rows",
          },
          {
            req: "Meaningful work: reasoning, decisions, automation — not printing rows",
            proof:
              "Yield routing across chains, vega-budgeted allocation weights, stress verdicts; natural-language mandate in, allocation out",
          },
          {
            req: "Open-source with README / SKILL.md so judges can run it",
            proof:
              "packages/langchain + packages/the-graph, CLI one-liners documented, Level A/B probe scripts",
          },
          {
            req: "Reusable infrastructure, not a single end-user app",
            proof:
              "The math function table + ProtocolRegistry are agent-agnostic; any LangChain app can mount them",
          },
        ],
      },
      {
        sponsor: "1inch",
        track: "Track 5.1",
        title: "Build an Aqua App — shared liquidity, SwapVM execution",
        pool: "1st $2,500 · 2nd $1,500 · 3rd $1,000",
        mapping: [
          {
            req: "Custom Aqua app implementing a sophisticated DeFi position",
            proof:
              "Plan: agent-computed fixed-income allocations (weights ∝ η = netAPY/LVR) expressed as Aqua shared-liquidity positions",
          },
          {
            req: "SwapVM usage scores higher — strategies as data",
            proof:
              "The agent's vega-budgeted strategy compiles to a SwapVM program: concentration L, rebalance trigger σ, exit rule — one program, no per-strategy contract",
          },
          {
            req: "Official Aqua/SwapVM contracts, onchain execution demoed (local forks ok)",
            proof:
              "Execution leg wired through official contracts; fork demo planned in the final build",
          },
          {
            req: "Proper git commit history",
            proof: "Full session history in this repository — no single-commit entries",
          },
        ],
      },
      {
        sponsor: "Uniswap Foundation",
        track: "Track 7.1",
        title: "Best Uniswap Stack Contribution — dynamic v4 fixed income",
        pool: "Up to 3 teams · $1,000 each",
        mapping: [
          {
            req: "Build on any part of the Uniswap stack — v4, hooks, tooling",
            proof:
              "Live v4 subgraph analysis: volume-ranked venues, hook leaderboard, dynamic-fee (8388608) detection, hourly σ — shipping as reusable tools",
          },
          {
            req: "FEEDBACK.md + developer feedback form",
            proof:
              "Feedback file drafted with the TVL-accounting quirk (negative TVL on flash-heavy pools) and hook-discovery gaps we hit",
          },
          {
            req: "README points to relevant contracts and lines of code",
            proof:
              "PHASE1_TEST_RESULTS.md records pool IDs, hook addresses and block heights used in verification",
          },
        ],
      },
    ],
  },
  v4: {
    kicker: "05 — Uniswap v4",
    h2a: "Dynamic fixed income on v4:",
    h2b: " fees plus lending yield, minus the vol you carry.",
    lead:
      "Uniswap v4's hooks turn an LP position into a bond-like instrument: idle capital earns a lending leg while active capital earns fees, and the hook — not a vault contract — manages both. The agent prices these books honestly: it subtracts the rebalancing cost (LVR) before calling anything \"yield\", and it tracks vega so the book's short-vol exposure is a managed number, not a surprise.",
    termTitle: "fixedIncomeMath.ts — golden-tested",
    termAssertions: "23/23 assertions",
    aquaNote:
      "1inch Aqua is the same idea from the execution side: virtual balances are accounting entries, tokens move only when a swap fills — which is why the agent's strategy can compile to a SwapVM program instead of a per-strategy contract.",
    examplePrefix: "worked example",
    exampleBody:
      "σ=40%, L=4, fee slope k=0.6 ⇒ vega −1.0 pp per vol point ⇒ −$100k/yr per vol point on $10M. The agent refuses books it cannot afford to carry.",
    formulas: [
      {
        name: "netAPY",
        formula: "(1−w)·feeAPY + w·r − L²σ²/8 − gas",
        note: "trading fees on active capital + lending yield on the hook-swept idle leg − rebalancing cost",
      },
      {
        name: "vega",
        formula: "𝒱 = k − L²σ/4",
        note: "yield sensitivity to vol; with fee slope k = feeAPY/σ. Per vol point: 𝒱/100 × notional",
      },
      {
        name: "LVR",
        formula: "L²σ²/8",
        note: "Loss-Versus-Rebalancing — the credit spread an LP book is paid to bear (Milionis–Moallemi–Roughgarden)",
      },
      {
        name: "weights",
        formula: "wᵢ ∝ ηᵢ = netAPYᵢ / LVRᵢ",
        note: "allocation proportional to the Fixed-Income Efficiency Ratio, filtered by APR target and vega budget",
      },
    ],
    hooks: [
      {
        title: "Swap fills → fee yield",
        body: "Active capital earns the pool fee tier. For the top USDC/WETH hooked book that tier is dynamic — feeTier 8388608 means the hook sets it at runtime.",
      },
      {
        title: "Idle capital → lending yield",
        body: "A DualPool-style hook sweeps unused tokens into a lending vault (Spark-style). The accounting is a virtual balance — the protocol holds nothing.",
      },
      {
        title: "Big swap → instant pullback",
        body: "When a swap needs the swept capital, the hook restores it in the same transaction. Yield continues between fills.",
      },
      {
        title: "σ rises → de-lever",
        body: "The agent watches realized vol from hourly closes. Past a trigger it cuts range leverage L — because the bleed is L²σ²/8, L is the only knob that beats quadratic cost.",
      },
    ],
  },
  stack: {
    kicker: "06 — Stack",
    h2a: "Every layer is a package",
    h2b: " you can read, run, or fork.",
    groups: [
      {
        group: "Data — The Graph",
        items: [
          {
            name: "@ethonline2026/graph-fno-indexer",
            role: "SubgraphClient (health gate, id_gt cursors, _change_block deltas) · ProtocolRegistry · FnoDataExtractor",
          },
          {
            name: "Messari standardized subgraphs",
            role: "one reserves/rates schema across Aave V3 on Ethereum, Arbitrum, Optimism — the Track 1.1 leverage",
          },
          {
            name: "Subgraph MCP",
            role: "agent-time discovery: schema introspection, top deployments, cross-protocol search",
          },
        ],
      },
      {
        group: "Agent — reasoning & math",
        items: [
          {
            name: "@ethonline2026/langchain-agent",
            role: "DeepGraphAgent on deepagents + LangGraph: 40+ typed tools, Markdown report contract, invoke-level transient retry",
          },
          {
            name: "Math function table",
            role: "calc_realized_vol · calc_fee_apy · calc_lvr · calc_net_apy · calc_vega · calc_efficiency_ratio · calc_allocation — golden-tested, LLM supplies arguments only",
          },
          {
            name: "Google Vertex AI (gemini-2.5-flash-lite)",
            role: "strategic reasoning and report writing; ADC auth, EU LangSmith observability on the full call tree",
          },
        ],
      },
      {
        group: "Execution — where capital moves",
        items: [
          {
            name: "1inch Aqua + SwapVM",
            role: "self-custodial shared liquidity; agent allocations compile to SwapVM programs — strategies as data (Track 5.1)",
          },
          {
            name: "Uniswap v4 hooks",
            role: "dual-hook LP books: idle capital to a lending leg, dynamic fee tiers, σ-triggered de-levering (Track 7.1)",
          },
          {
            name: "Uniswap v4 subgraph",
            role: "venue discovery by volume, hook leaderboard, hourly realized-vol series feeding the vega math",
          },
        ],
      },
      {
        group: "Surface — this page",
        items: [
          {
            name: "Next.js 15 + React 19",
            role: "single-page app, server components by default, client islands only where interaction demands it",
          },
          {
            name: "shadcn/ui primitives + Tailwind v4",
            role: "button/card/badge/separator re-themed to Terminal Noir — squared corners, hairline edges",
          },
          {
            name: "React Flow (@xyflow/react)",
            role: "the architecture canvas above — every node names a real module in this monorepo",
          },
        ],
      },
    ],
  },
  demo: {
    kicker: "07 — Demo",
    h2: "The two-minute pitch.",
    badge: "judges: start here",
    lead:
      "The recorded walkthrough of the system — the data layer answering live, the agent reasoning over standardized rows, and the fixed income report produced at the end. This clip itself was composed in our own FastH3 video studio — chained continuous scenes, generated by the same agent stack.",
    studioCta: "Open the Product Demo studio",
    studioNote: "compose new pitch episodes — chained scenes, one continuous cut",
  },
  footer: {
    about:
      "An agentic execution management system for on-chain fixed income. Built in the open for ETHOnline 2026 — data by The Graph, execution by Uniswap v4 and 1inch, reasoning by an agent that is not allowed to do its own arithmetic.",
    repro:
      "numbers on this page are gateway snapshots of 2026-09-07 — re-run pnpm probe:levelA to reproduce",
    submission: "ETHOnline 2026 submission · The Graph · 1inch · Uniswap Foundation tracks",
    links: {
      graph: "The Graph — standardized subgraphs ↗",
      oneinch: "1inch Aqua — shared liquidity ↗",
      uniswap: "Uniswap developers ↗",
      repo: "Source repository ↗",
      studio: "Product Demo studio →",
    },
  },
};

export type Dict = typeof en;

const hi: Dict = {
  nav: {
    thesis: "प्रस्तावना",
    architecture: "आर्किटेक्चर",
    live: "लाइव डेटा",
    prizes: "प्राइज़ ट्रैक",
    v4: "v4 रणनीतियाँ",
    stack: "स्टैक",
    demo: "डेमो",
    productDemo: "प्रोडक्ट डेमो",
    productDemoHint: "FastH3 वीडियो स्टूडियो",
    theme: "डार्क / लाइट टॉगल करें",
    lang: "भाषा",
  },
  hero: {
    badgeEvent: "ETHOnline 2026",
    badgeGraph: "द ग्राफ़ · 2 ट्रैक",
    badgeOneinch: "1इंच · Aqua",
    badgeUniswap: "यूनिस्वैप v4",
    h1a: "फिक्स्ड इनकम,",
    h1b: "एजेंट्स द्वारा निष्पादित।",
    leadA: "ब्लूमबर्ग ने वह टर्मिनल बनाया जो पारंपरिक फिक्स्ड इनकम चलाता है। ",
    leadB: "ऑन-चेन फिक्स्ड इनकम चलाने वाला कोई नहीं बनाया।",
    leadC:
      " एजेंटिक EMS चेनों के पार मानकीकृत सबग्राफ़ डेटा पढ़ता है, क्वांट गणित टूल्स से यील्ड, अवधि और वेगा पर तर्क करता है, और यूनिस्वैप v4 तथा 1इंच के रास्ते पूंजी रूट करता है — बीच में रिस्क गेट्स के साथ।",
    ctaArchitecture: "आर्किटेक्चर देखें",
    ctaPrizes: "प्राइज़-ट्रैक मैपिंग",
    stat1k: "लाइव सबग्राफ़",
    stat2k: "चेन (लेंडिंग)",
    stat3k: "डिप्लॉयमेंट्स",
    termTitle: "agentic-ems · बूट लॉग",
    metricsNote:
      "messari रजिस्ट्री और उसके लाइव एंडपॉइंट प्रोब से गिना गया · packages/the-graph",
  },
  thesis: {
    kicker: "01 — प्रस्तावना",
    h2a: "फिक्स्ड इनकम टर्मिनल पर चलती है।",
    h2b: " डेफ़ी अनुमान पर चल रही है।",
    lead:
      "पारंपरिक फिक्स्ड इनकम के पास चालीस वर्षों का निष्पादन ढांचा है: रिस्क मॉडल, प्री-ट्रेड गेट्स, स्मार्ट ऑर्डर रूटिंग, ऑडिट ट्रेल। ऑन-चेन फिक्स्ड इनकम के पास है सिर्फ APY स्क्रीनशॉट। सब टुकड़े मौजूद हैं — मानकीकृत डेटा, असली क्वांट गणित, प्रोग्रामेबल निष्पादन — पर उन्हें जोड़ने वाला कुछ नहीं है। वही जोड़ है एजेंटिक EMS।",
    trad: "पारंपरिक",
    ours: "हमारा",
    foot:
      "पारंपरिक डेस्क जैसा ही अनुशासन — बस डेटा प्लंबिंग अलग, और विश्लेषक एक एजेंट है जिसके पास गणित फ़ंक्शन टेबल है।",
    desks: [
      {
        desk: "क्रेडिट डेस्क",
        trad: "मर्टन स्ट्रक्चरल डिफ़ॉल्ट — एसेट वैल्यू बनाम ऋण बाधा",
        ours:
          "प्रोटोकॉल TVL बनाम उधार ली गई पूंजी, प्रति रिज़र्व, प्रति चेन — मानकीकृत reserves एंटिटी से लाइव",
        track: "aave-v3 × 3 चेन",
      },
      {
        desk: "रेट्स डेस्क",
        trad: "DV01 / ड्यूरेशन — बेसिस-पॉइंट हलचल पर बुक की संवेदनशीलता",
        ours:
          "प्रति एसेट और प्रति चेन लेंडिंग APY टर्म स्ट्रक्चर, रिज़र्व स्नैपशॉट से यूटिलाइज़ेशन कर्व के साथ",
        track: "supply/borrow APY, RAY→%",
      },
      {
        desk: "वोलैटिलिटी डेस्क",
        trad: "वेगा — इम्प्लाइड वोल के प्रति P&L संवेदनशीलता",
        ours:
          "LP बुक के लिए LVR रीबैलेंसिंग लागत: L²σ²/8, और LP वेगा: k − L²σ/4 — घंटेवार क्लोज़ से गणना",
        track: "uniswap v4 hour data",
      },
      {
        desk: "लिक्विडिटी डेस्क",
        trad: "LQA — निष्पादन से पहले लिक्विडिटी-समायोजित मूल्यांकन",
        ours:
          "वॉल्यूम-से-TVL अनुपात, फ़ीस APY, डेप्थ और डायनामिक-फ़ीस हुक — पूंजी जाने से पहले स्कोरिंग",
        track: "volume-ranked venues",
      },
    ],
  },
  arch: {
    kicker: "02 — आर्किटेक्चर",
    h2a: "डेटा → एजेंट → रिस्क → निष्पादन।",
    h2b: " कुछ भी छोड़ा नहीं।",
    lead:
      "एजेंट के बाईं ओर का हर बॉक्स इस रिपो में पहले से चल रहा है — पाँच हेल्दी सबग्राफ़ एंडपॉइंट, एक प्रोटोकॉल रजिस्ट्री जो किसी भी protocol×network को उसके मानकीकृत स्कीमा से जोड़ती है, और हेल्थ गेट्स व कर्सर पेजिनेशन वाला टाइप्ड ट्रांसपोर्ट। एजेंट लेयर इसे लपेटती है; गणित टेबल LLM को अंकगणित से दूर रखती है; और निष्पादन किनारे पर 1इंच व यूनिस्वैप v4 आते हैं।",
    hint:
      "कैनवस को ड्रैग / ज़ूम करें — हर नोड packages/the-graph और packages/langchain का एक वास्तविक मॉड्यूल है।",
  },
  live: {
    kicker: "03 — लाइव डेटा",
    h2a: "मॉक नहीं।",
    h2b: " ये एंडपॉइंट आज जवाब दे रहे हैं।",
    lead:
      "रजिस्ट्री के हर एंडपॉइंट की जाँच होती है, और केवल जवाब देने वाले ही क्वेरी किए जाते हैं — डेड हिस्सा छिपाया नहीं, बाहर रखा जाता है। नीचे के कार्ड उसी प्रोब का आउटपुट हैं, जिसमें हर एंडपॉइंट का रिपोर्ट किया गया ब्लॉक भी शामिल है।",
    healthy: "हेल्दी",
    answering: "जवाब दे रहे",
    pipeline: [
      {
        title: "एक क्वेरी पैटर्न, कई प्रोटोकॉल",
        body: "ProtocolRegistry protocol×network → मानकीकृत स्कीमा सुलझाता है। वही reserves क्वेरी Aave V3 Ethereum, Arbitrum और Optimism पर बिना किसी बदलाव के चलती है।",
      },
      {
        title: "LLM कभी अंकगणित नहीं करता",
        body: "सात गोल्डन-टेस्टेड गणित टूल्स (calc_realized_vol, calc_lvr, calc_vega, calc_net_apy, calc_efficiency_ratio, calc_allocation…) फ़ंक्शन टेबल बनाते हैं। मॉडल केवल आर्ग्युमेंट देता है; TypeScript गणना करता है।",
      },
      {
        title: "ऐसे एजेंट जो अपना काम दिखाते हैं",
        body: "deepagents + LangGraph टूल्स को एक सिस्टम कॉन्ट्रैक्ट में बाँधते हैं: रिपोर्ट का हर आंकड़ा किसी टूल रिज़ल्ट तक trace होना चाहिए। LangSmith (EU) पूरा कॉल ट्री रिकॉर्ड करता है।",
      },
      {
        title: "निष्पादन से पहले रिस्क गेट्स",
        body: "vega बजट, एफ़िशिएंसी रेशियो η = netAPY/LVR, कंसंट्रेशन कैप और σ×1.5 स्ट्रेस रन — ऑर्डर जाने से पहले हर एलोकेशन की जाँच करते हैं।",
      },
    ],
  },
  prizes: {
    kicker: "04 — प्राइज़ ट्रैक",
    h2a: "हम हर जगह एंट्री नहीं ले रहे।",
    h2b: " जहाँ बिल्ड पहले से इशारा करता है, वहीं ले रहे हैं।",
    lead:
      "दो ग्राफ़ ट्रैक इस हफ़्ते शिप हुए काम को कवर करते हैं — मानकीकृत सबग्राफ़ कंपोज़िशन और लाइव डेटा पर असली काम करने वाला AI एजेंट। 1इंच Aqua और यूनिस्वैप v4 ट्रैक निष्पादन किनारे को कवर करते हैं, जहाँ एजेंट की एलोकेशन पोज़िशन बनती है। नीचे आवश्यकताएँ आधिकारिक ट्रैक लिस्टिंग से उद्धृत हैं और मौजूद काम से मैप की गई हैं।",
    statusShipped: "शिप हो गया",
    statusPlanned: "प्रगति पर",
    foot:
      "ईमानदारी नीति: हरा = आज इस रिपो में सत्यापन योग्य। डैश = बाकी बिल्ड विंडो के लिए नियोजित कार्य। जज हर दावा दोबारा चला सकते हैं: प्रोब स्क्रिप्ट्स वही नंबर प्रिंट करती हैं।",
    tracks: [
      {
        sponsor: "The Graph",
        track: "Track 1.1",
        title: "कंपोज़ेबल या स्टैंडर्डाइज़्ड ग्राफ़ प्रोडक्ट्स का सर्वश्रेष्ठ उपयोग",
        pool: "1st $2,500 · 2nd $1,500 · 3rd $1,000",
        mapping: [
          {
            req: "मानकीकृत स्कीमा (Messari) पर बनाएं या 2+ ग्राफ़ प्रोडक्ट्स को कंपोज़ करें",
            proof:
              "एक ProtocolRegistry aave-v3 × {eth, arb, opt} को उसी reserves क्वेरी से जोड़ता है; ऊपर Subgraph MCP डिस्कवरी जोड़ता है",
          },
          {
            req: "Graph प्रोवाइडर से लाइव डेटा — मॉक डेटासेट नहीं",
            proof:
              "packages/the-graph/scripts/messari-probe.ts से हर रजिस्ट्री एंडपॉइंट की जाँच; प्रोब आउटपुट कमिट है और इस पेज के नंबर उसी से आते हैं",
          },
          {
            req: "स्टैंडर्ड्स का लाभ स्पष्ट रूप से दिखाएँ",
            proof:
              "Optimism जोड़ने के लिए एक कॉन्फ़िग लाइन, शून्य क्वेरी बदलाव — लाभ साक्षात्कार दिखता है",
          },
          {
            req: "सार्वजनिक रिपो + 2–4 मिनट डेमो वीडियो",
            proof: "यह ओपन-सोर्स रिपो; डेमो सेक्शन नीचे",
          },
        ],
      },
      {
        sponsor: "The Graph",
        track: "Track 1.2",
        title: "सर्वश्रेष्ठ AI टूलिंग या AI यूज़ केस (Start Fresh)",
        pool: "1st $2,500 · 2nd $1,500 · 3rd $1,000",
        mapping: [
          {
            req: "AI एजेंट The Graph को अपने मुख्य डेटा स्रोत के रूप में उपयोग करे",
            proof:
              "DeepGraphAgent (deepagents + LangGraph) — हर रिस्क निर्णय लाइव सबग्राफ़ पंक्तियों पर गणना होता है",
          },
          {
            req: "अर्थपूर्ण काम: तर्क, निर्णय, ऑटोमेशन — पंक्तियाँ प्रिंट करना नहीं",
            proof:
              "चेनों में यील्ड रूटिंग, vega-बजटेड एलोकेशन वेट, स्ट्रेस निर्णय; प्राकृतिक भाषा का मैंडेट इन, एलोकेशन आउट",
          },
          {
            req: "जज चला सकें — README / SKILL.md के साथ ओपन-सोर्स",
            proof:
              "packages/langchain + packages/the-graph, CLI वन-लाइनर डॉक्यूमेंटेड, Level A/B प्रोब स्क्रिप्ट्स",
          },
          {
            req: "पुन: प्रयोग योग्य इंफ्रास्ट्रक्चर, सिर्फ एक ऐप नहीं",
            proof:
              "गणित फ़ंक्शन टेबल + ProtocolRegistry एजेंट-अज्ञेयवादी हैं; कोई भी LangChain ऐप इन्हें जोड़ सकता है",
          },
        ],
      },
      {
        sponsor: "1inch",
        track: "Track 5.1",
        title: "Aqua ऐप बनाएं — शेयर्ड लिक्विडिटी, SwapVM निष्पादन",
        pool: "1st $2,500 · 2nd $1,500 · 3rd $1,000",
        mapping: [
          {
            req: "परिष्कृत DeFi पोज़िशन लागू करता कस्टम Aqua ऐप",
            proof:
              "योजना: एजेंट-गणना फिक्स्ड-इनकम एलोकेशन (वेट ∝ η = netAPY/LVR) Aqua शेयर्ड-लिक्विडिटी पोज़िशन के रूप में",
          },
          {
            req: "SwapVM उपयोग पर अधिक स्कोर — रणनीतियाँ डेटा के रूप में",
            proof:
              "एजेंट की vega-बजटेड रणनीति SwapVM प्रोग्राम में कंपाइल होती है: कंसंट्रेशन L, रीबैलेंस ट्रिगर σ, एग्ज़िट रूल — एक प्रोग्राम, प्रति-रणनीति कॉन्ट्रैक्ट नहीं",
          },
          {
            req: "आधिकारिक Aqua/SwapVM कॉन्ट्रैक्ट, ऑनचेन निष्पादन डेमो (लोकल फ़ोर्क ठीक)",
            proof: "निष्पादन लेग आधिकारिक कॉन्ट्रैक्ट से जुड़ा; फ़ाइनल बिल्ड में फ़ोर्क डेमो नियोजित",
          },
          {
            req: "उचित git कमिट हिस्ट्री",
            proof: "इस रिपो में पूरा सेशन हिस्ट्री — कोई सिंगल-कमिट एंट्री नहीं",
          },
        ],
      },
      {
        sponsor: "Uniswap Foundation",
        track: "Track 7.1",
        title: "सर्वश्रेष्ठ यूनिस्वैप स्टैक योगदान — डायनामिक v4 फिक्स्ड इनकम",
        pool: "3 टीमों तक · $1,000 प्रति टीम",
        mapping: [
          {
            req: "यूनिस्वैप स्टैक के किसी भी हिस्से पर बनाएं — v4, हुक्स, टूलिंग",
            proof:
              "लाइव v4 सबग्राफ़ विश्लेषण: वॉल्यूम-रैंक वेन्यू, हुक लीडरबोर्ड, डायनामिक-फ़ीस (8388608) डिटेक्शन, घंटेवार σ — पुन: प्रयोग योग्य टूल्स के रूप में",
          },
          {
            req: "FEEDBACK.md + डेवलपर फ़ीडबैक फ़ॉर्म",
            proof:
              "TVL-अकाउंटिंग विसंगति (फ़्लैश-भारी पूल्स पर ऋणात्मक TVL) और हुक-डिस्कवरी कमियों के साथ फ़ीडबैक फ़ाइल तैयार",
          },
          {
            req: "README संबंधित कॉन्ट्रैक्ट और कोड लाइनों तक इशारा करे",
            proof:
              "PHASE1_TEST_RESULTS.md सत्यापन में उपयोग किए गए पूल ID, हुक एड्रेस और ब्लॉक हाइट दर्ज करता है",
          },
        ],
      },
    ],
  },
  v4: {
    kicker: "05 — यूनिस्वैप v4",
    h2a: "v4 पर डायनामिक फिक्स्ड इनकम:",
    h2b: " फ़ीस + लेंडिंग यील्ड, घटाओ वह वोल जो आप ले रहे हैं।",
    lead:
      "यूनिस्वैप v4 के हुक्स LP पोज़िशन को बॉन्ड जैसा इंस्ट्रूमेंट बना देते हैं: खाली पूंजी लेंडिंग लेग कमाती है, सक्रिय पूंजी फ़ीस, और दोनों को वॉल्ट कॉन्ट्रैक्ट नहीं — हुक संभालता है। एजेंट इन बुक्स की ईमानदार कीमत लगाता है: कुछ भी \"यील्ड\" कहने से पहले रीबैलेंसिंग लागत (LVR) घटाता है, और vega ट्रैक करता है ताकि बुक का शॉर्ट-वोल एक्सपोज़र प्रबंधित संख्या हो, चौंकने वाली नहीं।",
    termTitle: "fixedIncomeMath.ts — गोल्डन-टेस्टेड",
    termAssertions: "23/23 असरशन",
    aquaNote:
      "निष्पादन की ओर से 1इंच Aqua वही विचार है: वर्चुअल बैलेंस अकाउंटिंग एंट्री हैं, टोकन तभी चलते हैं जब स्वैप भरता है — इसीलिए एजेंट की रणनीति प्रति-रणनीति कॉन्ट्रैक्ट की जगह SwapVM प्रोग्राम में कंपाइल हो सकती है।",
    examplePrefix: "उदाहरण",
    exampleBody:
      "σ=40%, L=4, फ़ीस स्लोप k=0.6 ⇒ vega −1.0 pp प्रति vol पॉइंट ⇒ $10M पर −$100k/वर्ष। एजेंट जिन बुक्स को वहन नहीं कर सकता, उन्हें अस्वीकार कर देता है।",
    formulas: [
      {
        name: "netAPY",
        formula: "(1−w)·feeAPY + w·r − L²σ²/8 − gas",
        note: "सक्रिय पूंजी पर ट्रेडिंग फ़ीस + हुक-स्वेप्ट खाली लेग पर लेंडिंग यील्ड − रीबैलेंसिंग लागत",
      },
      {
        name: "vega",
        formula: "𝒱 = k − L²σ/4",
        note: "वोल के प्रति यील्ड संवेदनशीलता; फ़ीस स्लोप k = feeAPY/σ। प्रति vol पॉइंट: 𝒱/100 × notional",
      },
      {
        name: "LVR",
        formula: "L²σ²/8",
        note: "Loss-Versus-Rebalancing — LP बुक जो क्रेडिट स्प्रेड वहन करती है (Milionis–Moallemi–Roughgarden)",
      },
      {
        name: "weights",
        formula: "wᵢ ∝ ηᵢ = netAPYᵢ / LVRᵢ",
        note: "APR लक्ष्य व vega बजट से फ़िल्टर होकर, फ़िक्स्ड-इनकम एफ़िशिएंसी रेशियो के अनुपात में एलोकेशन",
      },
    ],
    hooks: [
      {
        title: "स्वैप भरे → फ़ीस यील्ड",
        body: "सक्रिय पूंजी पूल फ़ीस टियर कमाती है। टॉप USDC/WETH हुक्ड बुक का टियर डायनामिक है — feeTier 8388608 का मतलब हुक रनटाइम पर फ़ीस तय करता है।",
      },
      {
        title: "खाली पूंजी → लेंडिंग यील्ड",
        body: "DualPool-शैली का हुक अप्रयुक्त टोकन लेंडिंग वॉल्ट (Spark-शैली) में भेजता है। अकाउंटिंग वर्चुअल बैलेंस है — प्रोटोकॉल के पास कुछ नहीं रहता।",
      },
      {
        title: "बड़ा स्वैप → तुरंत वापसी",
        body: "जब स्वैप को भेजी गई पूंजी चाहिए, हुक उसी ट्रांज़ैक्शन में वापस ले आता है। भरने के बीच यील्ड चलती रहती है।",
      },
      {
        title: "σ बढ़े → डी-लेवर",
        body: "एजेंट घंटेवार क्लोज़ से रियलाइज़्ड वोल देखता है। ट्रिगर पार होते ही रेंज लीवरेज L घटाता है — क्योंकि खर्च L²σ²/8 है, L ही वह कनॉब है जो द्विघात लागत को हराता है।",
      },
    ],
  },
  stack: {
    kicker: "06 — स्टैक",
    h2a: "हर लेयर एक पैकेज है",
    h2b: " जिसे आप पढ़ सकते हैं, चला सकते हैं, या फ़ोर्क कर सकते हैं।",
    groups: [
      {
        group: "डेटा — The Graph",
        items: [
          {
            name: "@ethonline2026/graph-fno-indexer",
            role: "SubgraphClient (हेल्थ गेट, id_gt कर्सर, _change_block डेल्टा) · ProtocolRegistry · FnoDataExtractor",
          },
          {
            name: "Messari मानकीकृत सबग्राफ़",
            role: "Ethereum, Arbitrum, Optimism पर Aave V3 के लिए एक reserves/rates स्कीमा — Track 1.1 का लाभ",
          },
          {
            name: "Subgraph MCP",
            role: "एजेंट-टाइम डिस्कवरी: स्कीमा इंट्रोस्पेक्शन, टॉप डिप्लॉयमेंट, क्रॉस-प्रोटोकॉल सर्च",
          },
        ],
      },
      {
        group: "एजेंट — तर्क और गणित",
        items: [
          {
            name: "@ethonline2026/langchain-agent",
            role: "deepagents + LangGraph पर DeepGraphAgent: 40+ टाइप्ड टूल्स, Markdown रिपोर्ट कॉन्ट्रैक्ट, invoke-स्तरीय ट्रांजिएंट रीट्राई",
          },
          {
            name: "गणित फ़ंक्शन टेबल",
            role: "calc_realized_vol · calc_fee_apy · calc_lvr · calc_net_apy · calc_vega · calc_efficiency_ratio · calc_allocation — गोल्डन-टेस्टेड, LLM केवल आर्ग्युमेंट देता है",
          },
          {
            name: "Google Vertex AI (gemini-2.5-flash-lite)",
            role: "रणनीतिक तर्क और रिपोर्ट लेखन; ADC auth, पूरे कॉल ट्री पर EU LangSmith निगरानी",
          },
        ],
      },
      {
        group: "निष्पादन — जहाँ पूंजी चलती है",
        items: [
          {
            name: "1इंच Aqua + SwapVM",
            role: "सेल्फ़-कस्टोडियल शेयर्ड लिक्विडिटी; एजेंट एलोकेशन SwapVM प्रोग्राम में कंपाइल — रणनीतियाँ डेटा के रूप में (Track 5.1)",
          },
          {
            name: "यूनिस्वैप v4 हुक्स",
            role: "डुअल-हुक LP बुक्स: खाली पूंजी लेंडिंग लेग को, डायनामिक फ़ीस टियर, σ-ट्रिगर डी-लेवरिंग (Track 7.1)",
          },
          {
            name: "यूनिस्वैप v4 सबग्राफ़",
            role: "वॉल्यूम से वेन्यू खोज, हुक लीडरबोर्ड, vega गणित को खिलाने वाली घंटेवार रियलाइज़्ड-वोल श्रृंखला",
          },
        ],
      },
      {
        group: "सतह — यह पेज",
        items: [
          {
            name: "Next.js 15 + React 19",
            role: "सिंगल-पेज ऐप, डिफ़ॉल्ट रूप से सर्वर कंपोनेंट्स, क्लाइंट द्वीप केवल जहाँ इंटरैक्शन माँगे",
          },
          {
            name: "shadcn/ui प्रिमिटिव्स + Tailwind v4",
            role: "button/card/badge/separator को Terminal Noir में री-थीम — स्क्वायर कॉर्नर, हेयरलाइन एज",
          },
          {
            name: "React Flow (@xyflow/react)",
            role: "ऊपर का आर्किटेक्चर कैनवस — हर नोड इस मोनोरिपो का वास्तविक मॉड्यूल बताता है",
          },
        ],
      },
    ],
  },
  demo: {
    kicker: "07 — डेमो",
    h2: "दो-मिनट का पिच।",
    badge: "जज: यहीं से शुरू करें",
    lead:
      "सिस्टम की रिकॉर्डेड वॉकथ्रू — लाइव जवाब देता डेटा लेयर, मानकीकृत पंक्तियों पर तर्क करता एजेंट, और अंत में बना फिक्स्ड इनकम रिपोर्ट। यह क्लिप खुद हमारे FastH3 वीडियो स्टूडियो में बनी — चेन्ड कंटीन्यूअस सीन्स, उसी एजेंट स्टैक से।",
    studioCta: "प्रोडक्ट डेमो स्टूडियो खोलें",
    studioNote: "नए पिच एपिसोड बनाएं — चेन्ड सीन्स, एक लगातार कट",
  },
  footer: {
    about:
      "ऑन-चेन फिक्स्ड इनकम के लिए एजेंटिक निष्पादन प्रबंधन प्रणाली। ETHOnline 2026 के लिए खुले रूप से बनी — डेटा The Graph से, निष्पादन यूनिस्वैप v4 व 1इंच से, और तर्क एक ऐसे एजेंट से जिसे अपना गणित करने की अनुमति नहीं है।",
    repro:
      "इस पेज के आंकड़े 2026-09-07 के गेटवे स्नैपशॉट हैं — दोहराने के लिए pnpm probe:levelA चलाएँ",
    submission: "ETHOnline 2026 सबमिशन · The Graph · 1inch · Uniswap Foundation ट्रैक",
    links: {
      graph: "The Graph — मानकीकृत सबग्राफ़ ↗",
      oneinch: "1इंच Aqua — शेयर्ड लिक्विडिटी ↗",
      uniswap: "यूनिस्वैप डेवलपर्स ↗",
      repo: "सोर्स रिपॉज़िटरी ↗",
      studio: "प्रोडक्ट डेमो स्टूडियो →",
    },
  },
};

const fr: Dict = {
  nav: {
    thesis: "Thèse",
    architecture: "Architecture",
    live: "Données live",
    prizes: "Pistes de prix",
    v4: "Stratégies v4",
    stack: "Stack",
    demo: "Démo",
    productDemo: "Démo produit",
    productDemoHint: "studio vidéo FastH3",
    theme: "Basculer sombre / clair",
    lang: "Langue",
  },
  hero: {
    badgeEvent: "ETHOnline 2026",
    badgeGraph: "The Graph · 2 pistes",
    badgeOneinch: "1inch · Aqua",
    badgeUniswap: "Uniswap v4",
    h1a: "Le revenu fixe,",
    h1b: "exécuté par des agents.",
    leadA: "Bloomberg a construit le terminal qui pilote le revenu fixe traditionnel. ",
    leadB: "Personne n'a construit celui du revenu fixe on-chain.",
    leadC:
      " L'EMS agentique lit des données de subgraphs standardisées sur plusieurs chaînes, raisonne sur le rendement, la duration et le vega avec des outils mathématiques quant, et achemine le capital via Uniswap v4 et 1inch — avec des garde-fous de risque dans la boucle.",
    ctaArchitecture: "Voir l'architecture",
    ctaPrizes: "Correspondance des pistes",
    stat1k: "Subgraphs live",
    stat2k: "Chaînes (prêt)",
    stat3k: "Déploiements",
    termTitle: "agentic-ems · journal de démarrage",
    metricsNote:
      "compté depuis le registre messari et sa sonde d'endpoints · packages/the-graph",
  },
  thesis: {
    kicker: "01 — Thèse",
    h2a: "Le revenu fixe tourne sur des terminaux.",
    h2b: " La DeFi tourne sur des impressions.",
    lead:
      "Le revenu fixe traditionnel dispose de quarante ans d'infrastructure d'exécution : modèles de risque, garde-fous pré-trade, routage intelligent des ordres, pistes d'audit. Le revenu fixe on-chain dispose de captures d'écran d'APY. Toutes les pièces existent — données standardisées, vraie math quant, exécution programmable — mais rien ne les connecte. Cette connexion, c'est l'EMS agentique.",
    trad: "Trad",
    ours: "Le nôtre",
    foot:
      "La même discipline que les desks traditionnels — une plomberie de données différente, et l'analyste est un agent doté d'une table de fonctions mathématiques.",
    desks: [
      {
        desk: "Desk crédit",
        trad: "Défaut structurel de Merton — valeur d'actif vs barrière de dette",
        ours:
          "TVL du protocole vs capital emprunté, par réserve, par chaîne — en direct depuis les entités de réserves standardisées",
        track: "aave-v3 × 3 chaînes",
      },
      {
        desk: "Desk taux",
        trad: "DV01 / duration — sensibilité du portefeuille à un point de base",
        ours:
          "Structure par terme des APY de prêt par actif et par chaîne, avec courbes d'utilisation issues des snapshots de réserves",
        track: "supply/borrow APY, RAY→%",
      },
      {
        desk: "Desk volatilité",
        trad: "Vega — sensibilité du P&L à la volatilité implicite",
        ours:
          "Coût de rééquilibrage LVR des livres LP : L²σ²/8, et vega LP : k − L²σ/4, calculés depuis les clôtures horaires",
        track: "uniswap v4 hour data",
      },
      {
        desk: "Desk liquidité",
        trad: "LQA — valorisation ajustée à la liquidité avant exécution",
        ours:
          "Ratios volume/TVL, APY de frais, profondeur et hooks à frais dynamiques — notés avant tout mouvement de capital",
        track: "venues classées par volume",
      },
    ],
  },
  arch: {
    kicker: "02 — Architecture",
    h2a: "Données → agent → risque → exécution.",
    h2b: " Rien n'est sauté.",
    lead:
      "Chaque boîte à gauche de l'agent tourne déjà dans ce dépôt — cinq endpoints de subgraphs sains, un registre de protocoles qui mappe tout protocole×réseau vers son schéma standardisé, et un transport typé avec health gates et pagination par curseurs. La couche agent l'enveloppe ; la table mathématique éloigne le LLM de l'arithmétique ; le bord d'exécution, c'est là qu'interviennent 1inch et Uniswap v4.",
    hint:
      "glissez / zoomez le canevas — chaque nœud nomme un module réel de packages/the-graph et packages/langchain.",
  },
  live: {
    kicker: "03 — Données live",
    h2a: "Pas un mock.",
    h2b: " Ces endpoints ont répondu aujourd'hui.",
    lead:
      "Chaque endpoint du registre est sondé, et seuls ceux qui ont répondu sont interrogés — la part morte est exclue, pas cachée. Les cartes ci-dessous sont la sortie de cette sonde, avec le bloc rapporté par chaque endpoint.",
    healthy: "sain",
    answering: "répondent",
    pipeline: [
      {
        title: "Un pattern de requête, plusieurs protocoles",
        body: "ProtocolRegistry résout protocole×réseau → schéma standardisé. La même requête de réserves tourne sur Aave V3 Ethereum, Arbitrum et Optimism sans changer un seul champ.",
      },
      {
        title: "Le LLM ne fait jamais d'arithmétique",
        body: "Sept outils mathématiques testés par valeurs d'or (calc_realized_vol, calc_lvr, calc_vega, calc_net_apy, calc_efficiency_ratio, calc_allocation…) forment une table de fonctions. Le modèle fournit des arguments ; TypeScript calcule.",
      },
      {
        title: "Des agents qui montrent leur travail",
        body: "deepagents + LangGraph lient les outils à un contrat système : chaque chiffre du rapport doit remonter à un résultat d'outil. LangSmith (EU) enregistre l'arbre d'appels complet.",
      },
      {
        title: "Garde-fous de risque avant exécution",
        body: "Budget de vega, ratio d'efficacité η = netAPY/LVR, plafonds de concentration et stress σ×1.5 contrôlent chaque allocation avant qu'un ordre ne soit exprimé.",
      },
    ],
  },
  prizes: {
    kicker: "04 — Pistes de prix",
    h2a: "Nous ne participons pas partout.",
    h2b: " Nous participons là où le build pointe déjà.",
    lead:
      "Deux pistes Graph couvrent ce qui a été livré cette semaine — composition de subgraphs standardisés et un agent IA faisant un vrai travail sur des données live. Les pistes 1inch Aqua et Uniswap v4 couvrent le bord d'exécution, où les allocations de l'agent deviennent des positions. Les exigences ci-dessous sont citées des listes officielles et mappées sur ce qui existe.",
    statusShipped: "livré",
    statusPlanned: "en cours",
    foot:
      "Politique d'honnêteté : vert = livré et vérifiable dans ce dépôt aujourd'hui. Pointillé = travail planifié pour la fenêtre de build restante. Les juges peuvent rejouer chaque affirmation : les scripts de sonde impriment les mêmes chiffres.",
    tracks: [
      {
        sponsor: "The Graph",
        track: "Piste 1.1",
        title: "Meilleure utilisation des produits Graph composables ou standardisés",
        pool: "1er $2,500 · 2e $1,500 · 3e $1,000",
        mapping: [
          {
            req: "Construire sur un schéma standardisé (Messari) ou composer 2+ produits Graph",
            proof:
              "Un ProtocolRegistry mappe aave-v3 × {eth, arb, opt} vers la même requête de réserves ; le Subgraph MCP ajoute la découverte par-dessus",
          },
          {
            req: "Consommer des données live d'un fournisseur Graph — aucun dataset simulé",
            proof:
              "Chaque endpoint du registre sondé par packages/the-graph/scripts/messari-probe.ts ; la sortie de la sonde est committée et alimente les chiffres de cette page",
          },
          {
            req: "Rendre l'apport des standards explicite",
            proof:
              "Ajouter Optimism a pris une ligne de config, zéro changement de requête — la démonstration d'effet de levier est littérale",
          },
          {
            req: "Dépôt public + vidéo de démo de 2–4 minutes",
            proof: "Ce dépôt open source ; section démo ci-dessous",
          },
        ],
      },
      {
        sponsor: "The Graph",
        track: "Piste 1.2",
        title: "Meilleur outil IA ou cas d'usage IA (Start Fresh)",
        pool: "1er $2,500 · 2e $1,500 · 3e $1,000",
        mapping: [
          {
            req: "Un agent IA utilise The Graph comme source de données porteuse",
            proof:
              "DeepGraphAgent (deepagents + LangGraph) — chaque verdict de risque est calculé sur des lignes de subgraph live",
          },
          {
            req: "Travail signifiant : raisonnement, décisions, automatisation — pas juste imprimer des lignes",
            proof:
              "Routage de rendement entre chaînes, poids d'allocation sous budget de vega, verdicts de stress ; mandat en langage naturel entrant, allocation sortante",
          },
          {
            req: "Open source avec README / SKILL.md pour que les juges l'exécutent",
            proof:
              "packages/langchain + packages/the-graph, one-liners CLI documentés, scripts de sonde niveau A/B",
          },
          {
            req: "Infrastructure réutilisable, pas une simple app",
            proof:
              "La table de fonctions mathématiques + ProtocolRegistry sont agnostiques de l'agent ; toute app LangChain peut les monter",
          },
        ],
      },
      {
        sponsor: "1inch",
        track: "Piste 5.1",
        title: "Construire une app Aqua — liquidité partagée, exécution SwapVM",
        pool: "1er $2,500 · 2e $1,500 · 3e $1,000",
        mapping: [
          {
            req: "App Aqua personnalisée implémentant une position DeFi sophistiquée",
            proof:
              "Plan : allocations de revenu fixe calculées par l'agent (poids ∝ η = netAPY/LVR) exprimées en positions Aqua à liquidité partagée",
          },
          {
            req: "L'usage de SwapVM est mieux noté — les stratégies comme données",
            proof:
              "La stratégie sous budget de vega de l'agent compile vers un programme SwapVM : concentration L, déclencheur de rééquilibrage σ, règle de sortie — un programme, pas un contrat par stratégie",
          },
          {
            req: "Contrats officiels Aqua/SwapVM, exécution onchain démontrée (forks locaux acceptés)",
            proof: "Branche d'exécution câblée via les contrats officiels ; démo sur fork prévue dans le build final",
          },
          {
            req: "Historique de commits git propre",
            proof: "Historique complet de session dans ce dépôt — aucune entrée à commit unique",
          },
        ],
      },
      {
        sponsor: "Uniswap Foundation",
        track: "Piste 7.1",
        title: "Meilleure contribution à la stack Uniswap — revenu fixe dynamique v4",
        pool: "Jusqu'à 3 équipes · $1,000 chacune",
        mapping: [
          {
            req: "Construire sur n'importe quelle partie de la stack Uniswap — v4, hooks, outillage",
            proof:
              "Analyse live du subgraph v4 : venues classées par volume, classement des hooks, détection de frais dynamiques (8388608), σ horaire — livré en outils réutilisables",
          },
          {
            req: "FEEDBACK.md + formulaire de retours développeur",
            proof:
              "Fichier de retours rédigé avec la particularité de comptabilisation TVL (TVL négative sur les pools à flash) et les lacunes de découverte des hooks rencontrées",
          },
          {
            req: "Le README pointe vers les contrats et lignes de code pertinents",
            proof:
              "PHASE1_TEST_RESULTS.md consigne les IDs de pools, adresses de hooks et hauteurs de bloc utilisés pour la vérification",
          },
        ],
      },
    ],
  },
  v4: {
    kicker: "05 — Uniswap v4",
    h2a: "Revenu fixe dynamique sur v4 :",
    h2b: " frais + rendement de prêt, moins la vol que vous portez.",
    lead:
      "Les hooks d'Uniswap v4 transforment une position LP en instrument proche d'une obligation : le capital inactif rapporte une jambe de prêt, le capital actif rapporte des frais, et c'est le hook — pas un contrat de coffre — qui gère les deux. L'agent évalue ces livres honnêtement : il soustrait le coût de rééquilibrage (LVR) avant d'appeler quoi que ce soit « rendement », et il suit le vega pour que l'exposition short-vol du livre soit un chiffre géré, pas une surprise.",
    termTitle: "fixedIncomeMath.ts — testé par valeurs d'or",
    termAssertions: "23/23 assertions",
    aquaNote:
      "1inch Aqua est la même idée côté exécution : les soldes virtuels sont des écritures comptables, les jetons ne bougent que quand un swap remplit — voilà pourquoi la stratégie de l'agent peut compiler vers un programme SwapVM plutôt qu'un contrat par stratégie.",
    examplePrefix: "exemple chiffré",
    exampleBody:
      "σ=40%, L=4, pente de frais k=0.6 ⇒ vega −1.0 pp par point de vol ⇒ −$100k/an par point de vol sur $10M. L'agent refuse les livres qu'il ne peut pas porter.",
    formulas: [
      {
        name: "netAPY",
        formula: "(1−w)·feeAPY + w·r − L²σ²/8 − gas",
        note: "frais de trading sur le capital actif + rendement de prêt sur la jambe inactive balayée par le hook − coût de rééquilibrage",
      },
      {
        name: "vega",
        formula: "𝒱 = k − L²σ/4",
        note: "sensibilité du rendement à la vol ; avec pente k = feeAPY/σ. Par point de vol : 𝒱/100 × notionnel",
      },
      {
        name: "LVR",
        formula: "L²σ²/8",
        note: "Loss-Versus-Rebalancing — le spread de crédit qu'un livre LP est payé pour porter (Milionis–Moallemi–Roughgarden)",
      },
      {
        name: "weights",
        formula: "wᵢ ∝ ηᵢ = netAPYᵢ / LVRᵢ",
        note: "allocation proportionnelle au ratio d'efficacité de revenu fixe, filtrée par objectif d'APR et budget de vega",
      },
    ],
    hooks: [
      {
        title: "Les swaps remplissent → rendement de frais",
        body: "Le capital actif gagne le palier de frais du pool. Pour le meilleur livre hooké USDC/WETH, ce palier est dynamique — feeTier 8388608 signifie que le hook fixe les frais à l'exécution.",
      },
      {
        title: "Capital inactif → rendement de prêt",
        body: "Un hook de type DualPool balaie les jetons inutilisés vers un coffre de prêt (style Spark). La comptabilisation est un solde virtuel — le protocole ne détient rien.",
      },
      {
        title: "Gros swap → rappel instantané",
        body: "Quand un swap a besoin du capital balayé, le hook le restaure dans la même transaction. Le rendement continue entre les fills.",
      },
      {
        title: "σ monte → dé-leverager",
        body: "L'agent surveille la volatilité réalisée sur les clôtures horaires. Passé un déclencheur, il réduit le levier de plage L — car le coût est L²σ²/8, L est le seul levier qui bat un coût quadratique.",
      },
    ],
  },
  stack: {
    kicker: "06 — Stack",
    h2a: "Chaque couche est un paquet",
    h2b: " que vous pouvez lire, exécuter ou forker.",
    groups: [
      {
        group: "Données — The Graph",
        items: [
          {
            name: "@ethonline2026/graph-fno-indexer",
            role: "SubgraphClient (health gate, curseurs id_gt, deltas _change_block) · ProtocolRegistry · FnoDataExtractor",
          },
          {
            name: "Subgraphs standardisés Messari",
            role: "un schéma de réserves/taux sur Aave V3 Ethereum, Arbitrum, Optimism — l'effet de levier de la piste 1.1",
          },
          {
            name: "Subgraph MCP",
            role: "découverte à l'heure de l'agent : introspection de schéma, meilleurs déploiements, recherche inter-protocoles",
          },
        ],
      },
      {
        group: "Agent — raisonnement & math",
        items: [
          {
            name: "@ethonline2026/langchain-agent",
            role: "DeepGraphAgent sur deepagents + LangGraph : 40+ outils typés, contrat de rapport Markdown, retry transient au niveau invoke",
          },
          {
            name: "Table de fonctions mathématiques",
            role: "calc_realized_vol · calc_fee_apy · calc_lvr · calc_net_apy · calc_vega · calc_efficiency_ratio · calc_allocation — testées par valeurs d'or, le LLM ne fournit que des arguments",
          },
          {
            name: "Google Vertex AI (gemini-2.5-flash-lite)",
            role: "raisonnement stratégique et rédaction du rapport ; auth ADC, observabilité LangSmith UE sur l'arbre d'appels complet",
          },
        ],
      },
      {
        group: "Exécution — là où le capital bouge",
        items: [
          {
            name: "1inch Aqua + SwapVM",
            role: "liquidité partagée auto-conservatrice ; les allocations de l'agent compilent vers des programmes SwapVM — stratégies comme données (piste 5.1)",
          },
          {
            name: "Hooks Uniswap v4",
            role: "livres LP à double hook : capital inactif vers une jambe de prêt, paliers de frais dynamiques, dé-leverager déclenché par σ (piste 7.1)",
          },
          {
            name: "Subgraph Uniswap v4",
            role: "découverte de venues par volume, classement des hooks, séries de vol réalisée horaire alimentant la math du vega",
          },
        ],
      },
      {
        group: "Surface — cette page",
        items: [
          {
            name: "Next.js 15 + React 19",
            role: "application mono-page, composants serveur par défaut, îlots clients seulement là où l'interaction l'exige",
          },
          {
            name: "primitives shadcn/ui + Tailwind v4",
            role: "button/card/badge/separator re-thématisés en Terminal Noir — coins carrés, bords hairline",
          },
          {
            name: "React Flow (@xyflow/react)",
            role: "le canevas d'architecture ci-dessus — chaque nœud nomme un module réel de ce monorepo",
          },
        ],
      },
    ],
  },
  demo: {
    kicker: "07 — Démo",
    h2: "Le pitch de deux minutes.",
    badge: "juges : commencez ici",
    lead:
      "La démonstration enregistrée du système — la couche de données répondant en direct, l'agent raisonnant sur des lignes standardisées, et le rapport de revenu fixe produit à la fin. Ce clip a lui-même été composé dans notre studio vidéo FastH3 — scènes chaînées continues, générées par la même stack d'agents.",
    studioCta: "Ouvrir le studio de démo produit",
    studioNote: "composez de nouveaux épisodes de pitch — scènes chaînées, un montage continu",
  },
  footer: {
    about:
      "Un système de gestion d'exécution agentique pour le revenu fixe on-chain. Construit ouvertement pour ETHOnline 2026 — données par The Graph, exécution par Uniswap v4 et 1inch, raisonnement par un agent qui n'a pas le droit de faire sa propre arithmétique.",
    repro:
      "les chiffres de cette page sont des instantanés gateway du 2026-09-07 — relancez pnpm probe:levelA pour reproduire",
    submission: "Soumission ETHOnline 2026 · The Graph · 1inch · pistes Uniswap Foundation",
    links: {
      graph: "The Graph — subgraphs standardisés ↗",
      oneinch: "1inch Aqua — liquidité partagée ↗",
      uniswap: "Développeurs Uniswap ↗",
      repo: "Dépôt source ↗",
      studio: "Studio de démo produit →",
    },
  },
};

export const DICTS: Record<Lang, Dict> = { en, hi, fr };
