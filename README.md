# FORTRESS Protocol — Monad

Stateless deposit router for USDC yield. Users split deposits across multiple DeFi
protocols in a single transaction. All output tokens (shares, aTokens, LP) go directly to
the user — the vault never custodies funds beyond a single transaction.

**Live on Monad mainnet (chain 143) since 2026-08-16.** Ported from the original Base
deployment; see [`Monad_Contract/Fortress/DEPLOYMENT.md`](Monad_Contract/Fortress/DEPLOYMENT.md)
for the full deployment record and [`Monad_Contract/Fortress/SUBMISSION.md`](Monad_Contract/Fortress/SUBMISSION.md)
for the port's state.

> **Read this before using the deployment.** Ownership is still an EOA, not a timelock.
> All swap paths are closed by design until the selector allowlist is populated. The
> contracts have not been audited. Details in §[Status](#status-what-works-right-now).

---

## Deployed — Monad mainnet (143)

| Contract | Proxy |
|---|---|
| **FortVault** | `0x252709C4569E096BD4babe3be9175Ca2F49f152F` |
| LiFiAdapter | `0x1f2Bda259365BF10210AB6C8C0F4A211eE2be5FC` |
| AaveV3Adapter — Aave V3 Monad | `0x1493522095857A3e28e6573E8a1f6b612dd30B40` |
| AaveV3Adapter — Neverland | `0x34bce6998d3599B665Ec36b205ab1d91F23f2b4D` |
| ShMonadAdapter | `0x6f9eDe63115707bF01403f12f63Fa5e4616BB47A` |
| FortSwapRouter | `0x220C82bF47cD376f9B71d038Ca45aC6E98482CC0` |
| CrossChainRouter | `0x64b65CF8469bcdb81D8621Cbc4e2F2B36D4f39EE` |

Deployment cost ≈ 4.0 MON at 202 gwei. Contracts are **not yet source-verified** — the
Monad verifier endpoint is still unconfirmed.

### Registered venues

| Registry key | Target | Type | Capacity at deploy |
|---|---|---|---|
| `Aave` | AaveV3Adapter | Adapter | **108.2M USDC** |
| `Neverland` | AaveV3Adapter | Adapter | 87.3M USDC |
| `Euler` | `0x1905EDDF…` eUSDC | ERC-4626 | ~6.58M USDC |
| `Curvance` | `0x21aDBb60…` cUSDC | ERC-4626 | uncapped |
| `Morpho` | `0x78999cc9…` Hyperithm USDC Apex | ERC-4626 | **0 — at cap** |
| `shMONAD` | ShMonadAdapter | Adapter | uncapped (swap-gated) |
| `LiFi` | LiFiAdapter | Adapter | swap-gated |

`Compound` and `Yearn` are deliberately **absent** — neither protocol exists on Monad.

---

## Status: what works right now

### ✅ Usable today — no swap required

`FortVault.deposit()` pulls USDC and routes it straight to the venue:

**Aave V3**, **Neverland**, **Euler**, **Curvance**.

Aave is the deepest and the best-tested path — the adapter has fork tests passing against
that exact market including real supply and withdraw round trips.

### ⚠️ Registered but at capacity

`Morpho` reports `maxDeposit() == 0`. A deposit reverts `ProtocolAtCapacity` — the
capacity guard working, giving a named error instead of an anonymous one from inside the
vault. It starts accepting automatically if the curator raises the cap; no redeploy.

### ❌ Closed by design — the selector allowlist

Every swap path reverts `UnauthorizedSelector` until an operator populates the allowlist
on **both** `LiFiAdapter` and `FortSwapRouter`. This affects `LiFiAdapter`,
`FortSwapRouter.swapAndDeposit`, and `ShMonadAdapter` (whose MON leg routes through
`LiFiAdapter`).

This fails closed on purpose. Invariant I5 requires every call into a user-supplied
external target to be validated by **address and function selector** — an address
allowlist alone was an audit finding on the Base deployment. The selectors belong to the
venues LI.FI routes *through* (KyberSwap, OpenOcean, Eisen, Monorail, Kuru), and each must
be read off a live chain-143 quote and verified before it is trusted.

---

## What changed from Base

The port is not an address swap. Every third-party address was re-verified on chain, and
that caught real problems:

| Finding | Consequence |
|---|---|
| **The Base BaseSwap router address has 8,679 bytes of code on Monad — and it is not BaseSwap.** `name()`, `symbol()`, `factory()` all revert. | Carrying the Base DEX allowlist over would have allowlisted an unknown contract as a swap target. |
| **`swapTokensGeneric` is not registered on the Monad LI.FI diamond.** Monad ships GenericSwapFacetV3. | Every swap path in the Base code reverted. `LiFiAdapter` was rewritten against all six V3 variants. |
| **`approveTo` was compared against the diamond.** In LI.FI it is the spender the diamond approves — the DEX, or its transfer proxy — never the diamond itself. | The old rule rejected every live quote. It survived CI only because the test mock doubled as both. Now allowlisted. |
| **Upstream Foundry under-reports Monad gas by 3.85×** on cold SLOAD (2,162 vs 8,162). | All gas assertions run under Monad Foundry with `network = "monad"`. `MAX_STEPS` re-derived 30 → 10. |
| **Aave V3 Monad and Neverland are different Aave revisions** (`POOL_REVISION` 11 vs 2). | The `getReserveData` struct differs between them; the adapter reads the configuration bitmap instead. |
| **shMONAD's `asset()` is the native-MON sentinel** and its `deposit` is payable. | The ERC-4626 fast path cannot drive it. Needs a dedicated adapter with a MON swap leg on both sides. |
| **Compound V3, Aerodrome and YO have no counterparty on Monad.** | Their adapter slots stay empty. See [`PENDING.md`](Monad_Contract/Fortress/src/adapters/PENDING.md). |

**Monad charges gas on `gas_limit`, not `gas_used`.** Gas is a correctness concern here,
not an optimisation — every entry point ships a measured envelope in
[`docs/gas-model.md`](Monad_Contract/Fortress/docs/gas-model.md).

---

## Architecture

```
                          +------------------+
                          |     User EOA     |
                          +--------+---------+
                                   |
                          deposit / withdraw / rebalance
                                   |
                          +--------v---------+
                          |  ERC1967 Proxy   |
                          |  (UUPS pattern)  |
                          +--------+---------+
                                   |
                          +--------v---------+
                          |    FortVault     |
                          +--------+---------+
                                   |
                 +-----------------+-----------------+
                 |                 |                 |
         +-------v------+  +-------v------+  +-------v-------+
         |   ERC-4626   |  | IFortProtocol|  |IFortProtocolEx|
         |  (fast path) |  |  (adapter)   |  | (adapter+data)|
         +-------+------+  +-------+------+  +-------+-------+
                 |                 |                 |
         +-------v------+  +-------v------+  +-------v-------+
         |    Euler     |  |AaveV3Adapter |  | LiFiAdapter   |
         |   Curvance   |  |  (Aave V3)   |  |      |        |
         |    Morpho    |  |AaveV3Adapter |  +------v--------+
         |              |  | (Neverland)  |  | LI.FI Diamond |
         +--------------+  +--------------+  | GenericSwapV3 |
                                             +------+--------+
                                                    ^
                           +--------------+         |
                           |ShMonadAdapter|---------+
                           | USDC<->MON<->|   (MON leg reuses
                           |    shMON     |    LiFiAdapter)
                           +--------------+
```

`ShMonadAdapter` deliberately routes its swap leg through `LiFiAdapter` rather than
calling the diamond directly, so there is **one** selector allowlist to maintain, not two.

---

## Deposit flow

```
User                    FortVault                Protocol / Adapter
 |                          |                          |
 |-- deposit(entries[]) --->|                          |
 |                          |-- transferFrom(USDC) --->|  (pull total from user)
 |                          |                          |
 |                          |  for each entry:         |
 |                          |                          |
 |                          |  [ERC-4626]              |
 |                          |-- maxDeposit() check --->|  ProtocolAtCapacity if short
 |                          |-- approve + deposit() -->|  Euler / Curvance / Morpho
 |                          |          shares -------->|  (minted to user directly)
 |                          |                          |
 |                          |  [Adapter, no data]      |
 |                          |-- approve + depositFor ->|  AaveV3Adapter
 |                          |          aTokens ------->|  (credited to user via onBehalfOf)
 |                          |                          |
 |                          |  [Adapter, with data]    |
 |                          |-- approve + depositFor ->|  LiFiAdapter / ShMonadAdapter
 |                          |    (amount, user, data)  |  (route + minimums + deadline)
 |                          |          tokens -------->|  (sent to user directly)
 |                          |                          |
 |                          |  vault USDC balance = 0  |
 |<--- Deposited event -----|                          |
```

## Protocol dispatch

```
entry.data empty?
    |
    +-- YES --> protocol.isERC4626?
    |               |
    |               +-- YES --> IERC4626.deposit(amount, user)
    |               +-- NO  --> IFortProtocol.depositFor(amount, user)
    |
    +-- NO  --> IFortProtocolEx.depositFor(amount, user, data)
```

---

## Contracts

| Contract | Description |
|---|---|
| `FortVault` | Core router. UUPS, Ownable2Step, Pausable, ReentrancyGuardTransient. Protocol registry + dispatch. ERC-4626 fast path carries a `ProtocolAtCapacity` guard. |
| `FortSwapRouter` | Swap-then-split-deposit for users holding non-USDC. Extracted from the vault for code size. |
| `LiFiAdapter` | LI.FI GenericSwapFacetV3, all six variants, chosen by an explicit `SwapKind` rather than inferred. Address + selector allowlists, route end-asset checks, delta-verified output. |
| `AaveV3Adapter` | One implementation serving **both** Aave V3 Monad and Neverland — two deployments differing only in their (pool, aToken) pair, proven on chain by the constructor. |
| `ShMonadAdapter` | FastLane shMONAD. USDC→MON→shMON and back, MON leg via `LiFiAdapter`. Per-leg slippage floors. |
| `CrossChainRouter` | Standalone cross-chain deposit/withdraw router. **Not part of Phase 6** — bridging was descoped. |
| `MorphoStrategyAdapter`, `MorphoLeverageExecutor`, `MorphoExitExecutor` | Morpho Blue strategy + flash-loan leverage. Ported and unit-tested; **not deployed**, and their fork tests are not yet rebuilt for Monad. |
| `MonadAddresses` | The **only** file permitted to contain an address literal. CI enforces it. |

---

## Security model

- **Stateless (I1)** — every adapter's balance of every asset is zero once a call returns.
  Residual input is swept back to whoever supplied it.
- **Direct delivery (I2)** — output goes to the end user, never parked in the protocol.
  Aave uses `onBehalfOf`; shMONAD mints straight to the receiver.
- **Address *and* selector allowlists (I5)** — every call into a user-supplied external
  target validates both. Ships empty and fails closed.
- **Protocol-computed amounts (I6)** — leg 0's `fromAmount` is overwritten with the
  vault's amount, so user calldata cannot inflate a swap.
- **Approval hygiene (I7)** — approvals scoped to the exact amount and revoked in the same
  transaction.
- **Slippage on every converting leg (I8)** — and for two-leg paths, per leg rather than
  end-to-end, so a bad swap cannot hide behind a good exchange rate.
- **Delta-based verification** — output is measured against a pre-call snapshot, never an
  absolute balance, and never taken from the callee's return value on trust.
- **Measured gas envelopes (I13)** — asserted under Monad Foundry.
- **UUPS + Ownable2Step** — a transfer to a wrong address is a no-op, not a permanent loss
  of the upgrade key.

### Not yet done

- **No timelock.** Ownership is the deployer EOA, which holds `_authorizeUpgrade` on every
  proxy. `DeployTimelock.s.sol` → `TransferOwnership.s.sol` → `acceptOwnership()` closes
  this; `VerifyDeployment.s.sol` fails loudly on the half-finished state.
- **No audit.** An executable access-control sweep exists; Slither has not been run.

---

## Repository layout

```
Monad_Contract/Fortress/          # the contracts (this README's subject)
  src/
    FortVault.sol  FortSwapRouter.sol  CrossChainRouter.sol
    FortStrategyExecutor.sol  MorphoLeverageExecutor.sol  MorphoExitExecutor.sol
    adapters/   LiFiAdapter  AaveV3Adapter  ShMonadAdapter  PendleAdapter
                MorphoStrategyAdapter  SwapStrategyAdapter  PendleStrategyAdapter
    interfaces/ ILiFi  IAaveV3Pool  IShMonad  IFortProtocol(Ex)  IMorphoBlue  …
    config/     MonadAddresses.sol      # the only file with address literals
  script/
    DeployMonad.s.sol         # full deployment (mainnet 143 only)
    VerifyDeployment.s.sol    # read-only post-deploy assertions
    DeployTimelock.s.sol  TransferOwnership.s.sol
    ci/check-address-literals.sh
  test/  unit/  fuzz/  invariant/  gas/  fork/  mocks/
  DEPLOYMENT.md  SUBMISSION.md  DECISIONS.md  ADDRESSES.md  RESEARCH.md
  docs/gas-model.md

Monad_Backend/                    # backend services
Monad_frontend/                   # frontend
FORTRESS_MONAD_PORT_PROMPT.md     # the master plan (Phases 0–10)
```

---

## Usage

```shell
cd Monad_Contract/Fortress
```

### Build and test

```shell
forge build
forge test --no-match-path "test/fork/*"            # 632 tests, no RPC needed
```

### Fork tests (live Monad)

```shell
export MONAD_RPC_URL=https://rpc.monad.xyz
forge test --match-path "test/fork/*"
```

Note: the Euler / Fluid / Morpho / PendleStrategyAdapter fork suites still carry Base
fixtures and fail. They are excluded from CI.

### Gas envelopes — requires Monad Foundry

```shell
foundryup --network monad
forge test --match-path "test/gas/*" -vv
```

Installing the Monad fork is **not sufficient** on its own — `network = "monad"` in
`foundry.toml` selects the Monad opcode schedule. Without it, cold SLOAD prices at
Ethereum's 2,100 instead of Monad's 8,100. `test/gas/ColdSloadPricing.t.sol` fails the
build if the wrong schedule is active.

### Address-book integrity

```shell
./script/ci/check-address-literals.sh
```

### Deploy (mainnet 143 only)

Testnet 10143 is rejected: none of the protocol addresses exist there.

```shell
cp .env.example .env      # set PRIVATE_KEY, MONAD_RPC_URL
source .env && forge script script/DeployMonad.s.sol --rpc-url $MONAD_RPC_URL          # simulate
source .env && forge script script/DeployMonad.s.sol --rpc-url $MONAD_RPC_URL --broadcast
```

### Verify a deployment (read-only, no key)

```shell
export MONAD_RPC_URL=https://rpc.monad.xyz
export FORT_VAULT=0x252709C4569E096BD4babe3be9175Ca2F49f152F
export LIFI_ADAPTER=0x1f2Bda259365BF10210AB6C8C0F4A211eE2be5FC
export AAVE_ADAPTER=0x1493522095857A3e28e6573E8a1f6b612dd30B40
export NEVERLAND_ADAPTER=0x34bce6998d3599B665Ec36b205ab1d91F23f2b4D
export SHMONAD_ADAPTER=0x6f9eDe63115707bF01403f12f63Fa5e4616BB47A
export FORT_SWAP_ROUTER=0x220C82bF47cD376f9B71d038Ca45aC6E98482CC0
export CROSS_CHAIN_ROUTER=0x64b65CF8469bcdb81D8621Cbc4e2F2B36D4f39EE

forge script script/VerifyDeployment.s.sol --rpc-url $MONAD_RPC_URL
```

### Adding a protocol post-deploy

No upgrade required:

```solidity
// ERC-4626 venue — register the vault directly
vault.registerProtocol("Euler", 0x1905EDDF5943ef6C92Ccf1469bd40fC2cB4A77b0, true);

// Non-ERC-4626 — deploy an adapter, register the adapter
vault.registerProtocol("Aave", address(aaveAdapter), false);

vault.removeProtocol("Euler");
```

Adapter ids `3`, `4` and `5` are **reserved and must stay empty** — see
[`PENDING.md`](Monad_Contract/Fortress/src/adapters/PENDING.md).

---

## Prior deployment — Base mainnet

The original deployment remains live on Base. Its addresses are **not** valid on Monad;
several of them collide with unrelated contracts there.

| Contract | Address |
|---|---|
| FortVault (Proxy) | [`0x1d19D3421a5a277201bEc3F596d61FB866284506`](https://basescan.org/address/0x1d19D3421a5a277201bEc3F596d61FB866284506) |
| LiFiAdapter | [`0x5460286d8C0B7d50Dd422c12De34944Eb081C138`](https://basescan.org/address/0x5460286d8C0B7d50Dd422c12De34944Eb081C138) |
| CrossChainRouter | [`0x7D15b7fe74810EBBA1a153A4Bf732d8Ee85B3739`](https://basescan.org/address/0x7D15b7fe74810EBBA1a153A4Bf732d8Ee85B3739) |
| CompoundV3Adapter | [`0xC161A7A56124c45430CB52A2Ef27Cd9BD991688d`](https://basescan.org/address/0xC161A7A56124c45430CB52A2Ef27Cd9BD991688d) |
| PendleAdapter | [`0x43Cb307003f9A9E069dF9741dA59F1e462774014`](https://basescan.org/address/0x43Cb307003f9A9E069dF9741dA59F1e462774014) |

---

## Further reading

| Document | Contents |
|---|---|
| [`DEPLOYMENT.md`](Monad_Contract/Fortress/DEPLOYMENT.md) | The live Monad deployment — addresses, verification output, outstanding items |
| [`SUBMISSION.md`](Monad_Contract/Fortress/SUBMISSION.md) | Port state, phase by phase, with evidence |
| [`DECISIONS.md`](Monad_Contract/Fortress/DECISIONS.md) | Every divergence from Base, with rationale (D0-1 … D4-13) |
| [`ADDRESSES.md`](Monad_Contract/Fortress/ADDRESSES.md) | Address book with per-address verification evidence |
| [`docs/gas-model.md`](Monad_Contract/Fortress/docs/gas-model.md) | Measured cost curve, `MAX_STEPS` derivation, per-adapter envelopes |
| [`PENDING.md`](Monad_Contract/Fortress/src/adapters/PENDING.md) | The three empty adapter slots and the bar a replacement must clear |
| [`FORTRESS_MONAD_PORT_PROMPT.md`](FORTRESS_MONAD_PORT_PROMPT.md) | The master plan — Phases 0–10, invariants, standing rules |

## Dependencies

- [OpenZeppelin Contracts v5](https://github.com/OpenZeppelin/openzeppelin-contracts)
- [OpenZeppelin Contracts Upgradeable v5](https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable)
- [Forge Std](https://github.com/foundry-rs/forge-std)

## License

MIT
