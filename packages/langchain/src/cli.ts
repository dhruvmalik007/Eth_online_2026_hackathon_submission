#!/usr/bin/env tsx
/**
 * CLI entry point for the LangChain agent.
 *
 * Usage:
 *   npm run cli -- analyze          Full risk analysis (Greeks + VaR + health)
 *   npm run cli -- greeks           Compute Greeks only
 *   npm run cli -- var              Compute Value at Risk
 *   npm run cli -- health           Check subgraph health
 *   npm run cli -- yields           Compare lending yields across chains
 *   npm run cli -- fixed-income     Fixed income strategy analysis
 *   npm run cli -- stress-test      Run stress test scenarios
 *   npm run cli -- e2e-lending      E2E test: lending data pipeline
 *   npm run cli -- e2e-dex          E2E test: DEX data pipeline
 *   npm run cli -- e2e-prediction   E2E test: prediction market pipeline
 *   npm run cli -- e2e-strategy     E2E test: fixed income strategy
 *   npm run cli -- chat             Interactive chat with the agent
 */

import { config } from 'dotenv';
config();

import { DeepGraphAgent } from './agents/DeepGraphAgent.js';
import { runStrategyPipeline } from './pipeline/index.js';
import { runDeskSession } from './desk/index.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log(`
DeepGraph Agent CLI

Commands:
  analyze   Full risk analysis (Greeks + VaR + health)
  greeks    Compute Greeks only
  var       Compute Value at Risk
  health    Check subgraph health
  chat      Interactive chat with the agent

Examples:
  npm run cli -- analyze
  npm run cli -- greeks
  npm run cli -- health
