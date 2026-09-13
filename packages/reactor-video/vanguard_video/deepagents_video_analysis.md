# DeepAgents Example Workflow — Video Analysis

_Model: gemini-2.5-flash | Video: vanguard_video/deepAgents-example-workflow.mov (inline)_

---

This video showcases a sophisticated agentic AI workflow, demonstrating the capabilities of a DeepAgents-style framework in tackling a research and synthesis task.

---

## 1. EXECUTIVE SUMMARY & OVERVIEW

The recording demonstrates an AI system's ability to decompose a complex query ("Compare DeepAgents, LangChain, and LangGraph for building an agent") into parallel sub-tasks, execute these tasks using specialized agents, and then synthesize their findings into a comprehensive comparison. The core workflow involves:

1.  **Task Decomposition:** The initial prompt is understood as a request for comparative research.
2.  **Agent Orchestration:** A main orchestrator agent spins up three "researcher" sub-agents, each assigned to investigate one of the specified frameworks (DeepAgents, LangChain, LangGraph).
3.  **Parallel Execution:** These researcher agents operate concurrently, utilizing command-line tools (`grep`, `ls`, `glob`) to search for information within an assumed local file system or knowledge base.
4.  **Information Gathering:** Each researcher attempts to find documentation and configuration files related to its assigned framework. Notably, the system indicates no local files were found for DeepAgents or LangChain, and a similar message for LangGraph, suggesting either a lack of local data or a fallback to pre-existing knowledge for the synthesis.
5.  **Synthesis:** Upon completion of all research sub-tasks, the orchestrator synthesizes the gathered (or known) information into a structured comparison, including a "Quick Decision Matrix."

The workflow highlights the benefits of agentic AI: parallel processing for efficiency, specialized tool use, and a clear, step-by-step visual representation of the agents' activities, enhancing transparency and auditability.

---

## 2. STEP-BY-STEP TIMELINE & ACTION BREAKDOWN

*   **00:00:** Video starts, displaying a prompt input field and a suggested prompt: "Compare DeepAgents, LangChain, and LangGraph for building an agent."
*   **00:01:** User clicks the suggested prompt.
*   **00:02:** The system (orchestrator agent) responds: "I'll spin up three specialists in parallel to research each agent framework in depth, then synthesize a comparison for you."
*   **00:06:** Three "researcher" agent cards appear below the orchestrator's message, each labeled "Running."
    *   **Researcher 1 (DeepAgents):** Namespace `tools:9656f86c-8b33-5bfa-8b58-...`
    *   **Researcher 2 (LangChain):** Namespace `tools:ca81184d-71b1-55fb-b9f9-...`
    *   **Researcher 3 (LangGraph):** Namespace `tools:10cdfd2c-2d1a-5745-b49f-...`
*   **00:07 - 00:17:** All three researcher agents execute a series of tool calls in parallel:
    *   Each researcher starts with multiple `grep` commands (e.g., `grep -r "DeepAgents" .`, `grep -r "LangChain" .`, `grep -r "LangGraph" .`).
    *   After initial `grep`s, they broaden their search:
        *   **Researcher 1:** "Let me search for documentation and configuration files more broadly:" executes `ls` and two `glob` commands. Concludes: "Based on my search of available resources, I cannot find documentation or information about DeepAgents."
        *   **Researcher 2:** "Let me search more broadly for framework documentation:" executes `ls` and two `grep` commands. Concludes: "Based on my research capabilities, there are no local files available in the system containing LangChain documentation."
        *   **Researcher 3:** "Let me check what files are available in the system:" executes `ls` and two `glob` commands. Concludes: "Based on my search attempts, there are no local files containing information..." (This message is slightly inconsistent with the final output, suggesting a fallback mechanism or external knowledge for LangGraph).
*   **00:12:** Researcher 1 (DeepAgents) status changes to "Complete."
*   **00:15:** Researcher 2 (LangChain) status changes to "Complete."
*   **00:17:** Researcher 3 (LangGraph) status changes to "Complete."
*   **00:17:** A new message appears: "Synthesizing results..."
*   **00:18:** The synthesized comparison is displayed, titled "Synthesis: Agent Framework Comparison." It provides details for LangChain, LangGraph, and DeepAgents, including "Best for," "Core strength," "Agent model," "Learning curve," and "When to use."
*   **00:20:** The user scrolls down to reveal more of the comparison, including a "Quick Decision Matrix" and a "Bottom line" summary.
*   **00:22 - 00:49:** The video scrolls up and down, reviewing the completed agent tasks and the final synthesized output. The agent cards remain visible in their "Complete" state.
*   **00:50:** Video ends.

---

## 3. AGENT INVENTORY

