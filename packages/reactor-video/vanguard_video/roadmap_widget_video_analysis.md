# Roadmap Widget UI Workflow - Video Analysis

_Model: gemini-2.5-flash | Video: example-ui-workflow-roadmap-widget.mov (first 12s) | Frames: 24 @ 2 fps_

---

The provided screen recording showcases an "Income Flow Visualization" widget, likely designed for financial analysis within the DeFi (Decentralized Finance) space, given the "DeFiLlama" branding. The visualization employs a Sankey-like diagram to illustrate the flow of revenue and costs over a specified period (Quarterly, Q2 2026).

---

### 1. EXECUTIVE SUMMARY & OVERVIEW

The widget presents a clear, left-to-right visualization of financial flows, starting from initial "Taker Fees" (gross revenue) and breaking it down into "Gross Protocol Revenue," then further bifurcating into "Gross Profit" (green path) and "Cost of Revenue" (red path). The "Gross Profit" ultimately leads to "Earnings," while the "Cost of Revenue" is itemized into various rebate and reward categories. The investment/liquidity arc narrates how initial revenue is generated, what portion becomes profit, and how the remaining portion is distributed as costs or incentives. The visual design uses varying ribbon widths to represent the magnitude of monetary values, and color coding (green for profit, red for cost, grey for initial revenue) to quickly convey financial health and distribution. Hover interactions provide detailed breakdowns for each stage and flow segment.

---

### 2. SECOND-BY-SECOND TIMELINE (00:00 -> 00:12)

*   **00:00:** The visualization is fully displayed. The mouse cursor is hovering over the "Gross Profit" node (green ribbon). A hover card appears, displaying "Gross Profit -> Earnings" and "$61.99M".
*   **00:01:** The mouse moves away from "Gross Profit". The hover card disappears.
*   **00:01:** The mouse moves to hover over the "Gross Protocol Revenue" node (grey ribbon). A hover card appears, displaying "Gross Protocol Revenue -> Gross Profit" and "$61.99M".
*   **00:02:** The mouse moves away from "Gross Protocol Revenue". The hover card disappears.
*   **00:02:** The mouse moves to hover over the "Cost of Revenue" node (red ribbon). A hover card appears, displaying "Gross Protocol Revenue -> Cost of Revenue" and "$36.65M".
*   **00:03:** The mouse moves away from "Cost of Revenue". The hover card disappears.
*   **00:03:** The mouse moves to hover over the flow segment from "Cost of Revenue" to "Maker Rebates (Cost)". A hover card appears, displaying "Cost of Revenue -> Maker Rebates (Cost)" and "$20.79M".
*   **00:04:** The mouse moves away from the flow segment. The hover card disappears.
*   **00:04:** The mouse moves to hover over the "Cost of Revenue" node again. A hover card appears, displaying "Cost of Revenue" and "$36.65M (37%)".
*   **00:05:** The mouse moves away from "Cost of Revenue". The hover card disappears.
*   **00:05:** The mouse moves to hover over the flow segment from "Cost of Revenue" to "Liquidity Rewards (Cost)". A hover card appears, displaying "Cost of Revenue -> Liquidity Rewards (Cost)" and "$9.48M".
*   **00:06:** The mouse moves away from the flow segment. The hover card disappears.
*   **00:06:** The mouse moves to hover over the flow segment from "Cost of Revenue" to "Referral Rewards (Cost)". A hover card appears, displaying "Cost of Revenue -> Referral Rewards (Cost)" and "$2.6M".
*   **00:07:** The mouse moves away from the flow segment. The hover card disappears.
*   **00:07:** The mouse moves to hover over the flow segment from "Cost of Revenue" to "Taker Rebates (Cost)". A hover card appears, displaying "Cost of Revenue -> Taker Rebates (Cost)" and "$2.73M".
*   **00:08:** The mouse moves away from the flow segment. The hover card disappears.
*   **00:08:** The mouse moves to hover over the flow segment from "Cost of Revenue" to "Holding Rewards (Cost)". A hover card appears, displaying "Cost of Revenue -> Holding Rewards (Cost)" and "$1.06M".
*   **00:09:** The mouse moves away from the flow segment. The hover card disappears.
*   **00:09:** The mouse moves to hover over the "Earnings" node. A hover card appears, displaying "Earnings" and "$61.99M (100%)".
*   **00:10:** The mouse moves away from "Earnings". The hover card disappears.
*   **00:10:** The mouse moves to hover over the "Gross Profit" node. A hover card appears, displaying "Gross Profit -> Earnings" and "$61.99M".
*   **00:11:** The mouse moves away from "Gross Profit". The hover card disappears.
*   **00:11:** The mouse moves to hover over the "Taker Fees" node. A hover card appears, displaying "Taker Fees" and "$98.64M (100%)".

---

### 3. LIQUIDITY-FLOW GRAPH

The graph is a Sankey-like diagram illustrating the flow of funds.

