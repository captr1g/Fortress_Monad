# FORTRESS → Monad: Master Build Prompt

> **How to use this document.** This whole file is the prompt. Paste it into a fresh agent session (Claude Code, or any coding agent with filesystem + shell + web access) at the start of the project. Then drive it **one phase at a time**: say `Execute Phase 0` and nothing else. The agent must stop at the end of every phase and wait for your explicit `Execute Phase N+1`. Do not let it run multiple phases in one go.
>
> Reference docs the agent must keep open:
> - Monad developer docs: <https://docs.monad.xyz/>
> - Monad EVM differences: <https://docs.monad.xyz/developer-essentials/differences>
> - Monad gas pricing: <https://docs.monad.xyz/developer-essentials/gas-pricing>
> - Monad opcode pricing: <https://docs.monad.xyz/developer-essentials/opcode-pricing>
> - Monad best practices: <https://docs.monad.xyz/developer-essentials/best-practices>
> - Monad network info: <https://docs.monad.xyz/developer-essentials/network-information>
> - **Canonical protocol address registry: <https://github.com/monad-crypto/protocols/tree/main/mainnet>** (one `.jsonc` per protocol; this is the authoritative source for every third-party address)

---

## 0. ROLE AND MISSION

You are a senior Solidity protocol engineer and security auditor. You are porting **FORTRESS**, a production DeFi protocol currently live on Base (Solidity/Foundry), to **Monad mainnet (chain ID 143)**.

Unlike a cross-VM port, this is **EVM → EVM**. The Solidity is portable almost verbatim. What is *not* portable is:

1. **The integration set.** Three of FORTRESS's eight adapters have no counterparty on Monad. See §3.
2. **The gas and resource model.** Monad charges on `gas_limit`, not `gas_used`, and reprices cold state access ~4×. Several of FORTRESS's design constants (`MAX_STEPS = 30`, adapter-per-step dispatch, registry SLOADs in loops) were tuned against Base's cost curve and are now economically wrong.
3. **The address book.** Every hardcoded Base address in `script/` and the adapter constructors is dead on Monad.

So: **do not rewrite the protocol. Re-target it.** Preserve the contracts, the invariants, and the audit posture. Change the integrations, the constants, and the deployment layer — and re-verify everything.

**Non-negotiable ground rules:**

1. **Verify before you write.** Every third-party contract address, ABI, chain ID, RPC endpoint, gas constant, and opcode price you use must be verified against official docs or against on-chain state in this session (`cast code`, `cast call`). Never write an address from memory, and never copy one from a Base deployment. If you cannot verify something, write it into `RESEARCH.md` under `## UNVERIFIED` and flag it in your phase report instead of guessing.
2. **Phase gates are hard stops.** At the end of each phase, produce the phase report, then STOP. Do not start the next phase.
3. **Tests before implementation.** Within every phase, write the failing test first, then the implementation. A phase is not complete until `forge test` passes and you have pasted the actual output.
4. **No invented numbers.** Do not invent contract addresses, market IDs, fee values, decimals, gas limits, or protocol parameters. Look them up or mark them `TODO(verify)`.
5. **Do not invent substitute integrations.** See §3.3. Where a Base dependency does not exist on Monad, the adapter slot is left **empty**. You do not pick a replacement protocol. You do not write a "similar" adapter. The operator will supply those adapters later.
6. **Report failures honestly.** If a phase's goal turns out to be infeasible on Monad, say so explicitly with evidence, deliver everything else in the phase, and propose alternatives. Do not silently narrow scope.
7. **No mainnet actions without explicit instruction.** Never deploy to Monad mainnet, never touch a mainnet key, never broadcast a mainnet transaction. Monad testnet (chain ID 10143) and local forks only, unless I explicitly say otherwise in a later message.

---

## 1. WHAT FORTRESS IS (SOURCE SYSTEM SPEC)

FORTRESS on Base is a **stateless deposit router and strategy execution engine for USDC yield**. Users split a deposit across many DeFi protocols in a single transaction, and every output token (vault shares, LP tokens, debt positions) lands **directly with the user**. The protocol contracts never custody funds beyond a single transaction.

Source of truth: the existing Foundry repo at `Fort/` (`src/`, `script/`, `test/`, `docs/`, `.audit/`).

### 1.1 Component map

| Contract | Role |
|---|---|
| `FortVault` | Core split-deposit router. UUPS proxy. Protocol registry keyed by `keccak256(name)`. `deposit(DepositEntry[])`, `withdraw(WithdrawEntry[])`, `rebalance(RebalanceEntry[])`. Dispatches to ERC-4626 vaults directly or to `IFortProtocol` / `IFortProtocolEx` adapters. Timelocked deposit fee (max 5%, 12h–7d delay, 48h execution window). |
| `FortSwapRouter` | Holds non-USDC input, swaps to USDC via aggregator, then BPS-splits into protocols. Last entry receives remainder so no dust. DEX allowlist + `approveTo` validation. |
| `FortStrategyExecutor` | Atomic multi-step engine. Ordered `Step[]` (currently max 30) of `SWAP / SUPPLY_COLLATERAL / BORROW / REPAY / WITHDRAW_COLLATERAL / DEPOSIT_ERC4626 / REDEEM_ERC4626`. Each step routes to a registered adapter by `uint8 adapterId`. Steps chain by live balance reads (`amountFixed` or `bps` of current balance). Delta-based output verification with pre-call balance snapshots. Sweeps every residual token to the user at the end. |
| `MorphoLeverageExecutor` | One-shot leveraged position open via Morpho flash loan. Flash callback guarded by `msg.sender == morpho` **plus** a transient-storage commitment hash. DEX allowlist + function-selector allowlist on the swap leg. |
| `MorphoExitExecutor` | One-shot deleverage/exit. Flash-repay debt, withdraw collateral, swap back, settle. Same commitment guard pattern. |
| `CrossChainRouter` | Async cross-chain deposit/withdraw. `depositCrossChain` bridges USDC and records a request; keeper marks completed/failed; refunds after a delay. Withdrawals use an intent → fulfill → claim pattern with `pendingWithdrawBalance` accounting that rescue/refund cannot touch. Bridge function-selector allowlist. |
| Adapters | `LiFiAdapter` (aggregator swaps), `CompoundV3Adapter`, `PendleAdapter` (PT buy/sell, market allowlist), `YoAdapter`, `AerodromeAdapter` (LP + gauge), plus strategy-side `MorphoStrategyAdapter`, `SwapStrategyAdapter`, `PendleStrategyAdapter`. |
| Interfaces | `IFortProtocol` (`depositFor(amount, receiver)` / `redeemFor(shares, receiver, owner)`), `IFortProtocolEx` (same plus `bytes data`), `IStrategyAdapter` (`execute(action, token, amount, beneficiary, data) → (tokenOut, amountOut)`). |