**1. Orchestrator Agent (Implicit)**
*   **Name:** Not explicitly named, but acts as the primary conversational agent.
*   **Role:** Receives user prompts, decomposes tasks, orchestrates sub-agent execution, and synthesizes final results.
*   **Tools:** Spawns and manages `researcher` sub-agents.
*   **Sub-agents:** Spawns three `researcher` agents.
*   **Output Manifestation:** Chat messages (initial response, "Synthesizing results..."), and the final structured "Synthesis: Agent Framework Comparison" in the chat interface.

**2. Researcher Agents (3 instances)**
*   **Name:** `researcher`
*   **Role:** Specialized in information gathering and analysis for a specific topic (in this case, an agent framework). Each instance focuses on one framework.
*   **Tools:**
    *   `grep`: Searches for patterns in files. Used to find specific keywords related to the frameworks.
    *   `ls`: Lists directory contents. Used to explore available files.
    *   `glob`: Finds pathnames matching a specified pattern. Used for broader file discovery (e.g., documentation files).
*   **Sub-agents:** None explicitly shown.
*   **Output Manifestation:**
    *   Internal messages within their respective agent cards, detailing their search strategy and immediate findings (e.g., "Let me search for documentation...", "Based on my search... I cannot find documentation...").
    *   Their aggregated findings are implicitly passed back to the Orchestrator for final synthesis.

---

## 4. PLANNING & ARTIFACT ANALYSIS

*   **Planning:**
    *   **Initial Plan (Orchestrator):** The orchestrator immediately formulates a clear plan: "spin up three specialists in parallel to research each agent framework in depth, then synthesize a comparison for you." This demonstrates effective task decomposition and parallelization.
    *   **Sub-Plans (Researcher Agents):** Each researcher agent appears to have an internal, iterative search strategy. They start with targeted `grep` commands, then broaden their search using `ls` and `glob` to find documentation or configuration files. This shows a heuristic-driven approach to information retrieval.
    *   **Plan Execution Tracking:** The UI visually tracks the completion of each researcher agent (e.g., "Specialist agents - 1/3 completed," "2/3 completed," "3/3 completed"), providing real-time progress updates on the overall plan.

*   **Artifacts:**
    *   **Intermediate Artifacts:** The output of the `grep`, `ls`, and `glob` commands, along with the researcher agents' internal conclusions ("Based on my search... I cannot find documentation..."), serve as intermediate artifacts. These are displayed within the individual agent cards, providing transparency into their working process. While not saved as explicit files, they represent the gathered data points.
    *   **Final Artifact:** The "Synthesis: Agent Framework Comparison" is the primary final artifact. It's a structured text output presented directly in the chat, summarizing the research from all three sub-agents. It includes a "Quick Decision Matrix" which is a valuable structured summary.

*   **Hand-off:**
    *   The hand-off occurs when all three `researcher` agents complete their tasks. Their individual findings (even if negative, like "no documentation found") are implicitly collected by the orchestrator.
    *   The orchestrator then takes these collected findings and performs the "Synthesizing results..." step, producing the final comparative analysis. This demonstrates a clear aggregation and summarization phase after parallel execution.

---

## 5. HUMAN STEERING MOMENTS

*   **00:01:** The human operator initiates the workflow by clicking on a pre-suggested prompt: "Compare DeepAgents, LangChain, and LangGraph for building an agent." This is the primary and only explicit human interaction shown in the video.
*   **No further human steering, interruptions, or approvals are observed during the agent's execution.** The entire research and synthesis process runs autonomously after the initial prompt. This suggests a high degree of autonomy for this particular workflow, or that the video is edited to show a smooth run.

---

## 6. UI COMPONENT & LAYOUT ANALYSIS

The UI is designed for clarity, legibility, and transparency of complex agentic workflows.

*   **Overall Aesthetic:** Dark theme, clean, modern, and functional.
*   **Top Bar:**
    *   "Preview" and "Code" tabs: Allows switching between the visual output and the underlying code (not shown in detail in this video, but implies code generation/inspection capabilities).
    *   Download and Share icons: Standard functionality.
    *   "React" dropdown: Suggests the UI framework used, or potentially a way to switch UI rendering modes.
