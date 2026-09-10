# Fixed-Income Trading Desk: Observation Report & Agentic Pipeline Recommendations

> **Author**: Agentic EMS Architecture Team
> **Date**: 2026-09-09
> **Status**: Architecture Observation Report
> **Scope**: Real-world fixed-income trading desk operations, gap analysis of current `packages/langchain` implementation, and recommendations for a production-grade agentic data pipeline.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [How Real Fixed-Income Trading Desks Operate](#2-how-real-fixed-income-trading-desks-operate)
   - 2.1 Desk Structure & Roles
   - 2.2 The Daily Timeline
   - 2.3 Bloomberg Terminal & TOMS Workflow
   - 2.4 Risk Management & Compliance
3. [Current Implementation Audit](#3-current-implementation-audit)
   - 3.1 What We Have Built
   - 3.2 Architecture Diagram
4. [Gap Analysis: Current State vs. Real Desk Operations](#4-gap-analysis)
   - 4.1 Session Phase & Test-State Initialization
   - 4.2 Space Constraints (Missing)
   - 4.3 HITL Compliance Review
   - 4.4 External Oracle Service (Missing)
   - 4.5 Audit Trail & Trade Surveillance (Missing)
5. [Recommendations: Robust Agentic Data Pipeline](#5-recommendations)
   - 5.1 Enhanced Session State Machine
   - 5.2 Space Constraints Framework
   - 5.3 Production HITL with Four-Eyes Compliance
   - 5.4 External Oracle Service
   - 5.5 Comprehensive Audit & Surveillance
6. [Implementation Roadmap](#6-implementation-roadmap)
7. [References](#7-references)

---

## 1. Executive Summary

This report documents how fixed-income trading desks **actually operate** at major financial institutions (JPMorgan, AllianceBernstein, Bloomberg, PGIM) and provides a detailed gap analysis against our current `packages/langchain` agentic implementation. The goal is to evolve our system from a **demonstration prototype** into a **production-grade agentic trading desk** that mirrors real institutional workflows.

**Key Finding**: Our current implementation correctly captures the *skeleton* of a trading desk (mandate → data → strategy → execution → verification), but lacks the **institutional rigor** that makes real desks compliant, auditable, and safe:

- **No space constraints** (position limits, risk budgets, concentration caps)
- **Naive HITL** (approve/overrule/reject without audit trail, data attribution, or four-eyes enforcement)
- **No external oracle** for market-data validation
- **No trade surveillance** or compliance reporting
- **Session phases** are calendar-driven but lack proper test-state initialization

---

## 2. How Real Fixed-Income Trading Desks Operate

### 2.1 Desk Structure & Roles

Real fixed-income desks at institutions like JPMorgan, AllianceBernstein, and PGIM are organized into specialized roles that collaborate continuously:

| Role | Responsibility | Interaction with System |
|------|---------------|------------------------|
| **Head Trader / Desk Head** | Sets risk budget, approves large positions, weekly strategy | Approves risk limits, reviews P&L |
| **Senior Trader** | Executes large trades, manages inventory, intra-day positioning | Real-time position management |
| **Junior Trader / Analyst** | Prepares trade ideas, monitors flows, writes commentaries | Data analysis, trade preparation |
| **Sales** | Client-facing, pitches trades, gathers flow intelligence | CRM, client order flow |
| **Quant Researcher** | Model calibration, signal research, backtesting | Research pipeline, model registry |
| **Risk Manager** | Independent risk oversight, VaR monitoring, limit enforcement | Risk dashboard, limit alerts |
| **Compliance Officer** | Trade surveillance, regulatory reporting, conduct review | Surveillance system, audit logs |

**Key Insight**: The risk manager and compliance officer are **independent** from the trading desk — they have veto power and separate reporting lines. This separation is a regulatory requirement (SEC, FCA, MiFID II), not optional.

### 2.2 The Daily Timeline

Based on documented "day in the life" accounts from traders at major institutions:

| Time | Activity | System Used |
|------|----------|-------------|
| **06:30** | Arrive, review overnight Asia/Europe markets, check positions | Bloomberg, internal risk dashboards |
| **07:00** | **Morning Strategy Meeting** — desk head, research, sales align on daily strategy | Bloomberg, research notes |
| **07:30** | Data ingestion: overnight flows, funding rates, new issues | TOMS, Bloomberg PFM |
| **08:30** | Pre-market: finalize positions, check risk limits | Risk management system |
| **09:30** | **Market Open** — execute trades, manage order flow | Bloomberg TEMS, TradElect |
| **12:00** | Mid-day P&L check, recalibrate risk models | Internal P&L, risk dashboards |
| **16:00** | **Market Close** — post-trade review, confirm settlements | TOMS, confirmation systems |
| **16:30** | End-of-day analytics, ledger reconciliation, variance analysis | Risk & P&L systems |
| **17:00** | Trader commentaries, next-day preparation | Research distribution |

**Critical Difference from Our Implementation**: Real desks have **two distinct meetings** — a *morning strategy meeting* (07:00) where the day's risk budget and strategy are set collaboratively, and a *post-trade review* (16:30) where outcomes are analyzed. Our current implementation collapses these into a single linear flow.

### 2.3 Bloomberg Terminal & TOMS Workflow

Bloomberg's **Trade Order Management System (TOMS)** and **Trade EMS (TEMS)** are the institutional standard:

- **TOMS** (sell-side): Inventory management, risk, P&L, compliance, straight-through processing
- **TEMS** (buy-side): Low-latency execution, workflow automation, D2D and D2C markets
- **AIM** (buy-side): Portfolio management, risk optimization, compliance monitoring
- **Bloomberg Terminal**: Real-time pricing, analytics, communication (IB chat), news

**Key Workflows**:
1. **Order staging**: Trader prepares order → compliance pre-check → risk limit verification → execution
2. **Inventory management**: Real-time position tracking across books
3. **P&L attribution**: Realized vs. unrealized, daily flash vs. official
4. **Compliance pre-trade**: Automated checks before order reaches market

### 2.4 Risk Management & Compliance

Real desks operate under strict, multi-layered risk frameworks:

**Position Limits**:
- **Gross exposure cap**: Total notional across all positions
- **Net exposure cap**: Directional exposure after hedging
- **Concentration limit**: Max % in single issuer/sector
- **Duration limit**: Interest rate sensitivity cap
- **Credit spread limit**: Max exposure to credit widening

**Value-at-Risk (VaR)**:
- **Daily VaR** at 95% and 99% confidence
- **Stressed VaR** (using historical stress periods)
- **Incremental VaR**: Marginal risk of new positions
- **Backtesting**: Daily comparison of VaR predictions vs. actual P&L

**Compliance (Four-Eyes Principle)**:
- **Pre-trade compliance**: Automated checks before execution
- **Post-trade surveillance**: T+1 review of all trades
- **Four-eyes approval**: Sensitive actions require two authorized persons
- **Audit trail**: Every decision logged with who, what, when, why
- **Trade surveillance**: Detection of market abuse, insider trading, wash trading

---

## 3. Current Implementation Audit

### 3.1 What We Have Built

Our current `packages/langchain` implementation includes:

**Pipeline Layer** (`src/pipeline/`):
- `state.ts` — StrategyState channels
- `marketData.ts` — Live Graph data fetching (extracted from shipped tool)
- `strategy.ts` — Pure allocation computation
- `graph.ts` — Compiled LangGraph StateGraph
- `executeLegs.ts` — Dual-mode execution (arc-bridge, 1inch-swap, v4-mint)
- `nodes/` — parseMandate, riskGate, verifyResults, renderReport

**Desk Layer** (`src/desk/`):
- `deskState.ts` — DeskState channels + session phases
- `sessionGraph.ts` — Session graph with HITL interrupt
- `hitl.ts` — Human-in-the-loop helpers
- `nodes/` — riskGuardian, reconciliation
- `index.ts` — runDeskSession entry point

**CLI Commands**:
- `execute-strategy` — Single mandate pipeline
- `desk-session` — Full day-2-day session

### 3.2 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                     DESK SESSION (sessionGraph.ts)                  │
│                                                                     │
│  ┌──────────┐   ┌───────────┐   ┌──────────────┐   ┌───────────┐  │
│  │Ingestion │──▶│ Inference │──▶│ResearchAgent │──▶│  ■ HITL ■ │  │
│  │ 07:30    │   │  07:30    │   │   08:30      │   │  08:30    │  │
│  └──────────┘   └───────────┘   └──────────────┘   └─────┬─────┘  │
│                                                           │       │
│                                                           ▼       │
│                                                    ┌───────────┐  │
│                                                    │RiskGuardian│  │
│                                                    │  09:00    │  │
│                                                    └─────┬─────┘  │
│                                                          │        │
│                                          ┌───────────────┼──────┐ │
│                                          │ pass          │ fail │ │
│                                          ▼               ▼      │ │
│                                   ┌───────────┐   ┌──────────┐  │ │
│                                   │  Atomic   │   │ Research │  │ │
│                                   │Execution  │   │ (re-loop)│  │ │
│                                   │  09:30    │   └──────────┘  │ │
│                                   └─────┬─────┘                  │ │
│                                         │                        │ │
│                                         ▼                        │ │
│                                  ┌────────────┐                  │ │
│                                  │Reconciliation                 │ │
│                                  │   16:30    │                  │ │
│                                  └────────────┘                  │ │
│                                                                  │ │
└─────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  STRATEGY PIPELINE (pipeline/graph.ts)              │
│                                                                     │
│  ┌──────────┐   ┌───────────┐   ┌──────────────┐   ┌───────────┐  │
│  │  Parse   │──▶│  Fetch    │──▶│  Compute     │──▶│   Risk    │  │
│  │ Mandate  │   │  Market   │   │  Strategy    │   │   Gate    │  │
│  └──────────┘   └───────────┘   └──────────────┘   └─────┬─────┘  │
│                                                           │       │
│                                          ┌────────────────┼─────┐ │
│                                          │ pass           │fail │ │
│                                          ▼                ▼     │ │
│                                   ┌───────────┐    ┌──────────┐ │ │
│                                   │  Build    │    │  Render  │ │ │
│                                   │  Plan     │    │  Report  │ │ │
│                                   └─────┬─────┘    │ (abort)  │ │ │
│                                         │          └──────────┘ │ │
│                                         ▼                        │ │
│                                   ┌───────────┐                  │ │
│                                   │  Execute  │                  │ │
│                                   │   Legs    │                  │ │
│                                   └─────┬─────┘                  │ │
│                                         │                        │ │
│                                         ▼                        │ │
│                                   ┌───────────┐                  │ │
│                                   │  Verify   │                  │ │
│                                   │  Results  │                  │ │
│                                   └─────┬─────┘                  │ │
│                                         │                        │ │
│                                         ▼                        │ │
│                                   ┌───────────┐                  │ │
│                                   │  Render   │                  │ │
│                                   │  Report   │                  │ │
│                                   └───────────┘                  │ │
│                                                                  │ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Gap Analysis

### 4.1 Session Phase & Test-State Initialization

**Current State**: Our `initialDeskState` derives `sessionPhase` from the day-of-week of the session date:
- Monday → `MON_MACRO`
- Friday → `FRI_DEFENSIVE`
- Tuesday–Thursday → `ALPHA_CAPTURE`

**Problem**: This is **calendar-driven**, not **state-driven**. In a real trading system:

1. **Test state is NOT initialized from UTC time** — it is initialized from:
   - **Market data timestamps** (when did the data actually arrive?)
   - **Trading session boundaries** (pre-market, regular, post-market)
   - **Exchange calendars** (NYSE, LSE, TSE holidays — not just weekends)
   - **Regulatory reporting dates** (month-end, quarter-end, year-end)

2. **Session phases are not just day-of-week** — they depend on:
   - **Macro event calendar** (FOMC meetings, CPI releases, NFP)
   - **Month-end/quarter-end** (rebalancing flows, window dressing)
   - **Tax-loss harvesting periods** (October–December)
   - **New issue calendar** (heavy issuance periods)

**Recommendation**: Implement a proper `SessionClock` that:
- Uses exchange calendars (e.g., `pandas_market_calendars` or exchange-specific APIs)
- Tracks market phases: `PRE_MARKET`, `REGULAR`, `POST_MARKET`, `CLOSED`
- Initializes test state from **simulated market data timestamps**, not wall-clock time
- Supports **historical replay** (run session as-of any past date with that date's data)

### 4.2 Space Constraints (Missing)

**Current State**: Our `riskGuardian.ts` has basic β-floor and HHI checks, but **no comprehensive space constraints**.

**What's Missing** (real desk requirements):

| Constraint | Description | Current Status |
|------------|-------------|----------------|
| **Gross Exposure Cap** | Max total notional across all positions | ❌ Missing |
| **Net Exposure Cap** | Max directional exposure after hedging | ❌ Missing |
| **Concentration Limit** | Max % in single issuer/sector | ⚠️ Partial (HHI) |
| **Duration Limit** | Interest rate sensitivity cap | ❌ Missing |
| **Credit Spread Limit** | Max exposure to credit widening | ❌ Missing |
| **Liquidity Limit** | Max % of average daily volume | ❌ Missing |
| **Counterparty Limit** | Max exposure to single counterparty | ❌ Missing |
| **Risk Budget** | Daily/weekly/monthly risk allocation | ❌ Missing |
| **Drawdown Limit** | Max loss before mandatory reduction | ❌ Missing |
| **Leverage Cap** | Max portfolio leverage ratio | ❌ Missing |

**Recommendation**: Implement a `SpaceConstraints` framework:

```typescript
interface SpaceConstraints {
  // Exposure limits
  grossExposureCapUsd: number;
  netExposureCapUsd: number;
  
  // Concentration limits
  maxSingleIssuerPct: number;      // e.g., 0.05 = 5%
  maxSectorPct: number;            // e.g., 0.25 = 25%
  maxHhi: number;                  // Herfindahl-Hirschman Index
  
  // Risk limits
  dailyVaRLimitPct: number;        // e.g., 0.02 = 2%
  weeklyDrawdownLimitPct: number;  // e.g., 0.05 = 5%
  leverageCap: number;             // e.g., 3.0x
  
  // Liquidity limits
  maxAdvParticipationPct: number;  // e.g., 0.10 = 10% of ADV
  
  // Session-phase modulated
  phaseOverrides: Partial<Record<SessionPhase, Partial<SpaceConstraints>>>;
}
```

### 4.3 HITL Compliance Review

**Current State**: Our `hitl.ts` provides:
- `readProposal()` — renders a text proposal
- `resume()` — applies approve/overrule/reject
- `clampOverride()` — clamps to floors

**Compliance Assessment**: ❌ **NOT ADEQUATE** for institutional use.

**What's Missing** (per four-eyes principle and Moore Tech guidelines):

1. **Data Attribution**: The approval screen must show:
   - ❌ What data sources were used (which subgraphs, which blocks)
   - ❌ Data freshness/timestamps
   - ❌ Any data quality issues or fallbacks used

2. **Rule Attribution**: Must show:
   - ❌ Which specific rule/threshold triggered the proposal
   - ❌ The exact constraint values being applied
   - ❌ What happens if approved vs. rejected

3. **Risk Disclosure**: Must show:
   - ❌ Current portfolio risk (VaR, duration, spread)
   - ❌ Incremental risk of the proposed action
   - ❌ Scenario analysis (what-if rates +100bps, credit +50bps)

4. **Audit Trail**: Must log:
   - ❌ Who approved (trader identity)
   - ❌ When (timestamp)
   - ❌ What they saw (full proposal snapshot)
   - ❌ What they decided
   - ❌ Any overrides applied

5. **Four-Eyes Enforcement**:
   - ❌ Sensitive actions require TWO authorized persons
   - ❌ Trader cannot approve their own trades above threshold
   - ❌ Compliance officer review for large/exceptional trades

**Recommendation**: Redesign HITL with:

```typescript
interface ApprovalRequest {
  proposalId: string;
  traderId: string;
  proposal: {
    action: string;
    allocation: Allocation;
    notionalUsd: number;
    triggerRule: string;
    dataSources: DataSourceAttribution[];
    riskImpact: RiskImpactAssessment;
  };
  constraints: SpaceConstraints;
  currentPortfolio: PortfolioSnapshot;
  scenarios: ScenarioResult[];
}

interface ApprovalResponse {
  decision: "approved" | "rejected" | "overridden";
  overriderId?: string;       // second set of eyes for large trades
  complianceNotified?: boolean;
  timestamp: Date;
  auditLog: AuditLogEntry[];
}
```

### 4.4 External Oracle Service (Missing)

**Current State**: We fetch market data directly from The Graph subgraphs with no validation.

**Problem**: In production, market data **must be validated** against multiple sources:
- A single subgraph can return stale or incorrect data
- Indexing errors happen (as we've seen with the v4 outage)
- Manipulation is possible (especially on-chain)

**Recommendation**: Implement an `OracleService` that:

1. **Multi-source aggregation**: Fetch the same data from multiple sources:
   - Primary: The Graph subgraph
   - Secondary: Direct RPC calls (eth_call)
   - Tertiary: Centralized API (Bloomberg, Refinitiv)

2. **Consensus mechanism**: Only use data when sources agree within tolerance:
   - Price: ±0.1% tolerance
   - Volume: ±5% tolerance
   - TVL: ±1% tolerance

3. **Staleness detection**: Reject data older than threshold:
   - Real-time: < 30 seconds
   - Near-real-time: < 5 minutes
   - End-of-day: < 1 hour

4. **Anomaly detection**: Flag data that deviates significantly from recent history:
   - Price spike > 3σ from 20-period moving average
   - Volume > 5× average
   - TVL change > 10% in single block

```typescript
interface OracleService {
  // Fetch with consensus
  getPrice(asset: string): Promise<OracleQuote>;
  getPoolData(poolId: string): Promise<OraclePoolData>;
  
  // Validation
  validateData(data: unknown, source: string): ValidationResult;
  
  // Health
  getSourceHealth(): Map<DataSource, HealthStatus>;
}

interface OracleQuote {
  value: number;
  sources: { name: string; value: number; timestamp: Date }[];
  consensus: "full" | "partial" | "conflict";
  confidence: number;  // 0-1
}
```

### 4.5 Audit Trail & Trade Surveillance (Missing)

**Current State**: We have no audit trail or trade surveillance.

**Recommendation**: Implement:

1. **Immutable Audit Log**: Every action logged to append-only store:
   - Who (trader ID)
   - What (action type, parameters)
   - When (timestamp with timezone)
   - Why (rule/trigger that caused it)
   - Outcome (success/failure, resulting state)

2. **Trade Surveillance**: Post-trade monitoring for:
   - Wash trading (buying and selling same instrument)
   - Layering (spoofing with non-bona fide orders)
   - Insider trading (trading before material news)
   - Front-running (trading ahead of client orders)

3. **Compliance Reporting**: Automated regulatory reports:
   - MiFID II transaction reporting
   - SEC Form PF (private fund reporting)
   - EMIR derivative reporting

---

## 5. Recommendations: Robust Agentic Data Pipeline

### 5.1 Enhanced Session State Machine

Replace the simple day-of-week phase detection with a proper session clock:

```typescript
class SessionClock {
  // Market phases (not just day-of-week)
  getMarketPhase(timestamp: Date): MarketPhase {
    // PRE_MARKET, REGULAR, POST_MARKET, CLOSED
  }
  
  // Trading session boundaries
  getSessionBoundaries(date: Date): { open: Date; close: Date };
  
  // Macro event awareness
  getMacroEvents(date: Date): MacroEvent[];
  
  // Test-state initialization (NOT from wall-clock)
  initializeTestState(asOf: Date): DeskState {
    // Use asOf date's market data timestamps
    // Simulate data arrival times
    // Set up historical replay context
  }
}
```

### 5.2 Space Constraints Framework

Implement comprehensive constraints with phase modulation:

```typescript
class SpaceConstraintEngine {
  // Check a proposed allocation against all constraints
  checkAllocation(
    proposed: Allocation,
    current: PortfolioSnapshot,
    constraints: SpaceConstraints
  ): ConstraintCheckResult;
  
  // Get remaining capacity
  getRemainingCapacity(
    current: PortfolioSnapshot,
    constraints: SpaceConstraints
  ): SpaceCapacity;
  
  // Phase-modulated constraints
  getConstraintsForPhase(phase: SessionPhase): SpaceConstraints;
}
```

### 5.3 Production HITL with Four-Eyes Compliance

Redesign the approval workflow:

```typescript
class ComplianceGate {
  // Create an approval request with full attribution
  createApprovalRequest(
    proposal: Proposal,
    traderId: string
  ): ApprovalRequest;
  
  // Process trader decision
  async approve(
    requestId: string,
    decision: ApprovalResponse
  ): Promise<ApprovalResult>;
  
  // Enforce four-eyes for large trades
  requiresFourEyes(proposal: Proposal): boolean;
  
  // Generate audit trail
  getAuditTrail(requestId: string): AuditLogEntry[];
}
```

### 5.4 External Oracle Service

```typescript
class OracleService {
  private sources: DataSource[];
  
  async getPoolData(poolId: string): Promise<OraclePoolData> {
    // Fetch from all sources
    const results = await Promise.allSettled(
      this.sources.map(s => s.getPoolData(poolId))
    );
    
    // Check consensus
    const consensus = this.checkConsensus(results);
    
    if (consensus.status === "conflict") {
      await this.alertConflictingData(poolId, results);
    }
    
    return consensus.data;
  }
}
```

### 5.5 Comprehensive Audit & Surveillance

```typescript
class AuditService {
  // Append-only audit log
  async log(entry: AuditLogEntry): Promise<void>;
  
  // Query audit trail
  async query(filters: AuditFilters): Promise<AuditLogEntry[]>;
  
  // Trade surveillance
  async surveil(trade: ExecutedTrade): Promise<SurveillanceAlert[]>;
  
  // Compliance reporting
  async generateReport(period: DateRange): Promise<ComplianceReport>;
}
```

---

## 6. Implementation Roadmap

### Phase 1: Foundation (Current Sprint)
- ✅ Pipeline core (data → strategy → execution → verification)
- ✅ Desk session graph with HITL interrupt
- ✅ Session phases (calendar-driven)
- ✅ Basic risk guardian

### Phase 2: Institutional Rigor (Next Sprint)
- 🔄 Space constraints framework (exposure, concentration, liquidity)
- 🔄 Enhanced HITL with data/rule attribution
- 🔄 Audit trail (append-only logging)
- 🔄 SessionClock with market phases

### Phase 3: Production Hardening (Following Sprint)
- ⬜ External oracle service (multi-source consensus)
- ⬜ Four-eyes enforcement
- ⬜ Trade surveillance
- ⬜ Compliance reporting
- ⬜ Historical replay capability

### Phase 4: Advanced Features
- ⬜ Real-time position monitoring
- ⬜ Automated regulatory reporting
- ⬜ Cross-desk risk aggregation
- ⬜ ML-based anomaly detection

---

## 7. References

### Industry Sources
- [Fixed Income Trading | Bloomberg Professional Services](https://professional.bloomberg.com/products/trading/electronic-markets/fixed-income/)
- ["Day in the Life of a Fixed Income Trader" — Sales and Trading Handbook](https://salesandtradinghandbook.wordpress.com/2025/03/26/fixed-income-trader-day/)
- [Bloomberg TOMS Case Study](https://assets.bbhub.io/professional/sites/10/TOMS_ZA_Bank_CASE_.pdf)
- [PGIM Weekly View from the Desk](https://www.pgim.com/us/en/institutional/insights/asset-class/fixed-income/weekly-view)
- [AllianceBernstein Fixed Income Trading Desk](https://www.alliancebernstein.com/us/en-us/investments/solutions/fixed-income-investments/a-note-from-the-ab-fixed-income-trading-desk.html)

### Compliance & HITL
- [Human-in-the-Loop Agentic Trading Systems — Moore Tech](https://www.mooretechllc.com/guides/human-in-the-loop-agentic-trading-systems/)
- [Governance for Human-in-the-Loop Systematic Trading](https://aborysenko.com/governance-for-human-in-the-loop-systematic-trading/)
- [Four-Eyes Principle in AI Governance](https://inferensys.com/glossary/enterprise-artificial-intelligence-governance/human-oversight-mechanisms/four-eyes-principle)
- [KPMG: Transforming Trade Surveillance](https://kpmg.com/kpmg-us/content/dam/kpmg/pdf/2026/transforming-trade-surveillance.pdf)
- [Bloomberg Compliance Solutions](https://professional.bloomberg.com/products/compliance/)

### Risk Management
- [Risk Budgeting Applied to Fixed Income — Western & Southern](https://www.westernsouthern.com/fortwashington/investment-strategies/fixed-income-investments/fixed-income-investments/risk-budgeting-applied-to-fixed-income)
- [Fixed Income Trader Job Description — Investopedia](https://www.investopedia.com/articles/professionals/120915/fixed-income-trader-job-description-average-salary.asp)

---

## Appendix: Key Terms

| Term | Definition |
|------|-----------|
| **TOMS** | Trade Order Management System (Bloomberg) |
| **TEMS** | Trade Execution Management System (Bloomberg) |
| **AIM** | Bloomberg Asset and Investment Manager |
| **VaR** | Value at Risk — max expected loss at a confidence level |
| **HHI** | Herfindahl-Hirschman Index — concentration measure |
| **LVR** | Loss Versus Rebalancing — structural LP loss to arbitrageurs |
| **ADV** | Average Daily Volume |
| **Four-Eyes** | Control requiring two authorized persons for sensitive actions |
| **MiFID II** | Markets in Financial Instruments Directive (EU) |
| **EMIR** | European Market Infrastructure Regulation |

---

*This report is a living document. Update as the implementation evolves.*