Every adapter is UUPS-upgradeable, `Ownable2Step`, `ReentrancyGuardTransient`, gated by an `onlyVault` / `onlyExecutor` modifier, with a `rescueToken` escape hatch and a 50-slot storage gap.

### 1.2 The invariants that define FORTRESS

These are the product. Preserve every one of them on Monad, or explicitly document why an equivalent is impossible and what replaces it.

- **I1 — Statelessness.** After any user-facing call completes, the router/executor's balance of every token involved is zero. No protocol contract custodies user funds across transactions. (`CrossChainRouter`'s escrowed withdrawal balance is the single deliberate exception, and it is separately accounted.)
- **I2 — Direct delivery.** Every output token goes to the end user, never to the protocol.
- **I3 — Atomicity.** A multi-step strategy either fully completes or fully reverts. No partial position may survive a failed run.
- **I4 — No trapped funds.** Every residual balance is swept to the user before the call ends.
- **I5 — Allowlisted external calls.** Any call into a user-supplied external target is validated against an owner-controlled allowlist, both by target address **and** by function selector.
- **I6 — Caller-supplied data cannot inflate amounts.** Amounts passed to external routers are always overridden by protocol-computed values, never taken from user calldata.
- **I7 — Approval hygiene.** Any ERC-20 approval granted to an external contract is scoped to the exact amount and revoked in the same transaction.
- **I8 — Slippage bounds.** Every value-converting leg accepts a caller-supplied minimum output and reverts below it.
- **I9 — Admin actions are bounded and observable.** Fees are capped and timelocked; every state-changing admin action emits an event; ownership transfer is two-step.
- **I10 — Emergency controls.** Pause halts user entry points; rescue recovers stranded tokens without touching accounted user funds.
- **I11 — Registry consistency.** Registering/removing a protocol or adapter keeps the key list and the map in sync; unknown keys revert.
- **I12 — No dust.** Proportional splits assign the remainder to the last entry so the sum is exact.

Add one Monad-specific invariant:

- **I13 — Bounded, measured gas.** Every user entry point has a measured worst-case gas cost, asserted in a regression test. No entry point may be callable in a shape whose gas limit exceeds the block gas limit or whose *charged* cost (gas limit, not gas used) is unbounded in user-supplied array length.

### 1.3 Known findings from the EVM audit (carry the lessons)

The Base deployment went through an adversarial audit ("Nemesis": Feynman logic pass + state-inconsistency pass + fusion loop). Final posture: **0 critical, 1 high, 4 medium, 8 low, 1 info**. The classes of bug that were found — and that you must not reintroduce on Monad — were:

- **Upgrade authority is the single largest risk.** UUPS contracts that hold standing user authorization on a lending protocol can be upgraded by one key with no delay. (HIGH, still open on EVM.) **On Monad, fix this: put the upgrade admin behind a timelock from day one.**
- **Raw user-supplied calldata forwarded to an allowlisted target.** Address allowlist alone is insufficient; the callable selector must also be allowlisted.
- **Incomplete residual sweeps.** Output tokens that never appear as an input token get stranded.
- **Balance checks using absolute balance instead of a delta**, breaking when `tokenOut == tokenIn` or when a token repeats across steps.
- **Non-atomic accounting between a queued state and its settlement** (fulfill/cancel race).
- **Missing events on fee paths**, breaking off-chain reconciliation.
- **Array access before a length check**, turning a clean revert into a panic.
- **Missing zero-address / zero-value validation on admin setters.**

Read `Fort/.audit/findings/nemesis-verified.md` and `Fort/.audit/FORTRESS-DEV-HANDOFF.md`; they define the audit output format you will reproduce in Phase 8.

---

## 2. MONAD EXECUTION MODEL (READ BEFORE ANY CODE)

Monad is **full EVM bytecode compatible** and RPC-compatible with Ethereum. Your Solidity compiles unchanged. The differences below are where a straight lift-and-shift produces a *working but wrong* deployment — mostly economic bugs, not correctness bugs. Verify every row against the docs in Phase 0; the numbers here are current as of writing but are the kind of thing that changes.