*   **Main Chat Area:** Standard chat interface at the bottom for user input ("Type a message...") and system responses.
*   **Agent Cards (Dynamic Display):**
    *   **Positioning:** Appear dynamically below the orchestrator's initial response. Initially stacked, then arranged in a responsive grid (3 columns in this view) for parallel agents.
    *   **Content:** Each card clearly displays:
        *   Agent type (`researcher`).
        *   A unique `namespace` (likely an ID for the agent's execution environment).
        *   Current status (`Running`, `Complete`).
        *   A log of tool calls (`grep`, `ls`, `glob`) with green checkmarks indicating successful execution.
        *   Internal thought processes or findings (e.g., "Let me search...", "Based on my search...").
    *   **Visual Cues:**
        *   Green checkmarks for completed tool steps.
        *   "Running" and "Complete" labels with distinct colors (orange for running, green for complete).
        *   Ellipses (`...`) and "Working..." for active agents.
        *   Expand/collapse arrow for each card, allowing users to focus on specific agent details or get an overview.
    *   **Legibility:** The visual separation and detailed logging within each card make it exceptionally clear what each agent is doing, what tools it's using, and its progress. This is crucial for understanding and debugging multi-agent systems.
*   **Synthesis Card:** A distinct card for the final synthesized output, clearly separating it from the individual agent activities.
*   **Bottom Bar (Quickstart):** Displays options for different LLM providers (Google, OpenAI, Anthropic, OpenRouter, Fireworks, Baseten, Ollama) and a "Quickstart" section with code examples, indicating the platform's integration with various models and its developer-centric nature.

---

## 7. TECHNICAL OBSERVATIONS

This workflow exemplifies a robust approach to agentic AI, composing several key elements:

*   **Hierarchical Agent Architecture:** A top-level orchestrator agent (the main chat interface) delegates tasks to specialized sub-agents (`researcher`). This allows for modularity, parallelization, and clear division of labor.
*   **Dynamic Task Decomposition:** The orchestrator intelligently breaks down the high-level user request into concrete, executable sub-tasks for the specialized agents.
*   **Tool Integration:** The `researcher` agents effectively leverage external tools (`grep`, `ls`, `glob`) to interact with an environment (likely a virtual file system or a knowledge base). This demonstrates the power of grounding LLMs with real-world capabilities.
*   **Parallel Execution for Efficiency:** Running multiple `researcher` agents concurrently significantly speeds up the overall task completion time compared to a sequential approach.
*   **Transparent Execution Trace:** The UI's detailed logging of each agent's actions (tool calls, internal thoughts, status) provides an invaluable audit trail. This is critical for debugging, understanding agent behavior, and building trust in autonomous systems.
*   **Synthesis Layer:** A dedicated synthesis step aggregates and processes the potentially disparate outputs from parallel agents into a coherent, unified response. This addresses the challenge of combining information from multiple sources.
*   **Handling of Negative Findings:** The agents report when they cannot find information locally. The fact that the final synthesis still provides information on all frameworks (including DeepAgents, which was "not found in public documentation") suggests either a fallback to general LLM knowledge, or that the "local files" search was just one part of a broader information-gathering strategy not fully depicted.

**Financial Trading Floor Analogue:**

A financial trading floor could greatly benefit from a similar agentic workflow, especially for complex market analysis or strategy development.

*   **Orchestrator (Head Trader / Portfolio Manager):** Receives a high-level query like "Analyze the impact of upcoming Fed rate hike on tech stocks, bond yields, and commodity prices, and suggest hedging strategies."
*   **Specialist Agents (Analysts):**
    *   **Equity Analyst Agent:** Focuses on tech stocks. Tools: Access to real-time stock data, news feeds, company financials, equity models.
    *   **Fixed Income Analyst Agent:** Focuses on bond yields. Tools: Access to bond market data, central bank announcements, macroeconomic indicators, yield curve models.
    *   **Commodity Analyst Agent:** Focuses on commodity prices. Tools: Access to commodity exchanges, supply/demand reports, geopolitical news, commodity pricing models.
    *   **Risk Analyst Agent:** Focuses on hedging strategies. Tools: Access to derivatives pricing, risk management frameworks, historical volatility data.
*   **Parallel Execution:** All these specialist agents work simultaneously, gathering data and performing calculations relevant to their domain.
*   **Tool Calls:** Each analyst agent would be making "tool calls" to their respective data terminals, running simulations, querying databases, or even interacting with other internal systems. The UI would show `query_bloomberg_terminal`, `run_quant_model`, `fetch_news_sentiment`, etc.
*   **Intermediate Artifacts:** Each analyst agent would generate mini-reports, charts, or risk assessments (e.g., "Equity Analyst: Tech sector sentiment is bearish, specific stocks X, Y, Z are vulnerable," "Fixed Income Analyst: 10-year Treasury yields expected to rise by 20bps"). These would be visible in their individual "agent cards."
*   **Synthesis (Head Trader / PM):** The orchestrator agent would then synthesize these individual findings into a comprehensive market outlook, identifying cross-asset correlations, potential risks, and proposing a consolidated trading or hedging strategy.
*   **Legibility & Auditability:** The DeepAgents UI's clear display of parallel agent activity, tool usage, and intermediate findings would be invaluable. A head trader could see in real-time which analyst is working on what, what data they're accessing, and their preliminary conclusions. This transparency allows for:
    *   **Real-time Oversight:** Intervene if an analyst agent is stuck or going down the wrong path.
    *   **Trust Building:** Understand the "reasoning" behind the synthesized strategy.
    *   **Compliance & Audit:** A detailed log of every step taken by every agent, including data sources queried, provides an auditable trail for regulatory purposes.

This agentic approach would allow trading floors to process vast amounts of information, generate complex analyses, and formulate strategies with unprecedented speed and transparency, while still retaining human oversight at critical junctures.