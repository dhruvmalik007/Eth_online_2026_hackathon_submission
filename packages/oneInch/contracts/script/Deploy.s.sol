// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { AgenticEMSSwapVMRouter } from "../src/AgenticEMSSwapVMRouter.sol";
import { RiskSignalSource } from "../src/RiskSignalSource.sol";
import { StablecoinRefugeApp } from "../src/StablecoinRefugeApp.sol";

/// @title Deploy
/// @notice Deploys our three contracts against a running fork.
///
/// @dev ## Why the constructor arguments come from the environment
///
/// The Aqua registry and WETH addresses differ per chain, and the agent address differs per
/// run. Baking them in would mean a different script per chain and a rebuild to change the
/// agent — for a harness whose whole job is to be pointed at a chain and run.
///
/// ## What is deliberately *not* deployed
///
/// Aqua itself, and the underlying tokens. Both already exist on the fork because we fork a
/// real chain at a pinned block. Deploying our own copies would test our copies rather than
/// the deployed protocol, which is the opposite of the point.
///
/// ## Usage
///
/// ```bash
/// AQUA_ADDRESS=0x1111… AGENT_ADDRESS=0x… ROUTER_OWNER=0x… WETH_ADDRESS=0x… \
///   forge script script/Deploy.s.sol --rpc-url $OPTIMISM_RPC_URL --broadcast
/// ```
///
/// The addresses are read back from the broadcast artifact by `apps/fork-execution`, which is
/// why the script returns them as well as logging them.
contract Deploy is Script {
    /// @notice What a run deployed, so the caller does not have to parse logs.
    struct Deployment {
        address router;
        address signalSource;
        address refugeApp;
    }

    /// @notice Deploy the router, the signal source and the refuge app.
    /// @dev Reads exactly four environment variables and refuses to guess any of them:
    ///
    ///      - `AQUA_ADDRESS`   — the chain's Aqua registry (identical on every chain)
    ///      - `WETH_ADDRESS`   — wrapped native for this chain
    ///      - `AGENT_ADDRESS`  — the only address permitted to write a flight verdict
    ///      - `ROUTER_OWNER`   — the address able to rescue tokens sent to the router
    ///
    ///      A wrong Aqua address is the dangerous one: the router would ship positions to a
    ///      registry nobody expects, and the failure would surface as a settlement that never
    ///      finds its strategy.
    function run() external returns (Deployment memory deployment) {
        address aqua = vm.envAddress("AQUA_ADDRESS");
        address weth = vm.envAddress("WETH_ADDRESS");
        address agent = vm.envAddress("AGENT_ADDRESS");
        address routerOwner = vm.envAddress("ROUTER_OWNER");

        vm.startBroadcast();

        // Deployed first, and the agent is immutable: whoever can set the verdict controls
        // whether a strategy may be taken and at what price, so it should not be a mutable role.
        deployment.signalSource = address(new RiskSignalSource(agent));

        // Our router: the canonical instruction set plus `YieldBandFlight` at opcode 0xb3. The
        // EIP-712 name and version are what `packages/custody` signs against for signature-mode
        // orders, so they are part of the wire contract rather than cosmetic.
        deployment.router = address(
            new AgenticEMSSwapVMRouter(aqua, weth, routerOwner, "AgenticEMSSwapVMRouter", "1.0.0")
        );

        // The refuge app: no pricing logic, just an atomic two-leg release.
        deployment.refugeApp = address(new StablecoinRefugeApp(IAqua(aqua)));

        vm.stopBroadcast();

        // Logged as well as returned, because the fork harness reads the artifact and a human
        // reads the console.
        console2.log("AgenticEMSSwapVMRouter", deployment.router);
        console2.log("RiskSignalSource", deployment.signalSource);
        console2.log("StablecoinRefugeApp", deployment.refugeApp);
    }
}