*   **Ordered Stages/Nodes (left to right):**
    1.  **Taker Fees:** Initial revenue source.
    2.  **Gross Protocol Revenue:** Consolidated initial revenue.
    3.  **Gross Profit:** Revenue remaining after initial costs.
    4.  **Cost of Revenue:** Total costs deducted from gross revenue.
    5.  **Earnings:** Final profit after all costs.
    6.  **Maker Rebates (Cost):** A specific cost category.
    7.  **Liquidity Rewards (Cost):** A specific cost category.
    8.  **Referral Rewards (Cost):** A specific cost category.
    9.  **Taker Rebates (Cost):** A specific cost category.
    10. **Holding Rewards (Cost):** A specific cost category.

*   **Directed Edges (Source -> Destination), Amounts, and Units:**
    *   **Taker Fees ($98.64M)** -> **Gross Protocol Revenue ($98.64M)**: Represents the total fees collected. (Inflow to Gross Protocol Revenue)
    *   **Gross Protocol Revenue ($98.64M)** -> **Gross Profit ($61.99M)**: Portion of revenue that becomes profit. (Inflow to Gross Profit)
    *   **Gross Protocol Revenue ($98.64M)** -> **Cost of Revenue ($36.65M)**: Portion of revenue allocated to costs. (Outflow from Gross Protocol Revenue, Inflow to Cost of Revenue)
    *   **Gross Profit ($61.99M)** -> **Earnings ($61.99M)**: Gross profit directly translates to earnings. (Inflow to Earnings)
    *   **Cost of Revenue ($36.65M)** -> **Maker Rebates (Cost) ($20.79M)**: Largest cost component. (Outflow from Cost of Revenue)
    *   **Cost of Revenue ($36.65M)** -> **Liquidity Rewards (Cost) ($9.48M)**: Second largest cost component. (Outflow from Cost of Revenue)
    *   **Cost of Revenue ($36.65M)** -> **Referral Rewards (Cost) ($2.6M)**: A smaller cost component. (Outflow from Cost of Revenue)
    *   **Cost of Revenue ($36.65M)** -> **Taker Rebates (Cost) ($2.73M)**: A smaller cost component. (Outflow from Cost of Revenue)
    *   **Cost of Revenue ($36.65M)** -> **Holding Rewards (Cost) ($1.06M)**: Smallest cost component. (Outflow from Cost of Revenue)

*   **Inflow vs. Outflow:**
    *   **Inflow:** Represented by the grey ribbon (Taker Fees -> Gross Protocol Revenue), and the green ribbons (Gross Protocol Revenue -> Gross Profit -> Earnings). These paths indicate money flowing *into* the profit/earnings stream.
    *   **Outflow:** Represented by the red ribbons (Gross Protocol Revenue -> Cost of Revenue, and Cost of Revenue -> various cost categories). These paths indicate money flowing *out* of the revenue stream as expenses or distributions.

*   **Horizontal Axis Representation:** The horizontal axis represents the sequential stages or pipeline order of income and cost allocation. It is not a time axis, but rather a process flow.

---

### 4. NODE ANATOMY

Each node in the visualization has a consistent structure:

*   **Label:** A descriptive name for the financial stage or category (e.g., "Taker Fees", "Gross Profit", "Maker Rebates (Cost)").
*   **Icon/Marker:**
    *   A vertical bar for most nodes (e.g., "Taker Fees", "Gross Profit", "Cost of Revenue", "Earnings", and all specific cost categories).
    *   A 3D cube icon with "DeFiLlama" text below it for the "Gross Protocol Revenue" node, indicating its source or context.
*   **Value:** The monetary amount associated with that stage, typically in millions of dollars (e.g., "$98.64M", "$61.99M").
*   **Sub-label:**
    *   A percentage, often indicating its proportion relative to a parent node (e.g., "100%", "63%", "37%", "57%").
    *   A brief descriptive sentence providing context (e.g., "Users pay fees when they trade binary options on polymarket." for "Taker Fees").
    *   A combination of both (e.g., "Cost of Revenue: $36.65M (37%)" with "Maker rebates, taker rebates, referral rewards, liquidity and holding rewards" below).
*   **State:** All nodes visible in the first 12 seconds appear to be in a "complete" or "active" state, displaying concrete values for Q2 2026. There are no visual cues for "upcoming," "blocked," or "projected" states.

---

### 5. HOVER INTERACTION

*   **Trigger:** The hover card is triggered by moving the mouse cursor over any node (vertical bar) or any flow segment (ribbon) connecting two nodes.
*   **Delay:** The card appears almost instantaneously upon hover, with no noticeable delay.
*   **Card Creation Location:** The new card is created directly adjacent to the hovered element, typically slightly above and to the right of the cursor, ensuring it doesn't obscure the hovered element itself.
*   **Dismissal:** The card is dismissed instantly when the mouse cursor moves away from the hovered node or flow segment.
*   **Interactivity:** The hover cards are read-only. They display information but do not contain any interactive elements like buttons, links, or input fields.

---

### 6. HOVER-CARD ANATOMY

Each hover card follows a consistent structure:

*   **Fields Shown:**
    *   **Primary Label:** This is the main title of the card, often indicating the node's name or the flow's origin and destination (e.g., "Gross Profit", "Cost of Revenue -> Maker Rebates (Cost)", "Taker Fees").
    *   **Value:** The monetary amount associated with the hovered element (e.g., "$61.99M", "$20.79M", "$98.64M").
    *   **Percentage (Optional):** A percentage value, often indicating the proportion of the value relative to a parent or total (e.g., "(63%)", "(100%)").
    *   **Descriptive Text (Optional):** A brief, contextual explanation related to the hovered element (e.g., "Fees going to protocol address post maker rebate...", "Users pay fees when they trade binary options on polymarket.").

*   **Field Grouping:**
    *   The Primary Label and Value are typically presented on the first line.
    *   The Percentage, if present, is usually appended to the Value or on the same line.
    *   The Descriptive Text, if present, occupies subsequent lines below the primary label and value.

*   **Sparkline, Bar, Table, or Badge:** No sparklines, bar charts, tables, or badges are visible within the hover cards in the first 12 seconds. They are purely text-based information displays.

---

### 7. COLOR + VISUAL GRAMMAR

*   **Palette:**
    *   **Background:** Dark grey/black, providing high contrast for the data elements.
    *   **Text:** White or very light grey for labels and values, ensuring readability against the dark background.
    *   **Ribbons/Flows:**
        *   **Grey:** Used for initial revenue streams ("Taker Fees", "Gross Protocol Revenue").
        *   **Green:** Used for profit and earnings streams ("Gross Profit", "Earnings"). This color typically signifies positive financial outcomes.
        *   **Red:** Used for cost and rebate streams ("Cost of Revenue" and its sub-categories). This color typically signifies negative financial outcomes or expenses.
    *   **Hover Cards:** Light blue/cyan background with dark text, providing a distinct visual pop for interactive information.
*   **Base Rail/Track Style:** The visualization uses a Sankey diagram style, characterized by curved, flowing ribbons. The width of each ribbon is proportional to the monetary value it represents, allowing for an intuitive understanding of magnitude.
*   **Completed vs. Projected Segments:** Within the first 12 seconds, there is no visual distinction between completed and projected segments. All data appears to be presented as historical or current for Q2 2026.
*   **Motion or Animation Cues:**
    *   **Ribbon Flow:** The ribbons themselves are static; there are no animated "traveling highlights" or "pulses" within them to indicate flow direction or activity. Their widths are fixed based on the displayed values.
    *   **Hover Cards:** Appear and disappear with a subtle, almost instantaneous fade-in/fade-out effect, rather than a sharp pop.
    *   **Counters:** No visible counters or animated numerical transitions are present.

---

### 8. TRANSLATION NOTES

Translating this visualization to a "Terminal Noir" aesthetic (sharp-cornered, amber-accented dark trading terminal) would require specific adaptations:

*   **Survive in Terminal Noir:**
    *   **Dark Background:** The existing dark background is perfectly suited.
    *   **Sankey-like Flow:** The core concept of a flow diagram with proportional widths can be retained.
    *   **Text Labels and Values:** The display of monetary values, percentages, and descriptive text would remain.
    *   **Hover Interaction:** The mechanism of displaying information on hover is a standard UI pattern that would translate well.
    *   **DeFiLlama Icon:** The 3D cube icon could be replaced with a monochrome, sharp-edged version, or simply a text label.
    *   **Overall Structure:** The left-to-right pipeline order of nodes and edges would be preserved.

*   **Must be Re-expressed Differently:**
    *   **Color Palette:**
        *   **Green for Profit:** The current soft green would likely be replaced with a sharp amber or a bright, high-contrast green (e.g., neon green) against the dark background.
        *   **Red for Cost:** The current red might be too muted. A more aggressive, sharp red or a contrasting color like a deep orange or even a stark white/grey with an amber border could be used to denote costs.
        *   **Grey for Revenue:** Could be replaced with a darker, more industrial grey or a subtle amber tint.
        *   **Hover Card Color:** The light blue/cyan background would be replaced with a dark background, amber text, and possibly an amber border, or a high-contrast white text on a dark background.
    *   **Curved Ribbons:** The organic, flowing curves of the Sankey diagram would likely be replaced with sharp, angular lines and corners to fit the "Terminal Noir" aesthetic. This would change the visual feel from "flow" to "circuitry" or "data pipes."
    *   **Font Style:** The current sans-serif font would be replaced with a monospace, pixelated, or highly stylized angular font characteristic of terminal interfaces.
    *   **Hover Card Styling:** Rounded corners would become sharp corners. The overall appearance would be more minimalist and stark, focusing on high contrast and clear information hierarchy.
    *   **Motion Cues:** Subtle fades might be too gentle. Hover cards could appear instantly or with a very quick, sharp animation (e.g., a quick slide or a "glitch" effect). Any "flow" animation within the ribbons would likely be represented by rapidly moving dashed lines or pixelated patterns rather than smooth pulses.