| Dimension | Ethereum / Base | Monad | Consequence for FORTRESS |
|---|---|---|---|
| **Gas charging** | Charged on `gas_used`; unused gas refunded. | **Charged on `gas_limit`.** `gas_paid = gas_limit × price_per_gas`, deducted upfront as `value + gas_bid × gas_limit`. This is required by async execution (blocks are built before they are executed) and blocks a DoS class. | **The single most important difference.** A user who submits a 3-step strategy with a wallet-estimated 5M gas limit *pays for 5M gas*. Loose gas limits are now a direct user cost. Every entry point needs a documented, tested gas envelope, and the SDK/frontend must set tight explicit limits rather than padding `eth_estimateGas`. Reverting transactions still consume gas and are valid chain entries. |
| **Cold state access** | Cold account 2600, cold storage 2100. | **Cold account 10100, cold storage 8100** (~3.9×). Affects `BALANCE`, `EXTCODESIZE/COPY/HASH`, `CALL`, `CALLCODE`, `DELEGATECALL`, `STATICCALL`, `SLOAD`, `SSTORE`. | FORTRESS is dispatch-heavy: registry `SLOAD` → adapter `CALL` → token `balanceOf` → external protocol `CALL`, per step. That pattern is now ~4× more expensive relative to compute. **Re-derive `MAX_STEPS`.** Cache registry reads in memory, batch balance reads, collapse redundant hops, and prefer computation over extra storage/external reads. |
| **Memory pricing** | Quadratic: `3w + w²/512`. | **Linear: `w/2`**, capped at **8 MB per transaction**. | Large calldata/memory arrays (`Step[]`, `sweepTokens[]`, `DepositEntry[]`) are dramatically cheaper than on Base. The binding constraint on batch size moves from memory to cold-access cost. Re-derive array caps from measurement, not from the Base values. |
| **Contract size** | 24 KB code / 48 KB init code (EIP-170/3860). | **128 KB code / 256 KB init code.** | Any size-driven contortion in the current codebase (library splitting, aggressive `via_ir` settings chosen to fit) can be relaxed. Do not relax it blindly — re-measure and only change what the size limit forced. |
| **Precompiles** | Standard pricing. | Repriced up: `ecRecover` 3000→**6000**, `ecAdd` 150→**300**, `ecMul` 6000→**30000**, `ecPairing` 45000→**225000**, `blake2f` 2× rounds, point-eval 50000→**200000**. Plus **secp256r1 (P-256) precompile** for WebAuthn/passkeys. | Signature-verifying paths (`permit`, EIP-712 order flows, any aggregator that verifies quotes on-chain) cost double. Factor into gas envelopes. P-256 is a new capability if you later want passkey-authorized flows. |
| **Blob transactions** | EIP-4844 supported. | **Not supported.** | Irrelevant to FORTRESS today; do not use blob-carrying tooling in deployment scripts. |
| **Mempool** | Global public mempool; strong sandwich/MEV surface. | **Local mempool per node**, no global public mempool; async execution. | The sandwich risk profile is different, **but not zero, and not your assumption to make.** Keep every slippage bound (I8) and deadline exactly as-is. Document the changed threat model in `THREAT-MODEL.md`; do not weaken any guard because "Monad has no mempool". |
| **Reserve balance** | n/a | A reserve-balance mechanism ensures included transactions remain viable at execution time. | Affects transaction submission and keeper design (`CrossChainRouter`'s keeper). Read <https://docs.monad.xyz/developer-essentials/reserve-balance> before writing keeper logic. |
| **EIP-7702** | Supported. | Supported, with restrictions: delegated EOAs must maintain a **minimum 10 MON balance** and **cannot use `CREATE`/`CREATE2`** when called as a smart contract. | If any FORTRESS flow is expected to be invoked by a 7702-delegated smart account, and any leg of that flow does `CREATE2` (deterministic deploys, some aggregator/router patterns, Permit2 proxies), it will fail. Enumerate `CREATE2` usage across the whole call graph in Phase 0 and record it. |
| **Transient storage (EIP-1153)** | Available (Cancun). | **VERIFY IN PHASE 0 — BLOCKING.** | `MorphoLeverageExecutor` and `MorphoExitExecutor` guard the flash-loan callback with a transient-storage commitment hash, and every adapter inherits `ReentrancyGuardTransient`. If `TSTORE`/`TLOAD` are unavailable or repriced significantly, those guards must be redesigned before anything else ships. Confirm with docs *and* an on-chain probe (deploy a trivial `TSTORE`/`TLOAD` contract to testnet). |
| **EVM version / hardfork** | `cancun` on Base. | Monad Foundry templates ship `cancun`; `prague` is also referenced. **Pin it explicitly in `foundry.toml` after verifying.** | Getting this wrong silently changes emitted opcodes. |
| **Block time / finality** | Base ~2s. | Verify current values in the docs; Monad targets sub-second blocks with fast finality. | Timelock and deadline constants are in seconds, so they are portable — but re-check that a 12h minimum fee timelock and refund delays still express the intended operational windows, and that any block-count-based assumption becomes time-based. |
| **Historical state** | Full archive readily available. | Full-node historical state access is limited by throughput. Indexers (Allium, Envio, Goldsky, QuickNode, The Graph, thirdweb) are the recommended path. | Fork-testing at an arbitrary old block may not be possible. Plan fork tests against recent blocks and record the pinned block number. Off-chain accounting/reconciliation should read from an indexer, not `eth_getLogs` sweeps. |
| **RPC** | Standard. | Ethereum-RPC compatible; batch `eth_call`, use Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`), track nonces locally when submitting concurrently. | Affects scripts and keepers, not contracts. |

### 2.1 Network facts (verify in Phase 0)

| Item | Value |
|---|---|
| Mainnet chain ID | **143** |
| Mainnet RPCs | `https://rpc.monad.xyz`, `https://rpc1.monad.xyz`, `https://rpc2.monad.xyz`, `https://rpc3.monad.xyz`, `https://rpc-mainnet.monadinfra.com` |
| Testnet chain ID | **10143** — RPC `https://testnet-rpc.monad.xyz`, faucet `https://testnet.monad.xyz` |
| Native token | MON (18 decimals) |
| Explorers | MonadVision `https://monadvision.com`, Monadscan `https://monadscan.com` |
| Wrapped MON | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| Permit2 | `0x000000000022d473030f116ddee9f6b43ac78ba3` |
| CreateX | `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed` |
| Foundry deterministic deployer | `0x4e59b44847b379578588920ca78fbf26c0b4956c` |
| Safe | `0x69f4D1788e39c87893C980c06EdF4b7f686e2938` |
| Min base fee | 100 MON-gwei |

**Toolchain:** Monad ships a Foundry fork with Monad-native EVM execution:

```sh
curl -L https://foundry.category.xyz | bash
foundryup --network monad
```

Or start from the template: `forge init --template monad-developers/foundry-monad`. Verify in Phase 0 whether the Monad fork is required for accurate gas accounting in tests (it should be — upstream Foundry will model Ethereum's opcode prices, which will make every gas measurement wrong). If the Monad fork is required, **all gas assertions must run under it**, and CI must install it.

---

## 3. ADAPTER AND ECOSYSTEM AVAILABILITY ON MONAD

This section is the result of a live check performed against the Monad canonical protocol registry (`monad-crypto/protocols`), each protocol's own address docs, and their public APIs. **Re-verify every address in Phase 0 with `cast code` before using it.**

### 3.1 PRESENT on Monad — port these

| FORTRESS component | Status | Verified Monad addresses | Notes |
|---|---|---|---|
| **`LiFiAdapter`** (aggregator swaps + bridging) | ✅ **LIVE** | LI.FI Diamond `0x026F252016A7C47CDEf1F05a3Fc9E20C92a49C37`<br>Permit2Proxy `0x3c6b2e0b7421254846c53c118e24c65d59eae75e` | **The diamond address is NOT the familiar `0x1231DEB6...` used on Base.** It is chain-specific on Monad. Every hardcoded `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` in the repo must be replaced. LI.FI aggregates all Monad DEXs and runs bridges (Across, Relay, Gas.zip, Glacis, Mayan) into/out of Monad. |
| **`MorphoStrategyAdapter`**, **`MorphoLeverageExecutor`**, **`MorphoExitExecutor`** | ✅ **LIVE** | Morpho Blue core `0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee`<br>AdaptiveCurveIrm `0x09475a3D6eA8c314c592b1a3799bDE044E2F400F`<br>ChainlinkOracleV2Factory `0xC8659Bcd5279DB664Be973aEFd752a5326653739`<br>MetaMorphoV1_1Factory `0x33f20973275B2F574488b18929cd7DCBf1AbF275`<br>Bundler3 `0x82b684483e844422FD339df0b67b3B111F02c66E`<br>PublicAllocator `0xfd70575B732F9482F4197FE1075492e114E97302`<br>PreLiquidationFactory `0xB5b3e541abD19799E0c65905a5a42BD37d6c94c0` | Morpho Blue is deployed with the standard singleton interface. ~$155M TVL on Monad. **Phase 0 must confirm `flashLoan` is present and behaves identically** — the leverage/exit executors depend on it entirely. Market IDs are chain-specific: enumerate live Monad markets via `https://blue-api.morpho.org/graphql` (filter `chainId_in: [143]`) and record the ones you intend to support. |
| **`PendleAdapter`**, **`PendleStrategyAdapter`** | ✅ **LIVE** | Router V4 `0x888888888889758F76e7103c6CbF23ABbF58F946`<br>RouterStatic `0x6813d43782395A1F2AAb42f39aeEDE03ac655e09`<br>MarketFactoryV6 `0xA3cb62a49b66eB2536cf6F3C7AC82293784888A3`<br>PendleSwap `0xd4F480965D2347d421F1bEC7F545682E5Ec2151D`<br>LimitRouter `0x000000000000c9B3E2C3Ec88B1B4c0cD853f4321`<br>YieldContractFactory `0x4fe1B23ab695D99394Ab78c16A5bE358f31847F4`<br>PYLPOracle `0x5542be50420E88dd7D5B4a3D488FA6ED82F6DAc2`<br>SYFactory `0x466CeD3b33045Ea986B2f306C8D0aA8067961CF8` | Router address is the same well-known singleton as on Base — **still verify with `cast code`**. Pendle is a top-5 protocol on Monad by TVL. Markets are chain-specific and expiry-bound: enumerate via `https://api-v2.pendle.finance/core/v1/143/markets` and rebuild the market allowlist from scratch. Do not carry over any Base PT/YT/market address. |
| **`SwapStrategyAdapter`** | ✅ portable | Depends on the DEX allowlist, which must be rebuilt from Monad venues. | The adapter itself is venue-agnostic — it enforces target + selector allowlists. Only its allowlist contents change. |
| **ERC-4626 fast path in `FortVault`** | ✅ portable, plenty of targets | e.g. MetaMorpho vaults on Monad: `naUSDC 0xf5BC68C6e5825FEAe99B8018F62a595Cf745e297`, `hyperUSDCa 0xA8665084D8CD6276c00CA97Cbc0BF4BC9ae94c79`, `bbqAUSD 0xBC03E505EE65f9fAa68a2D7e5A74452858C16D29`, `steakETH 0xba8424EBBEd6C51bEa6d6D903B8815838E6a0322` | The `isERC4626` dispatch path needs no code change and has real targets on Monad. Enumerate current vaults via the Morpho API before pinning any. |
| **`CrossChainRouter`** | ✅ **LIVE** rails | LI.FI (above) + Circle **native USDC & CCTP v2** on Monad; Across, LayerZero, Axelar, deBridge, Hyperlane, Mayan, Bungee, Gas.zip all present in the Monad registry. | Bridge selector allowlist must be rebuilt for the Monad LI.FI diamond's facets. CCTP v2 for native USDC is likely the cleanest USDC path — evaluate it in Phase 6. |

**Tokens (verified):**

| Token | Monad address | Decimals |
|---|---|---|
| **USDC** (native, Circle) | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | **6** — same as Base, so BPS math and fixed-point constants carry over unchanged. Confirm on-chain anyway. |
| WETH | `0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242` | 18 |
| WBTC | `0x0555E30da8f98308EdB960aa94C0Db47230d2B9c` | 8 |
| cbBTC | `0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b` | 8 |
| USDT0 | `0xe7cd86e13AC4309349F30B3435a9d337750fC82D` | 6 |
| AUSD (Agora) | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` | 6 |
| WMON | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` | 18 |

**Oracles present:** Chainlink (push + Data Streams), Pyth, Chronicle, RedStone, Stork, Supra, Switchboard (`0xB7F03eee7B9F56347e32cC71DaD65B303D5a0E67`), eOracle, Band. Addresses in the `monad-crypto/protocols` registry.

### 3.2 ABSENT on Monad — leave these EMPTY

| FORTRESS adapter | Status | Evidence |
|---|---|---|
| **`CompoundV3Adapter`** | ❌ **NOT ON MONAD** | Compound V3 (Comet) is deployed on Ethereum, Arbitrum, Base, Optimism, Polygon, Mantle, Unichain, Scroll, Ronin only. No `compound.jsonc` in the Monad canonical registry. No Comet market with any base asset on chain 143. |
| **`AerodromeAdapter`** (+ `IAerodromeRouter`, `IAerodromeGauge`) | ❌ **NOT ON MONAD** | Aerodrome is Base-exclusive by design (Velodrome's Base sister deployment); Velodrome itself is Optimism/Superchain-only. No `aerodrome.jsonc` in the Monad registry. No ve(3,3) Dromos deployment on Monad. |
| **`YoAdapter`** (yoUSD ERC-4626 vault) | ❌ **NOT ON MONAD** | YO Protocol vaults (yoUSD/yoETH/yoBTC/yoEUR/yoGOLD) are on Base, Ethereum, Arbitrum, Solana, HyperEVM, Katana, X-Layer. No `yo.jsonc` in the Monad registry. YO's own docs list exactly one Monad address — a `YoMorphoAdapter` at `0x2BcB71309554A5DC31932Cb3D5A547Cd8cc5ED26`, which is an *internal* YO strategy adapter reaching into Monad's Morpho, **not** a yoVault you can deposit into. There is no yo-token on Monad for `FortVault` to route to. |

### 3.3 How to handle the absent three — READ CAREFULLY

For each of the three above:

1. **Do not port the adapter.** Do not deploy it. Do not register it in `FortVault` or `FortStrategyExecutor`.
2. **Do not substitute a "similar" protocol.** Not Aave V3, not Euler V2, not Curvance, not Beefy, not Uniswap V4, not anything. The operator will supply the replacement adapters.
3. **Keep the slot open and obvious.** In the Monad repo:
   - Keep `src/adapters/` clean of the three contracts (do not copy them over).
   - Create `src/adapters/PENDING.md` listing the three empty slots, the interface each replacement must implement (`IFortProtocol`, `IFortProtocolEx`, or `IStrategyAdapter`), and the exact registration call the operator will need (`FortVault.registerProtocol(...)` / `FortStrategyExecutor.registerAdapter(uint8,address)`).
   - Reserve their `adapterId` values in `FortStrategyExecutor` config and document which IDs are reserved vs free.
   - In deployment scripts, the corresponding config entries are present but set to `address(0)` with a comment `// OPERATOR TO SUPPLY`, and the script **must revert** if a non-zero registration is attempted for a reserved-but-unfilled slot.
4. **Do not delete the Base source.** The Base repo keeps them; the Monad repo simply does not include them.
5. **Say so in the phase report.** Every phase report that touches the adapter set restates: three slots empty, awaiting operator.

If the operator later hands you a replacement protocol, that is a new instruction — treat it as a new phase, with its own research, adapter, tests, and audit pass.

### 3.4 Context only — what *does* exist on Monad (NOT permission to integrate)

Recorded so you understand the venue landscape when reasoning about liquidity, oracle availability, and swap routing. **Integrating any of these requires my explicit instruction.**

- **Lending:** Aave V3 (~$345M), Euler V2 (~$222M), Morpho Blue (~$155M), Curvance (~$88M), Gearbox, Neverland, TownSquare.
- **Yield / vaults / curators:** Pendle, K3 Capital, Hyperithm, Steakhouse, Upshift, Veda, Beefy, Mellow, Lagoon, Clearstar, Ouroboros, AFI.
- **DEX:** Uniswap V4 & V3, Curve, Balancer V3, PancakeSwap V3, Kuru (CLOB), Mento, Capricorn, izumi, LFJ, Clober, Bean, DyorSwap.
- **Aggregators:** LI.FI, 0x/Matcha, KyberSwap, Eisen, Fibrous, Bungee, Enjoyoors.
- **Bridges/interop:** LI.FI, Circle CCTP v2, Across, LayerZero, Axelar, deBridge, Hyperlane, Mayan, Garden, Unit, Gas.zip.
- **LSTs:** ShMonad, Kintsu, Magma, aPriori.
- **RWA:** Valos, Midas, Centrifuge, Tether Gold.

Chain TVL is roughly $400M+, dominated by external blue-chip protocols rather than Monad-native ones — which is good for FORTRESS, because the interfaces are the ones you already know.

---

## 4. TARGET REPOSITORY LAYOUT

Start from a clean copy of the Base repo's structure. Do **not** develop in the Base repo.

```
fortress-monad/
├── foundry.toml                    # chain 143 / 10143 profiles, pinned evm_version, pinned solc
├── remappings.txt
├── .env.example                    # MONAD_RPC_URL, MONAD_TESTNET_RPC_URL, ETHERSCAN/SOURCIFY keys
├── README.md
├── RESEARCH.md                     # Phase 0 output; living document of verified facts + UNVERIFIED list
├── DECISIONS.md                    # ADR log: every divergence from the Base deployment, with rationale
├── ADDRESSES.md                    # the Monad address book: every third-party address + how it was verified
├── .github/workflows/
│   ├── ci.yml                      # fmt, build, test, coverage, gas snapshot diff
│   └── security.yml                # slither, aderyn, semgrep (whatever the Base repo used)
├── src/
│   ├── FortVault.sol
│   ├── FortSwapRouter.sol
│   ├── FortStrategyExecutor.sol
│   ├── MorphoLeverageExecutor.sol
│   ├── MorphoExitExecutor.sol
│   ├── CrossChainRouter.sol
│   ├── config/
│   │   └── MonadAddresses.sol      # NEW: single source of truth for chain constants; no address literal
│   │                               #      may appear anywhere else in src/ or script/
│   ├── adapters/
│   │   ├── LiFiAdapter.sol
│   │   ├── MorphoStrategyAdapter.sol
│   │   ├── PendleAdapter.sol
│   │   ├── PendleStrategyAdapter.sol
│   │   ├── SwapStrategyAdapter.sol
│   │   └── PENDING.md              # the three empty slots (§3.3)
│   ├── governance/
│   │   └── UpgradeTimelock.sol     # NEW: closes the open HIGH finding (§1.3)
│   └── interfaces/                 # IComet / IAerodrome* NOT carried over
├── script/
│   ├── DeployMonad.s.sol           # replaces DeployBase.s.sol
│   ├── DeployAdapters.s.sol
│   ├── DeployExecutors.s.sol
│   ├── DeployTimelock.s.sol
│   ├── Configure.s.sol             # registries, allowlists, selector lists
│   ├── VerifyDeployment.s.sol      # post-deploy assertion script; reverts on any mismatch
│   └── ops/                        # Invest, Withdraw, Pause, Rescue runbook scripts
├── test/
│   ├── unit/
│   ├── fuzz/
│   ├── invariant/                  # I1–I13 as executable invariants
│   ├── fork/                       # Monad mainnet-fork tests, pinned block
│   ├── gas/                        # NEW: gas-envelope regression tests (I13)
│   ├── mocks/
│   └── helpers/
├── audit/
│   ├── CHECKLIST.md                # Monad-specific additions to the Base checklist
│   ├── THREAT-MODEL.md
│   ├── INVARIANTS.md               # I1–I13 + how each is tested
│   └── findings/pass-N.md
└── docs/
    ├── architecture.md
    ├── monad-differences.md        # what changed vs Base and why
    ├── gas-model.md                # the gas-limit-charging analysis + measured envelopes
    ├── addresses.md
    ├── <contract>.md               # one per contract
    └── operations.md               # deploy, upgrade (via timelock), pause, rescue, incident response
```

---

## 5. PHASES

Execute exactly one phase per instruction. Each phase ends with a **Phase Report** in the format given in §6, followed by a full stop.

---

### PHASE 0 — Ground truth, toolchain, and feasibility

**Goal:** establish every verified fact before a line of code moves. No contracts written this phase.

Deliver `RESEARCH.md` containing:

1. **Network facts**, each confirmed against docs *and* a live RPC call: chain IDs, RPC endpoints, block time, finality, block gas limit, min base fee, current base fee, explorer + verification endpoints.
2. **EVM feature probe.** Deploy trivial probe contracts to Monad testnet and confirm on-chain: `TSTORE`/`TLOAD` (**blocking** — the executors depend on it), `MCOPY`, `PUSH0`, `CREATE2`, transient-storage reentrancy guard behavior. Record the correct `evm_version` for `foundry.toml`. If `TSTORE` is unavailable, **stop and report** — the flash-loan commitment guard needs a redesign and that is a scope change I must approve.
3. **Toolchain decision.** Install Monad Foundry (`foundryup --network monad`). Determine empirically whether upstream Foundry mis-prices gas for Monad (write a contract with many cold `SLOAD`s, measure under both). Record which toolchain CI must use for gas assertions. Record the correct deploy/verify command form for Monad (including whether `--legacy` is needed and what the verifier endpoint is).
4. **Address book (`ADDRESSES.md`).** For every address in §3.1 and §2.1: `cast code` to prove it is a contract, and at least one `cast call` to prove it is the contract you think it is (e.g. `Morpho.DOMAIN_SEPARATOR()`, `Router.owner()`, `USDC.decimals()`, `USDC.symbol()`). Any address that fails, mark `UNVERIFIED` and do not use it.
5. **Morpho feasibility.** Confirm `flashLoan(address,uint256,bytes)` exists on Monad's Morpho and that the callback shape matches `MorphoLeverageExecutor`'s expectation. Enumerate live Monad markets (id, loan asset, collateral, LLTV, oracle, IRM, liquidity) and propose the initial supported set. **If flash loans are unavailable, the leverage/exit executors are out of scope — say so.**
6. **Pendle feasibility.** Enumerate live Monad markets (market, PT, YT, SY, underlying, expiry, liquidity) via the v1 API for chain 143. Confirm the Router V4 ABI matches `IPendleRouter.sol`. Propose the initial market allowlist.
7. **LI.FI feasibility.** Confirm the Monad diamond, enumerate the facets/selectors FORTRESS needs (swap + bridge), and rebuild the selector allowlist. Confirm `li.quest` returns routes for USDC↔major on chain 143.
8. **Gas re-derivation (analysis only).** Using Monad's opcode prices, estimate the per-step cost of `FortStrategyExecutor` and produce a *predicted* `MAX_STEPS` that fits comfortably in the block gas limit and is economically sane under gas-limit charging. This is a prediction to be tested in Phase 3, not a final number.
9. **`CREATE2` audit.** Enumerate every place FORTRESS or its dependencies use `CREATE`/`CREATE2` inside a user call. Flag anything that would break for an EIP-7702 delegated caller.
10. **Adapter matrix restated** with your own verification results — confirming or correcting §3.1/§3.2. If you find that any of the three "absent" protocols has in fact deployed to Monad since this prompt was written, report it; **do not** start integrating it.
11. **`## UNVERIFIED`** — everything you could not confirm.

---

### PHASE 1 — Repo bootstrap, toolchain, and CI

Scaffold `fortress-monad/` per §4. Copy over the portable Solidity (core contracts, the five surviving adapters, the interfaces they need). Do **not** copy `CompoundV3Adapter`, `AerodromeAdapter`, `YoAdapter`, `IComet.sol`, `IAerodromeRouter.sol`, `IAerodromeGauge.sol`, or their tests/mocks/scripts.

- `foundry.toml`: pinned solc, pinned `evm_version` (from Phase 0), optimizer + `via_ir` settings re-justified against the 128 KB code limit, `[rpc_endpoints]` for `monad` and `monad_testnet`, `[etherscan]`/verifier config.
- Write `src/config/MonadAddresses.sol` from `ADDRESSES.md`. Enforce by CI: **no 40-hex address literal may appear anywhere in `src/` or `script/` outside this file.** Add a grep-based CI check.
- Port the test suite; delete tests for the three dropped adapters; ensure the remainder compiles (failures expected where Base addresses were assumed — that's Phase 2).
- CI: build, test, coverage, `forge snapshot --diff` gas gate, static analysis, and the address-literal check. CI must install Monad Foundry if Phase 0 concluded it's required.
- `src/adapters/PENDING.md` per §3.3.

---

### PHASE 2 — De-Base the codebase

Systematic removal of every Base-specific assumption.

- Replace every hardcoded address (there are ~30, including nine occurrences of the Base LI.FI diamond `0x1231DEB6...` and six of Base USDC `0x833589fC...`) with `MonadAddresses` constants or constructor/config parameters.
- Rebuild every allowlist from Monad reality: DEX targets, `approveTo` targets, bridge targets, function selectors, Pendle markets, Morpho markets.
- Re-point fork tests at Monad, pinned block, and record the block number.
- Grep for every remaining string/comment referencing Base, Aerodrome, Compound, or yo, and resolve each.
- Deliverable: `forge build` clean, and a table in the phase report of every address changed (old Base → new Monad → verification method).

---

### PHASE 3 — Core contracts under Monad's cost model

The three core contracts (`FortVault`, `FortSwapRouter`, `FortStrategyExecutor`) with constants re-derived from measurement, not inherited.

- Write `test/gas/` first: parameterized gas measurements across step counts, entry counts, and sweep-token counts, for every user entry point.
- From those measurements, derive and justify: real `MAX_STEPS`, real caps on `DepositEntry[]` / `WithdrawEntry[]` / `sweepTokens[]`. Document each in `docs/gas-model.md` with the measured curve.
- Optimize the dispatch hot path against 8100-gas cold `SLOAD`s and 10100-gas cold `CALL`s: cache registry lookups in memory across the loop, avoid re-reading the same token balance, collapse redundant hops. **Every optimization must preserve I1–I12 — prove it with the existing invariant tests, and do not trade a delta-based balance check for a cheaper absolute one (that was an audit finding).**
- Add I13 gas-envelope assertions to the invariant suite.
- All existing unit/fuzz/invariant tests green.

---

### PHASE 4 — Adapter set: the five that survive

`LiFiAdapter`, `MorphoStrategyAdapter`, `SwapStrategyAdapter`, `PendleAdapter`, `PendleStrategyAdapter` — retargeted, retested, fork-tested against real Monad protocol state.

- Per adapter: unit tests against mocks, fuzz tests on amount/slippage boundaries, **fork tests against the live Monad deployment** for at least one real market/route each.
- Rebuild `PendleAdapter`'s market allowlist from Phase 0's enumeration; add a test that an unlisted market reverts.
- Rebuild `LiFiAdapter`'s target + selector allowlists for the Monad diamond; add a test that an unlisted selector reverts (this closes an audit finding — do not regress it).
- Confirm the ERC-4626 fast path in `FortVault` against at least two live Monad MetaMorpho vaults.
- Restate: three adapter slots remain empty, reserved IDs documented.

---

### PHASE 5 — Leverage and exit executors *(conditional on Phase 0)*

Only if Phase 0 confirmed Morpho `flashLoan` on Monad **and** `TSTORE`/`TLOAD` availability.

- Port `MorphoLeverageExecutor` and `MorphoExitExecutor` unchanged in logic.
- Re-verify the callback guard: `msg.sender == morpho` **plus** transient commitment hash. Write an explicit test that a spoofed callback from a non-Morpho address reverts, and that a callback with a mismatched commitment reverts.
- Rebuild the DEX target + selector allowlist for the swap leg from Monad venues.
- Fork tests: open and close a real leveraged position against a live Monad Morpho market.
- Assert I1 (zero residual balance) and I3 (atomicity) explicitly after every path, including failure paths.

---

### PHASE 6 — `CrossChainRouter`

- Rebuild the bridge allowlist against LI.FI's Monad facets; evaluate **Circle CCTP v2** as the primary native-USDC path and record the decision in `DECISIONS.md`.
- Re-examine the keeper model against Monad's reserve-balance mechanism and local mempool: what does the keeper need to hold, how are nonces managed under concurrency, what happens if a keeper transaction is included but reverts (remember: reverting transactions still cost the full gas limit).
- Re-test the intent → fulfill → claim accounting, especially the fulfill/cancel race that was an audit finding, and the invariant that rescue/refund cannot touch `pendingWithdrawBalance`.
- Fork/testnet integration test of at least one full bridge round trip.

---

### PHASE 7 — Upgrade timelock and full test matrix

- **`UpgradeTimelock.sol`**: close the open HIGH finding. Every UUPS `_authorizeUpgrade` on Monad routes through a timelock (propose → delay → execute, with cancel), owned by a Safe (`0x69f4D1788e39c87893C980c06EdF4b7f686e2938` factory). Choose and justify the delay. Test propose/execute/cancel/early-execute-reverts.
- Complete the matrix: unit, fuzz (≥256 runs), invariant (I1–I13, depth ≥30), fork (pinned Monad block), gas regression, and a testnet end-to-end run.
- Coverage report with actual output pasted.

---

### PHASE 8 — Security audit

Reproduce the Nemesis methodology and output format from `Fort/.audit/`:

- Feynman logic pass, state-inconsistency pass, fusion loop.
- Plus a **Monad-specific pass** covering, at minimum: gas-limit-charging griefing (can an attacker force a victim into an oversized gas limit?); cold-access-cost DoS on unbounded loops; transient-storage guard correctness under the actual Monad EVM; EIP-7702 delegated-caller `CREATE2` breakage; reserve-balance interaction with the keeper; oracle staleness on Monad's faster block cadence; MEV assumptions that changed with the local mempool.
- Re-verify every one of the eight Base finding classes has not regressed.
- Output `audit/findings/pass-N.md` in the FORTRESS format with severity, evidence, and remediation. Fix everything Medium and above before the phase closes; document Lows with a decision.

---

### PHASE 9 — Deployment, configuration, and operations

- Testnet (10143) first: deploy → configure → verify → run the ops runbooks end to end.
- `VerifyDeployment.s.sol` must assert, on-chain, post-deploy: every registry entry, every allowlist entry, every owner, that the timelock owns every upgrade path, that no reserved-but-empty adapter slot is registered, and that every contract's token balances are zero.
- Contract verification on Monadscan/Sourcify for every deployed contract.
- `docs/operations.md`: deploy, upgrade-via-timelock, pause, rescue, keeper operation, incident response. Include the gas-limit guidance for the frontend/SDK (§2, row 1) — this is a user-facing cost issue, not a footnote.
- Produce, but **do not execute**, the mainnet deployment plan. Mainnet requires my explicit go-ahead.

---

### PHASE 10 — Documentation and handoff

- `docs/monad-differences.md`: every divergence from the Base deployment, with rationale.
- `docs/gas-model.md`: the measured envelopes and derived constants.
- One doc per contract, matching the Base repo's voice (dense, ASCII diagrams, tables, precise, no marketing).
- `ADDRESSES.md` final, with verification method per address.
- A handoff document for the operator covering the three empty adapter slots: interface contract, expected behavior, registration procedure, test template, and the audit checklist any new adapter must pass.

---

## 6. PHASE REPORT FORMAT

End every phase with exactly this, then stop:

```
## PHASE <N> REPORT — <name>

### Status
COMPLETE | COMPLETE WITH CAVEATS | BLOCKED

### Delivered
- <file> — <one line on what it does>

### Verification (actual command output, not claims)
$ <command>
<output>

### Addresses touched
| Purpose | Base (old) | Monad (new) | Verified how |

### Adapter slots
- Ported: <list>
- Empty, awaiting operator: CompoundV3, Aerodrome, YO — reserved adapterIds <list>

### Decisions made
- <decision> — <why> — recorded in DECISIONS.md

### Divergences from the Base deployment
- <what changed and why Monad forced it>

### Open questions for you
- <question requiring my input>

### Risks and unverified assumptions
- <anything I should know before approving the next phase>

### Next phase
Phase <N+1>: <name>. Awaiting your instruction.
```

---

## 7. STANDING RULES FOR EVERY PHASE

- **Test first, always.** Red, green, then refactor. Never write implementation before the failing test.
- **No address literals outside `src/config/MonadAddresses.sol`.** CI enforces it.
- **No address carried over from Base without on-chain re-verification.** Same-looking singleton addresses (Pendle Router, Permit2, Multicall3) still get `cast code`'d.
- **Every state change emits an event.** No exceptions.
- **Every external call's result is verified by an independent balance-delta measurement**, never by trusting the callee's return value, and never by absolute balance.
- **Every entry point that touches tokens ends by asserting the contract's balance of those tokens is zero**, except `CrossChainRouter`'s accounted escrow.
- **Every external integration gets both an address allowlist and a function-selector allowlist.**
- **Every user entry point has a measured gas envelope** asserted in `test/gas/` (I13). Gas is a correctness concern on Monad, not an optimization concern.
- **Never substitute a protocol for one of the three empty slots.** Report and stop.
- **When Monad makes something impossible or uneconomic, say so in the phase report and propose the alternative.** Never quietly ship a design that costs the user 4× what the Base version did.
- **Keep `RESEARCH.md`, `DECISIONS.md`, and `ADDRESSES.md` alive.** Every phase appends to them.
- **Match the source repo's documentation voice**: dense, tabular, precise, no marketing.

---

## 8. FIRST INSTRUCTION

Read this entire document. Then confirm in three or four sentences what you are building and what your Phase 0 deliverable is — and list anything in this prompt you believe is wrong, stale, or unverifiable, in particular any address in §3.1 that you doubt. Do not begin Phase 0 until I reply `Execute Phase 0`.
