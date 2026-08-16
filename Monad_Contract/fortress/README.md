# FORTRESS Protocol — contracts

Stateless deposit router for USDC yield on **Monad** (chain 143). Users split deposits
across multiple DeFi protocols in a single transaction. All output tokens — shares,
aTokens, LP — go directly to the user; no contract in this repo custodies funds beyond a
single transaction.

This is the contracts-level reference. For orientation, deployed addresses and current
status see [`../../README.md`](../../README.md) and [`DEPLOYMENT.md`](DEPLOYMENT.md).

> **Ported from Base, not lifted.** Every third-party address was re-verified on chain
> and several Base assumptions turned out to be actively wrong on Monad. See
> [`DECISIONS.md`](DECISIONS.md) for the full record.

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
         +--------------+  +--------------+  |GenericSwapV3  |
                                             +------+--------+
                                                    ^
                           +--------------+         |
                           |ShMonadAdapter|---------+
                           |USDC<->MON<-> |   (MON leg reuses
                           |    shMON     |    LiFiAdapter)
                           +--------------+


        +------------------+          +------------------+
        |     User EOA     |          |     User EOA     |
        +--------+---------+          +--------+---------+
                 |                             |
      swapAndDeposit(non-USDC)      depositCrossChain / initiateWithdraw
                 |                             |
        +--------v---------+          +--------v---------+
        |  FortSwapRouter  |          | CrossChainRouter |
        |  (extracted for  |          |   (standalone)   |
        |   EIP-170 size)  |          +--------+---------+
        +--------+---------+                   |
                 |                    +--------+--------+
        +--------v---------+          |                 |
        |  LI.FI Diamond   |   +------v-----+   +-------v------+
        +------------------+   |LI.FI bridge|   |    Keeper    |
                               +------------+   +--------------+
```

**`swapAndDeposit` lives on `FortSwapRouter`, not on `FortVault`** — it was extracted to
keep the vault under the contract size limit. `FortVault` exposes `deposit`, `withdraw`
and `rebalance` only.

**`ShMonadAdapter` routes its MON leg through `LiFiAdapter`** rather than calling the
diamond directly, so route validation and the selector allowlist live in exactly one
place.

---

## Flows

### Deposit

```
User                    FortVault                Protocol / Adapter
 |                          |                          |
 |-- deposit(entries[]) --->|                          |
 |                          |-- transferFrom(USDC) --->|  (pull total from user)
 |                          |                          |
 |                          |  deposit fee (if set)    |
 |                          |                          |
 |                          |  for each entry:         |
 |                          |                          |
 |                          |  [ERC-4626]              |
 |                          |-- maxDeposit() --------->|  ProtocolAtCapacity if short
 |                          |-- approve + deposit() -->|  Euler / Curvance / Morpho
 |                          |-- minSharesOut check     |
 |                          |          shares -------->|  (minted to user directly)
 |                          |                          |
 |                          |  [Adapter, no data]      |
 |                          |-- approve + depositFor ->|  AaveV3Adapter
 |                          |          aTokens ------->|  (credited via onBehalfOf)
 |                          |                          |
 |                          |  [Adapter, with data]    |
 |                          |-- approve + depositFor ->|  LiFiAdapter / ShMonadAdapter
 |                          |    (amount, user, data)  |  (route + minimums + deadline)
 |                          |          tokens -------->|  (sent to user directly)
 |                          |                          |
 |                          |  approval cleared to 0   |
 |                          |  vault USDC balance = 0  |
 |<--- Deposited event -----|                          |
```

Amounts are absolute. The last entry receives the remainder, eliminating rounding dust.

### Withdraw

```
User                    FortVault                Protocol / Adapter
 |                          |                          |
 |-- withdraw(entries[]) -->|                          |
 |                          |  for each entry:         |
 |                          |                          |
 |                          |  [ERC-4626]              |
 |                          |-- redeem(shares, user, user)
 |                          |                          |
 |                          |  [Adapter]               |
 |                          |-- redeemFor(shares, user, user[, data])
 |                          |     adapter pulls shares from the USER
 |                          |     (user must approve the ADAPTER on the share token)
 |                          |                          |
 |                          |-- minUsdcOut check ----->|  SlippageExceeded if short
 |                          |          USDC ---------->|  (sent to user directly)
 |<--- Withdrawn event -----|                          |
