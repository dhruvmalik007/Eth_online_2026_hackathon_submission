# Third-party notices

This repository vendors Solidity source into `packages/*/contracts/lib/`. Those directories are
**gitignored** — upstream trees are fetched by `install-libs.sh` and pinned by `lib.lock` — so the
licence texts that live inside them would not be distributed with a clone. The texts are therefore
copied into [`licenses/`](licenses/) and listed below, which is the copy that actually travels.

Scope: this file covers **source vendored into the repository**, because that is the part which would
otherwise ship without its licence. Packages installed from npm (`viem`, `zod`, React, Next, Fastify
and the rest) carry their own licence files in `node_modules` and are redistributed by their authors.

## Source-available, not open source

Two components are **not** OSI-approved open source. They are published under the Degensoft
source-available licences, which permit use under conditions and are not interchangeable with MIT:

| Component | Licence |
|---|---|
| [`1inch/aqua`](https://github.com/1inch/aqua) | `LicenseRef-Degensoft-Aqua-Source-1.1` |
| [`1inch/swap-vm`](https://github.com/1inch/swap-vm) | `LicenseRef-Degensoft-SwapVM-1.1` |

What this means for anyone reading or reusing this repository:

- **The licence terms still apply to these two components.** Nothing here relicenses them, and this
  repository's MIT licence covers only the code written for it.
- **The SPDX headers are preserved.** Every vendored file keeps its own header, and neither tree has
  been modified in place — where behaviour needed changing, it was done by subclassing in our own
  contracts (`AgenticEMSSwapVMRouter`) rather than by editing upstream files.
- **Redeploying a modified SwapVM is explicitly permitted** by the Track 5.1 brief, which is why
  `AgenticEMSSwapVMRouter` is a redeployment rather than an attempt to use the canonical router with an
  unknown opcode.
- **Read `licenses/Aqua-Source-1.1.txt` and `licenses/SwapVM-1.1.txt` before reusing this code** for
  anything commercial. They are the operative documents; this summary is not a substitute.

## Vendored Solidity

| Component | Version | Commit | Licence | Text |
|---|---|---|---|---|
| [forge-std](https://github.com/foundry-rs/forge-std) | v1.11.0 | `8e40513d` | MIT OR Apache-2.0 | [`licenses/forge-std-MIT.txt`](licenses/forge-std-MIT.txt), [`licenses/forge-std-Apache-2.0.txt`](licenses/forge-std-Apache-2.0.txt) |
| [openzeppelin-contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) | v5.4.0 | `c64a1edb` | MIT | [`licenses/OpenZeppelin-contracts-MIT.txt`](licenses/OpenZeppelin-contracts-MIT.txt) |
| [@1inch/solidity-utils](https://github.com/1inch/solidity-utils) | 6.9.10 | `2d91bb67` | MIT | [`licenses/1inch-solidity-utils-MIT.txt`](licenses/1inch-solidity-utils-MIT.txt) |
| [1inch/aqua](https://github.com/1inch/aqua) | v1.0.0 | `098b4c5d` | `LicenseRef-Degensoft-Aqua-Source-1.1` | [`licenses/Aqua-Source-1.1.txt`](licenses/Aqua-Source-1.1.txt) |
| [1inch/swap-vm](https://github.com/1inch/swap-vm) | `main` | `afd99c40` | `LicenseRef-Degensoft-SwapVM-1.1` | [`licenses/SwapVM-1.1.txt`](licenses/SwapVM-1.1.txt) |

- `packages/oneInch/contracts/lib.lock` — the Aqua and SwapVM rows, with the versions 1inch itself pins.
- `packages/uniswap/contracts/lib.lock` — forge-std only, which is all that project needs.

Both the Aqua and SwapVM trees also carry their own `LICENSES/` directories containing
`Apache-2.0-Forge-Std.txt`, `MIT-1inch.txt`, `MIT-Forge-Std.txt` and `MIT-OpenZeppelin.txt` for the
code they themselves vendor. Those are upstream's copies of components already listed above.

`forge-std` is dual-licensed, so either text applies; both are included because the vendored tree
ships both.

## External contracts called, not vendored

This repository calls deployed contracts it does not own and does not redistribute:

- **Aqua** and the canonical **SwapVM router** — deployed at fixed addresses, used as-is.
- **Uniswap v4** — `PoolManager`, `PositionManager`, `StateView`. ABIs are hand-written against the
  deployed interfaces; `packages/uniswap/abi/PositionManager.optimism.json` is a verified ABI kept as
  evidence, not source copied from a repository.
- **Morpho** vaults, and the L2 protocols named in the protocol registry.

Calling a deployed contract does not require a licence, and no code from these projects is included.

## This repository's own licence

MIT — see [`LICENSE`](LICENSE). It covers the code written for this project and does **not** extend to
the vendored trees above, which keep their own terms.