`);
    process.exit(0);
  }

  // Initialize agent lazily — only the LLM-driven commands need it. The deterministic
  // execute-strategy pipeline runs without any model.
  let agent: DeepGraphAgent | null = null;
  const getAgent = async () => {
    if (!agent) {
      agent = new DeepGraphAgent();
      await agent.initialize();
    }
    return agent;
  };

  // Execute command
  switch (command) {
    case 'analyze': {
      const result = await (await getAgent()).invoke(
        'Perform a comprehensive fixed income risk analysis. ' +
          'Check subgraph health, then ground yourself in real data: use v4TopPools and v4HookedPools to pick a ' +
          'real Uniswap v4 book, use getLendingReserves for the Aave V3 lending leg, then compute ' +
          'fixed income metrics (computeFixedIncomeMetrics), Greeks via the calc_* math tools, VaR, and run a stress test. ' +
          'Report per the Markdown contract.',
      );
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'greeks': {
      const result = await (await getAgent()).invoke(
        'Compute the fixed income risk Greeks for the top Uniswap v4 stablecoin book: ' +
          'ground the pool id with v4TopPools first, then use calc_realized_vol, calc_lvr, calc_net_apy, calc_vega, ' +
          'and calc_efficiency_ratio. Report alpha, beta, vega, theta, gamma, duration.',
      );
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'var': {
      const result = await (await getAgent()).invoke(
        'Compute Value at Risk (VaR) at 95% and 99% confidence levels.'
      );
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'health': {
      const extractor = (await getAgent()).getExtractor();
      if (!extractor) {
        console.error('Extractor not initialized');
        process.exit(1);
      }
      const health = await extractor['client'].health();
      console.log(JSON.stringify(health, null, 2));
      break;
    }

    case 'yields': {
      const result = await (await getAgent()).invoke(
        'Compare USDC lending yields across Ethereum, Arbitrum, and Optimism. Show supply APY, borrow APY, and TVL for each network.'
      );
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'fixed-income': {
      const result = await (await getAgent()).invoke(
        'Compute fixed income metrics for a $100,000 USDC position on Aave V3 Ethereum. Include alpha, beta, vega, theta, gamma, duration, and VaR.'
      );
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'stress-test': {
      const result = await (await getAgent()).invoke(
        'Run stress test scenarios on a $100,000 USDC lending position. Include rate hikes, DeFi hack, and stablecoin depeg scenarios.'
      );
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'e2e-lending': {
      console.log('\n=== E2E Test: Lending Data Pipeline ===\n');
      const result = await (await getAgent()).invoke(
        'Test the lending data pipeline: 1) Get Aave V3 reserves on Ethereum, 2) Compare yields across networks, 3) Get pool metrics including TVL and utilization.'
      );
      console.log(JSON.stringify(result, null, 2));
      console.log('\n=== E2E Lending Test Complete ===\n');
      break;
    }

    case 'e2e-dex': {
      console.log('\n=== E2E Test: DEX Data Pipeline ===\n');
      const result = await (await getAgent()).invoke(
        'Test the DEX data pipeline: 1) Get Uniswap V3 pools sorted by TVL, 2) Analyze volume and fee APY, 3) Get aggregate DEX metrics.'
      );
      console.log(JSON.stringify(result, null, 2));
      console.log('\n=== E2E DEX Test Complete ===\n');
      break;
    }

    case 'e2e-prediction': {
      console.log('\n=== E2E Test: Prediction Market Pipeline ===\n');
      const result = await (await getAgent()).invoke(
        'Test the prediction market pipeline: 1) Get Polymarket active conditions and markets, 2) Analyze volume and payouts, 3) Get aggregate metrics.'
      );
      console.log(JSON.stringify(result, null, 2));
      console.log('\n=== E2E Prediction Test Complete ===\n');
      break;
    }

    case 'e2e-strategy': {
      console.log('\n=== E2E Test: Fixed Income Strategy ===\n');
      const result = await (await getAgent()).invoke(
        'Test the fixed income strategy pipeline: 1) Find best yield opportunities across lending protocols, 2) Compute risk metrics (alpha, beta, vega, VaR), 3) Run stress test scenarios.'
      );
      console.log(JSON.stringify(result, null, 2));
      console.log('\n=== E2E Strategy Test Complete ===\n');
      break;
    }

    case 'chat': {
      console.log('Interactive mode. Type "exit" to quit.');
      console.log('Ask me about DeFi risk analysis, Greeks, VaR, yields, subgraph health, or strategy execution.\n');

      // Simple interactive loop
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const askQuestion = () => {
        rl.question('> ', async (query) => {
          if (query.toLowerCase() === 'exit') {
            rl.close();
            return;
          }

          try {
            const result = await (await getAgent()).invoke(query);
            console.log(JSON.stringify(result, null, 2));
          } catch (error) {
            console.error('Error:', error);
          }

          askQuestion();
        });
      };

      askQuestion();
      break;
    }

    case 'execute-strategy': {
      // Deterministic end-to-end pipeline: mandate → Graph data → strategy → gate →
      // execution (dry calldata / live submit) → verification → report.
      // Usage: npm run cli -- execute-strategy "APR ≥ 6%, $10M USDC, vega ≤ 0.5" [--mode live]
      const mandate = args.slice(1).filter((a) => !a.startsWith("--")).join(" ");
      const modeArg = args.find((a) => a.startsWith("--mode="))?.split("=")[1];
      const mode = modeArg === "live" ? "live" : "dry";
      if (!mandate) {
        console.error('Usage: npm run cli -- execute-strategy "APR ≥ 6%, $10M USDC" [--mode live]');
        process.exit(1);
      }
      console.log(`\n=== Strategy Pipeline (${mode.toUpperCase()}) ===\nMandate: "${mandate}"\n`);
      const t0 = Date.now();
      const { report } = await runStrategyPipeline(mandate, { mode });
      console.log(report);
      console.log(`\n=== Pipeline completed in ${((Date.now() - t0) / 1000).toFixed(1)}s ===\n`);
      break;
    }

    case 'desk-session': {
      // Day-2-day desk session: ingestion → inference → research → HITL → guardian →
      // execution → reconciliation. Auto-approves in dry mode; pass --date to set the
      // session date (drives Mon/Fri posture). Usage:
      //   npm run cli -- desk-session --mode dry --date 2026-09-11
      const modeArg = args.find((a) => a.startsWith("--mode="))?.split("=")[1];
      const dateArg = args.find((a) => a.startsWith("--date="))?.split("=")[1];
      const mode = modeArg === "live" ? "live" : "dry";
      console.log(`\n=== Desk Session (${mode.toUpperCase()}) ===\n`);
      const t0 = Date.now();
      const state = await runDeskSession({
        mode,
        ...(dateArg !== undefined ? { sessionDate: dateArg } : {}),
        autoApprove: true,
      });
      console.log(`Session: ${state.sessionDate} (${state.sessionPhase})`);
      console.log(`Thesis: ${state.thesis ?? "(none)"}`);
      console.log(`Allocation: α=${(state.proposedAllocation.alpha*100).toFixed(1)}% β=${(state.proposedAllocation.beta*100).toFixed(1)}% γ=${(state.proposedAllocation.gamma*100).toFixed(2)}%`);
      console.log(`Reconciliation: ${state.reconciliationNotes.join(" | ") || "(none)"}`);
      if (state.errors.length) console.log(`Errors: ${state.errors.join("; ")}`);
      console.log(`\n=== Desk session completed in ${((Date.now() - t0) / 1000).toFixed(1)}s ===\n`);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