```

### Swap and deposit — `FortSwapRouter`

For users holding non-USDC. Swaps to USDC via LI.FI, then splits across protocols. Uses
basis points rather than absolute amounts because swap output is non-deterministic; the
last entry takes the remainder.

```
User                 FortSwapRouter           LI.FI Diamond      Protocol / Adapter
 |                        |                        |                    |
 |-- swapAndDeposit() --->|                        |                    |
 |   (inputToken, amount, |                        |                    |
 |    minUsdcOut, deadline,                        |                    |
 |    swapData[], entries[])                       |                    |
 |                        |                        |                    |
 |                        |  amount > 0, token != USDC, deadline, BPS = 10000
 |                        |                        |                    |
 |                        |  per leg (I5):         |                    |
 |                        |   callTo    in isApprovedDex                |
 |                        |   approveTo in isApprovedDex   <-- NOT "== diamond"
 |                        |   selector  in isApprovedSwapSelector       |
 |                        |  route ends: leg0.sendingAssetId == inputToken
 |                        |              legN.receivingAssetId == USDC  |
 |                        |  override leg0.fromAmount  (I6)             |
 |                        |                        |                    |
 |                        |-- transferFrom(token)->|                    |
 |                        |-- approve + swapV3() ->|  Single or Multiple
 |                        |<-- USDC to router -----|  ERC20->ERC20      |
 |                        |                        |                    |
 |                        |  delta vs pre-call snapshot                 |
 |                        |  minUsdcOut check, fee, clear approval      |
 |                        |  sweep residual input back to user          |
 |                        |                                             |
 |                        |  for each entry (BPS split):                |
 |                        |-- approve + deposit ----------------------->|
 |                        |          tokens --------------------------->| (to user)
 |<-- SwapAndDeposited ---|                                             |
```

### Rebalance

```
User                    FortVault              Source Protocol    Target Protocol
 |                          |                       |                   |
 |-- rebalance(entries[]) ->|                       |                   |
 |                          |                       |                   |
 |                          |-- redeem/redeemFor -->|                   |
 |                          |<-- USDC (to vault) ---|                   |
 |                          |  minUsdcOut check     |                   |
 |                          |                       |                   |
 |                          |-- maxDeposit() guard on target ---------->|
 |                          |-- approve + deposit/depositFor ---------->|
 |                          |  minSharesOut check   |    shares ------->| (to user)
 |                          |                       |                   |
 |                          |  vault USDC balance = 0                   |
 |<--- Rebalanced event ----|                       |                   |
```

USDC rests in the vault only *within* the transaction, between the two legs.

### Cross-chain deposit — `CrossChainRouter`

```
User                  CrossChainRouter            LI.FI Diamond          Destination
 |                          |                          |                    |
 |-- depositCrossChain() -->|                          |                    |
 |   (amount, destChain,    |                          |                    |
 |    lifiData, deadline)   |                          |                    |
 |                          |  selector in isApprovedBridgeSelector          |
 |                          |-- transferFrom(USDC) --->|                    |
 |                          |-- forceApprove(LI.FI) -->|                    |
 |                          |-- lifiDiamond.call() --->|                    |
 |                          |   (raw bridge calldata)  |--- bridge USDC --->|
 |                          |   balance delta check    |                    |
 |                          |   UsdcNotConsumed if not |         shares --> user on dest
 |<-- requestId (Pending) --|                          |                    |
 |                          |                          |                    |
 |        ... async bridge completes ...               |                    |
 |  Keeper: markDepositCompleted(requestId)            |                    |
```

### Cross-chain withdraw

```
User                  CrossChainRouter            Keeper
 |                          |                       |
 |-- initiateWithdraw() --->|                       |
 |   (expectedUsdc,         |                       |
 |    sourceChain, deadline)|                       |
 |<-- requestId (Pending) --|                       |
 |                          |                       |
 |    ... keeper redeems shares on the dest chain ...|
 |    ... keeper bridges USDC back to the router ... |
 |                          |                       |
 |                          |<-- fulfillWithdraw() -|
 |                          |   status -> Completed |
 |                          |   pendingWithdrawBalance reserved
 |                          |                       |
 |-- claimWithdraw() ------>|                       |
 |<-- USDC transferred -----|   status -> Claimed   |
```

> **Phase 6 was descoped.** `CrossChainRouter` is deployed but its bridge selector
> allowlist has not been rebuilt for the Monad LI.FI diamond's facets, so cross-chain
> deposits revert until `setApprovedBridgeSelector` is populated. Only one bridge facet
> selector was ever confirmed by live quote (`polymerStandard`, `0x17917a4e`).

### Protocol dispatch

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
| `FortVault` | Core router. UUPS, Ownable2Step, Pausable, ReentrancyGuardTransient. Protocol registry keyed by `keccak256(name)`; dispatches deposit / withdraw / rebalance. ERC-4626 path carries a `ProtocolAtCapacity` guard. Deposit fee is **timelocked** — `queueDepositFeeBps` → wait → `executeDepositFeeBps`, capped at `MAX_DEPOSIT_FEE_BPS = 500` (5%). |
| `FortSwapRouter` | `swapAndDeposit` for non-USDC input. Extracted from the vault for EIP-170. Owns its own DEX + selector allowlists. |
| `CrossChainRouter` | Standalone async cross-chain deposit/withdraw. Bridge **selector** allowlist, balance-delta check (`UsdcNotConsumed`), `pendingWithdrawBalance` accounting so rescue/refund cannot touch reserved funds. |
| `FortStrategyExecutor` | Multi-step strategy runner. `MAX_STEPS = 10`, re-derived from measured Monad gas. |
| `LiFiAdapter` | LI.FI **GenericSwapFacetV3** — all six variants, selected by an explicit `SwapKind` in the payload rather than inferred. Address + selector allowlists, route end-asset checks, delta-verified output, native-MON handling. |
| `AaveV3Adapter` | One implementation, **two deployments**: Aave V3 Monad and Neverland. `pool`/`aToken` are immutables (a cold SLOAD costs ~8,100 gas on Monad); the constructor proves the (pool, aToken, underlying) triple agrees on chain. |
| `ShMonadAdapter` | FastLane shMONAD. USDC→MON→shMON and back, MON leg via `LiFiAdapter`. Per-leg slippage floors; exposes `previewRedeemMon` because the exit carries a real haircut. |
| `MorphoStrategyAdapter` | Morpho Blue supply/withdraw for the strategy executor. |
| `MorphoLeverageExecutor` / `MorphoExitExecutor` | Flash-loan leverage open/close. Callback guarded by `msg.sender == morpho` **plus** a transient commitment hash. **Not deployed**; fork tests not yet rebuilt for Monad. |
| `PendleAdapter` / `PendleStrategyAdapter` | Pendle PT operations. Market allowlist **not rebuilt** for Monad markets. |
| `SwapStrategyAdapter` | Venue-agnostic swap step for the executor. EXACT and FULL-BALANCE modes. |
| `MonadAddresses` | The **only** file permitted to contain a 40-hex address literal. CI enforces it, and the check scans comments too. |

---

## Security model

### Invariants

| | |
|---|---|
| **I1 Stateless** | Every adapter's balance of every asset is zero once a call returns. Residual input is swept back to whoever supplied it. |
| **I2 Direct delivery** | Output goes to the end user, never parked. Aave uses `onBehalfOf`; shMONAD mints straight to the receiver. |
| **I5 Allowlists** | Any call into a user-supplied external target is validated by **address *and* function selector**. An address allowlist alone was an audit finding on Base. |
| **I6 Protocol-computed amounts** | Leg 0's `fromAmount` is overwritten with the protocol's amount, so user calldata cannot inflate a swap. |
| **I7 Approval hygiene** | Approvals scoped to the exact amount and revoked in the same transaction. |
| **I8 Slippage** | A caller-supplied minimum on every value-converting leg — and for two-leg paths, **per leg**, so a bad swap cannot hide behind a good exchange rate. |
| **I13 Bounded gas** | Measured envelopes asserted under Monad Foundry. |

Plus: **delta-based verification** everywhere — output is measured against a pre-call
snapshot, never an absolute balance, and never taken from the callee's return value on
trust. The check must stay correct when a token repeats across steps.

### Corrections made during the port

- **`approveTo` is allowlisted, not compared to the diamond.** The Base rule required
  `approveTo == lifiDiamond`. In LI.FI, `approveTo` is the spender the diamond approves —
  the DEX, or a DEX's separate token-transfer proxy — never the diamond itself. The rule
  rejected every live quote and survived CI only because the test mock doubled as both.
- **Selector allowlists added** to `LiFiAdapter` and `FortSwapRouter`; they previously
  gated on address alone.
- **`depositFor` now verifies its own output delta** instead of trusting the diamond's
  internal minimum.
- **Route end-assets are pinned** to the declared input and output tokens.

### Not yet done

- **No timelock on ownership.** The deployer EOA holds `_authorizeUpgrade` on every proxy.
  `DeployTimelock.s.sol` → `TransferOwnership.s.sol` → `acceptOwnership()` closes it;
  `VerifyDeployment.s.sol` fails loudly on the half-finished state.
- **No audit.** `test/unit/AccessControl.sweep.t.sol` asserts every owner/vault gate,
  the upgrade path and initializer lockdown — that is a slice, not a security review.
  Slither has not been run.

---

## Gas — read this before setting a limit

**Monad charges on `gas_limit`, not `gas_used`.** Gas is a correctness concern here, not
an optimisation.

Upstream Foundry prices a cold SLOAD at **2,162**; Monad prices it at **8,162** — a 3.85×
under-report on the operation this codebase does most. Installing Monad Foundry is **not
sufficient**: `network = "monad"` in `foundry.toml` selects the schedule, and without it
`forge test` silently keeps Ethereum prices. `test/gas/ColdSloadPricing.t.sol` fails the
build if the wrong schedule is active.

Measured envelopes per entry point are in [`docs/gas-model.md`](docs/gas-model.md).
`MAX_STEPS` was re-derived from measurement and cut **30 → 10**.

---

## Layout

```
src/
  FortVault.sol                    # core router (UUPS)
  FortSwapRouter.sol               # swapAndDeposit, extracted for EIP-170
  CrossChainRouter.sol             # standalone async cross-chain router
  FortStrategyExecutor.sol         # multi-step strategy runner (MAX_STEPS = 10)
  MorphoLeverageExecutor.sol       # flash-loan leverage open
  MorphoExitExecutor.sol           # flash-loan leverage close
  interfaces/
    IFortProtocol.sol              # base adapter interface
    IFortProtocolEx.sol            # + bytes data (routes, minimums, deadline)
    ILiFi.sol                      # GenericSwapFacetV3, SwapKind, diamond loupe
    IAaveV3Pool.sol                # minimal Aave slice + config-bitmap library
    IShMonad.sol                   # shMONAD (native-MON asset) + ILiFiSwapper
    IMorphoBlue.sol  IPendleRouter.sol  IStrategyAdapter.sol  ICrossChainRouter.sol
  adapters/
    LiFiAdapter.sol                # GenericSwapFacetV3, all six variants
    AaveV3Adapter.sol              # Aave V3 Monad AND Neverland
    ShMonadAdapter.sol             # USDC <-> MON <-> shMON
    MorphoStrategyAdapter.sol  PendleAdapter.sol
    PendleStrategyAdapter.sol  SwapStrategyAdapter.sol
    PENDING.md                     # the three empty slots, and the bar for a replacement
  config/
    MonadAddresses.sol             # the ONLY file with address literals

script/
  DeployMonad.s.sol                # full deployment (mainnet 143 only)
  VerifyDeployment.s.sol           # read-only post-deploy assertions
  DeployTimelock.s.sol             # 48h TimelockController, self-governed
  TransferOwnership.s.sol          # start the Ownable2Step handover
  ci/check-address-literals.sh     # address-book integrity gate

test/
  unit/  fuzz/  invariant/  gas/  fork/  mocks/  helpers/
```

`fork/` needs `MONAD_RPC_URL` and is excluded from the default CI run. The LiFi, Aave and
shMonad fork suites pass against live Monad; the Euler / Fluid / Morpho /
PendleStrategyAdapter suites still carry Base fixtures and fail.

---

## Usage

### Build and test

```shell
forge build
forge test --no-match-path "test/fork/*"        # 632 tests, no RPC needed
```

### Fork tests

```shell
export MONAD_RPC_URL=https://rpc.monad.xyz
forge test --match-path "test/fork/*"
```

### Gas envelopes — Monad Foundry only

```shell
foundryup --network monad
forge test --match-path "test/gas/*" -vv
```

### Address-book integrity

```shell
./script/ci/check-address-literals.sh
```

### Deploy — mainnet 143 only

Testnet 10143 is rejected by the script: none of the protocol addresses exist there.

```shell
cp .env.example .env      # PRIVATE_KEY, MONAD_RPC_URL
source .env && forge script script/DeployMonad.s.sol --rpc-url $MONAD_RPC_URL              # simulate
source .env && forge script script/DeployMonad.s.sol --rpc-url $MONAD_RPC_URL --broadcast  # live
```

Then run [`VerifyDeployment.s.sol`](script/VerifyDeployment.s.sol) — read-only, no key
required. Command and the current deployment's env block are in [`DEPLOYMENT.md`](DEPLOYMENT.md).

### Registering a protocol post-deploy

No upgrade required:

```solidity
// ERC-4626 venue — register the vault directly
vault.registerProtocol("Euler", 0x1905EDDF5943ef6C92Ccf1469bd40fC2cB4A77b0, true);

// Non-ERC-4626 — deploy an adapter, register the adapter
vault.registerProtocol("Aave", address(aaveAdapter), false);

vault.removeProtocol("Euler");
```

Adapter ids `3`, `4` and `5` are **reserved and must stay empty** — see
[`PENDING.md`](src/adapters/PENDING.md). Aave was added under explicit operator
instruction and did not consume one.

### Opening the swap paths

Every swap reverts `UnauthorizedSelector` until the allowlist is populated on **both**
`LiFiAdapter` and `FortSwapRouter`:

```solidity
lifiAdapter.setApprovedDex(dexRouter, true);
lifiAdapter.setApprovedSwapSelector(0x........, true);   // read off a live chain-143 quote
swapRouter.setApprovedDex(dexRouter, true);
swapRouter.setApprovedSwapSelector(0x........, true);
```

Selectors belong to the venues LI.FI routes *through* (KyberSwap, OpenOcean, Eisen,
Monorail, Kuru) — not to the diamond. Verify each one before trusting it; guessing is
exactly what the BaseSwap address collision already punished once.

---

## Further reading

| Document | Contents |
|---|---|
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | The live Monad deployment — addresses, verification output, outstanding items |
| [`SUBMISSION.md`](SUBMISSION.md) | Port state, phase by phase, with evidence |
| [`DECISIONS.md`](DECISIONS.md) | Every divergence from Base, with rationale (D0-1 … D4-13) |
| [`ADDRESSES.md`](ADDRESSES.md) | Address book with per-address verification evidence |
| [`RESEARCH.md`](RESEARCH.md) | Phase 0 findings, EVM probes, adapter matrix, open questions |
| [`docs/gas-model.md`](docs/gas-model.md) | Measured cost curve, `MAX_STEPS` derivation, per-adapter envelopes |

## Dependencies

- [OpenZeppelin Contracts v5](https://github.com/OpenZeppelin/openzeppelin-contracts)
- [OpenZeppelin Contracts Upgradeable v5](https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable)
- [Forge Std](https://github.com/foundry-rs/forge-std)

## License

MIT
